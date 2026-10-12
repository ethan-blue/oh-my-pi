//! N-API surface for the shared text-encoding policy and strict codec.
//!
//! Backed by `pi_edit::encoding`. The TypeScript tool shell resolves per-path
//! encodings through the compiled [`EncodingPolicy`] class so both sides share
//! one matcher implementation; `EditPolicy` carries the same JSON so edit
//! sessions compile the identical policy in-process.

use std::{collections::HashMap, path::PathBuf, sync::Arc};

use napi::bindgen_prelude::{Result, Uint8Array};
use napi_derive::napi;
use parking_lot::Mutex;
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
	use pi_edit::encoding::PolicyAssignment;
	let resolved = policy.and_then(|p| p.resolve_detailed(path, true));
	match resolved.map(|resolved| resolved.encoding) {
		Some(PolicyAssignment::Auto) => {
			// Explicit auto scope: strict UTF-8 first, then strict GBK.
			// Ambiguity diagnostics do not apply — auto already acknowledges
			// both readings.
			if let Ok(text) = decode_strict(bytes, TextEncoding::Utf8) {
				let ambiguous = pi_edit::encoding::dual_valid_utf8_with_gbk(bytes);
				return Ok(StrictDecodedSource {
					text,
					utf8_ambiguous: ambiguous,
					diagnostic: if ambiguous {
						SourceDiagnostic::Ambiguous(bytes.len())
					} else {
						SourceDiagnostic::NotApplicable
					},
				});
			}
			let text = decode_strict(bytes, TextEncoding::Gbk).map_err(|offset| {
				format!(
					"{}: neither strict UTF-8 nor strict GBK decodes this file (GBK failed at offset \
					 {offset})",
					path.display()
				)
			})?;
			Ok(StrictDecodedSource {
				text,
				utf8_ambiguous: false,
				diagnostic: SourceDiagnostic::NotApplicable,
			})
		},
		None => decode_source_fixed(bytes, path, TextEncoding::Utf8, false, context_hint),
		Some(PolicyAssignment::Fixed(encoding)) => {
			let from_override = resolved.is_some_and(|resolved| resolved.from_override);
			decode_source_fixed(bytes, path, encoding, from_override, context_hint)
		},
	}
}

