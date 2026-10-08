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

	/// Absolute policy root the globs are relative to.
	#[napi(getter)]
	pub fn root(&self) -> String {
		self.inner.root().to_string_lossy().into_owned()
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
		reason(format!(
			"invalid {} byte sequence at offset {offset}",
			encoding_label(encoding)
		))
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
