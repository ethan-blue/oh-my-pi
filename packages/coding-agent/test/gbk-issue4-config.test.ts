/**
 * Issue #4 formal regression suite:
 * - Unmanaged GBK read fallback and strict-utf8 toggle (G1)
 * - .ompg priority over .omp and fail-closed on corrupt config (G2)
 * - Per-target project boundary resolution across projects (G3)
 * - Home boundary leak prevention (G4)
 * - Grep multi-root, fallback searching, and partial coverage / zero-match wording (G5/G8)
 * - Write eligibility prevention of silent UTF-8 corruption on unmanaged GBK files (G6/G7)
 * - SchemaVersion 2 "auto" encoding (G5)
 * - Encoding CLI doctor & init commands (G10)
 */

import { afterEach, beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ToolChoiceQueue } from "@oh-my-pi/pi-coding-agent/session/tool-choice-queue";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { AstEditTool } from "@oh-my-pi/pi-coding-agent/tools/ast-edit";
import { dispatchResolutionDevice } from "@oh-my-pi/pi-coding-agent/tools/resolve";
import { applyWorkspaceEdit, writeTextWithPolicy } from "@oh-my-pi/pi-coding-agent/lsp/edits";
import { fileToUri } from "@oh-my-pi/pi-coding-agent/lsp/utils";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import {
	discoverEncodingPolicy,
	EncodingConfigError,
	invalidateEncodingCaches,
} from "@oh-my-pi/pi-coding-agent/encoding/index";
import {
	checkProtectedCommand,
	invalidateProtectedModeCaches,
	protectedEvalDenial,
} from "@oh-my-pi/pi-coding-agent/tools/protected-mode";
import { generateFileMentionMessages } from "@oh-my-pi/pi-coding-agent/utils/file-mentions";
import { astEdit, encodingUtf8AmbiguousWithGbk } from "@oh-my-pi/pi-natives";
import {
	DISTRIBUTION_VERSION,
	findProjectConfigUpward,
	invalidateProjectConfigCaches,
	removeWithRetries,
} from "@oh-my-pi/pi-utils";
import { runEncodingDoctorCommand, runEncodingInitCommand } from "@oh-my-pi/pi-coding-agent/cli/encoding-cli";

function hex(bytes: readonly number[]): Uint8Array<ArrayBuffer> {
	return new Uint8Array(new ArrayBuffer(bytes.length)).map((_, index) => bytes[index]!);
}

/** "// 中文\nint x = 1;\n" in GBK: D6 D0 CE C4. */
const GBK_SOURCE = hex([
	0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x31, 0x3b, 0x0a,
]);

/** Pure invalid bytes that decode in NEITHER UTF-8 nor GBK. */
const UNDECODABLE_BYTES = hex([0xff, 0xfe, 0xff, 0xff, 0x80, 0x80, 0xfe]);

const POLICY_GBK = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["**/*.c", "**/*.h"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

const POLICY_UTF8 = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["**/*.c", "**/*.h"],
	defaultEncoding: "utf8",
	newFileEncoding: "utf8",
	overrides: [],
});

const POLICY_SCHEMA2_AUTO = JSON.stringify({
	schemaVersion: 2,
	enabled: true,
	include: ["**/*.c", "**/*.h"],
	defaultEncoding: "auto",
	newFileEncoding: "utf8",
	overrides: [],
});

function createSession(cwd: string, settingOverrides: Record<string, unknown> | Settings = {}): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "artifact-1", path: path.join(cwd, "artifact-1.log") }),
		settings:
			settingOverrides instanceof Settings
				? settingOverrides
				: Settings.isolated({
						"bashInterceptor.enabled": false,
						"astGrep.enabled": false,
						"astEdit.enabled": false,
						"grep.enabled": false,
						"glob.enabled": false,
						...settingOverrides,
					}),
		enableLsp: false,
	};
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
		.map(b => b.text)
		.join("\n");
}

