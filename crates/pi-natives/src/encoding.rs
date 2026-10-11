//! N-API surface for the shared text-encoding policy and strict codec.
//!
//! Backed by `pi_edit::encoding`. The TypeScript tool shell resolves per-path
//! encodings through the compiled [`EncodingPolicy`] class so both sides share
//! one matcher implementation; `EditPolicy` carries the same JSON so edit
//! sessions compile the identical policy in-process.

use std::{path::PathBuf, sync::Arc};

use napi::bindgen_prelude::{Result, Uint8Array};
use napi_derive::napi;
use pi_edit::encoding::{
	CompiledEncodingPolicy, EncodingSpec, TextEncoding, decode_strict, encode_strict,
};

fn reason(err: impl std::fmt::Display) -> napi::Error {
	napi::Error::from_reason(err.to_string())
}

/// Parse `.omp/encoding.json` contents into the engine policy shape; the
/// message is user-facing (path context is added by the caller).
pub(crate) fn compile_policy(root: String, json: &str) -> Result<Arc<CompiledEncodingPolicy>> {
	let spec: EncodingSpec = serde_json::from_str(json)
		.map_err(|err| reason(format!(".omp/encoding.json is invalid: {err}")))?;
	CompiledEncodingPolicy::compile(PathBuf::from(root), &spec)
		.map(Arc::new)
		.map_err(reason)
}

/// Raw policy input for option structs (grep/ast/edit): the project root plus
/// the `.omp/encoding.json` contents. Compiled once per call.
#[napi(object)]
pub struct EncodingPolicyOptions {
	pub root: String,
	pub json: String,
}

/// Compile [`EncodingPolicyOptions`] when present.
pub(crate) fn compile_policy_options(
	options: Option<&EncodingPolicyOptions>,
) -> Result<Option<Arc<CompiledEncodingPolicy>>> {
	match options {
		None => Ok(None),
		Some(options) => compile_policy(options.root.clone(), &options.json).map(Some),
	}
}

/// Outcome of strictly transcoding one search input.
pub(crate) struct SearchTranscode {
	/// The path was decoded as GBK by the include scope's default rule (not an
	/// explicit override) and its BOM-free, non-ASCII bytes are also strictly
	/// valid UTF-8 — both encodings decode the file to different text, so the
	/// caller surfaces an ambiguity diagnostic instead of staying silent.
	pub utf8_ambiguous: bool,
}

/// Result of strictly decoding a source file or buffer through the encoding
/// policy.
pub(crate) struct StrictDecodedSource {
	pub text:           String,
	pub utf8_ambiguous: bool,
	pub diagnostic:     SourceDiagnostic,
}

pub(crate) enum SourceDiagnostic {
	NotApplicable,
	Checked,
	Ambiguous(usize),
	Unavailable,
}

#[napi(object)]
pub struct SourceEncodingDiagnostic {
	pub path:                String,
	pub kind:                String,
	pub scope:               String,
	pub checked_byte_length: u32,
	pub complete:            bool,
	pub reason:              Option<String>,
}

impl SourceDiagnostic {
	pub(crate) fn into_notice(self, path: String) -> Option<SourceEncodingDiagnostic> {
		let (kind, checked_byte_length, complete, reason) = match self {
			Self::Ambiguous(length) => ("ambiguous", length as u32, true, None),
			Self::Unavailable => ("unavailable", 0, false, Some("budget".to_owned())),
			Self::NotApplicable | Self::Checked => return None,
		};
		Some(SourceEncodingDiagnostic {
			path,
			kind: kind.to_owned(),
			scope: "file".to_owned(),
			checked_byte_length,
			complete,
			reason,
		})
	}
}

