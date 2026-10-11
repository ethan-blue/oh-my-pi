//! Decode child-process stdout/stderr into Unicode.
//!
//! Modern tools emit UTF-8 (Python with `PYTHONUTF8`, Node, Rust). Native
//! Windows programs on a CJK system write the ANSI code page to pipes — CP936
//! (GBK) on Simplified Chinese — and treating those bytes as UTF-8 replaces
//! them with U+FFFD (乱码).
//!
//! Policy: decode as UTF-8 until a complete invalid sequence; on Windows,
//! switch the remainder of that stream to the process ANSI code page
//! (`GetACP`) unless that page is already UTF-8.
//!
//! Valid UTF-8 always wins, including bytes that are also valid ACP (GBK 一 is
//! `D2 BB`, which is U+04BB in UTF-8). Overlap is ambiguous; this prefers the
//! modern-tool default over guessing language. The ACP switch is permanent
//! for the stream: command output is one encoding, not mixed. A single
//! invalid byte therefore ACP-decodes everything after it.
//!
//! [`OutputEncodingPreference`] lets the caller pin the stream's encoding
//! instead of relying on the UTF-8-first heuristic, and [`OutputDecoder`]
//! reports which encoding it ended up using plus how many undecodable
//! sequences became U+FFFD, so tool results can state their decode provenance
//! instead of leaving the reader to guess.

use std::str;

const REPLACEMENT: &str = "\u{FFFD}";
/// UTF-8 console / system code page. Fallback is a no-op: invalid UTF-8 stays
/// replacement characters rather than being re-decoded as itself.
#[cfg(windows)]
const CP_UTF8: u32 = 65001;

/// Caller-declared encoding of one captured output stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputEncodingPreference {
	/// UTF-8 first, with the host ANSI code page as fallback on Windows.
	#[default]
	Auto,
	/// UTF-8 only: invalid bytes become U+FFFD and never re-decode as ACP.
	Utf8,
	/// GBK (CP936) for the whole stream; no UTF-8 attempt is made.
	Gbk,
}

/// Encoding one decoder actually used for a stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputDecodeMode {
	#[default]
	Utf8,
	Gbk,
	/// Windows ANSI code page fallback, e.g. 936 (GBK) or 1252.
	#[cfg(windows)]
	AnsiCodepage(u32),
}

impl OutputDecodeMode {
	/// Wire label: `"utf8"`, `"gbk"`, or `"cp936"`/`"cp1252"` for an ANSI
	/// fallback page.
	#[must_use]
	pub fn as_str(&self) -> String {
		match self {
			Self::Utf8 => "utf8".to_owned(),
			Self::Gbk => "gbk".to_owned(),
			#[cfg(windows)]
			Self::AnsiCodepage(codepage) => format!("cp{codepage}"),
		}
	}
}

/// Provenance of one captured output stream's decode.
///
/// Carries which encoding the decoder ended up using and how many undecodable
/// sequences were lost to substitutions (U+FFFD in the UTF-8/GBK modes, the
/// Windows default character in the ACP mode); flows to tool results so the
/// consumer can state decode provenance instead of guessing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OutputDecodeSummary {
	pub encoding:     OutputDecodeMode,
	pub replacements: u32,
}

/// Decode provenance aggregated over every captured output reader of one run.
///
/// One summary per settled reader, in execution order — for a segmented
/// command chain that is one reader per executed segment, for a protected
/// build one per stream. `unknown_readers` counts captured readers that
/// finished WITHOUT a summary (killed at shutdown, pipe registration
/// failure). A report with unknowns is partial: the uniform-encoding and
/// summed-replacement views answer `None` instead of presenting observed-only
/// data as the whole run's provenance. Distinct mixed encodings stay visible
/// through [`Self::distinct_encodings`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OutputDecodeReport {
	parts:           Vec<OutputDecodeSummary>,
	unknown_readers: u32,
}

impl OutputDecodeReport {
	/// Record one settled reader's summary.
	pub fn record(&mut self, part: OutputDecodeSummary) {
		self.parts.push(part);
	}