fn decode_source_fixed(
	bytes: &[u8],
	path: &std::path::Path,
	encoding: TextEncoding,
	from_override: bool,
	context_hint: Option<&str>,
) -> std::result::Result<StrictDecodedSource, String> {
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

/// Outcome of a search-input decode attempt that may be reported instead of
/// thrown (report mode): the file is skipped, the remaining files continue.
#[derive(Clone)]
pub(crate) struct UndecodableSearchFile {
	pub message: String,
}

/// Report-mode variant of [`transcode_search_strict`]: decodes per the
/// policy, mapping a decode failure to a typed [`UndecodableSearchFile`]
/// instead of an error. `auto` assignments read strict UTF-8 first, then
/// strict GBK; explicit UTF-8/GBK assignments never cross-fall back. Files
/// with NO policy use [`decode_unmanaged_fallback`] when the caller's
/// read-fallback setting allows it.
pub(crate) fn transcode_search_reportable(
	buffer: &mut Vec<u8>,
	path: &std::path::Path,
	policy: Option<&CompiledEncodingPolicy>,
) -> std::result::Result<SearchTranscode, UndecodableSearchFile> {
	const HINT: &str = "not decodable as text under the active encoding policy; skipped in report \
	                    mode (this file was NOT searched)";
	let assignment = policy
		.and_then(|p| p.resolve_detailed(path, true))
		.map_or(pi_edit::encoding::PolicyAssignment::Fixed(TextEncoding::Utf8), |resolved| {
			resolved.encoding
		});
	match assignment {
		pi_edit::encoding::PolicyAssignment::Fixed(TextEncoding::Utf8) => {
			match decode_strict(buffer, TextEncoding::Utf8) {
				Ok(text) => {
					*buffer = text.into_bytes();
					Ok(SearchTranscode { utf8_ambiguous: false })
				},
				Err(offset) => Err(UndecodableSearchFile {
					message: format!(
						"{}: invalid UTF-8 byte sequence at offset {offset}; {HINT}",
						path.display()
					),
				}),
			}
		},
		pi_edit::encoding::PolicyAssignment::Fixed(TextEncoding::Gbk) => {
			transcode_search_strict(buffer, path, policy)
				.map_err(|error| UndecodableSearchFile { message: format!("{error}; {HINT}") })
		},
		pi_edit::encoding::PolicyAssignment::Auto => {
			// Explicit auto scope: strict UTF-8 first, then strict GBK.
			if let Ok(text) = decode_strict(buffer, TextEncoding::Utf8) {
				*buffer = text.into_bytes();
				return Ok(SearchTranscode { utf8_ambiguous: false });
			}
			match decode_strict(buffer, TextEncoding::Gbk) {
				Ok(text) => {
					*buffer = text.into_bytes();
					Ok(SearchTranscode { utf8_ambiguous: false })
				},
				Err(offset) => Err(UndecodableSearchFile {
					message: format!(
						"{}: neither strict UTF-8 nor strict GBK decodes this file (GBK failed at \
						 offset {offset}); {HINT}",
						path.display()
					),
				}),
			}
		},
	}
}

/// Read-only strict UTF-8→GBK fallback for files with no policy assignment.
/// Returns the decoded text or a typed failure message; never substitutes.
pub(crate) fn decode_unmanaged_fallback(
	buffer: &mut Vec<u8>,
	path: &std::path::Path,
) -> std::result::Result<SearchTranscode, UndecodableSearchFile> {
	match decode_strict(buffer, TextEncoding::Utf8) {
		Ok(text) => {
			*buffer = text.into_bytes();
			Ok(SearchTranscode { utf8_ambiguous: false })
		},
		Err(utf8_offset) => match decode_strict(buffer, TextEncoding::Gbk) {
			Ok(text) => {
				*buffer = text.into_bytes();
				Ok(SearchTranscode { utf8_ambiguous: false })
			},
			Err(gbk_offset) => Err(UndecodableSearchFile {
				message: format!(
					"{}: neither strict UTF-8 (offset {utf8_offset}) nor strict GBK (offset \
					 {gbk_offset}) decodes this file; {HINT}",
					path.display(),
					HINT = "not decodable as text; skipped in report mode (this file was NOT searched)"
				),
			}),
		},
	}
}

/// Per-search encoding decisions: the policy list (nearest project root wins
/// for a given file), the undecodable-file mode, and the read-only fallback
/// for files no policy manages. One instance serves a whole search call; the
/// per-file choice never calls back into JS.
type PolicyLookup = std::result::Result<Option<Arc<CompiledEncodingPolicy>>, String>;

pub(crate) struct SearchEncoding {
	policies:               Vec<std::sync::Arc<CompiledEncodingPolicy>>,
	/// `true` = skip undecodable files and report them; `false` = abort.
	pub report_undecodable: bool,
	/// `true` = files with no policy assignment read strict UTF-8 first, then
	/// strict GBK (the global read fallback). Never applies to explicit
	/// UTF-8/GBK assignments.
	pub unmanaged_fallback: bool,
	discovered:             Mutex<HashMap<PathBuf, PolicyLookup>>,
}

impl SearchEncoding {
	/// Single-policy (or no-policy) view with explicit mode flags.
	pub fn single(
		policy: Option<std::sync::Arc<CompiledEncodingPolicy>>,
		report_undecodable: bool,
		unmanaged_fallback: bool,
	) -> Self {
		Self {
			policies: policy.into_iter().collect(),
			report_undecodable,
			unmanaged_fallback,
			discovered: Mutex::new(HashMap::new()),
		}
	}

	/// Multi-policy view from caller-provided `{root, json}` options,
	/// ordered so the NEAREST root containing a path wins.
	pub fn from_options(
		options: &[EncodingPolicyOptions],
		report_undecodable: bool,
		unmanaged_fallback: bool,
	) -> Result<Self> {
		let mut policies = Vec::with_capacity(options.len());
		for option in options {
			policies.push(compile_policy(option.root.clone(), &option.json)?);
		}
		policies.sort_by_key(|policy| {
			std::cmp::Reverse(policy.root().as_os_str().to_string_lossy().len())
		});
		Ok(Self {
			policies,
			report_undecodable,
			unmanaged_fallback,
			discovered: Mutex::new(HashMap::new()),
		})
	}

	/// The policy whose root is the nearest ancestor of `path`, if any.
	/// Roots are pre-sorted nearest-first; comparison mirrors the engine's
	/// verbatim-stripping, forward-slash path semantics.
	pub fn policy_for(
		&self,
		path: &std::path::Path,
	) -> std::result::Result<Option<Arc<CompiledEncodingPolicy>>, String> {
		let normalized = path.to_string_lossy().replace('\\', "/");
		let normalized = normalized
			.strip_prefix(r"//?/UNC/")
			.map(|rest| format!("//{rest}"))
			.or_else(|| normalized.strip_prefix(r"//?/").map(str::to_owned))
			.unwrap_or(normalized);

		let normalized = if cfg!(windows) {
			normalized.to_ascii_lowercase()
		} else {
			normalized
		};
		let captured = self.policies.iter().find(|policy| {
			let root = policy.root().to_string_lossy().replace('\\', "/");
			let root = if cfg!(windows) {
				root.to_ascii_lowercase()
			} else {
				root
			};
			let root = root.trim_end_matches('/');
			normalized == root || normalized.starts_with(&format!("{root}/"))
		});
		let home = std::env::var_os("USERPROFILE")
			.or_else(|| std::env::var_os("HOME"))
			.map_or_default(PathBuf::from);
		pi_edit::path_policy::discover_policy_upward_with(path, &home, captured, |directory| {
			let mut cache = self.discovered.lock();
			cache
				.entry(directory.to_path_buf())
				.or_insert_with(|| pi_edit::path_policy::read_policy_directory(directory))
				.clone()
		})
	}

	/// Decode one whole-file search buffer per the per-file policy decision.
	/// Failures are typed; the caller decides abort vs report by
	/// `report_undecodable`.
	pub fn transcode(
		&self,
		buffer: &mut Vec<u8>,
		path: &std::path::Path,
	) -> std::result::Result<SearchTranscode, UndecodableSearchFile> {
		let policy = self
			.policy_for(path)
			.map_err(|message| UndecodableSearchFile { message })?;
		let assignment = policy
			.as_deref()
			.and_then(|p| p.resolve_detailed(path, true))
			.map(|resolved| resolved.encoding);
		match assignment {
			None => {
				// No policy manages this file.
				if self.unmanaged_fallback {
					decode_unmanaged_fallback(buffer, path)
				} else {
					match decode_strict(buffer, TextEncoding::Utf8) {
						Ok(text) => {
							*buffer = text.into_bytes();
							Ok(SearchTranscode { utf8_ambiguous: false })
						},
						Err(offset) => Err(UndecodableSearchFile {
							message: format!(
								"{}: invalid UTF-8 byte sequence at offset {offset}; search aborted \
								 without decoding substitutions. Check this project's .omp/encoding.json \
								 (or .ompg/encoding.json) include rules and explicit encoding overrides; \
								 outside-root files require their own project context",
								path.display()
							),
						}),
					}
				}
			},
			Some(_) => transcode_search_reportable(buffer, path, policy.as_deref()),
		}
	}

	/// The strict window encoding for a prefix read: the per-file fixed
	/// assignment, or the fallback order for auto/unmanaged files.
	pub fn prefix_mode(
		&self,
		path: &std::path::Path,
	) -> std::result::Result<PrefixDecodeMode, String> {
		use pi_edit::encoding::PolicyAssignment;
		let assignment = self
			.policy_for(path)?
			.as_deref()
			.and_then(|p| p.resolve_detailed(path, true))
			.map(|resolved| resolved.encoding);
		Ok(match assignment {
			Some(PolicyAssignment::Fixed(TextEncoding::Gbk)) => PrefixDecodeMode::Gbk,
			Some(PolicyAssignment::Fixed(TextEncoding::Utf8)) => PrefixDecodeMode::Utf8,
			// `auto` reads strict UTF-8 first, then strict GBK, by definition;
			// unmanaged files only when the global read fallback allows it.
			Some(PolicyAssignment::Auto) => PrefixDecodeMode::Utf8ThenGbk,
			None if self.unmanaged_fallback => PrefixDecodeMode::Utf8ThenGbk,
			None => PrefixDecodeMode::Utf8,
		})
	}
}

/// Strict decode order for a bounded search window.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrefixDecodeMode {
	Utf8,
	Gbk,
	Utf8ThenGbk,
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
				encoding:      assignment_label(resolved.encoding).to_owned(),
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
	/// `"utf8"`, `"gbk"`, or `"auto"` (schemaVersion 2 read branch: strict
	/// UTF-8 first, then strict GBK; never a write authorization).
	pub encoding:      String,
	/// `true` when an explicit override entry matched.
	pub from_override: bool,
}

/// Wire label for a policy assignment (`"utf8"`, `"gbk"`, `"auto"`).
pub(crate) const fn assignment_label(
	assignment: pi_edit::encoding::PolicyAssignment,
) -> &'static str {
	use pi_edit::encoding::PolicyAssignment;
	match assignment {
		PolicyAssignment::Fixed(TextEncoding::Utf8) => "utf8",
		PolicyAssignment::Fixed(TextEncoding::Gbk) => "gbk",
		PolicyAssignment::Auto => "auto",
	}
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