/// Maximum byte budget for diagnostic UTF-8 ambiguity / proof checks. Full
/// file parsing may exceed this, but extra diagnostics do not scan beyond 4
/// MiB.
pub(crate) const DIAGNOSTIC_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Strictly decode `bytes` according to the policy for `path`.
///
/// When `context_hint` is provided (e.g. for search), it is included in decode
/// failure messages.
pub(crate) fn decode_source_strict(
	bytes: &[u8],
	path: &std::path::Path,
	policy: Option<&CompiledEncodingPolicy>,
	context_hint: Option<&str>,
) -> std::result::Result<StrictDecodedSource, String> {
	let resolved = policy.and_then(|p| p.resolve_detailed(path, true));
	let (encoding, from_override) = match resolved {
		Some(resolved) => (resolved.encoding, resolved.from_override),
		None => (TextEncoding::Utf8, false),
	};
	if encoding == TextEncoding::Gbk && bytes.starts_with(&pi_edit::encoding::UTF8_BOM) {
		return Err(format!(
			"{}: UTF-8 BOM conflicts with GBK policy; add an explicit utf8 override in \
			 .omp/encoding.json",
			path.display()
		));
	}
	let text = decode_strict(bytes, encoding).map_err(|offset| {
		let hint = if encoding == TextEncoding::Gbk
			&& bytes.len() <= DIAGNOSTIC_MAX_BYTES
			&& pi_edit::encoding::utf8_ambiguous_with_gbk(bytes)
		{
			" The bytes are valid UTF-8 and invalid GBK, so this is a UTF-8 file swept in by a GBK \
			 include rule; add an explicit override with encoding \"utf8\" for this path."
		} else {
			""
		};
		if let Some(ctx) = context_hint {
			format!(
				"{}: invalid {} byte sequence at offset {offset}; {ctx}{hint}",
				path.display(),
				encoding_label(encoding)
			)
		} else {
			format!(
				"{}: invalid {} byte sequence at offset {offset}{hint}",
				path.display(),
				encoding_label(encoding)
			)
		}
	})?;
	let utf8_ambiguous = encoding == TextEncoding::Gbk
		&& !from_override
		&& bytes.len() <= DIAGNOSTIC_MAX_BYTES
		&& pi_edit::encoding::utf8_ambiguous_with_gbk(bytes);
	let diagnostic = if encoding != TextEncoding::Gbk || from_override {
		SourceDiagnostic::NotApplicable
	} else if bytes.len() > DIAGNOSTIC_MAX_BYTES {
		SourceDiagnostic::Unavailable
	} else if utf8_ambiguous {
		SourceDiagnostic::Ambiguous(bytes.len())
	} else {
		SourceDiagnostic::Checked
	};
	Ok(StrictDecodedSource { text, utf8_ambiguous, diagnostic })
}

/// Validate search input before matching in every output mode. A failed
/// decode is an error, never a successful zero-match result or lossy context.
pub(crate) fn transcode_search_strict(
	buffer: &mut Vec<u8>,
	path: &std::path::Path,
	policy: Option<&CompiledEncodingPolicy>,
) -> Result<SearchTranscode> {
	const SEARCH_ABORTED_HINT: &str = "search aborted without decoding substitutions. Check this \
	                                   project's .omp/encoding.json include rules and explicit \
	                                   encoding overrides; outside-root files require their own \
	                                   project context";
	let decoded =
		decode_source_strict(buffer, path, policy, Some(SEARCH_ABORTED_HINT)).map_err(reason)?;
	let utf8_ambiguous = decoded.utf8_ambiguous;
	*buffer = decoded.text.into_bytes();
	Ok(SearchTranscode { utf8_ambiguous })
}

/// A compiled `.omp/encoding.json` bound to one project root. Cheap to
/// query; create one per project and reuse it.
#[napi]
pub struct EncodingPolicy {
	inner: Arc<CompiledEncodingPolicy>,
}

#[napi]
impl EncodingPolicy {
	/// Compile `json` (raw `.omp/encoding.json` contents) against the
	/// project `root`. Fails on schema violations, unknown encodings, and
	/// invalid globs — never silently falls back to UTF-8.
	#[napi(constructor)]
	pub fn new(root: String, json: String) -> Result<Self> {
		Ok(Self { inner: compile_policy(root, &json)? })
	}

