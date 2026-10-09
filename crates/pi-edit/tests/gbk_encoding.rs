//! GBK end-to-end contracts at the engine layer: strict decode on read,
//! original-encoding persistence, unmodified-byte preservation, and refusal
//! (never substitution) on invalid input or unrepresentable output.
//!
//! The `EncodingWriter` mirrors what the TypeScript host's disk sink will do:
//! it encodes the write request's text per its `encoding` field and writes
//! bytes, reporting the persisted text back.

mod common;

use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use parking_lot::Mutex;
use pi_edit::{
	ApplyRequest, EditError, EditMode, EditResult, EditWriter, FileOp, WriteRequest, WriteResponse,
	encoding::{CompiledEncodingPolicy, EncodingSpec, TextEncoding, encode_strict},
};

/// Writer that persists write requests honoring `request.encoding` — the
/// byte-level contract the TypeScript sink implements.
#[derive(Default)]
struct EncodingWriter {
	requests: Mutex<Vec<WriteRequest>>,
}

#[async_trait]
impl EditWriter for EncodingWriter {
	async fn write(&self, request: WriteRequest) -> EditResult<WriteResponse> {
		self.requests.lock().push(request.clone());
		let content = request.content.clone().unwrap_or_default();
		let target = request
			.move_to
			.clone()
			.unwrap_or_else(|| request.absolute.clone());
		match request.op {
			FileOp::Delete => {
				std::fs::remove_file(&request.absolute).map_err(|e| EditError::Writer(e.to_string()))?
			},
			FileOp::Noop => {},
			FileOp::Create | FileOp::Update => {
				let bytes = match request.encoding {
					None | Some(TextEncoding::Utf8) => content.clone().into_bytes(),
					Some(TextEncoding::Gbk) => encode_strict(&content, TextEncoding::Gbk)
						.map_err(|(_, ch)| EditError::Writer(format!("unrepresentable {ch:?}")))?,
				};
				if let Some(parent) = target.parent() {
					std::fs::create_dir_all(parent).map_err(|e| EditError::Writer(e.to_string()))?;
				}
				std::fs::write(&target, bytes).map_err(|e| EditError::Writer(e.to_string()))?;
				if request.move_to.is_some() {
					let _ = std::fs::remove_file(&request.absolute);
				}
			},
		}
		Ok(WriteResponse { written: content, diagnostics_json: None })
	}
}

fn gbk_policy(cwd: &std::path::Path) -> Arc<CompiledEncodingPolicy> {
	let spec: EncodingSpec = serde_json::from_str(
		r#"{
			"schemaVersion": 1,
			"enabled": true,
			"include": ["src/**"],
			"defaultEncoding": "gbk",
			"newFileEncoding": "gbk",
			"overrides": [{ "glob": "src/utf8/**", "encoding": "utf8" }]
		}"#,
	)
	.expect("valid spec");
	Arc::new(CompiledEncodingPolicy::compile(cwd.to_path_buf(), &spec).expect("compiles"))
}

fn gbk_workspace(mode: EditMode) -> common::Workspace {
	let mut ws = common::Workspace::new(mode);
	ws.config.policy.encoding = Some(gbk_policy(ws.cwd()));
	ws
}

/// Write raw GBK bytes: "中文注释" in GBK is D6 D0 CE C4 D7 A2 CA CD.
fn gbk_bytes(text: &str) -> Vec<u8> {
	encode_strict(text, TextEncoding::Gbk).expect("fixture text is GBK-representable")
}

fn write_gbk(ws: &common::Workspace, rel: &str, text: &str) -> std::path::PathBuf {
	let path = ws.cwd().join(rel);
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent).expect("mkdir");
	}
	std::fs::write(&path, gbk_bytes(text)).expect("write GBK fixture");
	path
}

fn read_bytes(ws: &common::Workspace, rel: &str) -> Vec<u8> {
	std::fs::read(ws.cwd().join(rel)).expect("read bytes")
}

async fn apply(
	ws: &common::Workspace,
	args: &serde_json::Value,
	writer: &EncodingWriter,
) -> EditResult<pi_edit::ApplyOutcome> {
	let mut session = ws.session();
	session.set_args_json(&args.to_string());
	session.finish();
	session.apply(ApplyRequest::default(), writer).await
}