	/// Record a captured reader that produced no summary.
	pub const fn record_unknown(&mut self) {
		self.unknown_readers = self.unknown_readers.saturating_add(1);
	}

	/// Fold another report's observations into this one (chain segments,
	/// sibling streams).
	pub fn merge(&mut self, other: Self) {
		self.parts.extend(other.parts);
		self.unknown_readers = self.unknown_readers.saturating_add(other.unknown_readers);
	}

	/// The one encoding every settled reader used — only when they all agree
	/// AND no reader is missing. `None` for mixed modes or partial
	/// observation.
	#[must_use]
	pub fn uniform_encoding(&self) -> Option<OutputDecodeMode> {
		if self.unknown_readers > 0 || self.parts.is_empty() {
			return None;
		}
		let first = self.parts[0].encoding;
		self
			.parts
			.iter()
			.all(|part| part.encoding == first)
			.then_some(first)
	}

	/// Distinct encodings among settled readers, in first-seen order; empty
	/// when nothing was observed.
	#[must_use]
	pub fn distinct_encodings(&self) -> Vec<OutputDecodeMode> {
		let mut distinct: Vec<OutputDecodeMode> = Vec::new();
		for part in &self.parts {
			if !distinct.contains(&part.encoding) {
				distinct.push(part.encoding);
			}
		}
		distinct
	}

	/// Whether at least one reader settled with a summary.
	#[must_use]
	pub const fn observed_any(&self) -> bool {
		!self.parts.is_empty()
	}

	/// Summed substitutions across settled readers; `None` while any reader
	/// is missing — a partial observation must not pose as a total.
	#[must_use]
	pub fn total_replacements(&self) -> Option<u32> {
		if self.unknown_readers > 0 {
			return None;
		}
		Some(
			self
				.parts
				.iter()
				.fold(0u32, |sum, part| sum.saturating_add(part.replacements)),
		)
	}

	/// Readers that finished without a summary.
	#[must_use]
	pub const fn unknown_count(&self) -> u32 {
		self.unknown_readers
	}
}

enum Mode {
	Utf8,
	Gbk(encoding_rs::Decoder),
	#[cfg(windows)]
	Acp,
}

/// Incremental decoder for one stdout/stderr stream.
pub struct OutputDecoder {
	pending:           Vec<u8>,
	mode:              Mode,
	replacements:      u32,
	#[cfg(windows)]
	fallback_codepage: u32,
}

impl Default for OutputDecoder {
	fn default() -> Self {
		Self::new()
	}
}

impl OutputDecoder {
	/// Decode with the host ANSI code page as the Windows fallback.
	/// Not `const`: `GetACP` is an FFI call.
	#[cfg(windows)]
	pub fn new() -> Self {
		Self::with_fallback_codepage(acp())
	}

	/// Decode as UTF-8 only; no ANSI fallback exists off Windows.
	#[cfg(not(windows))]
	pub const fn new() -> Self {
		Self { pending: Vec::new(), mode: Mode::Utf8, replacements: 0 }
	}

	/// Decode with an explicit ANSI fallback. Used by tests so GBK fixtures
	/// run on any Windows host, not only a Chinese ACP.
	#[cfg(windows)]
	pub const fn with_fallback_codepage(codepage: u32) -> Self {
		Self {
			pending:           Vec::new(),
			mode:              Mode::Utf8,
			replacements:      0,
			fallback_codepage: codepage,
		}
	}

	/// Decode per `preference` (see [`OutputEncodingPreference`]).
	#[must_use]
	pub fn with_preference(preference: OutputEncodingPreference) -> Self {
		match preference {
			#[cfg(windows)]
			OutputEncodingPreference::Auto => Self::new(),
			#[cfg(not(windows))]
			OutputEncodingPreference::Auto => {
				Self { pending: Vec::new(), mode: Mode::Utf8, replacements: 0 }
			},
			OutputEncodingPreference::Utf8 => Self {
				pending: Vec::new(),
				mode: Mode::Utf8,
				replacements: 0,
				#[cfg(windows)]
				fallback_codepage: CP_UTF8,
			},
			OutputEncodingPreference::Gbk => Self {
				pending: Vec::new(),
				mode: Mode::Gbk(encoding_rs::GBK.new_decoder_without_bom_handling()),
				replacements: 0,
				#[cfg(windows)]
				fallback_codepage: 0,
			},
		}
	}