describe("Issue #4: config discovery and text encoding regression", () => {
	let tempRoot: string;

	beforeEach(async () => {
		await Settings.init({ inMemory: true });
		invalidateEncodingCaches();
		invalidateProjectConfigCaches();
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-issue4-test-"));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		invalidateEncodingCaches();
		invalidateProtectedModeCaches();
		invalidateProjectConfigCaches();
		await removeWithRetries(tempRoot);
	});

	describe("G1: Unmanaged GBK reading", () => {
		it.each(["edit", "lsp"])("%s config creation invalidates a cached legacy selection", async writer => {
			spyOn(Date, "now").mockReturnValue(1000);
			await Bun.write(path.join(tempRoot, ".omp", "encoding.json"), POLICY_UTF8);
			await Bun.write(path.join(tempRoot, "source.c"), GBK_SOURCE);
			const session = createSession(tempRoot);
			const reader = new ReadTool(session);
			await expect(reader.execute("before", { path: "source.c:raw" })).rejects.toThrow();
			const config = path.join(tempRoot, ".ompg", "encoding.json");
			if (writer === "edit") {
				const result = await new EditTool(session, "apply_patch").execute("create", {
					input: `*** Begin Patch\n*** Add File: .ompg/encoding.json\n+${POLICY_GBK}\n*** End Patch\n`,
				});
				expect(result.isError).not.toBe(true);
			} else {
				await writeTextWithPolicy(config, POLICY_GBK);
			}
			expect(resultText(await reader.execute("after", { path: "source.c:raw" }))).toContain("中文");
		});

		it("nested AST proposal retains Hashline tags and applies through the real resolve queue", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_UTF8);
			const child = path.join(tempRoot, "child");
			await Bun.write(path.join(child, ".ompg", "encoding.json"), POLICY_GBK);
			const file = path.join(child, "source.c");
			await Bun.write(file, GBK_SOURCE);
			const session = createSession(tempRoot);
			const queue = new ToolChoiceQueue();
			session.getToolChoiceQueue = () => queue;
			session.peekPendingInvoker = () => queue.peekPendingInvoker();
			const preview = await new AstEditTool(session).execute("preview", {
				paths: [file],
				ops: [{ pat: "int $X = 1;", out: "int $X = 2;" }],
			});
			expect(resultText(preview)).toMatch(/source\.c#[A-F0-9]+/i);
			expect(await fs.readFile(file)).toEqual(Buffer.from(GBK_SOURCE));
			const applied = await dispatchResolutionDevice(
				session,
				"resolve",
				"Apply this verified nested-policy rewrite.",
			);
			expect(applied.result.isError).not.toBe(true);
			expect(new Uint8Array(await fs.readFile(file))).toEqual(GBK_SOURCE.map(byte => (byte === 0x31 ? 0x32 : byte)));
		});

		it("native AST applies a nested GBK policy to both parse and persistence", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_UTF8);
			const child = path.join(tempRoot, "child");
			await Bun.write(path.join(child, ".ompg", "encoding.json"), POLICY_GBK);
			const file = path.join(child, "source.c");
			await Bun.write(file, GBK_SOURCE);
			const result = await astEdit({
				path: file,
				lang: "c",
				rewrites: { "int $X = 1;": "int $X = 2;" },
				dryRun: false,
				failOnParseError: true,
				encodingPolicy: { root: tempRoot, json: POLICY_UTF8 },
			});
			expect(result.totalReplacements).toBe(1);
			expect(new Uint8Array(await fs.readFile(file))).toEqual(GBK_SOURCE.map(byte => (byte === 0x31 ? 0x32 : byte)));
		});

		it("keeps valid UTF-8 when the 64 KiB probe ends inside a character", async () => {
			const file = path.join(tempRoot, "probe-boundary.c");
			await Bun.write(
				file,
				Buffer.concat([Buffer.alloc(65534, 0x61), Buffer.from("\n中文\n"), Buffer.alloc(4 * 1024 * 1024, 0x61)]),
			);
			const text = resultText(
				await new ReadTool(createSession(tempRoot)).execute("read", { path: `${file}:raw:2` }),
			);
			expect(text).toContain("中文");
			expect(text).not.toContain("decoded as GBK");
		});

		it("redecodes collected lines when GBK is detected after the probe", async () => {
			const file = path.join(tempRoot, "late-gbk.c");
			const first = Buffer.from("中文\n", "utf8");
			await Bun.write(
				file,
				Buffer.concat([
					first,
					Buffer.alloc(70 * 1024, 0x61),
					Buffer.from("\n"),
					GBK_SOURCE,
					Buffer.alloc(4 * 1024 * 1024, 0x61),
				]),
			);
			const text = resultText(
				await new ReadTool(createSession(tempRoot)).execute("read", { path: `${file}:raw:1` }),
			);
			expect(text).toContain(new TextDecoder("gbk", { fatal: true }).decode(first).trim());
			expect(text).toContain("decoded as GBK");
		});

		it("nested GBK edit uses the same policy as its read", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_UTF8);
			const child = path.join(tempRoot, "child");
			await Bun.write(path.join(child, ".ompg", "encoding.json"), POLICY_GBK);
			const file = path.join(child, "source.c");
			await Bun.write(file, GBK_SOURCE);
			const session = createSession(tempRoot);
			expect(resultText(await new ReadTool(session).execute("read", { path: file }))).toContain("中文");
			await new EditTool(session, "replace").execute("edit", {
				path: file,
				old_string: "int x = 1;",
				new_string: "int x = 2;",
			});
			expect(new Uint8Array(await fs.readFile(file))).toEqual(GBK_SOURCE.map(byte => (byte === 0x31 ? 0x32 : byte)));
		});

		it("grep discovers fixed UTF-8 nested policy under an unmanaged search root", async () => {
			const child = path.join(tempRoot, "child");
			await Bun.write(path.join(child, ".ompg", "encoding.json"), POLICY_UTF8);
			await Bun.write(path.join(child, "source.c"), GBK_SOURCE);
			const text = resultText(
				await new GrepTool(createSession(tempRoot)).execute("grep", { pattern: "中文", path: tempRoot }),
			);
			expect(text).not.toContain("// 中文");
			expect(text).toContain("not searched");
		});

		it("grep refuses a malformed preferred nested config instead of using the legacy alias", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_GBK);
			const child = path.join(tempRoot, "child");
			await Bun.write(path.join(child, ".ompg", "encoding.json"), "{bad");
			await Bun.write(path.join(child, ".omp", "encoding.json"), POLICY_GBK);
			await Bun.write(path.join(child, "source.c"), GBK_SOURCE);
			const text = resultText(
				await new GrepTool(createSession(tempRoot)).execute("grep", { pattern: "中文", path: tempRoot }),
			);
			expect(text).not.toContain("// 中文");
			expect(text).toContain("not searched");
		});

		it("reads unmanaged GBK source file with automatic fallback and notice", async () => {
			const project = path.join(tempRoot, "noconfig");
			const cFile = path.join(project, "03_func", "COMM", "f_modbus.c");
			await fs.mkdir(path.dirname(cFile), { recursive: true });
			await fs.writeFile(cFile, GBK_SOURCE);

			const session = createSession(project);
			const result = await new ReadTool(session).execute("read-1", { path: cFile });
			const text = resultText(result);

			expect(text).toContain("中文");
			expect(text).toContain("int x = 1;");
			expect(text).toContain("decoded as GBK through the read-only automatic fallback");
		});

		it("refuses unmanaged GBK file when textEncoding.readFallback is strict-utf8", async () => {
			const project = path.join(tempRoot, "strict-unmanaged");
			const cFile = path.join(project, "f_modbus.c");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(cFile, GBK_SOURCE);

			const session = createSession(project, {
				"textEncoding.readFallback": "strict-utf8",
			});
			const result = await new ReadTool(session).execute("read-1", { path: cFile });
			const text = resultText(result);

			expect(text).toContain("not valid UTF-8 text");
			expect(text).not.toContain("中文");
		});

		it("reads valid UTF-8 file in unmanaged project without fallback notice", async () => {
			const project = path.join(tempRoot, "utf8-unmanaged");
			const cFile = path.join(project, "main.c");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(cFile, "int main() { return 0; }\n", "utf8");

			const session = createSession(project);
			const result = await new ReadTool(session).execute("read-1", { path: cFile });
			const text = resultText(result);

			expect(text).toContain("int main()");
			expect(text).not.toContain("automatic fallback");
		});
	});

	describe("G2: Config directory priority and fail-closed", () => {
		it("rejects a non-directory preferred namespace instead of using the legacy alias", async () => {
			await Bun.write(path.join(tempRoot, ".ompg"), "not a directory");
			await Bun.write(path.join(tempRoot, ".omp", "encoding.json"), POLICY_GBK);
			await Bun.write(path.join(tempRoot, "source.c"), GBK_SOURCE);
			await expect(new ReadTool(createSession(tempRoot)).execute("read", { path: "source.c" })).rejects.toThrow(
				"not a regular file",
			);
		});

		it("rejects a preferred directory entry instead of falling back to a legacy file", async () => {
			await fs.mkdir(path.join(tempRoot, ".ompg", "encoding.json"), { recursive: true });
			await Bun.write(path.join(tempRoot, ".omp", "encoding.json"), POLICY_GBK);
			await Bun.write(path.join(tempRoot, "source.c"), GBK_SOURCE);
			await expect(new ReadTool(createSession(tempRoot)).execute("read", { path: "source.c" })).rejects.toThrow(
				"not a regular file",
			);
		});

		it("prefers .ompg/encoding.json over .omp/encoding.json whole-file without merging", async () => {
			const project = path.join(tempRoot, "dual-config");
			await fs.mkdir(path.join(project, ".ompg"), { recursive: true });
			await fs.mkdir(path.join(project, ".omp"), { recursive: true });

			// .ompg assigns GBK
			await fs.writeFile(path.join(project, ".ompg", "encoding.json"), POLICY_GBK, "utf8");
			// .omp assigns UTF-8
			await fs.writeFile(path.join(project, ".omp", "encoding.json"), POLICY_UTF8, "utf8");

			const discovered = discoverEncodingPolicy(project);
			expect(discovered).toBeDefined();
			expect(discovered?.namespace).toBe(".ompg");
			expect(discovered?.policy.resolve(path.join(project, "a.c"), true)).toBe("gbk");
		});

		it("falls back to legacy .omp/encoding.json when .ompg has no encoding.json", async () => {
			const project = path.join(tempRoot, "legacy-only");
			await fs.mkdir(path.join(project, ".omp"), { recursive: true });
			await fs.writeFile(path.join(project, ".omp", "encoding.json"), POLICY_GBK, "utf8");

			const discovered = discoverEncodingPolicy(project);
			expect(discovered).toBeDefined();
			expect(discovered?.namespace).toBe(".omp");
			expect(discovered?.policy.resolve(path.join(project, "a.c"), true)).toBe("gbk");
		});

		it("fails closed on corrupted .ompg/encoding.json without silently falling back", async () => {
			const project = path.join(tempRoot, "corrupt-ompg");
			await fs.mkdir(path.join(project, ".ompg"), { recursive: true });
			await fs.mkdir(path.join(project, ".omp"), { recursive: true });

			// Corrupted .ompg
			await fs.writeFile(path.join(project, ".ompg", "encoding.json"), "{ invalid json", "utf8");
			// Valid .omp
			await fs.writeFile(path.join(project, ".omp", "encoding.json"), POLICY_GBK, "utf8");

			expect(() => discoverEncodingPolicy(project)).toThrow(EncodingConfigError);
		});

		it("prefers nested subproject .omp over parent .ompg", async () => {
			const parent = path.join(tempRoot, "parent");
			const sub = path.join(parent, "packages", "sub");

			await fs.mkdir(path.join(parent, ".ompg"), { recursive: true });
			await fs.writeFile(path.join(parent, ".ompg", "encoding.json"), POLICY_UTF8, "utf8");

			await fs.mkdir(path.join(sub, ".omp"), { recursive: true });
			await fs.writeFile(path.join(sub, ".omp", "encoding.json"), POLICY_GBK, "utf8");

			const subDiscovered = discoverEncodingPolicy(sub);
			expect(subDiscovered).toBeDefined();
			expect(subDiscovered?.root).toBe(path.resolve(sub));
			expect(subDiscovered?.namespace).toBe(".omp");
			expect(subDiscovered?.policy.resolve(path.join(sub, "test.c"), true)).toBe("gbk");
		});
	});

	describe("G3: Target-aware project resolution", () => {
		it("resolves external target file using target's own policy rather than session cwd", async () => {
			const projectA = path.join(tempRoot, "proj-a-utf8");
			const projectB = path.join(tempRoot, "proj-b-gbk");

			await fs.mkdir(path.join(projectA, ".ompg"), { recursive: true });
			await fs.writeFile(path.join(projectA, ".ompg", "encoding.json"), POLICY_UTF8, "utf8");

			await fs.mkdir(path.join(projectB, ".ompg"), { recursive: true });
			await fs.writeFile(path.join(projectB, ".ompg", "encoding.json"), POLICY_GBK, "utf8");

			const fileB = path.join(projectB, "b.c");
			await fs.writeFile(fileB, GBK_SOURCE);

			// Session cwd is in Project A (which specifies UTF-8)
			const sessionA = createSession(projectA);
			const result = await new ReadTool(sessionA).execute("read-b", { path: fileB });
			const text = resultText(result);

			// Should resolve with Project B's GBK policy!
			expect(text).toContain("中文");
			// Since it was explicitly managed by B's policy, it should not carry the unmanaged notice
			expect(text).not.toContain("read-only automatic fallback");
		});
	});

	describe("G4: Home boundary isolation", () => {
		it("stops upward walk before reading user home directory config", async () => {
			const fakeHome = path.join(tempRoot, "fake-home");
			await fs.mkdir(path.join(fakeHome, ".ompg"), { recursive: true });
			await fs.writeFile(path.join(fakeHome, ".ompg", "encoding.json"), POLICY_GBK, "utf8");

			const subProject = path.join(fakeHome, "workspace", "firmware");
			await fs.mkdir(subProject, { recursive: true });

			const homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
			try {
				const lookup = findProjectConfigUpward(subProject, "encoding.json");
				expect(lookup).toBeUndefined();

				const discovered = discoverEncodingPolicy(subProject);
				expect(discovered).toBeUndefined();
			} finally {
				homedirSpy.mockRestore();
			}
		});
	});

	describe("G5 & G8: Grep search coverage and partial result reporting", () => {
		it("searches unmanaged GBK and UTF-8 files in fallback mode", async () => {
			const project = path.join(tempRoot, "grep-unmanaged");
			await fs.mkdir(path.join(project, "src"), { recursive: true });
			await fs.writeFile(path.join(project, "src", "gbk.c"), GBK_SOURCE);
			await fs.writeFile(path.join(project, "src", "utf8.c"), "// utf8\nint y = 2;\n", "utf8");

			const session = createSession(project);
			const grepTool = new GrepTool(session);

			const matchInt = await grepTool.execute("grep-1", {
				pattern: "int",
				path: path.join(project, "src"),
			});
			const textInt = resultText(matchInt);
			expect(textInt).toContain("gbk.c");
			expect(textInt).toContain("utf8.c");

			const matchChinese = await grepTool.execute("grep-2", {
				pattern: "中文",
				path: path.join(project, "src"),
			});
			const textChinese = resultText(matchChinese);
			expect(textChinese).toContain("gbk.c");
			expect(textChinese).toContain("中文");
		});

		it("reports undecodable files and states zero matches in searched files when none match", async () => {
			const project = path.join(tempRoot, "grep-partial");
			await fs.mkdir(project, { recursive: true });
			// Valid UTF-8 file without matching pattern
			await fs.writeFile(path.join(project, "clean.c"), "void foo() {}\n", "utf8");
			// Undecodable binary/corrupt file
			await fs.writeFile(path.join(project, "corrupt.c"), UNDECODABLE_BYTES);

			const session = createSession(project, {
				"textEncoding.readFallback": "strict-utf8",
				"textEncoding.invalidSearchFile": "report",
			});
			const grepTool = new GrepTool(session);

			const result = await grepTool.execute("grep-zero", {
				pattern: "nonexistent_pattern",
				path: project,
			});
			const text = resultText(result);

			expect(text).toContain("No matches found in searched files");
			expect(text).toContain("not searched due to encoding errors");
			expect(text).toContain("Skipped 1 undecodable file(s) in report mode");
		});

		it("throws ToolError when undecodable file is encountered in fail mode", async () => {
			const project = path.join(tempRoot, "grep-fail-mode");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(path.join(project, "clean.c"), "void foo() {}\n", "utf8");
			await fs.writeFile(path.join(project, "corrupt.c"), UNDECODABLE_BYTES);

			const session = createSession(project, {
				"textEncoding.readFallback": "strict-utf8",
				"textEncoding.invalidSearchFile": "fail",
			});
			const grepTool = new GrepTool(session);

			await expect(
				grepTool.execute("grep-fail", {
					pattern: "foo",
					path: project,
				}),
			).rejects.toThrow();
		});
	});

	describe("G6 & G7: Write eligibility pre-check", () => {
		it("LSP rejects policy and source changes together before mutating either file", async () => {
			const config = path.join(tempRoot, ".ompg", "encoding.json");
			const file = path.join(tempRoot, "source.c");
			await Bun.write(config, POLICY_GBK);
			await Bun.write(file, GBK_SOURCE);
			await expect(
				applyWorkspaceEdit(
					{
						changes: {
							[fileToUri(config)]: [
								{
									range: { start: { line: 0, character: 0 }, end: { line: 0, character: POLICY_GBK.length } },
									newText: POLICY_UTF8,
								},
							],
							[fileToUri(file)]: [
								{ range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } }, newText: "2" },
							],
						},
					},
					tempRoot,
				),
			).rejects.toThrow("separate tool calls");
			expect(await fs.readFile(file)).toEqual(Buffer.from(GBK_SOURCE));
			expect(await Bun.file(config).text()).toBe(POLICY_GBK);
		});

		it("refuses a batch that changes encoding policy and source bytes together", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_GBK);
			const file = path.join(tempRoot, "source.c");
			await Bun.write(file, GBK_SOURCE);
			await expect(
				new EditTool(createSession(tempRoot), "apply_patch").execute("mixed", {
					input: `*** Begin Patch\n*** Update File: .ompg/encoding.json\n@@\n-${POLICY_GBK}\n+${POLICY_UTF8}\n*** Update File: source.c\n@@\n-int x = 1;\n+int x = 2;\n*** End Patch\n`,
				}),
			).rejects.toThrow("separate tool calls");
			expect(await fs.readFile(file)).toEqual(Buffer.from(GBK_SOURCE));
			expect(await Bun.file(path.join(tempRoot, ".ompg", "encoding.json")).text()).toBe(POLICY_GBK);
		});

		it("refuses WriteTool overwrite of unmanaged non-UTF8 file as UTF-8", async () => {
			const project = path.join(tempRoot, "write-refusal");
			const file = path.join(project, "f_modbus.c");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(file, GBK_SOURCE);

			const session = createSession(project);
			const writeTool = new WriteTool(session);

			await expect(
				writeTool.execute("write-1", {
					path: file,
					content: "int x = 99;\n",
				}),
			).rejects.toThrow(/writing it as UTF-8 would corrupt it/);

			// Verify file bytes were NOT changed on disk!
			expect(await Bun.file(file).bytes()).toEqual(GBK_SOURCE);
		});

		it("refuses EditTool batch edit if any target file lacks write eligibility", async () => {
			const project = path.join(tempRoot, "edit-refusal");
			const cleanFile = path.join(project, "clean.c");
			const gbkFile = path.join(project, "gbk.c");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(cleanFile, "int a = 1;\n", "utf8");
			await fs.writeFile(gbkFile, GBK_SOURCE);

			const session = createSession(project);
			const editTool = new EditTool(session);

			// Attempt patch on gbkFile
			await expect(
				editTool.execute("edit-1", {
					input: `[${gbkFile}#1234]\nPUT 1.=1:\n+int x = 2;\n`,
				}),
			).rejects.toThrow(/writing it as UTF-8 would corrupt it/);

			// Verify disk was NOT mutated
			expect(await Bun.file(gbkFile).bytes()).toEqual(GBK_SOURCE);
			expect(await fs.readFile(cleanFile, "utf8")).toBe("int a = 1;\n");
		});
	});

	describe("SchemaVersion 2 auto policy", () => {
		it("allows unambiguous UTF-8 writes under auto instead of treating every non-ASCII file as dual-valid", async () => {
			await Bun.write(path.join(tempRoot, ".ompg", "encoding.json"), POLICY_SCHEMA2_AUTO);
			const file = path.join(tempRoot, "utf8-only.c");
			const text = "// 中\nint x = 1;\n";
			expect(() => new TextDecoder("gbk", { fatal: true }).decode(Buffer.from(text))).toThrow();
			await Bun.write(file, text);
			const result = await new WriteTool(createSession(tempRoot)).execute("write", {
				path: file,
				content: text.replace("= 1", "= 2"),
			});
			expect(result.isError).not.toBe(true);
			expect(await Bun.file(file).bytes()).toEqual(Buffer.from(text.replace("= 1", "= 2")));
		});

		it("reads both UTF-8 and GBK files cleanly under defaultEncoding: auto", async () => {
			const project = path.join(tempRoot, "schema2-auto");
			await fs.mkdir(path.join(project, ".ompg"), { recursive: true });
			await fs.writeFile(path.join(project, ".ompg", "encoding.json"), POLICY_SCHEMA2_AUTO, "utf8");

			const gbkFile = path.join(project, "a.c");
			const utf8File = path.join(project, "b.c");
			await fs.writeFile(gbkFile, GBK_SOURCE);
			await fs.writeFile(utf8File, "// utf8 comment\nint y = 2;\n", "utf8");

			const session = createSession(project);
			const readTool = new ReadTool(session);

			const resultGbk = await readTool.execute("read-gbk", { path: gbkFile });
			expect(resultText(resultGbk)).toContain("中文");

			const resultUtf8 = await readTool.execute("read-utf8", { path: utf8File });
			expect(resultText(resultUtf8)).toContain("utf8 comment");
		});
	});

	describe("G10: CLI doctor & init commands", () => {
		it("initializes .ompg/encoding.json with gbk-source profile idempotently", async () => {
			const project = path.join(tempRoot, "cli-init-project");
			await fs.mkdir(project, { recursive: true });

			// Run init
			await runEncodingInitCommand({ path: project, profile: "gbk-source" });

			const createdPath = path.join(project, ".ompg", "encoding.json");
			expect(await fs.stat(createdPath)).toBeDefined();

			const content = JSON.parse(await fs.readFile(createdPath, "utf8"));
			expect(content.schemaVersion).toBe(1);
			expect(content.defaultEncoding).toBe("gbk");
			expect(content.include).toEqual(["**/*.c", "**/*.h"]);

			// Run init again: idempotent, does not overwrite
			await runEncodingInitCommand({ path: project, profile: "gbk-source" });
			expect(JSON.parse(await fs.readFile(createdPath, "utf8"))).toEqual(content);
		});

		it("doctor command inspects target resolution accurately", async () => {
			const project = path.join(tempRoot, "cli-doctor-project");
			const cFile = path.join(project, "main.c");
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(cFile, GBK_SOURCE);

			// Init policy
			await runEncodingInitCommand({ path: project, profile: "gbk-source" });

			// Inspect with doctor via captured stdout
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
			try {
				await runEncodingDoctorCommand(cFile, { json: true });
			} finally {
				console.log = origLog;
			}

			const parsed = JSON.parse(logs.join("\n"));
			expect(parsed.binary.version).toBe(DISTRIBUTION_VERSION);
			expect(parsed.targetKind).toBe("file");
			expect(parsed.config.selectedPath).toContain(".ompg");
			expect(parsed.targetResolution.assignment).toBe("gbk");
			expect(parsed.targetResolution.writeEligible).toBe(true);
		});
	});

	describe("Review R1–R13 contracts: edge cases and security guarantees", () => {
		it("R1 external GBK read then replace edit uses the target policy", async () => {
			const active = path.join(tempRoot, "active");
			const target = path.join(tempRoot, "target");
			await Bun.write(path.join(active, ".ompg/encoding.json"), POLICY_UTF8);
			await Bun.write(path.join(target, ".ompg/encoding.json"), POLICY_GBK);
			const file = path.join(target, "main.c");
			await Bun.write(file, GBK_SOURCE);
			const owner = createSession(active);
			expect(resultText(await new ReadTool(owner).execute("r", { path: file }))).toContain("中文");
			const edited = await new EditTool(owner, "replace").execute("e", {
				path: file,
				old_string: "int x = 1;",
				new_string: "int x = 2;",
			});
			if (edited.isError) throw new Error(resultText(edited));
			expect(resultText(await new ReadTool(owner).execute("r2", { path: file }))).toContain("int x = 2;");
		});

		it("R2 directory grep discovers nested target policies", async () => {
			await Bun.write(path.join(tempRoot, ".ompg/encoding.json"), POLICY_UTF8);
			await Bun.write(path.join(tempRoot, "child/.ompg/encoding.json"), POLICY_GBK);
			await Bun.write(path.join(tempRoot, "child/main.c"), GBK_SOURCE);
			const result = await new GrepTool(createSession(tempRoot)).execute("g", { pattern: "中文", path: tempRoot });
			expect(resultText(result)).toContain("// 中文");
		});

		it("R3 unreadable preferred protection cannot fall back to disabled legacy protection (EACCES fault injection)", async () => {
			const preferred = path.join(tempRoot, ".ompg/protected-mode.json");
			await Bun.write(preferred, JSON.stringify({ schemaVersion: 1, enabled: true, buildTasks: [] }));
			await Bun.write(
				path.join(tempRoot, ".omp/protected-mode.json"),
				JSON.stringify({ schemaVersion: 1, enabled: false, buildTasks: [] }),
			);
			const original = nodeFs.statSync;
			spyOn(nodeFs, "statSync").mockImplementation(((target: nodeFs.PathLike) => {
				if (String(target) === preferred)
					throw Object.assign(new Error("EACCES review injection"), { code: "EACCES" });
				return original(target);
			}) as unknown as typeof nodeFs.statSync);
			expect(protectedEvalDenial(tempRoot)).toBeDefined();
		});

		it("R4 preferred policy creation is observed after an existing positive legacy lookup", async () => {
			spyOn(Date, "now").mockReturnValue(100000);
			await Bun.write(path.join(tempRoot, ".omp/encoding.json"), POLICY_UTF8);
			const file = path.join(tempRoot, "main.c");
			await Bun.write(file, GBK_SOURCE);
			await expect(new ReadTool(createSession(tempRoot)).execute("before", { path: file })).rejects.toThrow(
				"invalid UTF-8",
			);
			await new WriteTool(createSession(tempRoot)).execute("policy-write", {
				path: path.join(tempRoot, ".ompg/encoding.json"),
				content: POLICY_GBK,
			});
			expect(resultText(await new ReadTool(createSession(tempRoot)).execute("after", { path: file }))).toContain(
				"中文",
			);
		});

		it("R6 auto dual-valid nonASCII bytes require explicit policy before overwrite", async () => {
			await Bun.write(path.join(tempRoot, ".ompg/encoding.json"), POLICY_SCHEMA2_AUTO);
			const file = path.join(tempRoot, "main.c");
			const original = Buffer.from("// 中文\nint x = 1;\n");
			expect(encodingUtf8AmbiguousWithGbk(original)).toBe(true);
			await Bun.write(file, original);
			const owner = createSession(tempRoot);
			await new ReadTool(owner).execute("r", { path: file });
			let refused = false;
			try {
				await new WriteTool(owner).execute("w", { path: file, content: "// 中文\nint x = 2;\n" });
			} catch {
				refused = true;
			}
			expect(await Bun.file(file).bytes()).toEqual(new Uint8Array(original));
			expect(refused).toBe(true);
		});

		it("R7 streamed fallback retains a GBK character across the 8192-byte read boundary", async () => {
			const file = path.join(tempRoot, "large.c");
			const bytes = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x61);
			bytes.set([0xd6, 0xd0, 0xce, 0xc4, 10], 8191);
			await Bun.write(file, bytes);
			expect(
				resultText(await new ReadTool(createSession(tempRoot)).execute("r", { path: `${file}:raw:1` })),
			).toContain("中文");
		});

		it("R8 streamed fallback reports its decode provenance", async () => {
			const file = path.join(tempRoot, "large.c");
			const bytes = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x61);
			bytes.set(GBK_SOURCE);
			await Bun.write(file, bytes);
			const result = await new ReadTool(createSession(tempRoot)).execute("r", { path: `${file}:raw:1-2` });
			expect(resultText(result)).toContain("中文");
			expect(resultText(result)).toContain("read-only automatic fallback");
		});

		it("R9 project .ompg config settings reach the actual ReadTool", async () => {
			const legacy = path.join(tempRoot, "legacy-control");
			await Bun.write(path.join(legacy, ".omp/config.yml"), "textEncoding:\n  readFallback: strict-utf8\n");
			const legacyFile = path.join(legacy, "main.c");
			await Bun.write(legacyFile, GBK_SOURCE);
			const legacySettings = await Settings.loadReadOnly({
				cwd: legacy,
				agentDir: path.join(tempRoot, "isolated-agent"),
			});
			const control = await new ReadTool(createSession(legacy, legacySettings)).execute("control", {
				path: legacyFile,
			});
			expect(resultText(control)).toContain("not valid UTF-8");
			await Bun.write(path.join(tempRoot, ".ompg/config.yml"), "textEncoding:\n  readFallback: strict-utf8\n");
			const file = path.join(tempRoot, "main.c");
			await Bun.write(file, GBK_SOURCE);
			const settings = await Settings.loadReadOnly({
				cwd: tempRoot,
				agentDir: path.join(tempRoot, "isolated-agent"),
			});
			const result = await new ReadTool(createSession(tempRoot, settings)).execute("r", { path: file });
			expect(resultText(result)).not.toContain("// 中文");
		});

		it("R10 file mention enforces the same GBK/BOM conflict as ReadTool", async () => {
			await Bun.write(path.join(tempRoot, ".ompg/encoding.json"), POLICY_GBK);
			const file = path.join(tempRoot, "main.c");
			await Bun.write(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("int x;\n")]));
			await expect(new ReadTool(createSession(tempRoot)).execute("direct", { path: file })).rejects.toThrow(
				"UTF-8 BOM",
			);
			const messages = await generateFileMentionMessages([file], tempRoot);
			expect(JSON.stringify(messages)).toContain("policy conflict");
		});

		it("R11 doctor reports the codec selected by strict-utf8 settings", async () => {
			const file = path.join(tempRoot, "main.c");
			await Bun.write(file, GBK_SOURCE);
			spyOn(Settings, "loadReadOnly").mockResolvedValue(
				Settings.isolated({ "textEncoding.readFallback": "strict-utf8" }),
			);
			const output = spyOn(console, "log").mockImplementation(() => {});
			await runEncodingDoctorCommand(file, { json: true });
			const report = JSON.parse(String(output.mock.calls[0]?.[0])) as {
				globalSettings: { readFallback: string };
				targetResolution: { effectiveCodec: string };
			};
			expect(report.globalSettings.readFallback).toBe("strict-utf8");
			expect(report.targetResolution.effectiveCodec).toBe("utf8");
		});

		it("R12 semantically equal protection aliases retain the allowed build task", async () => {
			const config = {
				schemaVersion: 1,
				enabled: true,
				buildTasks: [{ id: "version", exe: process.execPath, args: ["--version"] }],
			};
			await Bun.write(path.join(tempRoot, ".ompg/protected-mode.json"), JSON.stringify(config));
			expect(checkProtectedCommand(tempRoot, `"${process.execPath}" --version`)?.denied).toBe(false);
			await Bun.write(path.join(tempRoot, ".omp/protected-mode.json"), JSON.stringify(config, null, 2));
			expect(checkProtectedCommand(tempRoot, `"${process.execPath}" --version`)?.denied).toBe(false);
		});

		it.skipIf(process.platform !== "win32")("R13 Windows home boundary is case insensitive", async () => {
			await Bun.write(path.join(tempRoot, ".omp/encoding.json"), POLICY_GBK);
			const file = path.join(tempRoot, "child/main.c");
			await Bun.write(file, GBK_SOURCE);
			spyOn(os, "homedir").mockReturnValue(tempRoot);
			const owner = createSession(path.join(tempRoot, "child").toLowerCase(), {
				"textEncoding.readFallback": "strict-utf8",
			});
			const result = await new ReadTool(owner).execute("r", { path: file.toLowerCase() });
			expect(resultText(result)).not.toContain("// 中文");
		});
	});
});
