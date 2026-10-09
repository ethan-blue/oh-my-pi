/**
 * Deterministic LSP workspace-edit and move-failure contracts for GBK files:
 * E21 — a rename/code-action style workspace edit (text edits + file rename)
 *        applied through the LSP edit surface keeps files GBK on disk;
 * E16 — a move whose destination write fails leaves the source untouched.
 *
 * No LSP server needed: `applyWorkspaceEdit` is the deterministic surface the
 * `lsp` tool drives; positions below are UTF-16 code units over the DECODED
 * text, never GBK byte offsets.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ensureFileOpen } from "@oh-my-pi/pi-coding-agent/lsp/client";
import { applyWorkspaceEdit } from "@oh-my-pi/pi-coding-agent/lsp/edits";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { fileToUri } from "@oh-my-pi/pi-coding-agent/lsp/utils";
import type { RenameFile, TextDocumentEdit, WorkspaceEdit } from "@oh-my-pi/pi-coding-agent/lsp/types";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "a", path: path.join(cwd, "a.log") }),
		settings: Settings.isolated(),
		enableLsp: false,
	};
}

/** Hand-mapped GBK sequences (independent of the codec under test). */
function gbk(text: string): Uint8Array<ArrayBuffer> {
	const map: Record<string, number[]> = {
		值: [0xd6, 0xb5],
		量: [0xc1, 0xbf],
		变: [0xb1, 0xe4],
		中: [0xd6, 0xd0],
		文: [0xce, 0xc4],
	};
	const out: number[] = [];
	for (const ch of text) {
		if (ch.codePointAt(0)! < 0x80) out.push(ch.charCodeAt(0));
		else {
			const seq = map[ch];
			if (!seq) throw new Error(`no GBK mapping for ${ch}`);
			out.push(...seq);
		}
	}
	return new Uint8Array(new ArrayBuffer(out.length)).map((_, i) => out[i]!);
}

const POLICY = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

describe("GBK LSP workspace edits and move failure", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-lsp-test-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY, "utf8");
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("create then edit and rename then edit use the ordered virtual file state", async () => {
		const original = path.join(tmpDir, "src", "created.c");
		const renamed = path.join(tmpDir, "src", "renamed.c");
		await applyWorkspaceEdit(
			{
				documentChanges: [
					{ kind: "create", uri: fileToUri(original) },
					{
						textDocument: { uri: fileToUri(original), version: null },
						edits: [
							{
								range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
								newText: "// 中文\nint a = 1;\n",
							},
						],
					},
					{ kind: "rename", oldUri: fileToUri(original), newUri: fileToUri(renamed) },
					{
						textDocument: { uri: fileToUri(renamed), version: null },
						edits: [
							{ range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } }, newText: "2" },
						],
					},
				],
			},
			tmpDir,
		);
		expect(await Bun.file(original).exists()).toBe(false);
		expect(await Bun.file(renamed).bytes()).toEqual(gbk("// 中文\nint a = 2;\n"));
	});

	it("a noncanonical GBK byte sequence rejects the complete batch without normalizing it", async () => {
		const good = path.join(tmpDir, "src", "good.c"),
			ambiguous = path.join(tmpDir, "src", "ambiguous.c");
		const original = Buffer.from([0x2f, 0x2f, 0xa2, 0xe3, 0x0a, 0x31]);
		await Bun.write(good, "1");
		await Bun.write(ambiguous, original);
		await expect(
			applyWorkspaceEdit(
				{
					changes: {
						[fileToUri(good)]: [
							{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "2" },
						],
						[fileToUri(ambiguous)]: [
							{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, newText: "2" },
						],
					},
				},
				tmpDir,
			),
		).rejects.toThrow("round-trip stable");
		expect(await Bun.file(good).text()).toBe("1");
		expect(Buffer.from(await Bun.file(ambiguous).bytes())).toEqual(original);
	});

	it("a rename-style workspace edit keeps GBK bytes and encoding (E21)", async () => {
		const file = path.join(tmpDir, "src", "mod.ts");
		await Bun.write(file, Buffer.from(gbk("const 值 = 1;\n")));

		const edit: TextDocumentEdit = {
			textDocument: { uri: fileToUri(file), version: 1 },
			edits: [
				{
					// UTF-16 positions over the decoded text: "const 值 = 1"
					// → "1" occupies [10, 11); never a GBK byte offset.
					range: { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } },
					newText: "2",
				},
			],
		};
		const rename: RenameFile = {
			kind: "rename",
			oldUri: fileToUri(file),
			newUri: fileToUri(path.join(tmpDir, "src", "mod2.ts")),
		};
		const workspaceEdit: WorkspaceEdit = { documentChanges: [edit, rename] };

		const { applied } = await applyWorkspaceEdit(workspaceEdit, tmpDir);
		expect(applied.length).toBe(2);

		// The edited+renamed file persists as GBK with the edit applied.
		const renamed = path.join(tmpDir, "src", "mod2.ts");
		const onDisk = new Uint8Array(await fs.readFile(renamed));
		expect(onDisk).toEqual(gbk("const 值 = 2;\n"));
		expect(
			await fs.stat(file).then(
				() => true,
				() => false,
			),
		).toBe(false);
	});

	it("a code-action style multi-file workspace edit preserves each GBK file (E21)", async () => {
		const a = path.join(tmpDir, "src", "a.ts");
		const b = path.join(tmpDir, "src", "b.ts");
		await Bun.write(a, Buffer.from(gbk("const 值 = 1;\n")));
		await Bun.write(b, Buffer.from(gbk("const 量 = 值;\n")));

		const editA: TextDocumentEdit = {
			textDocument: { uri: fileToUri(a), version: 1 },
			edits: [{ range: { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } }, newText: "9" }],
		};
		const editB: TextDocumentEdit = {
			textDocument: { uri: fileToUri(b), version: 1 },
			edits: [
				// Replace "值" (UTF-16 unit at position 10) with "变".
				{ range: { start: { line: 0, character: 10 }, end: { line: 0, character: 11 } }, newText: "变" },
			],
		};
		const { applied } = await applyWorkspaceEdit({ documentChanges: [editA, editB] }, tmpDir);
		expect(applied.length).toBe(2);

		expect(new Uint8Array(await fs.readFile(a))).toEqual(gbk("const 值 = 9;\n"));
		expect(new Uint8Array(await fs.readFile(b))).toEqual(gbk("const 量 = 变;\n"));
	});

	it("a failed destination write leaves the moved GBK source untouched (E16)", async () => {
		const source = path.join(tmpDir, "src", "origin.c");
		// Hand-mapped GBK fixture (independent of the codec under test).
		const full: number[] = [];
		const map: Record<string, number[]> = { 源: [0xd4, 0xb4], 文: [0xce, 0xc4], 件: [0xbc, 0xfe] };
		for (const ch of "// 源文件\nint x = 1;\n") {
			if (ch.codePointAt(0)! < 0x80) full.push(ch.charCodeAt(0));
			else
				full.push(
					...(map[ch] ??
						(() => {
							throw new Error(`no map ${ch}`);
						})()),
				);
		}
		const sourceBytes = new Uint8Array(new ArrayBuffer(full.length)).map((_, i) => full[i]!);
		await Bun.write(source, Buffer.from(sourceBytes));

		// Blocker: a regular FILE occupies the path that would be the
		// destination's parent directory, so the destination write fails with
		// ENOTDIR after staging — the delete of the source must never run.
		const blocker = path.join(tmpDir, "src", "blocker");
		await Bun.write(blocker, "i am a file\n");
		const session = createSession(tmpDir);
		const edit = new EditTool(session, "patch");

		const outcome = await edit.execute("move-1", {
			path: source,
			edits: [
				{
					op: "update",
					rename: "src/blocker/renamed.c",
					diff: "@@\n-int x = 1;\n+int x = 2;\n",
				},
			],
		});

		// The move failed; report the failure rather than half-applying.
		expect(outcome.isError).toBe(true);
		// Source survives with its original GBK bytes.
		const after = new Uint8Array(await fs.readFile(source));
		expect(after).toEqual(sourceBytes);
		// The blocker file is untouched as well.
		expect(new Uint8Array(await fs.readFile(blocker))).toEqual(Buffer.from("i am a file\n", "utf8"));
	});
});

