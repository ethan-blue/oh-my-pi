//! Read-through file access for engines.
//!
//! [`FileSource`] resolves authored paths through [`PathPolicy`], recovers
//! missing paths by unique suffix, enforces the auto-generated guard, decodes
//! notebooks to their editable text, and caches reads by `(path, mtime, len)`
//! for the lifetime of one preview/apply pass. Engines never touch
//! `std::fs` directly; the session clears the cache before `apply` so a final
//! stage always sees fresh bytes.
//!
//! [`FileCache`] also owns the host's internal-URL answers: a URL target
//! missing from that table is recorded (see [`FileCache::take_unresolved`])
//! and fails with [`EditError::UnresolvedUrl`] until the host
//! [`FileCache::provide`]s it.

use std::{
	collections::HashMap,
	fs::FileType,
	path::{Path, PathBuf},
	sync::Arc,
	time::SystemTime,
};

use crate::{
	encoding::{
		TextEncoding, UTF8_BOM, decode_strict, encode_strict, line_endings_unrestorable,
		validate_source_encoding,
	},
	engine::{FileOp, Resolved},
	error::{EditError, EditResult},
	notebook,
	path_policy::{PathPolicy, UrlResolution, canonical_key},
	text::{LineEnding, detect_line_ending, normalize_to_lf, restore_line_endings, strip_bom},
};

/// One target file as read from disk plus its normalized editable form.
#[derive(Debug)]
pub struct FileRead {
	pub resolved:             Resolved,
	/// Snapshot-store key.
	pub canonical:            PathBuf,
	/// Bytes as read, decoded to the engine's Unicode model (notebook JSON
	/// for `.ipynb`; GBK-decoded text when the encoding policy manages the
	/// file — never lossy).
	pub raw:                  String,
	pub bom:                  &'static str,
	pub ending:               LineEnding,
	/// LF-normalized, BOM-stripped editable text (notebook cell projection).
	pub text:                 String,
	pub is_notebook:          bool,
	/// Charset the file persists with (`utf8` unless the encoding policy
	/// manages this path).
	pub encoding:             TextEncoding,
	/// Mixed (or lone-CR) line endings the persist step cannot faithfully
	/// restore; GBK-managed files refuse to write in that case.
	pub endings_unrestorable: bool,
	/// The file's original bytes are NOT reproduced by re-encoding its decoded
	/// text (e.g. GBK maps the euro sign both to `A2 E3` and the single byte
	/// `80`). Editing would silently change unedited bytes, so persist refuses.
	pub bytes_unstable:       bool,
}

impl FileRead {
	/// Encode LF-normalized post-edit text back to the bytes this file
	/// persists with: BOM and line endings restored, notebooks re-serialized.
	/// GBK-managed files are strictly encode-validated here (before any write
	/// is issued) and refuse when their original line endings cannot be
	/// restored exactly or their original bytes are not round-trip stable.
	pub fn persist(&self, after_lf: &str) -> EditResult<String> {
		validate_source_encoding(&self.resolved.absolute, after_lf, self.encoding)
			.map_err(EditError::apply)?;
		if self.is_notebook {
			return notebook::serialize_edited_notebook_text(
				Some(&self.raw),
				after_lf,
				&self.resolved.display,
			)
			.map_err(|err| EditError::apply(err.to_string()));
		}
		if self.encoding == TextEncoding::Gbk {
			persist_gbk_guard(
				&self.resolved.display,
				self.endings_unrestorable,
				self.bytes_unstable,
				after_lf,
			)?;
		}
		let mut out = String::with_capacity(self.bom.len() + after_lf.len());
		out.push_str(self.bom);
		out.push_str(&restore_line_endings(after_lf, self.ending));
		Ok(out)
	}
}

