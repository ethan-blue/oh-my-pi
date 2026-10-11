//! Project-scoped text encodings (UTF-8 default, opt-in GBK).
//!
//! One strict codec for every engine: decoding reports the first invalid byte
//! offset, encoding reports the first unrepresentable character, and nothing
//! ever degrades to replacement characters or HTML numeric references.
//! [`CompiledEncodingPolicy`] owns path matching (include globs plus ordered
//! overrides) so the Rust engines and the TypeScript tool shell resolve a
//! path to the same encoding through the same code.

use std::{
	borrow::Cow,
	collections::HashSet,
	io::Read,
	path::{Path, PathBuf},
};

use globset::GlobMatcher;
use serde::Deserialize;

/// Charset a managed file persists with. Everything the engine keeps in
/// memory stays Unicode; only disk bytes differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoding {
	Utf8,
	Gbk,
}

impl TextEncoding {
	/// Wire name used by `.omp/encoding.json` and the N-API boundary.
	pub const fn as_str(self) -> &'static str {
		match self {
			Self::Utf8 => "utf8",
			Self::Gbk => "gbk",
		}
	}

	/// Parse a configured encoding name; unknown or unsupported values are
	/// rejected (never silently mapped to UTF-8 or upgraded to GB18030).
	pub fn parse(name: &str) -> Result<Self, String> {
		match name.trim().to_ascii_lowercase().as_str() {
			"utf8" | "utf-8" => Ok(Self::Utf8),
			"gbk" | "cp936" | "ms936" => Ok(Self::Gbk),
			"gb18030" | "gb2312" | "big5" | "shift_jis" | "latin1" | "iso-8859-1" => Err(format!(
				"encoding '{name}' is not supported (supported: utf8, gbk); GBK is not silently \
				 upgraded to GB18030"
			)),
			other => Err(format!("unknown encoding '{other}' (supported: utf8, gbk)")),
		}
	}
}

impl std::fmt::Display for TextEncoding {
	fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		formatter.write_str(self.as_str())
	}
}

/// UTF-8 byte order mark prefix; a GBK-persisted file must not carry one.
pub const UTF8_BOM: [u8; 3] = [0xef, 0xbb, 0xbf];

/// Strictly decode `bytes` with `encoding`; `Err` carries the first invalid
/// byte offset. ASCII-only input is valid in every supported encoding.
pub fn decode_strict(bytes: &[u8], encoding: TextEncoding) -> Result<String, usize> {
	match encoding {
		TextEncoding::Utf8 => match std::str::from_utf8(bytes) {
			Ok(text) => Ok(text.to_owned()),
			Err(err) => Err(err.valid_up_to()),
		},
		TextEncoding::Gbk => gbk_decode_strict(bytes),
	}
}

/// Strictly validate a bounded search window.
///
/// A truncated window uses the
/// decoder's nonfinal state so a trailing partial character is withheld rather
/// than replaced or mistaken for an invalid complete file. Unread tails are
/// intentionally outside this validation contract.
pub fn read_validated_prefix(
	reader: impl std::io::Read,
	limit: usize,
	encoding: TextEncoding,
) -> std::io::Result<Vec<u8>> {
	let codec = match encoding {
		TextEncoding::Utf8 => encoding_rs::UTF_8,
		TextEncoding::Gbk => encoding_rs::GBK,
	};
	let mut decoder = codec.new_decoder_without_bom_handling();
	let mut prefix = Vec::with_capacity(limit);
	reader
		.take(limit.saturating_add(1) as u64)
		.read_to_end(&mut prefix)?;
	let truncated = prefix.len() > limit;
	prefix.truncate(limit);
	let mut output = vec![0u8; 64 * 1024];
	let mut consumed = 0usize;
	loop {
		let (result, read, _) =
			decoder.decode_to_utf8_without_replacement(&prefix[consumed..], &mut output, !truncated);
		consumed += read;
		match result {
			encoding_rs::DecoderResult::InputEmpty => break,
			encoding_rs::DecoderResult::OutputFull => {},
			encoding_rs::DecoderResult::Malformed(length, after) => {
				let label = match encoding {
					TextEncoding::Utf8 => "UTF-8",
					TextEncoding::Gbk => "GBK",
				};
				return Err(std::io::Error::new(
					std::io::ErrorKind::InvalidData,
					format!(
						"invalid {label} byte sequence at offset {}",
						consumed - usize::from(length) - usize::from(after),
					),
				));
			},
		}
	}
	if let Err(boundary) = decode_strict(&prefix, encoding) {
		// Nonfinal validation passed: withhold the incomplete window suffix.
		prefix.truncate(boundary);
	}
	Ok(prefix)
}