describe("review regressions R05/R06", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-lsp-reg-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(
			path.join(tmpDir, ".omp", "encoding.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				include: ["src/**"],
				defaultEncoding: "gbk",
				newFileEncoding: "gbk",
				overrides: [],
			}),
			"utf8",
		);
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("R05: didOpen sends the policy-decoded text, not UTF-8 mojibake", async () => {
		const file = path.join(tmpDir, "src", "a.c");
		await Bun.write(file, Buffer.from(gbk("// 中文\nint x = 1;\n")));

		const frames: string[] = [];
		const client = {
			name: "gbk-reg-capture",
			config: { languageId: "c" },
			openFiles: new Map(),
			writeQueue: Promise.resolve(),
			proc: {
				stdin: {
					write: (data: Uint8Array) => {
						frames.push(Buffer.from(data).toString());
						return data.byteLength;
					},
					flush: () => 0,
				},
			},
		};
		await ensureFileOpen(client as never, file);

		const wire = frames.join("");
		expect(wire).toContain("textDocument/didOpen");
		// The server must see the decoded text (中文 present as escaped
		// UTF-8 JSON), never replacement characters from a UTF-8 misread.
		expect(wire).toContain("中文");
		expect(wire).not.toContain("\uFFFD");
	});

	it("R06: an unrepresentable second file rejects the whole batch before any write", async () => {
		const a = path.join(tmpDir, "src", "a.c");
		const b = path.join(tmpDir, "src", "b.c");
		const originalText = "// 中文\nint x = 1;\n";
		await Bun.write(a, Buffer.from(gbk(originalText)));
		await Bun.write(b, Buffer.from(gbk(originalText)));

		let message = "";
		try {
			await applyWorkspaceEdit(
				{
					changes: {
						[fileToUri(a)]: [
							{ range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } }, newText: "2" },
						],
						[fileToUri(b)]: [
							{ range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } }, newText: "😀" },
						],
					},
				},
				tmpDir,
			);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("rejected before any write");
		// Zero writes: BOTH files keep their original bytes.
		expect(new Uint8Array(await fs.readFile(a))).toEqual(gbk(originalText));
		expect(new Uint8Array(await fs.readFile(b))).toEqual(gbk(originalText));
	});
});