	/// Push the next pipe read. Returns text that is safe to emit now;
	/// incomplete UTF-8 / DBCS sequences stay buffered.
	pub fn push(&mut self, bytes: &[u8]) -> String {
		if bytes.is_empty() {
			return String::new();
		}
		// Common case: nothing held back and the read is valid UTF-8.
		if self.pending.is_empty()
			&& matches!(self.mode, Mode::Utf8)
			&& let Ok(text) = str::from_utf8(bytes)
		{
			return text.to_owned();
		}
		self.pending.extend_from_slice(bytes);
		self.drain(false)
	}

	/// Flush held bytes at EOF.
	pub fn finish(&mut self) -> String {
		self.drain(true)
	}

	/// Encoding used so far; a fallback switch is permanent for the stream.
	#[must_use]
	pub const fn mode(&self) -> OutputDecodeMode {
		match self.mode {
			Mode::Utf8 => OutputDecodeMode::Utf8,
			Mode::Gbk(_) => OutputDecodeMode::Gbk,
			#[cfg(windows)]
			Mode::Acp => OutputDecodeMode::AnsiCodepage(self.fallback_codepage),
		}
	}

	/// Undecodable byte sequences this decoder substituted so far: U+FFFD in
	/// the UTF-8/GBK modes, the Windows default character in the ACP mode
	/// (counted by strict-validating each structural character against the
	/// same OS mapping — legitimate '?' or U+FFFD in the output is never
	/// counted).
	#[must_use]
	pub const fn replacements(&self) -> u32 {
		self.replacements
	}

	fn drain(&mut self, eof: bool) -> String {
		match self.mode {
			Mode::Utf8 => self.drain_utf8(eof),
			Mode::Gbk(_) => self.drain_gbk(eof),
			#[cfg(windows)]
			Mode::Acp => self.drain_acp(eof),
		}
	}

	/// Decodes `pending` with a cursor and compacts it once at the end, so a
	/// buffer with many invalid sequences costs linear time (draining the
	/// prefix per sequence made it quadratic).
	fn drain_utf8(&mut self, eof: bool) -> String {
		let mut out = String::with_capacity(self.pending.len());
		let mut start = 0;
		while start < self.pending.len() {
			let err = match str::from_utf8(&self.pending[start..]) {
				Ok(text) => {
					out.push_str(text);
					start = self.pending.len();
					break;
				},
				Err(err) => err,
			};
			let valid_end = start + err.valid_up_to();
			// SAFETY: [start..valid_end] is valid UTF-8 by valid_up_to().
			out.push_str(unsafe { str::from_utf8_unchecked(&self.pending[start..valid_end]) });
			start = valid_end;
			if let Some(invalid_len) = err.error_len() {
				#[cfg(windows)]
				if self.can_fallback_to_acp() {
					// One encoding per command. Do not resume UTF-8 after
					// a bad byte: later UTF-8 would be ACP-mojibake, but
					// cmd/chcp emit ACP for the whole stream.
					self.pending.drain(..start);
					self.mode = Mode::Acp;
					out.push_str(&self.drain_acp(eof));
					return out;
				}

				self.replacements = self.replacements.saturating_add(1);
				out.push_str(REPLACEMENT);
				start += invalid_len;
				continue;
			}
			// An incomplete sequence ends the buffer: hold it for the next
			// read, or resolve it at EOF.
			if eof {
				#[cfg(windows)]
				if self.can_fallback_to_acp() {
					self.pending.drain(..start);
					self.mode = Mode::Acp;
					out.push_str(&self.drain_acp(true));
					return out;
				}

				self.replacements = self.replacements.saturating_add(1);
				out.push_str(REPLACEMENT);
				start = self.pending.len();
			}
			break;
		}
		self.pending.drain(..start);
		out
	}