/// Write-side GBK guarantees: refuse unrestorable line endings and files whose
/// original bytes a re-encode would not reproduce, and verify every character
/// of the final text has a GBK byte sequence (encoding never substitutes `?`,
/// U+FFFD, or HTML numeric references).
fn persist_gbk_guard(
	display: &str,
	endings_unrestorable: bool,
	bytes_unstable: bool,
	after_lf: &str,
) -> EditResult<()> {
	if bytes_unstable {
		return Err(EditError::apply(format!(
			"{display}: refusing to edit — re-encoding this file's decoded text would not reproduce \
			 its original bytes (some byte sequences have more than one GBK spelling, e.g. the euro \
			 sign); add a path override with encoding \"utf8\" to the encoding policy or normalize \
			 the file deliberately outside ompg"
		)));
	}
	if endings_unrestorable {
		return Err(EditError::apply(format!(
			"{display}: refusing to write a GBK-managed file with mixed line endings (CRLF and LF \
			 mixed, or lone CR); normalize the line endings first or add a path override to the \
			 encoding policy"
		)));
	}
	if let Err((offset, ch)) = encode_strict(after_lf, TextEncoding::Gbk) {
		let line = after_lf[..offset].matches('\n').count() + 1;
		return Err(EditError::apply(format!(
			"{display}: character U+{:04X} ({}) on line {line} cannot be represented in GBK; remove \
			 it or add a path override with encoding \"utf8\" to the encoding policy",
			ch as u32, ch
		)));
	}
	Ok(())
}

/// Persist text for a file that did not exist before the edit.
///
/// The encoding comes from the policy's new-file rule (override match, else
/// `newFileEncoding`); GBK output is strictly validated before the write.
pub fn persist_new(policy: &PathPolicy, resolved: &Resolved, after_lf: &str) -> EditResult<String> {
	validate_source_encoding(
		&resolved.absolute,
		after_lf,
		policy
			.resolve_encoding(&resolved.absolute, false)
			.unwrap_or(TextEncoding::Utf8),
	)
	.map_err(EditError::apply)?;
	if notebook::is_notebook_path(&resolved.absolute) {
		return notebook::serialize_edited_notebook_text(None, after_lf, &resolved.display)
			.map_err(|err| EditError::apply(err.to_string()));
	}
	if policy.resolve_encoding(&resolved.absolute, false) == Some(TextEncoding::Gbk) {
		// New files have no original bytes to preserve.
		persist_gbk_guard(&resolved.display, false, false, after_lf)?;
	}
	Ok(after_lf.to_owned())
}

/// Root-relative, forward-slash display of `path` for error messages.
fn pathdiff_rel(root: &Path, path: &Path) -> String {
	match path.strip_prefix(root) {
		Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
		Err(_) => path.to_string_lossy().into_owned(),
	}
}

/// New-file encoding the policy assigns to `resolved` (for write requests).
pub fn new_file_encoding(policy: &PathPolicy, resolved: &Resolved) -> Option<TextEncoding> {
	policy.resolve_encoding(&resolved.absolute, false)
}

/// Filesystem view an engine reads through.
pub trait FileSource {
	fn policy(&self) -> &PathPolicy;

	/// Resolve an authored path without reading it. When `must_exist` and
	/// the resolved file is missing, unique-suffix recovery may substitute a
	/// different display/absolute pair (never for internal URLs, which fail
	/// with [`EditError::UnresolvedUrl`] until the host answers them).
	fn resolve(&mut self, authored: &str, must_exist: bool) -> EditResult<Resolved>;

	/// Whether `absolute` currently exists (file or directory).
	fn exists(&mut self, absolute: &Path) -> bool;

	/// Read a target that must exist. Fails with `File not found: <display>`
	/// after recovery, or with the auto-generated guard message.
	fn read(&mut self, authored: &str) -> EditResult<Arc<FileRead>>;

	/// Read an already-resolved target; `Ok(None)` when it does not exist.
	fn try_read(&mut self, resolved: &Resolved) -> EditResult<Option<Arc<FileRead>>>;

	/// Drop every cached read and path resolution. Host URL answers survive.
	fn clear(&mut self);
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp {
	mtime:        Option<SystemTime>,
	len:          u64,
	special_kind: Option<&'static str>,
}

/// Kind of a non-regular, non-directory file, or `None`. Reading one can block
/// forever (a FIFO, a terminal) or never end (`/dev/zero`). `metadata` follows
/// symlinks, so a link reports its target's kind.
fn special_file_kind(file_type: FileType) -> Option<&'static str> {
	if file_type.is_file() || file_type.is_dir() {
		return None;
	}
	#[cfg(unix)]
	{
		use std::os::unix::fs::FileTypeExt;
		if file_type.is_char_device() {
			return Some("character device");
		}
		if file_type.is_block_device() {
			return Some("block device");
		}
		if file_type.is_fifo() {
			return Some("FIFO");
		}
		if file_type.is_socket() {
			return Some("socket");
		}
	}
	Some("special file")
}

