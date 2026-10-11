/**
 * G4 contracts: a broad GBK include rule sweeping in BOM-free UTF-8 files.
 *
 * The decode stays per the explicit policy — no guessing, no auto-switch —
 * but every surface reports the byte-level ambiguity: read (including :raw)
 * appends a notice, a strict GBK failure names the proven UTF-8 bytes, grep
 * lists the ambiguous files, and an edit carries the notice while keeping
 * untouched bytes stable. An explicit override is the user's per-path answer
 * and is never re-flagged.
 *
 * Fixtures are byte-exact: "// 中文\nint x = 1;\n" in UTF-8 is ALSO valid GBK
 * (the classic silent-mojibake overlap), while "// 中\nint x = 1;\n" in UTF-8
 * is invalid GBK (odd-length Chinese run misaligns the GBK pairs before the
 * LF, an invalid trail byte).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { BunFile } from "bun";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import { AstGrepTool } from "@oh-my-pi/pi-coding-agent/tools/ast-grep";
import { AstEditTool } from "@oh-my-pi/pi-coding-agent/tools/ast-edit";
import { applyWorkspaceEdit } from "@oh-my-pi/pi-coding-agent/lsp/edits";
import { fileToUri } from "@oh-my-pi/pi-coding-agent/lsp/utils";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ToolChoiceQueue } from "@oh-my-pi/pi-coding-agent/session/tool-choice-queue";
import {
	decodeStrict,
	inspectGbkAmbiguity,
	readGbkAmbiguityDiagnostic,
	ENCODING_DIAGNOSTIC_MAX_BYTES,
} from "@oh-my-pi/pi-coding-agent/encoding/index";
import { astGrep } from "@oh-my-pi/pi-natives";
import { READ_CHUNK_SIZE } from "@oh-my-pi/pi-coding-agent/tools/read-format";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "artifact-1", path: path.join(cwd, "artifact-1.log") }),
		settings: Settings.isolated({
			"bashInterceptor.enabled": false,
			"astGrep.enabled": false,
			"astEdit.enabled": false,
			"grep.enabled": false,
			"glob.enabled": false,
		}),
		enableLsp: false,
	};
}

function createSessionWithQueue(cwd: string): { session: ToolSession; queue: ToolChoiceQueue } {
	const queue = new ToolChoiceQueue();
	const base = createSession(cwd);
	const session: ToolSession = {
		...base,
		getToolChoiceQueue: () => queue,
		peekPendingInvoker: () => queue.peekPendingInvoker(),
		clearPendingInvokers: () => queue.clearPendingInvokers(),
	};
	return { session, queue };
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
		.map(b => b.text)
		.join("\n");
}

const encoder = new TextEncoder();

/** UTF-8 bytes that also decode as valid GBK (the both-valid overlap). */
const UTF8_ALSO_GBK = encoder.encode("// 中文\nint x = 1;\n");
/** UTF-8 bytes that are invalid GBK (odd Chinese run before LF). */
const UTF8_NOT_GBK = encoder.encode("// 中\nint x = 1;\n");
/** ASCII-only bytes decode identically in both encodings. */
const PURE_ASCII = encoder.encode("int x = 1;\n");
/** "// 中文\nint x = 1;\n" in real GBK bytes. */
const TRUE_GBK = new Uint8Array([
	0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x31, 0x3b, 0x0a,
]);

const POLICY = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

const POLICY_UTF8_OVERRIDE = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [{ glob: "src/doc.md", encoding: "utf8" }],
});