/// Strictly encode `text` with `encoding`; `Err` carries the byte index and
/// the first character GBK cannot represent. The result always re-decodes to
/// `text` (verified before returning).
pub fn encode_strict(text: &str, encoding: TextEncoding) -> Result<Vec<u8>, (usize, char)> {
	match encoding {
		TextEncoding::Utf8 => Ok(text.as_bytes().to_vec()),
		TextEncoding::Gbk => gbk_encode_strict(text),
	}
}

/// Check a Python source declaration before persistence. The cookie is a
/// constraint, never permission to change the configured encoding. Python 3
/// defaults to UTF-8 when no cookie is present.
pub fn validate_source_encoding(
	path: &Path,
	text: &str,
	encoding: TextEncoding,
) -> Result<(), String> {
	if !path
		.extension()
		.is_some_and(|ext| ext.eq_ignore_ascii_case("py") || ext.eq_ignore_ascii_case("pyw"))
	{
		return Ok(());
	}
	if text.starts_with('\u{feff}') && encoding != TextEncoding::Utf8 {
		return Err(format!("{}: Python UTF-8 BOM conflicts with target {encoding}", path.display()));
	}
	static COOKIE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
		regex::Regex::new(r"^[\t \x0c]*#.*?coding[:=][\t ]*([-_.a-zA-Z0-9]+)").unwrap()
	});
	let mut declared = None;
	for line in text.trim_start_matches('\u{feff}').lines().take(2) {
		if let Some(captures) = COOKIE.captures(line) {
			declared = Some(captures[1].to_owned());
			break;
		}
		// A second-line declaration only counts after a comment or blank line.
		if !line.trim().is_empty() && !line.trim_start().starts_with('#') {
			break;
		}
	}
	let name = declared
		.as_deref()
		.unwrap_or("utf-8")
		.to_ascii_lowercase()
		.replace('_', "-");
	if text.starts_with('\u{feff}') && !matches!(name.as_str(), "utf8" | "utf-8") {
		return Err(format!(
			"{}: Python UTF-8 BOM conflicts with coding declaration '{name}'",
			path.display()
		));
	}
	let compatible = match name.as_str() {
		"utf8" | "utf-8" | "utf-8-sig" => encoding == TextEncoding::Utf8,
		"gbk" | "cp936" | "ms936" => encoding == TextEncoding::Gbk,
		"ascii" | "us-ascii" => text.is_ascii(),
		_ => false,
	};
	if compatible {
		return Ok(());
	}
	Err(format!(
		"{}: Python source encoding '{name}' conflicts with target {encoding}; update the coding \
		 declaration or add an explicit include and encoding override in .omp/encoding.json before \
		 writing",
		path.display()
	))
}

/// Decode GBK bytes or fail with the first invalid byte offset.
///
/// `encoding_rs` performs the actual mapping; this wrapper only locates the
/// first offending byte (walking the lead/trail structure) when the WHATWG
/// decoder reported errors.
fn gbk_decode_strict(bytes: &[u8]) -> Result<String, usize> {
	let (text, had_errors) = encoding_rs::GBK.decode_without_bom_handling(bytes);
	if !had_errors {
		return Ok(text.into_owned());
	}
	Err(first_invalid_gbk_offset(bytes))
}

/// Byte offset of the first structurally invalid or unmapped GBK sequence.
fn first_invalid_gbk_offset(bytes: &[u8]) -> usize {
	let mut index = 0;
	while index < bytes.len() {
		let byte = bytes[index];
		if byte <= 0x7f || byte == 0x80 {
			// ASCII, or the single-byte CP936 euro sign.
			index += 1;
			continue;
		}
		if !(0x81..=0xfe).contains(&byte) {
			return index;
		}
		let Some(&trail) = bytes.get(index + 1) else {
			return index; // truncated trailing byte
		};
		let trail_ok = (0x40..=0x7e).contains(&trail) || (0x80..=0xfe).contains(&trail);
		if !trail_ok {
			return index;
		}
		let pair = &bytes[index..index + 2];
		let (_, pair_errors) = encoding_rs::GBK.decode_without_bom_handling(pair);
		if pair_errors {
			// Structurally valid pair that the WHATWG index leaves unmapped.
			return index;
		}
		index += 2;
	}
	// Unreachable when the caller saw `had_errors`; fall back to offset 0.
	0
}