fn stamp(absolute: &Path) -> Option<Stamp> {
	let meta = std::fs::metadata(absolute).ok()?;
	Some(Stamp {
		mtime:        meta.modified().ok(),
		len:          meta.len(),
		special_kind: special_file_kind(meta.file_type()),
	})
}

/// Default [`FileSource`] backed by `std::fs`.
pub struct FileCache {
	policy:      PathPolicy,
	reads:       HashMap<PathBuf, (Stamp, Arc<FileRead>)>,
	/// Authored path → resolution (so paired hunks share one recovery).
	resolutions: HashMap<(String, bool), Resolved>,
	/// Host answers keyed by [`PathPolicy::url_target`].
	urls:        HashMap<String, UrlResolution>,
	/// URLs that missed `urls`, deduped in first-seen order.
	unresolved:  Vec<String>,
}

impl FileCache {
	/// Empty cache over `policy`.
	pub fn new(policy: PathPolicy) -> Self {
		Self {
			policy,
			reads: HashMap::new(),
			resolutions: HashMap::new(),
			urls: HashMap::new(),
			unresolved: Vec::new(),
		}
	}

	/// Record the host answer for `url`, dropping cached resolutions and
	/// reads made for it.
	pub fn provide(&mut self, url: String, resolution: UrlResolution) {
		let policy = &self.policy;
		let names_url = |authored: &str| policy.url_target(authored).as_deref() == Some(url.as_str());
		self
			.resolutions
			.retain(|(authored, _), _| !names_url(authored));
		self
			.reads
			.retain(|_, (_, read)| !names_url(&read.resolved.display));
		self.unresolved.retain(|missed| *missed != url);
		self.urls.insert(url, resolution);
	}

	/// Drain URLs that missed the resolution table since the last call
	/// (deduped, first-seen order).
	pub fn take_unresolved(&mut self) -> Vec<String> {
		std::mem::take(&mut self.unresolved)
	}

	/// Drop every host URL answer and recorded miss, plus every cached read
	/// and resolution (some were made from those answers), so URL targets ask
	/// the host again.
	pub fn forget_urls(&mut self) {
		self.clear();
		self.urls.clear();
		self.unresolved.clear();
	}

	/// Plan-mode write guard, judging URL targets by their host answers.
	///
	/// # Errors
	/// [`EditError::Plan`] when plan mode refuses the write.
	pub fn enforce_write(&self, display: &str, op: FileOp, move_to: Option<&str>) -> EditResult<()> {
		self.policy.enforce_write(display, op, move_to, &self.urls)
	}