/// E01/E02: read a GBK file, edit through replace mode, persist as GBK;
/// unmodified bytes (comment, other lines) are byte-identical.
#[tokio::test]
async fn gbk_edit_round_trips_original_bytes() {
	let ws = gbk_workspace(EditMode::Replace);
	let original_text = "// 中文注释\nint x = 1;\nint y = 2;\n";
	write_gbk(&ws, "src/main.c", original_text);
	let writer = EncodingWriter::default();

	let _outcome = apply(
		&ws,
		&serde_json::json!({ "path": "src/main.c", "old_string": "int x = 1;", "new_string": "int x = 42;" }),
		&writer,
	)
	.await
	.expect("edit applies");

	let after = read_bytes(&ws, "src/main.c");
	let expected = gbk_bytes("// 中文注释\nint x = 42;\nint y = 2;\n");
	assert_eq!(after, expected, "file must be GBK with unmodified bytes preserved");
	// The write request told the host to persist GBK.
	assert_eq!(writer.requests.lock()[0].encoding, Some(TextEncoding::Gbk));
}

/// E03: CRLF line endings survive a one-line edit in a GBK file.
#[tokio::test]
async fn gbk_crlf_line_endings_preserved() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/win.c", "// 首行\r\nint a = 1;\r\nint b = 2;\r\n");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/win.c", "old_string": "int a = 1;", "new_string": "int a = 9;" }),
		&writer,
	)
	.await
	.expect("edit applies");
	assert_eq!(
		read_bytes(&ws, "src/win.c"),
		gbk_bytes("// 首行\r\nint a = 9;\r\nint b = 2;\r\n"),
		"CRLF endings must survive everywhere"
	);
}

/// E04: a file without a trailing newline stays without one.
#[tokio::test]
async fn gbk_no_trailing_newline_preserved() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/nt.c", "int x = 1;// 尾");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/nt.c", "old_string": "int x = 1;", "new_string": "int x = 2;" }),
		&writer,
	)
	.await
	.expect("edit applies");
	assert_eq!(read_bytes(&ws, "src/nt.c"), gbk_bytes("int x = 2;// 尾"));
}

/// E05: a no-change edit never reaches the writer.
#[tokio::test]
async fn gbk_noop_does_not_write() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/a.c", "int x = 1;\n");
	let before = read_bytes(&ws, "src/a.c");
	let writer = EncodingWriter::default();
	let result = apply(
		&ws,
		&serde_json::json!({ "path": "src/a.c", "old_string": "int x = 1;", "new_string": "int x = 1;" }),
		&writer,
	)
	.await;
	assert!(result.is_err(), "identical replace is rejected as a no-op upstream");
	assert_eq!(read_bytes(&ws, "src/a.c"), before, "file untouched");
	assert!(writer.requests.lock().is_empty(), "no write request issued");
}

/// E06: an all-ASCII file under a GBK rule gains Chinese and persists as GBK
/// (the encoding comes from the rule, not from content sniffing).
#[tokio::test]
async fn ascii_file_with_gbk_rule_gains_chinese_as_gbk() {
	let ws = gbk_workspace(EditMode::Replace);
	ws.write("src/plain.c", "int x = 1;\n");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/plain.c", "old_string": "int x = 1;", "new_string": "int x = 2; // 加注释" }),
		&writer,
	)
	.await
	.expect("edit applies");
	assert_eq!(read_bytes(&ws, "src/plain.c"), gbk_bytes("int x = 2; // 加注释\n"));
}

/// E08: an override exempts a subtree; UTF-8 behavior is preserved there.
#[tokio::test]
async fn override_exempts_utf8_subtree() {
	let ws = gbk_workspace(EditMode::Replace);
	ws.write("src/utf8/mod.ts", "const s = \"你好\";\n");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/utf8/mod.ts", "old_string": "你好", "new_string": "世界" }),
		&writer,
	)
	.await
	.expect("edit applies");
	assert_eq!(read_bytes(&ws, "src/utf8/mod.ts"), "const s = \"世界\";\n".as_bytes());
	assert_eq!(writer.requests.lock()[0].encoding, None);
}

/// Unmanaged paths keep upstream behavior: invalid UTF-8 there is still
/// rejected with the original message.
#[tokio::test]
async fn unmanaged_paths_keep_upstream_utf8_rejection() {
	let ws = gbk_workspace(EditMode::Replace);
	let path = ws.cwd().join("outside.txt");
	let original = b"name=caf\xe9\n";
	std::fs::write(&path, original).unwrap();
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "outside.txt", "old_string": "name", "new_string": "label" }),
		&writer,
	)
	.await
	.expect_err("invalid UTF-8 outside the policy is still refused");
	assert!(matches!(err, EditError::InvalidUtf8 { .. }), "{err}");
	assert_eq!(std::fs::read(&path).unwrap(), original);
}