	/// Encoding `path` persists with: `"utf8"`, `"gbk"`, or `null` when the
	/// policy does not manage the path (upstream behavior). `exists=false`
	/// applies the new-file rule.
	#[napi]
	pub fn resolve(&self, path: String, exists: bool) -> Option<String> {
		self
			.inner
			.resolve(std::path::Path::new(&path), exists)
			.map(|encoding| encoding.as_str().to_owned())
	}

	/// [`Self::resolve`] plus what selected the encoding: `null` when the
	/// policy does not manage the path, else `{ encoding, fromOverride }`.
	/// `fromOverride=true` means an explicit override entry matched (the
	/// user's per-path answer); `false` means the include scope's
	/// default/new-file rule did.
	#[napi]
	pub fn resolve_detailed(&self, path: String, exists: bool) -> Option<EncodingResolution> {
		self
			.inner
			.resolve_detailed(std::path::Path::new(&path), exists)
			.map(|resolved| EncodingResolution {
				encoding:      resolved.encoding.as_str().to_owned(),
				from_override: resolved.from_override,
			})
	}

	/// Absolute policy root the globs are relative to.
	#[napi(getter)]
	pub fn root(&self) -> String {
		self.inner.root().to_string_lossy().into_owned()
	}
}

/// Policy answer for one path, with the origin that selected it.
#[napi(object)]
pub struct EncodingResolution {
	/// `"utf8"` or `"gbk"`.
	pub encoding:      String,
	/// `true` when an explicit override entry matched.
	pub from_override: bool,
}

/// Human label matching the engine's error strings (`UTF-8`, `GBK`).
const fn encoding_label(encoding: TextEncoding) -> &'static str {
	match encoding {
		TextEncoding::Utf8 => "UTF-8",
		TextEncoding::Gbk => "GBK",
	}
}

/// Strictly decode `bytes` (`"utf8"` or `"gbk"`) to text; rejects invalid
/// sequences with the byte offset instead of substituting replacement
/// characters.
#[napi]
pub fn encoding_decode_strict(bytes: Uint8Array, encoding: String) -> Result<String> {
	let encoding = TextEncoding::parse(&encoding).map_err(reason)?;
	decode_strict(&bytes, encoding).map_err(|offset| {
		reason(format!("invalid {} byte sequence at offset {offset}", encoding_label(encoding)))
	})
}

/// Strictly encode `text` (`"utf8"` or `"gbk"`) to bytes; rejects characters
/// the encoding cannot represent instead of substituting `?` or HTML numeric
/// references. The result always decodes back to exactly `text`.
#[napi]
pub fn encoding_encode_strict(text: String, encoding: String) -> Result<Uint8Array> {
	let encoding = TextEncoding::parse(&encoding).map_err(reason)?;
	let bytes = encode_strict(&text, encoding).map_err(|(offset, ch)| {
		reason(format!(
			"character U+{:04X} at byte offset {offset} cannot be represented in {}",
			ch as u32,
			encoding_label(encoding)
		))
	})?;
	Ok(Uint8Array::from(bytes))
}

/// Whether `text` is fully representable in `encoding` (pre-flight check
/// used by write paths that report before touching disk).
#[napi]
pub fn encoding_can_encode(text: String, encoding: String) -> Result<bool> {
	let encoding = TextEncoding::parse(&encoding).map_err(reason)?;
	Ok(encode_strict(&text, encoding).is_ok())
}

/// Reject Python coding declarations incompatible with the write encoding.
#[napi]
pub fn encoding_validate_source(path: String, text: String, encoding: String) -> Result<()> {
	let encoding = TextEncoding::parse(&encoding).map_err(reason)?;
	pi_edit::encoding::validate_source_encoding(std::path::Path::new(&path), &text, encoding)
		.map_err(reason)
}

/// Whether BOM-free, non-ASCII `bytes` are also strictly valid UTF-8.
///
/// The byte-level condition behind the GBK/UTF-8 ambiguity diagnostic; byte
/// validity only, never decoded-content inspection or character-frequency
/// guessing.
#[napi]
pub fn encoding_utf8_ambiguous_with_gbk(bytes: Uint8Array) -> bool {
	pi_edit::encoding::utf8_ambiguous_with_gbk(&bytes)
}