/// Encode text as GBK or fail with the byte offset and character that has no
/// GBK byte sequence. The WHATWG encoder escapes unmappable characters as HTML
/// numeric references (`&#128512;`) and reports `had_errors`; that path is an
/// error here, never a substitute output.
fn gbk_encode_strict(text: &str) -> Result<Vec<u8>, (usize, char)> {
	let (bytes, _, had_errors) = encoding_rs::GBK.encode(text);
	if !had_errors {
		let (back, back_errors) = encoding_rs::GBK.decode_without_bom_handling(&bytes);
		if !back_errors && back == text {
			return Ok(bytes.to_vec());
		}
	}
	for (offset, ch) in text.char_indices() {
		let mut buffer = [0u8; 4];
		let (_, _, single_errors) = encoding_rs::GBK.encode(ch.encode_utf8(&mut buffer));
		if single_errors {
			return Err((offset, ch));
		}
	}
	// A per-character pass that succeeds while the whole-string encode failed
	// can only mean a state interaction GBK does not have; report offset 0.
	Err((0, '\u{FFFD}'))
}

/// Line-ending styles found in a file's raw text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum EndingStyle {
	Lf,
	CrLf,
	Cr,
}

/// Scan `text` for the set of line-ending styles it mixes. Pure LF and pure
/// CRLF return a single style; anything else is a mix the persist step cannot
/// faithfully restore (GB18030-era `LineEnding` only models Lf/CrLf).
fn ending_styles(text: &str) -> HashSet<EndingStyle> {
	let mut styles = HashSet::new();
	let bytes = text.as_bytes();
	let mut index = 0;
	while index < bytes.len() {
		match bytes[index] {
			b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
				styles.insert(EndingStyle::CrLf);
				index += 2;
			},
			b'\r' => {
				styles.insert(EndingStyle::Cr);
				index += 1;
			},
			b'\n' => {
				styles.insert(EndingStyle::Lf);
				index += 1;
			},
			_ => index += 1,
		}
	}
	styles
}

/// Whether a GBK-managed file's line endings cannot be restored exactly on
/// persist (mixed styles, or lone CR which `LineEnding` cannot express).
pub fn line_endings_unrestorable(text: &str) -> bool {
	let styles = ending_styles(text);
	styles.len() > 1 || styles.contains(&EndingStyle::Cr)
}

/// Raw `.omp/encoding.json` shape (see
/// docs/gbk-handoff/02-encoding-contract.md). Unknown keys are rejected so
/// typos fail at load instead of silently no-op'ing.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EncodingSpec {
	pub schema_version:    u32,
	pub enabled:           bool,
	#[serde(default)]
	pub include:           Vec<String>,
	pub default_encoding:  Option<String>,
	pub new_file_encoding: Option<String>,
	#[serde(default)]
	pub overrides:         Vec<EncodingOverrideSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncodingOverrideSpec {
	pub glob:     String,
	pub encoding: String,
}

/// Failure while validating an encoding policy; the message is user-facing.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct PolicyError(String);

/// A validated, compiled encoding policy bound to one project root.
#[derive(Debug)]
pub struct CompiledEncodingPolicy {
	root:              PathBuf,
	include:           Vec<GlobMatcher>,
	overrides:         Vec<(GlobMatcher, TextEncoding)>,
	default_encoding:  Option<TextEncoding>,
	new_file_encoding: Option<TextEncoding>,
	/// `false` when the spec said `enabled: false`: `resolve` always answers
	/// `None` so every consumer keeps upstream UTF-8 behavior.
	enabled:           bool,
}