/// E09: text GBK cannot represent (emoji) is refused before any write; the
/// original bytes are untouched.
#[tokio::test]
async fn unrepresentable_output_refused_before_write() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/e.c", "int x = 1;\n");
	let before = read_bytes(&ws, "src/e.c");
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "src/e.c", "old_string": "int x = 1;", "new_string": "int x = 2; // 完成 🎉" }),
		&writer,
	)
	.await
	.expect_err("emoji is not GBK-representable");
	let message = err.to_string();
	assert!(message.contains("U+1F389") && message.contains("GBK"), "{message}");
	assert!(writer.requests.lock().is_empty(), "no write may be issued");
	assert_eq!(read_bytes(&ws, "src/e.c"), before, "original bytes untouched");
}

/// E10: invalid GBK input is refused with a byte offset, never decoded to
/// mojibake, and produces no snapshot.
#[tokio::test]
async fn invalid_gbk_input_refused_with_offset() {
	let ws = gbk_workspace(EditMode::Replace);
	let path = ws.cwd().join("src/broken.c");
	std::fs::create_dir_all(path.parent().unwrap()).unwrap();
	let original = b"int ok;\n\xd6\x7f\n"; // 0x7F is not a valid GBK trail byte
	std::fs::write(&path, original).unwrap();
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "src/broken.c", "old_string": "int ok;", "new_string": "int fine;" }),
		&writer,
	)
	.await
	.expect_err("invalid GBK must not decode");
	let message = err.to_string();
	assert!(message.contains("invalid GBK") && message.contains("offset 8"), "{message}");
	assert!(writer.requests.lock().is_empty());
	assert_eq!(std::fs::read(&path).unwrap(), original);
}

/// E11: a UTF-8 BOM under a GBK rule is a policy conflict demanding an
/// explicit override, not a silent choice.
#[tokio::test]
async fn utf8_bom_under_gbk_rule_is_a_conflict() {
	let ws = gbk_workspace(EditMode::Replace);
	let path = ws.cwd().join("src/bom.c");
	std::fs::create_dir_all(path.parent().unwrap()).unwrap();
	let original = format!("// 中文\nint x = 1;\n");
	let mut bytes = b"\xEF\xBB\xBF".to_vec();
	bytes.extend_from_slice(original.as_bytes());
	std::fs::write(&path, &bytes).unwrap();
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "src/bom.c", "old_string": "int x = 1;", "new_string": "int x = 2;" }),
		&writer,
	)
	.await
	.expect_err("BOM conflict must be refused");
	let message = err.to_string();
	assert!(message.contains("policy conflict") && message.contains("override"), "{message}");
	assert_eq!(std::fs::read(&path).unwrap(), bytes, "file untouched");
}

/// Mixed line endings in a GBK-managed file refuse the write (documented
/// limitation) instead of normalizing the whole file.
#[tokio::test]
async fn mixed_line_endings_refuse_gbk_write() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/mixed.c", "// 一\r\nint a = 1;\nint b = 2;\r\n");
	let before = read_bytes(&ws, "src/mixed.c");
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "src/mixed.c", "old_string": "int a = 1;", "new_string": "int a = 2;" }),
		&writer,
	)
	.await
	.expect_err("mixed endings must refuse");
	let message = err.to_string();
	assert!(message.contains("mixed line endings"), "{message}");
	assert!(writer.requests.lock().is_empty());
	assert_eq!(read_bytes(&ws, "src/mixed.c"), before);
}

/// New files under the policy root persist with newFileEncoding (gbk).
#[tokio::test]
async fn new_file_uses_new_file_encoding() {
	let ws = gbk_workspace(EditMode::Patch);
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/fresh.c", "edits": [{ "op": "create", "diff": "// 新文件\nint x;\n" }] }),
		&writer,
	)
	.await
	.expect("create applies");
	assert_eq!(read_bytes(&ws, "src/fresh.c"), gbk_bytes("// 新文件\nint x;\n"));
	assert_eq!(writer.requests.lock()[0].encoding, Some(TextEncoding::Gbk));
}