	/// Decode `pending` as GBK through an incremental WHATWG decoder. A
	/// malformed sequence consumes its own bytes (reported via `read`), emits
	/// one U+FFFD, and decoding continues — the counter keeps the loss
	/// observable.
	fn drain_gbk(&mut self, eof: bool) -> String {
		let mut out = String::with_capacity(self.pending.len());
		let mut consumed = 0usize;
		let mut output = [0u8; 8 * 1024];
		let Mode::Gbk(ref mut decoder) = self.mode else {
			return out;
		};
		loop {
			let (result, read, written) =
				decoder.decode_to_utf8_without_replacement(&self.pending[consumed..], &mut output, eof);
			consumed += read;
			// The decoder only ever writes UTF-8 code units.
			if let Ok(text) = str::from_utf8(&output[..written]) {
				out.push_str(text);
			}
			match result {
				encoding_rs::DecoderResult::InputEmpty => break,
				encoding_rs::DecoderResult::OutputFull => {},
				encoding_rs::DecoderResult::Malformed(..) => {
					self.replacements = self.replacements.saturating_add(1);
					out.push_str(REPLACEMENT);
				},
			}
		}
		self.pending.drain(..consumed);
		out
	}

	#[cfg(windows)]
	const fn can_fallback_to_acp(&self) -> bool {
		self.fallback_codepage != 0 && self.fallback_codepage != CP_UTF8
	}

	#[cfg(windows)]
	fn drain_acp(&mut self, eof: bool) -> String {
		if self.pending.is_empty() {
			return String::new();
		}
		let len = complete_acp_len(self.fallback_codepage, &self.pending, eof);
		if len == 0 {
			return String::new();
		}
		let slice = &self.pending[..len];
		let decoded = if let Some(text) = decode_codepage_strict(self.fallback_codepage, slice) {
			// Whole window maps cleanly: no default-character substitutions.
			text
		} else {
			// At least one sequence falls back to the OS default character.
			// Count them by strict-decoding each structural character
			// (single byte, or lead+trail pair) with the same Windows
			// mapping — never by scanning the decoded text for '?' or
			// U+FFFD, which legitimate output can contain.
			let mut out = String::with_capacity(len);
			let mut index = 0;
			while index < len {
				let unit = if is_dbcs_lead(self.fallback_codepage, slice[index]) && index + 1 < len {
					2
				} else {
					1
				};
				if let Some(text) =
					decode_codepage_strict(self.fallback_codepage, &slice[index..index + unit])
				{
					out.push_str(&text);
				} else {
					self.replacements = self.replacements.saturating_add(1);
					let lossy = decode_codepage(self.fallback_codepage, &slice[index..index + unit])
						.unwrap_or_else(|| {
							String::from_utf8_lossy(&slice[index..index + unit]).into_owned()
						});
					out.push_str(&lossy);
				}
				index += unit;
			}
			out
		};
		self.pending.drain(..len);
		decoded
	}
}

#[cfg(windows)]
fn acp() -> u32 {
	// SAFETY: GetACP has no preconditions.
	unsafe { windows_sys::Win32::Globalization::GetACP() }
}

#[cfg(windows)]
fn is_dbcs_lead(codepage: u32, byte: u8) -> bool {
	// SAFETY: `IsDBCSLeadByteEx` accepts any code-page id; unknown pages return
	// false.
	unsafe { windows_sys::Win32::Globalization::IsDBCSLeadByteEx(codepage, byte) != 0 }
}

/// Bytes at the start of `bytes` that form complete ACP characters.
///
/// A trail byte in GBK/Shift-JIS can itself be a lead-byte value, so holding
/// back whatever happens to be last is wrong — walk from the start of the
/// ACP segment instead.
#[cfg(windows)]
fn complete_acp_len(codepage: u32, bytes: &[u8], eof: bool) -> usize {
	let mut index = 0;
	while index < bytes.len() {
		if is_dbcs_lead(codepage, bytes[index]) {
			if index + 1 < bytes.len() {
				index += 2;
			} else {
				return if eof { bytes.len() } else { index };
			}
		} else {
			index += 1;
		}
	}
	index
}