describe("GBK/UTF-8 encoding ambiguity diagnostics (G4)", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-ambiguity-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY, "utf8");
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("read decodes per policy but reports the both-valid overlap", async () => {
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const result = await new ReadTool(createSession(tmpDir)).execute("read-1", { path: file });
		const text = resultText(result);
		// The explicit GBK policy wins: the UTF-8 reading never appears.
		expect(text).toContain("int x = 1;");
		expect(text).not.toContain("中文");
		// ...but the ambiguity notice names the overlap and the override remedy.
		expect(text).toContain("also valid UTF-8");
		expect(text).toContain("override entry");
		expect(text).toContain(path.join(tmpDir, ".omp", "encoding.json"));
	});

	it("read :raw keeps strict GBK decoding and the same notice", async () => {
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const result = await new ReadTool(createSession(tmpDir)).execute("read-raw", { path: `${file}:raw` });
		const text = resultText(result);
		expect(text).toContain("int x = 1;");
		expect(text).toContain("also valid UTF-8");
	});

	it("an explicit utf8 override reads the file as UTF-8 with no notice", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY_UTF8_OVERRIDE, "utf8");
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const result = await new ReadTool(createSession(tmpDir)).execute("read-1", { path: file });
		const text = resultText(result);
		expect(text).toContain("// 中文");
		expect(text).not.toContain("also valid UTF-8");
	});

	it("pure-ASCII and true-GBK files raise no notice", async () => {
		const session = createSession(tmpDir);
		await fs.writeFile(path.join(tmpDir, "src", "ascii.c"), PURE_ASCII);
		await fs.writeFile(path.join(tmpDir, "src", "real.c"), TRUE_GBK);
		const ascii = resultText(
			await new ReadTool(session).execute("read-a", { path: path.join(tmpDir, "src", "ascii.c") }),
		);
		expect(ascii).not.toContain("also valid UTF-8");
		const real = resultText(
			await new ReadTool(session).execute("read-b", { path: path.join(tmpDir, "src", "real.c") }),
		);
		expect(real).toContain("// 中文");
		expect(real).not.toContain("also valid UTF-8");
	});

	it("a strict GBK failure on UTF-8 bytes says so instead of a bare offset", async () => {
		const file = path.join(tmpDir, "src", "odd.md");
		await fs.writeFile(file, UTF8_NOT_GBK);
		await expect(new ReadTool(createSession(tmpDir)).execute("read-1", { path: file })).rejects.toThrow(
			/valid UTF-8 and invalid GBK/,
		);
		// Failure keeps the file untouched.
		expect(new Uint8Array(await fs.readFile(file))).toEqual(UTF8_NOT_GBK);
	});

	it("grep lists ambiguous files in the result note", async () => {
		await fs.writeFile(path.join(tmpDir, "src", "doc.md"), UTF8_ALSO_GBK);
		await fs.writeFile(path.join(tmpDir, "src", "real.c"), TRUE_GBK);
		const result = await new GrepTool(createSession(tmpDir)).execute("grep-1", {
			pattern: "int",
			path: path.join(tmpDir, "src"),
		});
		const text = resultText(result);
		expect(text).toContain("int x = 1;");
		expect(text).toContain("also valid UTF-8");
		expect(text).toContain("doc.md");
		// The true GBK file is not flagged.
		const flagged = text.split("\n").find(line => line.includes("also valid UTF-8"));
		expect(flagged).not.toContain("real.c");
	});

	it("grep names the proven UTF-8 bytes when the GBK decode fails", async () => {
		await fs.writeFile(path.join(tmpDir, "src", "odd.md"), UTF8_NOT_GBK);
		await expect(
			new GrepTool(createSession(tmpDir)).execute("grep-1", {
				pattern: "int",
				path: path.join(tmpDir, "src"),
			}),
		).rejects.toThrow(/valid UTF-8 and invalid GBK/);
	});

	it("an edit applies per policy, carries the notice, and keeps untouched bytes stable", async () => {
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const session = createSession(tmpDir);
		// The model copies anchors from what it read: the GBK reading.
		await new ReadTool(session).execute("read-1", { path: file });
		const outcome = await new EditTool(session, "replace").execute("edit-1", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 42;",
		});
		expect(outcome.isError).toBeFalsy();
		const text = resultText(outcome);
		expect(text).toContain("also valid UTF-8");
		// Untouched regions keep their exact original bytes: the GBK round trip
		// re-encodes the mojibake characters back to the same UTF-8-looking
		// bytes, so the file stays valid UTF-8 outside the edit.
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(encoder.encode("// 中文\nint x = 42;\n"));
	});

	it("edit reuses the bounded diagnostic reader and reports an over-budget source without blocking its edit", async () => {
		const file = path.join(tmpDir, "src", "edit-large.c");
		const tail = `/*${"a".repeat(ENCODING_DIAGNOSTIC_MAX_BYTES)}*/\n`;
		await Bun.write(file, `int x = 1;\n${tail}`);
		const session = createSession(tmpDir);
		await new ReadTool(session).execute("read", { path: `${file}:1-1` });
		const result = await new EditTool(session, "replace").execute("edit", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 2;",
		});
		expect(result.isError).toBeFalsy();
		expect(resultText(result)).toContain("precheck unavailable (budget)");
		expect(resultText(result)).not.toContain("also valid UTF-8");
		expect(await Bun.file(file).text()).toBe(`int x = 2;\n${tail}`);
	});

	it("write tool pre-checks existing ambiguous file and attaches scoped notice", async () => {
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const session = createSession(tmpDir);
		const result = await new WriteTool(session).execute("write-1", {
			path: file,
			content: "// 中文\nint x = 99;\n",
		});
		const text = resultText(result);
		expect(text).toContain("Successfully wrote");
		expect(text).toContain("also valid UTF-8");
		// Persisted as strict GBK
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(
			new Uint8Array([
				0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x39, 0x39,
				0x3b, 0x0a,
			]),
		);
	});

	it("write tool to a new file raises no ambiguity notice", async () => {
		const file = path.join(tmpDir, "src", "new.md");
		const session = createSession(tmpDir);
		const result = await new WriteTool(session).execute("write-new", {
			path: file,
			content: "int x = 1;\n",
		});
		const text = resultText(result);
		expect(text).toContain("Successfully wrote");
		expect(text).not.toContain("also valid UTF-8");
	});

	it("write tool with an explicit utf8 override raises no ambiguity notice", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY_UTF8_OVERRIDE, "utf8");
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const session = createSession(tmpDir);
		const result = await new WriteTool(session).execute("write-ov", {
			path: file,
			content: "// 中文\nint x = 100;\n",
		});
		const text = resultText(result);
		expect(text).toContain("Successfully wrote");
		expect(text).not.toContain("also valid UTF-8");
	});

	it("LSP applyWorkspaceEdit returns encodingNotes for ambiguous files", async () => {
		const file = path.join(tmpDir, "src", "doc.md");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const outcome = await applyWorkspaceEdit(
			{
				changes: {
					[fileToUri(file)]: [
						{
							range: {
								start: { line: 1, character: 8 },
								end: { line: 1, character: 9 },
							},
							newText: "50",
						},
					],
				},
			},
			tmpDir,
		);
		expect(outcome.applied.length).toBe(1);
		expect(outcome.encodingNotes).toBeDefined();
		expect(outcome.encodingNotes?.[0]).toContain("also valid UTF-8");
	});

	it("AST grep reports ambiguous files in warning note", async () => {
		const file = path.join(tmpDir, "src", "doc.c");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const session = createSession(tmpDir);
		const result = await new AstGrepTool(session).execute("ast-grep-1", {
			pat: "int $VAR = $VAL;",
			path: path.join(tmpDir, "src"),
		});
		const text = resultText(result);
		expect(text).toContain("also valid UTF-8");
		expect(text).toContain("doc.c");
	});

	it("AST grep names proven UTF-8 bytes when GBK decode fails", async () => {
		const file = path.join(tmpDir, "src", "odd.c");
		await fs.writeFile(file, UTF8_NOT_GBK);
		const session = createSession(tmpDir);
		const result = await new AstGrepTool(session).execute("ast-grep-odd", {
			pat: "int $VAR = $VAL;",
			path: path.join(tmpDir, "src"),
		});
		const text = resultText(result);
		expect(text).toContain("valid UTF-8 and invalid GBK");
	});

	it("AST edit apply re-discovers encoding policy, writes UTF-8 when override added, and keeps unapplied bytes unchanged", async () => {
		const file = path.join(tmpDir, "src", "ast.c");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const initialBytes = await fs.readFile(file);

		const { session } = createSessionWithQueue(tmpDir);
		const astEditTool = new AstEditTool(session);
		const previewResult = await astEditTool.execute("ast-edit-preview", {
			ops: [{ pat: "int $VAR = 1;", out: 'int $VAR = sizeof("中文");' }],
			paths: [file],
		});
		expect(previewResult.isError).toBeFalsy();
		const previewText = resultText(previewResult);
		expect(previewText).toContain("also valid UTF-8");

		// 1. Before resolve, file on disk is completely untouched
		const preResolveBytes = await fs.readFile(file);
		expect(Buffer.from(preResolveBytes).equals(Buffer.from(initialBytes))).toBe(true);

		// 2. Add UTF-8 override to .omp/encoding.json before resolve
		const utf8OverridePolicy = JSON.stringify({
			schemaVersion: 1,
			enabled: true,
			include: ["src/**"],
			defaultEncoding: "gbk",
			newFileEncoding: "gbk",
			overrides: [{ glob: "src/ast.c", encoding: "utf8" }],
		});
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), utf8OverridePolicy, "utf8");

		// 3. Resolve staged edit via WriteTool on xd://resolve
		const writeTool = new WriteTool(session);
		const resolveResult = await writeTool.execute("resolve-apply", {
			path: "xd://resolve",
			content: "apply ast edit with utf8 override",
		});
		expect(resolveResult.isError).toBeFalsy();
		const resolveText = resultText(resolveResult);
		expect(resolveText).toContain("Applied 1 replacement in 1 file");
		expect(resolveText).not.toContain("also valid UTF-8");

		// 4. File on disk is now strictly valid UTF-8 containing "中文" in UTF-8 bytes
		const onDiskBytes = await fs.readFile(file);
		expect(() => decodeStrict(new Uint8Array(onDiskBytes), "utf8")).not.toThrow();
		const decodedUtf8 = decodeStrict(new Uint8Array(onDiskBytes), "utf8");
		expect(decodedUtf8).toContain('sizeof("中文")');
		// Bytes must not be GBK (d6 d0 ce c4)
		expect(Buffer.from(onDiskBytes).includes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe(false);
	});

	it("AST edit apply with GBK override suppresses ambiguity note on resolve", async () => {
		const file = path.join(tmpDir, "src", "ast.c");
		await fs.writeFile(file, UTF8_ALSO_GBK);

		const { session } = createSessionWithQueue(tmpDir);
		const astEditTool = new AstEditTool(session);
		await astEditTool.execute("ast-edit-preview", {
			ops: [{ pat: "int $VAR = 1;", out: "int $VAR = 42;" }],
			paths: [file],
		});

		// Add explicit GBK override before resolve
		const gbkOverridePolicy = JSON.stringify({
			schemaVersion: 1,
			enabled: true,
			include: ["src/**"],
			defaultEncoding: "gbk",
			newFileEncoding: "gbk",
			overrides: [{ glob: "src/ast.c", encoding: "gbk" }],
		});
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), gbkOverridePolicy, "utf8");

		const writeTool = new WriteTool(session);
		const resolveResult = await writeTool.execute("resolve-apply", {
			path: "xd://resolve",
			content: "apply ast edit with gbk override",
		});
		expect(resolveResult.isError).toBeFalsy();
		const resolveText = resultText(resolveResult);
		expect(resolveText).toContain("Applied 1 replacement in 1 file");
		expect(resolveText).not.toContain("also valid UTF-8");
	});

	it("AST preview and queued apply use their native call policy rather than a nested file-directory policy", async () => {
		const file = path.join(tmpDir, "src", "nested.c");
		const bytes = Buffer.concat([
			encoder.encode("// "),
			Buffer.from("e0a0a2e38080", "hex"),
			encoder.encode("\nint x = 1;\n"),
		]);
		await Bun.write(file, bytes);
		await Bun.write(
			path.join(tmpDir, "src", ".omp", "encoding.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				include: ["**"],
				defaultEncoding: "utf8",
				newFileEncoding: "utf8",
				overrides: [],
			}),
		);
		await expect(
			new AstEditTool(createSession(tmpDir)).execute("preview", {
				ops: [{ pat: "int $VAR = 1;", out: "int $VAR = 42;" }],
				paths: [file],
			}),
		).rejects.toThrow("round-trip stable");
		expect(await Bun.file(file).bytes()).toEqual(bytes);
		await Bun.write(
			path.join(tmpDir, ".omp", "encoding.json"),
			JSON.stringify({
				...JSON.parse(POLICY),
				overrides: [{ glob: "src/nested.c", encoding: "utf8" }],
			}),
		);
		const { session, queue } = createSessionWithQueue(tmpDir);
		await new AstEditTool(session).execute("preview", {
			ops: [{ pat: "int $VAR = 1;", out: "int $VAR = 42;" }],
			paths: [file],
		});
		expect(queue.hasPendingInvoker).toBe(true);
		await Bun.write(path.join(tmpDir, ".omp", "encoding.json"), POLICY);
		await expect(
			new WriteTool(session).execute("resolve", {
				path: "xd://resolve",
				content: "Apply staged edit.",
			}),
		).rejects.toThrow("round-trip stable");
		expect(await Bun.file(file).bytes()).toEqual(bytes);
		expect(queue.hasPendingInvoker).toBe(true);
	});

	it("AST edit apply detects stale preview when file modified between preview and apply", async () => {
		const file = path.join(tmpDir, "src", "ast.c");
		await fs.writeFile(file, UTF8_ALSO_GBK);

		const { session } = createSessionWithQueue(tmpDir);
		const astEditTool = new AstEditTool(session);
		await astEditTool.execute("ast-edit-preview", {
			ops: [{ pat: "int $VAR = 1;", out: "int $VAR = 42;" }],
			paths: [file],
		});

		// External change invalidating the pattern
		await fs.writeFile(file, encoder.encode("// 中文\nint x = 999;\n"));

		const writeTool = new WriteTool(session);
		const resolveResult = await writeTool.execute("resolve-apply", {
			path: "xd://resolve",
			content: "apply stale preview",
		});
		expect(resolveResult.isError).toBe(true);
		const resolveText = resultText(resolveResult);
		expect(resolveText).toContain("Preview is stale");
	});

	it("AST edit with zero replacements preserves ambiguity note", async () => {
		const file = path.join(tmpDir, "src", "doc.c");
		await fs.writeFile(file, UTF8_ALSO_GBK);
		const session = createSession(tmpDir);
		const result = await new AstEditTool(session).execute("ast-edit-zero", {
			ops: [{ pat: "int $VAR = 999;", out: "int $VAR = 88;" }],
			paths: [file],
		});
		const text = resultText(result);
		expect(text).toContain("No replacements made");
		expect(text).toContain("also valid UTF-8");
	});

	it("stale AST apply retains only its fresh diagnostic and preserves the new source bytes", async () => {
		const file = path.join(tmpDir, "src", "stale.c");
		for (const ambiguous of [true, false]) {
			await Bun.write(file, UTF8_ALSO_GBK);
			const { session } = createSessionWithQueue(tmpDir);
			await new AstEditTool(session).execute("preview", {
				ops: [{ pat: "int $VAR = 1;", out: "int $VAR = 42;" }],
				paths: [file],
			});
			const changed = ambiguous ? encoder.encode("// 中文\nint x = 999;\n") : encoder.encode("int x = 999;\n");
			await Bun.write(file, changed);
			const result = await new WriteTool(session).execute("resolve", {
				path: "xd://resolve",
				content: "Apply staged edit.",
			});
			expect(result.isError).toBe(true);
			expect(resultText(result)).toContain("Preview is stale");
			expect(resultText(result).includes("also valid UTF-8")).toBe(ambiguous);
			expect(await Bun.file(file).bytes()).toEqual(changed);
		}
	});

	it("a spanning GBK line never receives a definitive hint based on its chunk suffix", async () => {
		const file = path.join(tmpDir, "src", "spanning.md");
		const line = Buffer.concat([
			Buffer.alloc(READ_CHUNK_SIZE - 1, 0x61),
			Buffer.from([0x81, 0xe4, 0xb8, 0xad, 0x0a]),
		]);
		expect(() => decodeStrict(line, "gbk")).not.toThrow();
		expect(() => decodeStrict(line, "utf8")).toThrow();
		await Bun.write(file, Buffer.concat([line, Buffer.from([0xff, 0x0a]), Buffer.alloc(4 * 1024 * 1024, 0x61)]));
		let error: unknown;
		try {
			await new ReadTool(createSession(tmpDir)).execute("read", { path: `${file}:1-5` });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeDefined();
		expect(String(error)).not.toContain("valid UTF-8 and invalid GBK");
	});

	it("a failing unterminated fragment keeps the strict read error and exposes incomplete proof", async () => {
		const file = path.join(tmpDir, "src", "fragment.md");
		const bytes = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(ENCODING_DIAGNOSTIC_MAX_BYTES, 0x61)]);
		await Bun.write(file, bytes);
		let error: unknown;
		try {
			await new ReadTool(createSession(tmpDir)).execute("read", { path: `${file}:1-2` });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeDefined();
		expect(String(error)).toContain("precheck unavailable (fragment)");
		expect(String(error)).toContain("require valid GBK");
		expect(String(error)).not.toContain("valid UTF-8 and invalid GBK");
		expect(await Bun.file(file).bytes()).toEqual(bytes);
	});

	it("write ambiguity precheck has a bounded acquisition budget when the file grows after stat", async () => {
		const file = path.join(tmpDir, "src", "growing.txt");
		const cap = 4 * 1024 * 1024;
		await Bun.write(file, PURE_ASCII);
		const originalFile = Bun.file;
		const reads: number[] = [];
		function track<T extends Blob>(blob: T): T {
			const bytes = blob.bytes.bind(blob);
			blob.bytes = async () => {
				const result = await bytes();
				reads.push(result.length);
				return result;
			};
			return blob;
		}
		const fileSpy = spyOn(Bun, "file").mockImplementation((...args) => {
			const blob = Reflect.apply(originalFile, Bun, args) as BunFile;
			if (String(args[0]) !== file) return blob;
			const slice = blob.slice.bind(blob);
			blob.slice = (...sliceArgs) => track(Reflect.apply(slice, blob, sliceArgs) as BunFile);
			return track(blob);
		});
		let grew = false;
		try {
			const result = await new WriteTool(createSession(tmpDir)).execute(
				"write",
				{ path: file, content: "int x = 2;\n" },
				undefined,
				() => {
					if (grew) return;
					grew = true;
					// A synchronous progress callback provides a deterministic external-change boundary.
					fsSync.writeFileSync(file, Buffer.alloc(cap + 1024, 0x61));
					reads.length = 0;
				},
			);
			expect(grew).toBe(true);
			expect(reads[0]).toBeLessThanOrEqual(cap + 1);
			expect(resultText(result)).toContain("encoding ambiguity precheck unavailable");
			expect(resultText(result)).toContain("budget");
			expect(await originalFile(file).text()).toBe("int x = 2;\n");
		} finally {
			fileSpy.mockRestore();
		}
	});

	it("AST grep and edit report capped ambiguous files with omission notice", async () => {
		for (let i = 1; i <= 11; i++) {
			await fs.writeFile(path.join(tmpDir, "src", `file${i}.c`), UTF8_ALSO_GBK);
		}
		const session = createSession(tmpDir);
		const grepResult = await new AstGrepTool(session).execute("ast-grep-cap", {
			pat: "int $VAR = $VAL;",
			path: path.join(tmpDir, "src"),
		});
		const grepText = resultText(grepResult);
		expect(grepText).toContain("GBK policy decoded 10 searched file(s) (further files omitted; total unknown)");
		const edit = await new AstEditTool(session).execute("edit-cap", {
			ops: [{ pat: "int $VAR = 999;", out: "int $VAR = 88;" }],
			paths: Array.from({ length: 11 }, (_, i) => path.join(tmpDir, "src", `file${i + 1}.c`)),
		});
		expect(resultText(edit)).toContain("10 searched file(s) (further files omitted; total unknown)");
	});

	it("LSP applyWorkspaceEdit retains all internal notes before tool rendering", async () => {
		const files: string[] = [];
		for (let i = 1; i <= 11; i++) {
			const f = path.join(tmpDir, "src", `item${i}.c`);
			await fs.writeFile(f, UTF8_ALSO_GBK);
			files.push(f);
		}
		const edit = {
			changes: Object.fromEntries(
				files.map(f => [
					fileToUri(f),
					[{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, newText: "int" }],
				]),
			),
		};
		const outcome = await applyWorkspaceEdit(edit, tmpDir);
		expect(outcome.applied.length).toBe(11);
		expect(outcome.encodingNotes).toBeDefined();
		expect(outcome.encodingNotes?.length).toBe(11);
	});

	it("a complete failing UTF-8 line crossing a chunk boundary retains its full-line proof", async () => {
		const file = path.join(tmpDir, "src", "crossing-failure.md");
		const header = Buffer.concat([Buffer.alloc(READ_CHUNK_SIZE - 2, 0x61), Buffer.from("中\n")]);
		await Bun.write(file, Buffer.concat([header, Buffer.alloc(4 * 1024 * 1024, 0x61)]));
		await expect(new ReadTool(createSession(tmpDir)).execute("read", { path: `${file}:1-5` })).rejects.toThrow(
			/line 1.*valid UTF-8 and invalid GBK/,
		);
	});

	it("a failure in a scanned prefix is not labelled as a displayed window", async () => {
		const file = path.join(tmpDir, "src", "prefix.md");
		await Bun.write(file, Buffer.concat([UTF8_NOT_GBK, Buffer.from("ascii line\n".repeat(420000))]));
		await expect(
			new ReadTool(createSession(tmpDir)).execute("read", { path: `${file}:1000-1001:raw` }),
		).rejects.toThrow(/checked window bytes are valid UTF-8/);
	});

	it("diagnostic evidence distinguishes fragments, strict failures and bounded complete files", async () => {
		const file = path.join(tmpDir, "src", "evidence.txt");
		const partial = inspectGbkAmbiguity(tmpDir, file, UTF8_ALSO_GBK, {
			scope: "window",
			complete: false,
			window: { startLine: 7, lineCount: 1 },
		});
		expect(partial).toMatchObject({
			kind: "unavailable",
			complete: false,
			reason: "fragment",
			scope: "window",
			checkedRange: { byteLength: 0, startLine: 7 },
		});
		expect(inspectGbkAmbiguity(tmpDir, file, UTF8_NOT_GBK).kind).toBe("invalid-gbk-utf8");
		await Bun.write(file, Buffer.alloc(ENCODING_DIAGNOSTIC_MAX_BYTES, 0x61));
		expect(await readGbkAmbiguityDiagnostic(tmpDir, file)).toMatchObject({
			kind: "checked",
			complete: true,
			checkedRange: { byteLength: ENCODING_DIAGNOSTIC_MAX_BYTES },
		});
		await Bun.write(file, Buffer.alloc(ENCODING_DIAGNOSTIC_MAX_BYTES + 1, 0x61));
		expect(await readGbkAmbiguityDiagnostic(tmpDir, file)).toMatchObject({
			kind: "unavailable",
			complete: false,
			reason: "budget",
			checkedRange: { byteLength: 0 },
		});
	});

	it("bounded diagnostic reads do not disguise an invalid encoding policy as an I/O notice", async () => {
		const file = path.join(tmpDir, "src", "invalid-policy.c");
		await Bun.write(file, PURE_ASCII);
		await Bun.write(path.join(tmpDir, ".omp", "encoding.json"), "{");
		await expect(readGbkAmbiguityDiagnostic(tmpDir, file)).rejects.toThrow("encoding.json");
	});

	it("write exposes a diagnostic I/O failure without claiming its authorized save failed", async () => {
		const file = path.join(tmpDir, "src", "diagnostic-io.txt");
		await Bun.write(file, PURE_ASCII);
		const originalFile = Bun.file;
		const fileSpy = spyOn(Bun, "file").mockImplementation((...args) => {
			const blob = Reflect.apply(originalFile, Bun, args) as BunFile;
			if (String(args[0]) === file) {
				const slice = blob.slice.bind(blob);
				blob.slice = (...sliceArgs) => {
					const part = Reflect.apply(slice, blob, sliceArgs) as BunFile;
					if (sliceArgs[1] === ENCODING_DIAGNOSTIC_MAX_BYTES + 1)
						part.bytes = async () => {
							throw new Error("injected diagnostic read failure");
						};
					return part;
				};
			}
			return blob;
		});
		try {
			const result = await new WriteTool(createSession(tmpDir)).execute("write", {
				path: file,
				content: "int x = 2;\n",
			});
			expect(resultText(result)).toContain("precheck unavailable (io)");
			expect(await originalFile(file).text()).toBe("int x = 2;\n");
		} finally {
			fileSpy.mockRestore();
		}
	});

	it("native and both AST tools expose incomplete diagnostics above the whole-file budget", async () => {
		const file = path.join(tmpDir, "src", "large.c");
		await Bun.write(file, Buffer.concat([UTF8_ALSO_GBK, Buffer.from(`/*${"a".repeat(4 * 1024 * 1024)}*/\n`)]));
		const result = await astGrep({
			path: file,
			patterns: ["int $VAR = $VAL;"],
			encodingPolicy: { root: tmpDir, json: POLICY },
		});
		expect(result.encodingDiagnostics?.[0]).toMatchObject({
			path: path.toNamespacedPath(file),
			kind: "unavailable",
			scope: "file",
			complete: false,
			reason: "budget",
			checkedByteLength: 0,
		});
		const session = createSession(tmpDir);
		const grep = await new AstGrepTool(session).execute("grep", { path: file, pat: "int $VAR = $VAL;" });
		expect(resultText(grep)).toContain("precheck unavailable (budget)");
		const edit = await new AstEditTool(session).execute("edit", {
			paths: [file],
			ops: [{ pat: "int $VAR = 999;", out: "int $VAR = 88;" }],
		});
		expect(resultText(edit)).toContain("precheck unavailable (budget)");
		expect(resultText(edit)).not.toContain("also valid UTF-8");
	});

	it("streamLinesFromFile on >4 MiB file handles non-canonical GBK mapping bytes e0a0a2e38080", async () => {
		const file = path.join(tmpDir, "src", "noncanon.md");
		// Raw bytes e0 a0 a2 e3 80 80 is valid UTF-8 and valid GBK, but re-encoding normalizes to non-UTF-8.
		const nonCanonBytes = new Uint8Array([0x2f, 0x2f, 0x20, 0xe0, 0xa0, 0xa2, 0xe3, 0x80, 0x80, 0x0a]);
		const line2 = encoder.encode("int x = 1;\n");
		const padLine = "line of plain ascii text to pad the file content beyond the snapshot buffer cap\n";
		const repeatCount = Math.ceil((4 * 1024 * 1024) / padLine.length) + 100;
		const padContent = encoder.encode(padLine.repeat(repeatCount));
		await fs.writeFile(file, Buffer.concat([nonCanonBytes, line2, padContent]));

		const session = createSession(tmpDir);
		const result = await new ReadTool(session).execute("read-noncanon", { path: `${file}:1-5` });
		const text = resultText(result);
		expect(text).toContain("displayed window bytes are also valid UTF-8");
		expect(text).toContain("lines 1-8");

		// Also verify raw mode
		const rawResult = await new ReadTool(session).execute("read-noncanon-raw", { path: `${file}:1-5:raw` });
		const rawText = resultText(rawResult);
		expect(rawText).toContain("displayed window bytes are also valid UTF-8");

		// Also verify multi-range
		const multiResult = await new ReadTool(session).execute("read-noncanon-multi", { path: `${file}:1-2,3-5` });
		const multiText = resultText(multiResult);
		expect(multiText).toContain("displayed window bytes are also valid UTF-8");
	});

	it("streamLinesFromFile on >4 MiB file surfaces definitive UTF-8 hint on fatal validation failure", async () => {
		const file = path.join(tmpDir, "src", "fail-utf8.md");
		// Line 1 is valid UTF-8 and invalid GBK
		const header = encoder.encode("// 中\nint x = 1;\n");
		const padLine = "line of plain ascii text to pad the file content beyond the snapshot buffer cap\n";
		const repeatCount = Math.ceil((4 * 1024 * 1024) / padLine.length) + 100;
		const padContent = encoder.encode(padLine.repeat(repeatCount));
		await fs.writeFile(file, Buffer.concat([header, padContent]));

		const session = createSession(tmpDir);
		await expect(new ReadTool(session).execute("read-fail", { path: `${file}:1-5` })).rejects.toThrow(
			/the displayed window bytes are valid UTF-8 and invalid GBK/,
		);
	});

	it("write tool preserves zero-write contract when unrepresentable characters are supplied", async () => {
		const file = path.join(tmpDir, "src", "existing.txt");
		await fs.writeFile(file, UTF8_NOT_GBK);
		const beforeBytes = await fs.readFile(file);

		const session = createSession(tmpDir);
		const writeTool = new WriteTool(session);
		// '🚀' cannot be represented in GBK
		await expect(writeTool.execute("write-unrep", { path: file, content: "hello 🚀" })).rejects.toThrow(
			/cannot be represented in GBK/i,
		);

		const afterBytes = await fs.readFile(file);
		expect(Buffer.from(afterBytes).equals(Buffer.from(beforeBytes))).toBe(true);
	});
	it("large read windows diagnose retained complete lines and mark truncated-only previews incomplete", async () => {
		const file = path.join(tmpDir, "src", "wide.md");
		const session = createSession(tmpDir);
		await Bun.write(file, `// 中文\n${`${"a".repeat(500)}\n`.repeat(10000)}`);
		const wide = resultText(await new ReadTool(session).execute("read", { path: `${file}:1-10001:raw` }));
		expect(wide.slice(-2000)).toContain("displayed window bytes are also valid UTF-8");
		expect(wide.slice(-2000)).not.toContain("same bytes are also valid UTF-8");
		await Bun.write(file, "a".repeat(ENCODING_DIAGNOSTIC_MAX_BYTES + 1));
		const fragment = resultText(await new ReadTool(session).execute("read", { path: `${file}:1-1:raw` }));
		expect(fragment).toContain("precheck unavailable (fragment)");
		expect(fragment).not.toContain("also valid UTF-8");
	});

	it("LSP reports a skipped whole-file ambiguity check above budget while preserving its edit", async () => {
		const file = path.join(tmpDir, "src", "lsp-large.c");
		await Bun.write(file, `int x = 1;\n/*${"a".repeat(ENCODING_DIAGNOSTIC_MAX_BYTES)}*/\n`);
		const result = await applyWorkspaceEdit(
			{
				changes: {
					[fileToUri(file)]: [
						{
							range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } },
							newText: "2",
						},
					],
				},
			},
			tmpDir,
		);
		expect(result.applied).toHaveLength(1);
		expect(result.encodingNotes).toHaveLength(1);
		expect(result.encodingNotes?.[0]).toContain("precheck unavailable (budget)");
		expect(result.encodingNotes?.[0]).not.toContain("also valid UTF-8");
		expect((await Bun.file(file).text()).startsWith("int x = 2;\n")).toBe(true);
	});

	it("streamLinesFromFile on >4 MiB file produces window-scoped ambiguity notice without tail scan", async () => {
		const file = path.join(tmpDir, "src", "large.md");
		const header = "// 中文\nint x = 1;\n";
		const padLine = "line of plain ascii text to pad the file content beyond the snapshot buffer cap\n";
		const repeatCount = Math.ceil((4 * 1024 * 1024) / padLine.length) + 100;
		const padContent = padLine.repeat(repeatCount);
		const tailBytes = new Uint8Array([0xff, 0xff, 0x0a]);
		await fs.writeFile(
			file,
			Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(padContent, "utf8"), tailBytes]),
		);

		const session = createSession(tmpDir);
		const result = await new ReadTool(session).execute("read-large", { path: `${file}:1-5` });
		const text = resultText(result);
		expect(text).toContain("displayed window bytes are also valid UTF-8");
		expect(text).toContain("lines 1-8");
		expect(text).not.toContain("same bytes are also valid UTF-8");
	});
});