	fn read_resolved(&mut self, resolved: &Resolved) -> EditResult<Option<Arc<FileRead>>> {
		let Some(current) = stamp(&resolved.absolute) else {
			return Ok(None);
		};
		if let Some(kind) = current.special_kind {
			return Err(EditError::apply(format!(
				"Cannot edit '{}': it is a {kind}, not a regular file or directory.",
				resolved.display
			)));
		}
		if let Some((cached_stamp, read)) = self.reads.get(&resolved.absolute)
			&& *cached_stamp == current
			&& read.resolved.display == resolved.display
		{
			return Ok(Some(Arc::clone(read)));
		}
		let bytes = match std::fs::read(&resolved.absolute) {
			Ok(bytes) => bytes,
			Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
			Err(source) => return Err(EditError::Io { path: resolved.absolute.clone(), source }),
		};
		if let Some(message) = self
			.policy
			.auto_generated_message(&resolved.display, &bytes[..bytes.len().min(1024)])
		{
			return Err(EditError::apply(message));
		}
		let is_notebook = notebook::is_notebook_path(&resolved.absolute);
		// Encoding policy: notebooks always stay UTF-8 (JSON); a GBK-managed
		// file is strictly decoded (BOM conflict refused, invalid bytes carry
		// their offset); everything else keeps upstream UTF-8 semantics.
		let managed_encoding = if is_notebook {
			None
		} else {
			self.policy.resolve_encoding(&resolved.absolute, true)
		};
		let mut bytes_unstable = false;
		let (raw, encoding) = match managed_encoding {
			None | Some(TextEncoding::Utf8) => match String::from_utf8(bytes) {
				Ok(raw) => (raw, TextEncoding::Utf8),
				Err(err) => {
					// R10 recovery guidance: with a policy present but this
					// path uncovered, the model must learn which rule gap to
					// close — never fall back to an out-of-band rewrite.
					if let Some(policy) = &self.policy.encoding {
						let rel = pathdiff_rel(policy.root(), &resolved.absolute);
						return Err(EditError::InvalidUtf8 {
							display:     format!(
								"{} (the encoding policy at {} does not cover this path; if the file is \
								 GBK, add an include rule for '{}' and re-read — do not rewrite it \
								 through shell or scripting languages)",
								resolved.display,
								policy.root().display(),
								rel,
							),
							valid_up_to: err.utf8_error().valid_up_to(),
						});
					}
					return Err(EditError::InvalidUtf8 {
						display:     resolved.display.clone(),
						valid_up_to: err.utf8_error().valid_up_to(),
					});
				},
			},
			Some(TextEncoding::Gbk) => {
				if bytes.starts_with(&UTF8_BOM) {
					return Err(EditError::apply(format!(
						"{}: policy conflict — the file carries a UTF-8 BOM but the encoding policy \
						 assigns GBK; add an override with encoding \"utf8\" for this path",
						resolved.display
					)));
				}
				match decode_strict(&bytes, TextEncoding::Gbk) {
					Ok(raw) => {
						// Byte stability: re-encoding the decoded text must
						// reproduce the original bytes, or an edit would
						// silently rewrite sequences the file never asked to
						// change (GBK spells the euro sign both `A2 E3` and
						// `80`). Unstable files refuse edits at persist time.
						bytes_unstable = match encode_strict(&raw, TextEncoding::Gbk) {
							Ok(encoded) => encoded != bytes,
							Err(_) => true,
						};
						(raw, TextEncoding::Gbk)
					},
					Err(offset) => {
						return Err(EditError::apply(format!(
							"{}: invalid GBK byte sequence at offset {offset}; refusing to decode \
							 lossily (fix the file or add a path override)",
							resolved.display
						)));
					},
				}
			},
		};
		let (bom, text) = if is_notebook {
			let editable = notebook::notebook_to_editable_text(&raw, &resolved.display)
				.map_err(|err| EditError::apply(err.to_string()))?;
			("", normalize_to_lf(&editable).into_owned())
		} else {
			let (bom, body) = strip_bom(&raw);
			(bom, normalize_to_lf(body).into_owned())
		};
		let (ending, endings_unrestorable) = if is_notebook {
			(LineEnding::Lf, false)
		} else {
			let body = strip_bom(&raw).1;
			(
				detect_line_ending(body),
				encoding == TextEncoding::Gbk && line_endings_unrestorable(body),
			)
		};
		let read = Arc::new(FileRead {
			canonical: canonical_key(&resolved.absolute),
			resolved: resolved.clone(),
			raw,
			bom,
			ending,
			text,
			is_notebook,
			encoding,
			endings_unrestorable,
			bytes_unstable,
		});
		self
			.reads
			.insert(resolved.absolute.clone(), (current, Arc::clone(&read)));
		Ok(Some(read))
	}
}

impl FileSource for FileCache {
	fn policy(&self) -> &PathPolicy {
		&self.policy
	}

	fn resolve(&mut self, authored: &str, must_exist: bool) -> EditResult<Resolved> {
		let key = (authored.to_owned(), must_exist);
		if let Some(resolved) = self.resolutions.get(&key) {
			return Ok(resolved.clone());
		}
		let resolved = self.policy.resolve(authored, &self.urls);
		if let Err(EditError::UnresolvedUrl(url)) = &resolved
			&& !self.unresolved.contains(url)
		{
			self.unresolved.push(url.clone());
		}
		let mut resolved = resolved?;
		if must_exist
			&& !self.policy.is_internal_url(authored)
			&& stamp(&resolved.absolute).is_none()
			&& let Some(recovered) = self.policy.recover_missing(authored)
		{
			resolved = recovered;
		}
		self.resolutions.insert(key, resolved.clone());
		Ok(resolved)
	}

	fn exists(&mut self, absolute: &Path) -> bool {
		stamp(absolute).is_some()
	}

	fn read(&mut self, authored: &str) -> EditResult<Arc<FileRead>> {
		let resolved = self.resolve(authored, true)?;
		self
			.read_resolved(&resolved)?
			.ok_or_else(|| EditError::apply(format!("File not found: {}", resolved.display)))
	}

	fn try_read(&mut self, resolved: &Resolved) -> EditResult<Option<Arc<FileRead>>> {
		self.read_resolved(resolved)
	}

	fn clear(&mut self) {
		self.reads.clear();
		self.resolutions.clear();
	}
}