#[cfg(windows)]
fn decode_codepage(codepage: u32, bytes: &[u8]) -> Option<String> {
	decode_codepage_with_flags(codepage, bytes, 0)
}

/// Strict variant: fails instead of substituting the OS default character, so
/// the caller can count real substitutions (used by `drain_acp`).
#[cfg(windows)]
fn decode_codepage_strict(codepage: u32, bytes: &[u8]) -> Option<String> {
	decode_codepage_with_flags(
		codepage,
		bytes,
		windows_sys::Win32::Globalization::MB_ERR_INVALID_CHARS,
	)
}

#[cfg(windows)]
fn decode_codepage_with_flags(codepage: u32, bytes: &[u8], flags: u32) -> Option<String> {
	if bytes.is_empty() {
		return Some(String::new());
	}
	let len = i32::try_from(bytes.len()).ok()?;
	// SAFETY: `bytes` is a valid slice of `len` bytes; a null wide-char buffer
	// with cchWideChar=0 is the documented size-query form.
	let needed = unsafe {
		windows_sys::Win32::Globalization::MultiByteToWideChar(
			codepage,
			flags,
			bytes.as_ptr(),
			len,
			std::ptr::null_mut(),
			0,
		)
	};
	if needed <= 0 {
		return None;
	}
	let mut wide = vec![0u16; needed as usize];
	// SAFETY: `wide` has `needed` UTF-16 units, matching the size query.
	let written = unsafe {
		windows_sys::Win32::Globalization::MultiByteToWideChar(
			codepage,
			flags,
			bytes.as_ptr(),
			len,
			wide.as_mut_ptr(),
			needed,
		)
	};
	if written <= 0 {
		return None;
	}
	Some(String::from_utf16_lossy(&wide[..written as usize]))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn utf8_passthrough() {
		let mut decoder = OutputDecoder::new();
		assert_eq!(decoder.push("hello 中文\n".as_bytes()), "hello 中文\n");
		assert_eq!(decoder.finish(), "");
	}

	#[test]
	fn incomplete_utf8_is_held_then_flushed() {
		let mut decoder = OutputDecoder::new();
		// First byte of UTF-8 中 (E4 B8 AD).
		assert_eq!(decoder.push(&[0xe4]), "");
		assert_eq!(decoder.push(&[0xb8, 0xad]), "中");
		assert_eq!(decoder.finish(), "");
	}

	#[test]
	fn incomplete_utf8_at_eof_becomes_replacement() {
		// Test UTF-8 semantics independently of the machine's ANSI code page.
		#[cfg(windows)]
		let mut decoder = OutputDecoder::with_fallback_codepage(CP_UTF8);
		#[cfg(not(windows))]
		let mut decoder = OutputDecoder::new();
		assert_eq!(decoder.push(&[0xe4]), "");
		assert_eq!(decoder.finish(), "\u{FFFD}");
	}

	#[cfg(windows)]
	#[test]
	fn gbk_decodes_to_chinese() {
		// GBK for 中文.
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce, 0xc4]), "中文");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn host_acp_decodes_gbk_when_system_is_936() {
		if acp() != 936 {
			return;
		}
		let mut decoder = OutputDecoder::new();
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce, 0xc4]), "中文");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn gbk_character_split_across_reads() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push(&[0xd6]), "");
		assert_eq!(decoder.push(&[0xd0, 0xce, 0xc4, b'\n']), "中文\n");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn gbk_holds_real_lead_not_trail_that_looks_like_lead() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		// 文 is CE C4; C4 is also a GBK lead value, so a last-byte heuristic
		// would hold it back and mangle 文.
		assert_eq!(decoder.push(&[0xce, 0xc4]), "文");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn ascii_prefix_then_gbk() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push(b"cmd"), "cmd");
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce, 0xc4]), "中文");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn utf8_preferred_over_gbk_fallback() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push("中文".as_bytes()), "中文");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(windows)]
	#[test]
	fn incomplete_utf8_at_eof_falls_back_to_acp() {
		// CP1252 for é is also an incomplete three-byte UTF-8 prefix. EOF proves
		// this stream is not valid UTF-8, so it must still trigger fallback.
		let mut decoder = OutputDecoder::with_fallback_codepage(1252);
		assert_eq!(decoder.push(&[0xe9]), "");
		assert_eq!(decoder.finish(), "é");
	}

	#[cfg(windows)]
	#[test]
	fn utf8_system_codepage_keeps_replacement() {
		let mut decoder = OutputDecoder::with_fallback_codepage(65001);
		assert_eq!(decoder.push(&[0xff]), "\u{FFFD}");
		assert_eq!(decoder.finish(), "");
	}

	#[cfg(not(windows))]
	#[test]
	fn invalid_utf8_becomes_replacement() {
		let mut decoder = OutputDecoder::new();
		assert_eq!(decoder.push(&[0xff]), "\u{FFFD}");
		assert_eq!(decoder.finish(), "");
	}

	// ── explicit encoding preference + observable decode mode ───────────────

	fn preference_decoder(preference: OutputEncodingPreference) -> OutputDecoder {
		OutputDecoder::with_preference(preference)
	}

	/// Explicit GBK decodes the whole stream as CP936 on every platform —
	/// no UTF-8-first attempt, so GBK bytes that merely look like broken
	/// UTF-8 still decode.
	#[test]
	fn explicit_gbk_decodes_whole_stream() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Gbk);
		assert_eq!(decoder.push(b"flag: "), "flag: ");
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce, 0xc4]), "中文");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.mode(), OutputDecodeMode::Gbk);
		assert_eq!(decoder.mode().as_str(), "gbk");
		assert_eq!(decoder.replacements(), 0);
	}

	/// A GBK double-byte character split across pipe reads is held and
	/// completed by the next read, not replaced.
	#[test]
	fn explicit_gbk_holds_split_pair_across_reads() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Gbk);
		assert_eq!(decoder.push(&[0xd6]), "");
		assert_eq!(decoder.push(&[0xd0, 0xce]), "中");
		assert_eq!(decoder.push(&[0xc4]), "文");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 0);
	}

	/// A dangling GBK lead byte at EOF becomes one U+FFFD, counted.
	#[test]
	fn explicit_gbk_counts_dangling_lead_at_eof() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Gbk);
		assert_eq!(decoder.push(&[0xd6, 0xd0]), "中");
		assert_eq!(decoder.push(&[0xd6]), "");
		assert_eq!(decoder.finish(), "\u{FFFD}");
		assert_eq!(decoder.replacements(), 1);
	}

	/// Structurally invalid GBK bytes each count one replacement and decoding
	/// continues with the following valid text. 0xFF is outside the GBK lead
	/// range, so each byte is its own one-byte malformed sequence.
	#[test]
	fn explicit_gbk_counts_each_malformed_byte() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Gbk);
		assert_eq!(decoder.push(&[0xff, 0xff, b'!']), "\u{FFFD}\u{FFFD}!");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 2);
	}

	/// The CP936 single-byte euro sign survives the explicit GBK path.
	#[test]
	fn explicit_gbk_decodes_cp936_euro() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Gbk);
		assert_eq!(decoder.push(&[0x80]), "€");
		assert_eq!(decoder.finish(), "");
	}

	/// Explicit UTF-8 never falls back to the ANSI page: invalid bytes stay
	/// U+FFFD, counted, and the mode stays UTF-8.
	#[test]
	#[cfg(windows)]
	fn explicit_utf8_never_falls_back_to_acp() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Utf8);
		// GBK 中文 is invalid UTF-8: two bad lead bytes replace immediately,
		// the third stays incomplete until EOF.
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce]), "\u{FFFD}\u{FFFD}");
		assert_eq!(decoder.finish(), "\u{FFFD}");
		assert_eq!(decoder.mode(), OutputDecodeMode::Utf8);
		assert_eq!(decoder.replacements(), 3);
	}

	#[test]
	#[cfg(not(windows))]
	fn explicit_utf8_replaces_invalid_bytes() {
		let mut decoder = preference_decoder(OutputEncodingPreference::Utf8);
		assert_eq!(decoder.push(&[0xd6, 0xd0, 0xce]), "\u{FFFD}\u{FFFD}");
		assert_eq!(decoder.finish(), "\u{FFFD}");
		assert_eq!(decoder.mode(), OutputDecodeMode::Utf8);
		assert_eq!(decoder.replacements(), 3);
	}

	/// Auto mode reports the ANSI page it fell back to, including non-CJK
	/// pages like 1252.
	#[test]
	#[cfg(windows)]
	fn auto_mode_reports_non_cjk_acp_fallback() {
		let mut decoder = OutputDecoder::with_fallback_codepage(1252);
		assert_eq!(decoder.push(b"ok "), "ok ");
		// 0xE9 alone is an incomplete UTF-8 prefix; at EOF the stream proves
		// it is not UTF-8 and the fallback engages.
		assert_eq!(decoder.push(&[0xe9]), "");
		assert_eq!(decoder.finish(), "é");
		assert_eq!(decoder.mode(), OutputDecodeMode::AnsiCodepage(1252));
		assert_eq!(decoder.mode().as_str(), "cp1252");
	}

	// ── ACP default-character substitution counting (strict validation) ─────

	/// The designer review's repro: a dangling CP936 lead byte substitutes the
	/// default character '?' at EOF — the loss must be counted, not reported
	/// as zero.
	#[test]
	#[cfg(windows)]
	fn acp_counts_dangling_lead_substitution() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push(&[0x81]), "");
		assert_eq!(decoder.finish(), "?");
		assert_eq!(decoder.replacements(), 1);
	}

	/// A structurally complete but unmapped pair substitutes the default
	/// character; valid text before and after it still decodes.
	#[test]
	#[cfg(windows)]
	fn acp_counts_invalid_trail_pair() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		// 0xD6 is a lead byte; 0x7F is not a valid CP936 trail.
		assert_eq!(decoder.push(b"a\xD6\x7Fb"), "a?b");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 1);
	}

	/// Legitimate '?' and the single-byte CP936 euro (0x80) are real mappings,
	/// not losses: strict validation passes them and nothing is counted.
	#[test]
	#[cfg(windows)]
	fn acp_does_not_count_legitimate_mappings() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		assert_eq!(decoder.push(&[0x80, b'?', b'x']), "€?x");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 0);
	}

	/// On a non-CJK page, the bytes Windows actually maps (CP1252's 0x81 →
	/// U+0081 via its C1 pass-through) decode without loss and count nothing;
	/// the counting itself is exercised on CP936 above, where unmapped
	/// sequences genuinely substitute.
	#[test]
	#[cfg(windows)]
	fn acp_non_cjk_page_mapped_bytes_are_not_counted() {
		let mut decoder = OutputDecoder::with_fallback_codepage(1252);
		assert_eq!(decoder.push(&[0x81]), "\u{81}");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 0);
	}

	/// Mixed content: real mappings decode, only the unmapped sequence counts.
	/// (0x81 followed by a valid trail is a legal pair, not a loss — the
	/// fixture uses a genuinely unmapped lead+trail.)
	#[test]
	#[cfg(windows)]
	fn acp_counts_only_substitutions_in_mixed_content() {
		let mut decoder = OutputDecoder::with_fallback_codepage(936);
		// Euro, then 中文 (D6 D0 CE C4), then an invalid pair (D6 7F), then x.
		assert_eq!(decoder.push(&[0x80, 0xd6, 0xd0, 0xce, 0xc4, 0xd6, 0x7f, b'x']), "€中文?x");
		assert_eq!(decoder.finish(), "");
		assert_eq!(decoder.replacements(), 1);
	}

	// ── aggregated provenance across readers ────────────────────────────────

	fn summary(encoding: OutputDecodeMode, replacements: u32) -> OutputDecodeSummary {
		OutputDecodeSummary { encoding, replacements }
	}

	#[test]
	fn report_answers_uniform_only_when_complete_and_agreeing() {
		let mut report = OutputDecodeReport::default();
		report.record(summary(OutputDecodeMode::Utf8, 2));
		report.record(summary(OutputDecodeMode::Utf8, 3));
		assert_eq!(report.uniform_encoding(), Some(OutputDecodeMode::Utf8));
		assert_eq!(report.total_replacements(), Some(5));
		assert_eq!(report.unknown_count(), 0);

		let mut mixed = OutputDecodeReport::default();
		mixed.record(summary(OutputDecodeMode::Utf8, 1));
		mixed.record(summary(OutputDecodeMode::Gbk, 0));
		assert_eq!(mixed.uniform_encoding(), None);
		assert_eq!(mixed.distinct_encodings(), vec![OutputDecodeMode::Utf8, OutputDecodeMode::Gbk]);
		assert_eq!(mixed.total_replacements(), Some(1));
	}

	#[test]
	fn report_unknown_reader_blocks_totals_but_keeps_observations_visible() {
		let mut report = OutputDecodeReport::default();
		report.record(summary(OutputDecodeMode::Utf8, 1));
		report.record_unknown();
		// Partial observation must not pose as the whole run's provenance.
		assert_eq!(report.uniform_encoding(), None);
		assert_eq!(report.total_replacements(), None);
		assert_eq!(report.unknown_count(), 1);
		assert_eq!(report.distinct_encodings(), vec![OutputDecodeMode::Utf8]);
		assert!(report.observed_any());

		let mut empty = OutputDecodeReport::default();
		empty.record_unknown();
		assert_eq!(empty.uniform_encoding(), None);
		assert_eq!(empty.total_replacements(), None);
		assert!(!empty.observed_any());
	}

	#[test]
	fn report_merges_chain_segments() {
		let mut first = OutputDecodeReport::default();
		first.record(summary(OutputDecodeMode::Utf8, 4));
		let mut second = OutputDecodeReport::default();
		second.record(summary(OutputDecodeMode::Utf8, 0));
		first.merge(second);
		assert_eq!(first.uniform_encoding(), Some(OutputDecodeMode::Utf8));
		assert_eq!(first.total_replacements(), Some(4));
	}

	/// Valid UTF-8 keeps the default mode without touching replacements.
	#[test]
	fn default_mode_stays_utf8() {
		let mut decoder = OutputDecoder::new();
		assert_eq!(decoder.push("中文\n".as_bytes()), "中文\n");
		assert_eq!(decoder.mode(), OutputDecodeMode::Utf8);
		assert_eq!(decoder.mode().as_str(), "utf8");
		assert_eq!(decoder.replacements(), 0);
	}
}

#[cfg(test)]
mod utf8_tests {
	use super::*;

	/// A decoder that never falls back to an ANSI code page.
	fn utf8_decoder() -> OutputDecoder {
		#[cfg(windows)]
		return OutputDecoder::with_fallback_codepage(CP_UTF8);
		#[cfg(not(windows))]
		return OutputDecoder::new();
	}

	#[test]
	fn invalid_sequences_between_text_keep_order_and_hold_the_tail() {
		let mut decoder = utf8_decoder();
		// Binary-ish output: invalid bytes between text, then the first byte of
		// a three-byte character that the next read completes.
		let mut bytes = Vec::new();
		for _ in 0..1000 {
			bytes.extend_from_slice(&[0xff, b'a', 0xc0, 0x80, b'b']);
		}
		bytes.push(0xe4);
		let decoded = decoder.push(&bytes);
		assert_eq!(decoded, "\u{FFFD}a\u{FFFD}\u{FFFD}b".repeat(1000));
		assert_eq!(decoder.push(&[0xb8, 0xad, b'\n']), "中\n");
		assert_eq!(decoder.finish(), "");
	}
}