/// E13: a GBK file externally modified after its snapshot was taken rejects
/// the stale edit (hashline stale-tag protection works on decoded text).
#[tokio::test]
async fn stale_edit_protection_works_for_gbk() {
	let ws = gbk_workspace(EditMode::Hashline);
	write_gbk(&ws, "src/stale.c", "int a = 1;\nint b = 2;\n");
	// Record the snapshot the model saw (what `read` does).
	let tag = ws.snapshot("src/stale.c", "int a = 1;\nint b = 2;\n", Some(&[1, 2]));
	// External editor rewrites the file (still GBK).
	write_gbk(&ws, "src/stale.c", "int a = 100;\nint b = 2;\n");
	let writer = EncodingWriter::default();
	let outcome = apply(
		&ws,
		&serde_json::json!({ "input": format!("[src/stale.c#{tag}]\nPUT 1.=1:\n+int a = 9;") }),
		&writer,
	)
	.await;
	// The stale tag must not silently overwrite the external edit: either the
	// apply errors, or a warning was raised — but never a write, and the
	// external bytes survive.
	if let Ok(outcome) = &outcome {
		assert!(
			outcome.text.contains("stale") || outcome.text.contains("changed"),
			"stale edits must be reported, got: {}",
			outcome.text
		);
	}
	assert!(writer.requests.lock().is_empty(), "stale edits must not write");
	assert_eq!(
		read_bytes(&ws, "src/stale.c"),
		gbk_bytes("int a = 100;\nint b = 2;\n"),
		"external edit must survive"
	);
}

/// E14: two consecutive edits in one workspace — the second uses the real
/// post-first-edit state (snapshots keyed on decoded text).
#[tokio::test]
async fn consecutive_edits_use_fresh_state() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/two.c", "// 起始\nint x = 1;\n");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/two.c", "old_string": "int x = 1;", "new_string": "int x = 2;" }),
		&writer,
	)
	.await
	.expect("first edit");
	apply(
		&ws,
		&serde_json::json!({ "path": "src/two.c", "old_string": "int x = 2;", "new_string": "int x = 3; // 第二次" }),
		&writer,
	)
	.await
	.expect("second edit sees the first edit's result");
	assert_eq!(read_bytes(&ws, "src/two.c"), gbk_bytes("// 起始\nint x = 3; // 第二次\n"));
}

/// `record_file` decodes GBK-managed files when the store carries the policy
/// (read tool integration contract: read and edit share one decode).
#[tokio::test]
async fn record_file_decodes_gbk_with_store_policy() {
	let ws = gbk_workspace(EditMode::Replace);
	write_gbk(&ws, "src/snap.c", "// 快照\nint x = 1;\n");
	ws.store.set_encoding_policy(Some(gbk_policy(ws.cwd())));
	let absolute = ws.cwd().join("src/snap.c");
	let tag = ws
		.store
		.record_file(&absolute, None)
		.expect("GBK file records a snapshot");
	let key = pi_edit::path_policy::canonical_key(&absolute);
	let text = ws
		.store
		.by_hash(&key, &tag)
		.expect("snapshot retrievable")
		.text
		.to_string();
	assert_eq!(text, "// 快照\nint x = 1;\n");
}

/// A move keeps the source encoding: the write request for the destination
/// carries the same encoding the source resolved to.
#[tokio::test]
async fn move_preserves_source_encoding_to_destination() {
	let ws = gbk_workspace(EditMode::Patch);
	write_gbk(&ws, "src/origin.c", "// 移动\nint x = 1;\n");
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/origin.c", "edits": [{ "op": "update", "rename": "src/renamed.c", "diff": "@@\n-int x = 1;\n+int x = 2;\n" }] }),
		&writer,
	)
	.await
	.expect("rename applies");
	assert_eq!(read_bytes(&ws, "src/renamed.c"), gbk_bytes("// 移动\nint x = 2;\n"));
	assert!(!ws.cwd().join("src/origin.c").exists());
}

#[test]
fn policy_encodes_root_and_spec_semantics_shared_with_napi() {
	let policy = gbk_policy(std::path::Path::new("/proj"));
	assert_eq!(policy.resolve(std::path::Path::new("/proj/src/a.c"), true), Some(TextEncoding::Gbk));
	assert_eq!(
		policy.resolve(std::path::Path::new("/proj/src/utf8/a.ts"), true),
		Some(TextEncoding::Utf8)
	);
	assert_eq!(policy.resolve(std::path::Path::new("/proj/README.md"), true), None);
}