impl CompiledEncodingPolicy {
	/// Validate `spec` and compile its globs relative to `root`.
	pub fn compile(root: PathBuf, spec: &EncodingSpec) -> Result<Self, PolicyError> {
		if spec.schema_version != 1 {
			return Err(PolicyError(format!(
				"unsupported schemaVersion {} (supported: 1)",
				spec.schema_version
			)));
		}
		// `enabled: false` disables the policy outright: resolve() always
		// answers `None` (upstream UTF-8 behavior), and the field requirements
		// below don't apply — a disabled stub may legitimately omit them.
		if !spec.enabled {
			return Ok(Self {
				root,
				include: Vec::new(),
				overrides: Vec::new(),
				default_encoding: None,
				new_file_encoding: None,
				enabled: false,
			});
		}
		let include = spec
			.include
			.iter()
			.map(|pattern| compile_glob(pattern))
			.collect::<Result<Vec<_>, _>>()
			.map_err(PolicyError)?;
		let overrides = spec
			.overrides
			.iter()
			.map(|entry| {
				let encoding = TextEncoding::parse(&entry.encoding).map_err(PolicyError)?;
				let matcher = compile_glob(&entry.glob).map_err(PolicyError)?;
				Ok((matcher, encoding))
			})
			.collect::<Result<Vec<_>, PolicyError>>()?;
		let default_encoding = match &spec.default_encoding {
			Some(name) => Some(TextEncoding::parse(name).map_err(PolicyError)?),
			None => None,
		};
		if !spec.include.is_empty() && default_encoding.is_none() {
			return Err(PolicyError("defaultEncoding is required when include is non-empty".into()));
		}
		let new_file_encoding = match &spec.new_file_encoding {
			Some(name) => Some(TextEncoding::parse(name).map_err(PolicyError)?),
			None => None,
		};
		if new_file_encoding.is_none() {
			return Err(PolicyError("newFileEncoding is required".into()));
		}
		if !include.is_empty() && new_file_encoding != default_encoding {
			return Err(PolicyError(
				"newFileEncoding must equal defaultEncoding within include scope so new files remain \
				 readable; use matching path overrides for encoding exceptions"
					.into(),
			));
		}
		Ok(Self { root, include, overrides, default_encoding, new_file_encoding, enabled: true })
	}

	/// Project root the globs are relative to.
	pub fn root(&self) -> &Path {
		&self.root
	}

	/// Resolve the encoding for `path`.
	///
	/// `None` keeps upstream behavior (the file is not managed). Outside the
	/// policy root the answer is always `None` — a home-directory policy never
	/// leaks into nested projects. Both new and existing files must match an
	/// include glob. Within that scope the first override wins; otherwise new
	/// files use `newFileEncoding` and existing files use the default.
	pub fn resolve(&self, path: &Path, exists: bool) -> Option<TextEncoding> {
		if !self.enabled {
			return None;
		}
		// Walkers on Windows hand out verbatim (`\\?\C:\x`) forms of the same
		// path; normalize both sides before matching so an ordinary-form root
		// still governs them.
		let path = strip_verbatim(path);
		let root = strip_verbatim(&self.root);
		let relative = path.strip_prefix(root.as_ref()).ok()?;
		let relative = to_forward_slashes(relative);
		if !self
			.include
			.iter()
			.any(|glob| glob.is_match(relative.as_ref()))
		{
			return None;
		}
		self
			.overrides
			.iter()
			.find(|(glob, _)| glob.is_match(relative.as_ref()))
			.map(|(_, encoding)| *encoding)
			.or(if exists {
				self.default_encoding
			} else {
				self.new_file_encoding
			})
	}
}

/// Compile one policy glob: gitignore-ish, `*` never crosses `/`, matched
/// against the root-relative forward-slash path, case-insensitive on Windows.
fn compile_glob(pattern: &str) -> Result<GlobMatcher, String> {
	globset::GlobBuilder::new(&pattern.replace('\\', "/"))
		.literal_separator(true)
		.case_insensitive(cfg!(windows))
		.build()
		.map(|glob| glob.compile_matcher())
		.map_err(|err| format!("invalid glob '{pattern}': {err}"))
}

/// Borrowed path with a Windows verbatim prefix (`\\?\C:\x` or
/// `\\?\UNC\server\x`) rewritten to its ordinary form; other paths pass
/// through unchanged.
fn strip_verbatim(path: &Path) -> std::borrow::Cow<'_, Path> {
	let text = path.to_string_lossy();
	if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
		return std::borrow::Cow::Owned(PathBuf::from(format!(r"\\{rest}")));
	}
	if let Some(rest) = text.strip_prefix(r"\\?\") {
		return std::borrow::Cow::Owned(PathBuf::from(rest.to_owned()));
	}
	std::borrow::Cow::Borrowed(path)
}