#[test]
fn policy_resolves_verbatim_prefixed_paths() {
	// Simulate the Windows verbatim (`\\?\C:\x`) form a walker hands out;
	// a policy root in ordinary form must still govern it.
	let verbatim = std::path::PathBuf::from(r"\\?\C:\proj\src\a.c");
	let ordinary_root = gbk_policy(std::path::PathBuf::from(r"C:\proj").as_path());
	assert_eq!(ordinary_root.resolve(&verbatim, true), Some(TextEncoding::Gbk));
	// And the verbatim form of an unrelated root stays unmanaged.
	let other = std::path::PathBuf::from(r"\\?\D:\elsewhere\a.c");
	assert_eq!(ordinary_root.resolve(&other, true), None);
}

/// R01: `enabled: false` disables the policy everywhere — a UTF-8 file inside
/// the include globs must stay UTF-8 behavior, and edits must not go through
/// GBK validation.
#[tokio::test]
async fn disabled_policy_keeps_upstream_utf8_behavior() {
	let mut ws = common::Workspace::new(EditMode::Replace);
	let spec: EncodingSpec = serde_json::from_str(
		r#"{
			"schemaVersion": 1,
			"enabled": false,
			"include": ["src/**"],
			"defaultEncoding": "gbk",
			"newFileEncoding": "gbk"
		}"#,
	)
	.expect("disabled spec may omit nothing but stays valid");
	ws.config.policy.encoding = Some(Arc::new(
		CompiledEncodingPolicy::compile(ws.cwd().to_path_buf(), &spec).expect("compiles"),
	));
	// UTF-8 Chinese bytes in src/ — with the policy disabled this must read
	// as plain UTF-8 and persist as UTF-8.
	let utf8_text = "// 中文\nint x = 1;\n";
	ws.write("src/a.c", utf8_text);
	let writer = EncodingWriter::default();
	apply(
		&ws,
		&serde_json::json!({ "path": "src/a.c", "old_string": "int x = 1;", "new_string": "int x = 2;" }),
		&writer,
	)
	.await
	.expect("edit applies as UTF-8");
	let after = std::fs::read(ws.cwd().join("src/a.c")).unwrap();
	assert_eq!(after, "// 中文\nint x = 2;\n".as_bytes());
	assert_eq!(writer.requests.lock()[0].encoding, None);
}

/// R01: a disabled stub without the required encoding fields still compiles.
#[test]
fn disabled_policy_compiles_without_required_fields() {
	let spec: EncodingSpec =
		serde_json::from_str(r#"{ "schemaVersion": 1, "enabled": false }"#).expect("parses");
	let policy = CompiledEncodingPolicy::compile(Path::new("/proj").to_path_buf(), &spec)
		.expect("disabled stub compiles without encodings");
	assert_eq!(policy.resolve(Path::new("/proj/src/a.c"), true), None);
	assert_eq!(policy.resolve(Path::new("/proj/src/a.c"), false), None);
}

/// R04: GBK files whose bytes a re-encode would not reproduce (the euro sign
/// is `A2 E3` on disk but re-encodes as the single byte `80`) refuse edits so
/// unedited bytes never change silently.
#[tokio::test]
async fn byte_unstable_gbk_file_refuses_edits() {
	let ws = gbk_workspace(EditMode::Replace);
	let path = ws.cwd().join("src/euro.c");
	std::fs::create_dir_all(path.parent().unwrap()).unwrap();
	// "// 价 " with the euro as A2 E3, then an editable ASCII line.
	let original: &[u8] = &[
		0x2f, 0x2f, 0x20, 0xbc, 0xdb, 0xa2, 0xe3, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d,
		0x20, 0x31, 0x3b, 0x0a,
	];
	std::fs::write(&path, original).unwrap();
	let writer = EncodingWriter::default();
	let err = apply(
		&ws,
		&serde_json::json!({ "path": "src/euro.c", "old_string": "int x = 1;", "new_string": "int x = 2;" }),
		&writer,
	)
	.await
	.expect_err("byte-unstable files must refuse edits");
	let message = err.to_string();
	assert!(message.contains("original bytes"), "{message}");
	assert!(writer.requests.lock().is_empty());
	assert_eq!(std::fs::read(&path).unwrap(), original);
}