fn to_forward_slashes(path: &Path) -> Cow<'_, str> {
	let text = path.to_string_lossy();
	if text.contains('\\') {
		Cow::Owned(text.replace('\\', "/"))
	} else {
		text
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn decode_hex(hex: &str) -> Vec<u8> {
		(0..hex.len())
			.step_by(2)
			.map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
			.collect()
	}

	// ── codec: byte fixtures with independently chosen expected values ──────

	/// "中文" in GBK: D6 D0 CE C4.
	#[test]
	fn gbk_decodes_chinese_bytes() {
		let text = gbk_decode_strict(&decode_hex("d6d0cec4")).unwrap();
		assert_eq!(text, "中文");
	}

	/// Euro sign: single byte 0x80 in CP936.
	#[test]
	fn gbk_decodes_cp936_euro() {
		let text = gbk_decode_strict(b"\x80").unwrap();
		assert_eq!(text, "€");
	}

	/// Valid ASCII stays valid in every encoding.
	#[test]
	fn gbk_decodes_ascii() {
		assert_eq!(gbk_decode_strict(b"int x = 0;\r\n").unwrap(), "int x = 0;\r\n");
	}

	/// Truncated trail byte fails and reports the lead byte offset.
	#[test]
	fn gbk_rejects_truncated_sequence_with_offset() {
		let err = gbk_decode_strict(b"int \xd6").unwrap_err();
		assert_eq!(err, 4);
	}

	/// Invalid trail byte (0x7F is excluded from GBK trails).
	#[test]
	fn gbk_rejects_invalid_trail_byte() {
		let err = gbk_decode_strict(&[0xd6, 0x7f]).unwrap_err();
		assert_eq!(err, 0);
	}

	/// UTF-8 encoded Chinese fed to the GBK decoder must fail, not produce
	/// replacement characters.
	#[test]
	fn gbk_rejects_utf8_bytes_without_replacement() {
		let utf8_bytes = "中".as_bytes();
		let result = gbk_decode_strict(utf8_bytes);
		assert!(result.is_err());
	}

	/// Round trip: encode-then-decode is the identity for representable text.
	#[test]
	fn gbk_round_trips_chinese_and_ascii() {
		let text = "// 注释\nchar *s = \"你好，世界\";\nint € = 1;\n";
		let bytes = gbk_encode_strict(text).unwrap();
		assert_eq!(gbk_decode_strict(&bytes).unwrap(), text);
	}

	/// Emoji has no GBK sequence; encoding must fail with the character.
	#[test]
	fn gbk_encode_rejects_unrepresentable_character() {
		let text = "x = 1; // 完成 🎉\n";
		let (offset, ch) = gbk_encode_strict(text).unwrap_err();
		assert_eq!(ch, '🎉');
		assert_eq!(offset, text.char_indices().find(|(_, c)| *c == '🎉').unwrap().0);
	}

	/// The encoder never emits HTML numeric references.
	#[test]
	fn gbk_encode_never_emits_entities() {
		let bytes = gbk_encode_strict("价钱 = €5; 中文 ok").unwrap();
		assert!(!bytes.windows(2).any(|w| w == b"&#"));
	}

	#[test]
	fn encoding_names_parse_and_reject() {
		assert_eq!(TextEncoding::parse("utf8").unwrap(), TextEncoding::Utf8);
		assert_eq!(TextEncoding::parse("GBK").unwrap(), TextEncoding::Gbk);
		assert_eq!(TextEncoding::parse("cp936").unwrap(), TextEncoding::Gbk);
		assert!(TextEncoding::parse("gb18030").is_err());
		assert!(TextEncoding::parse("gb2312").is_err());
		assert!(TextEncoding::parse("utf16").is_err());
	}

	// ── line endings ────────────────────────────────────────────────────────

	#[test]
	fn mixed_endings_are_detected() {
		assert!(!line_endings_unrestorable("a\nb\nc"));
		assert!(!line_endings_unrestorable("a\r\nb\r\nc"));
		assert!(line_endings_unrestorable("a\r\nb\nc"));
		assert!(line_endings_unrestorable("a\rb\rc"));
		assert!(line_endings_unrestorable("a\rb\n"));
		assert!(!line_endings_unrestorable("no newlines at all"));
	}

	// ── policy resolution ───────────────────────────────────────────────────

	fn spec_json(json: &str) -> EncodingSpec {
		serde_json::from_str(json).unwrap()
	}

	fn compiled(json: &str) -> CompiledEncodingPolicy {
		let spec = spec_json(json);
		CompiledEncodingPolicy::compile(Path::new("/proj").to_path_buf(), &spec).unwrap()
	}

	const POLICY: &str = r#"{
		"schemaVersion": 1,
		"enabled": true,
		"include": ["src/**/*.c", "src/**/*.h"],
		"defaultEncoding": "gbk",
		"newFileEncoding": "gbk",
		"overrides": [{ "glob": "src/vendor-utf8/**", "encoding": "utf8" }]
	}"#;

	#[test]
	fn policy_manages_included_existing_files() {
		let policy = compiled(POLICY);
		assert_eq!(policy.resolve(Path::new("/proj/src/main.c"), true), Some(TextEncoding::Gbk));
	}

	#[test]
	fn policy_first_override_wins() {
		let policy = compiled(
			r#"{
				"schemaVersion": 1, "enabled": true,
				"include": ["src/**"],
				"defaultEncoding": "gbk",
				"newFileEncoding": "gbk",
				"overrides": [
					{ "glob": "src/a/**", "encoding": "utf8" },
					{ "glob": "src/a/b/**", "encoding": "gbk" }
				]
			}"#,
		);
		assert_eq!(policy.resolve(Path::new("/proj/src/a/b/x.c"), true), Some(TextEncoding::Utf8));
	}

	#[test]
	fn policy_leaves_unmanaged_paths_alone() {
		let policy = compiled(POLICY);
		assert_eq!(policy.resolve(Path::new("/proj/README.md"), true), None);
		assert_eq!(policy.resolve(Path::new("/proj/src/script.py"), true), None);
		assert_eq!(policy.resolve(Path::new("/proj/src/script.py"), false), None);
		// An override refines the include scope; it does not expand it.
		assert_eq!(policy.resolve(Path::new("/proj/src/vendor-utf8/gen.ts"), false), None);
		assert_eq!(policy.resolve(Path::new("/proj/src/vendor-utf8/gen.ts"), true), None);
		// Outside the root entirely.
		assert_eq!(policy.resolve(Path::new("/other/src/main.c"), true), None);
	}

	#[test]
	fn policy_new_files_follow_new_file_encoding() {
		let policy = compiled(POLICY);
		assert_eq!(
			policy.resolve(Path::new("/proj/src/newly_created.c"), false),
			Some(TextEncoding::Gbk)
		);
	}

	#[test]
	fn policy_new_files_take_path_override_first() {
		let policy = compiled(POLICY);
		assert_eq!(
			policy.resolve(Path::new("/proj/src/vendor-utf8/gen.c"), false),
			Some(TextEncoding::Utf8)
		);
	}

	#[test]
	fn policy_glob_star_does_not_cross_separator() {
		let policy = compiled(POLICY);
		assert_eq!(
			policy.resolve(Path::new("/proj/src/deep/dir/main.c"), true),
			Some(TextEncoding::Gbk)
		);
		// "src/*.c" would not match nested; this policy uses ** so it must.
		let shallow = compiled(
			r#"{
				"schemaVersion": 1, "enabled": true,
				"include": ["src/*.c"], "defaultEncoding": "gbk", "newFileEncoding": "gbk"
			}"#,
		);
		assert_eq!(shallow.resolve(Path::new("/proj/src/main.c"), true), Some(TextEncoding::Gbk));
		assert_eq!(shallow.resolve(Path::new("/proj/src/a/main.c"), true), None);
	}

	#[test]
	fn policy_schema_rejects_unknown_fields_and_encodings() {
		assert!(serde_json::from_str::<EncodingSpec>(
			r#"{"schemaVersion": 1, "enabled": true, "include": [], "defaultEncoding": "gbk", "newFileEncoding": "gbk", "oops": 1}"#
		)
		.is_err());
		let spec = spec_json(
			r#"{"schemaVersion": 1, "enabled": true, "include": ["**"], "defaultEncoding": "gb18030", "newFileEncoding": "gbk"}"#,
		);
		let err = CompiledEncodingPolicy::compile(Path::new("/p").to_path_buf(), &spec).unwrap_err();
		assert!(err.to_string().contains("not silently upgraded"));
	}

	#[test]
	fn policy_requires_default_when_include_non_empty() {
		let spec = spec_json(
			r#"{"schemaVersion": 1, "enabled": true, "include": ["src/**"], "newFileEncoding": "gbk"}"#,
		);
		assert!(CompiledEncodingPolicy::compile(Path::new("/p").to_path_buf(), &spec).is_err());
	}

	#[test]
	fn bom_conflict_bytes_are_recognized() {
		assert_eq!(&UTF8_BOM[..], "\u{FEFF}".as_bytes());
	}

	#[test]
	fn python_declarations_cannot_disagree_with_persisted_bytes() {
		let path = Path::new("/proj/check.py");
		for text in [
			"# coding: utf-8\n# 中文",
			"# 中文",
			"\u{feff}# coding: gbk\n# 中文",
			"# coding: unknown\n",
		] {
			assert!(validate_source_encoding(path, text, TextEncoding::Gbk).is_err());
		}
		assert!(
			validate_source_encoding(
				path,
				"#!/usr/bin/python\n# coding=cp936\n# 中文",
				TextEncoding::Gbk
			)
			.is_ok()
		);
		assert!(validate_source_encoding(path, "# coding: gbk\n# 中文", TextEncoding::Utf8).is_err());
		assert!(
			validate_source_encoding(path, "\u{feff}# coding: gbk\n# 中文", TextEncoding::Utf8)
				.is_err()
		);
		assert!(
			validate_source_encoding(path, "\u{feff}# coding: ascii\n", TextEncoding::Utf8).is_err()
		);
		assert!(
			validate_source_encoding(path, "\u{feff}# coding: utf-8\n# 中文", TextEncoding::Utf8)
				.is_ok()
		);
		assert!(validate_source_encoding(path, "x = 1\n# coding: gbk\n", TextEncoding::Gbk).is_err());
	}

	#[test]
	fn inconsistent_new_and_existing_encodings_are_rejected() {
		let spec = spec_json(
			r#"{"schemaVersion":1,"enabled":true,"include":["**"],"defaultEncoding":"gbk","newFileEncoding":"utf8"}"#,
		);
		assert!(CompiledEncodingPolicy::compile(PathBuf::from("/proj"), &spec).is_err());
	}

	#[test]
	fn bounded_search_prefix_withholds_incomplete_characters_without_validating_unread_tail() {
		for (bytes, encoding) in [
			(&b"a\xe4\xb8\xad\xff"[..], TextEncoding::Utf8),
			(&b"a\xd6\xd0\xff"[..], TextEncoding::Gbk),
		] {
			assert_eq!(read_validated_prefix(bytes, 2, encoding).unwrap(), b"a");
			assert!(read_validated_prefix(bytes, 8, encoding).is_err());
		}
		assert!(read_validated_prefix(&b"a\xe4"[..], 2, TextEncoding::Utf8).is_err());
		assert!(read_validated_prefix(&b"a\xd6"[..], 2, TextEncoding::Gbk).is_err());
	}

	#[test]
	fn disabled_and_outside_root_new_files_remain_unmanaged() {
		let policy = compiled(POLICY);
		assert_eq!(policy.resolve(Path::new("/other/src/main.c"), false), None);
		let disabled = compiled(
			r#"{"schemaVersion":1,"enabled":false,"include":["**"],"defaultEncoding":"gbk","newFileEncoding":"utf8"}"#,
		);
		assert_eq!(disabled.resolve(Path::new("/proj/main.c"), false), None);
		assert_eq!(disabled.resolve(Path::new("/proj/main.c"), true), None);
	}

	#[test]
	fn explicitly_selected_gbk_does_not_guess_valid_utf8_bytes() {
		let bytes = "中文".as_bytes();
		assert_eq!(decode_strict(bytes, TextEncoding::Utf8).unwrap(), "中文");
		assert_ne!(decode_strict(bytes, TextEncoding::Gbk).unwrap(), "中文");
	}
}
