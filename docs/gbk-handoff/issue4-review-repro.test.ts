/** Reviewer counterexamples. Bun ignores docs: use native edit/write to place
 * this file in packages/coding-agent/test/zz-issue4-review-repro.test.ts before
 * running it. These are intentionally failing until the corresponding fixes.
 */
import { afterEach, beforeEach, expect, it, spyOn, vi } from "bun:test";
import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { GrepTool } from "@oh-my-pi/pi-coding-agent/tools/grep";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { invalidateEncodingCaches } from "@oh-my-pi/pi-coding-agent/encoding/index";
import { invalidateProtectedModeCaches, protectedEvalDenial } from "@oh-my-pi/pi-coding-agent/tools/protected-mode";
import { generateFileMentionMessages } from "@oh-my-pi/pi-coding-agent/utils/file-mentions";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
import { encodingUtf8AmbiguousWithGbk } from "@oh-my-pi/pi-natives";
import { runEncodingDoctorCommand } from "@oh-my-pi/pi-coding-agent/cli/encoding-cli";
import { checkProtectedCommand } from "@oh-my-pi/pi-coding-agent/tools/protected-mode";

let root: string;
const source = new Uint8Array([47, 47, 32, 0xd6, 0xd0, 0xce, 0xc4, 10, 105, 110, 116, 32, 120, 32, 61, 32, 49, 59, 10]);
function policy(encoding: "gbk" | "utf8" | "auto", enabled = true): string {
	return JSON.stringify({
		schemaVersion: encoding === "auto" ? 2 : 1,
		enabled,
		include: ["**/*.c"],
		defaultEncoding: encoding,
		newFileEncoding: encoding === "auto" ? "utf8" : encoding,
		overrides: [],
	});
}
function session(cwd: string, settings = Settings.isolated()): ToolSession {
	return { cwd, settings, hasUI: false, enableLsp: false, getSessionFile: () => null, getSessionSpawns: () => "*" };
}
function text(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("\n");
}
beforeEach(async () => {
	await Settings.init({ inMemory: true });
	invalidateEncodingCaches();
	invalidateProtectedModeCaches();
	root = await fs.mkdtemp(path.join(os.tmpdir(), "ompg-issue4-review-"));
});
afterEach(async () => {
	vi.restoreAllMocks();
	invalidateEncodingCaches();
	invalidateProtectedModeCaches();
	await removeWithRetries(root);
});

it("R1 external GBK read then replace edit uses the target policy", async () => {
	const active = path.join(root, "active");
	const target = path.join(root, "target");
	await Bun.write(path.join(active, ".ompg/encoding.json"), policy("utf8"));
	await Bun.write(path.join(target, ".ompg/encoding.json"), policy("gbk"));
	const file = path.join(target, "main.c");
	await Bun.write(file, source);
	const owner = session(active);
	expect(text(await new ReadTool(owner).execute("r", { path: file }))).toContain("中文");
	const edited = await new EditTool(owner, "replace").execute("e", {
		path: file,
		old_string: "int x = 1;",
		new_string: "int x = 2;",
	});
	if (edited.isError) throw new Error(text(edited));
	expect(text(await new ReadTool(owner).execute("r2", { path: file }))).toContain("int x = 2;");
});

it("R2 directory grep discovers nested target policies", async () => {
	await Bun.write(path.join(root, ".ompg/encoding.json"), policy("utf8"));
	await Bun.write(path.join(root, "child/.ompg/encoding.json"), policy("gbk"));
	await Bun.write(path.join(root, "child/main.c"), source);
	const result = await new GrepTool(session(root)).execute("g", { pattern: "中文", path: root });
	expect(text(result)).toContain("// 中文");
});

it("R3 unreadable preferred protection cannot fall back to disabled legacy protection (EACCES fault injection)", async () => {
	const preferred = path.join(root, ".ompg/protected-mode.json");
	await Bun.write(preferred, JSON.stringify({ schemaVersion: 1, enabled: true, buildTasks: [] }));
	await Bun.write(
		path.join(root, ".omp/protected-mode.json"),
		JSON.stringify({ schemaVersion: 1, enabled: false, buildTasks: [] }),
	);
	const original = nodeFs.statSync;
	spyOn(nodeFs, "statSync").mockImplementation(target => {
		if (String(target) === preferred) throw Object.assign(new Error("EACCES review injection"), { code: "EACCES" });
		return original(target);
	});
	expect(protectedEvalDenial(root)).toBeDefined();
});

it("R4 preferred policy creation is observed after an existing positive legacy lookup", async () => {
	spyOn(Date, "now").mockReturnValue(100000);
	await Bun.write(path.join(root, ".omp/encoding.json"), policy("utf8"));
	const file = path.join(root, "main.c");
	await Bun.write(file, source);
	await expect(new ReadTool(session(root)).execute("before", { path: file })).rejects.toThrow("invalid UTF-8");
	await new WriteTool(session(root)).execute("policy-write", {
		path: path.join(root, ".ompg/encoding.json"),
		content: policy("gbk"),
	});
	expect(text(await new ReadTool(session(root)).execute("after", { path: file }))).toContain("中文");
});

it("R6 auto dual-valid nonASCII bytes require explicit policy before overwrite", async () => {
	await Bun.write(path.join(root, ".ompg/encoding.json"), policy("auto"));
	const file = path.join(root, "main.c");
	const original = Buffer.from("// 中文\nint x = 1;\n");
	expect(encodingUtf8AmbiguousWithGbk(original)).toBe(true);
	await Bun.write(file, original);
	const owner = session(root);
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
	const file = path.join(root, "large.c");
	const bytes = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x61);
	bytes.set([0xd6, 0xd0, 0xce, 0xc4, 10], 8191);
	await Bun.write(file, bytes);
	expect(text(await new ReadTool(session(root)).execute("r", { path: `${file}:raw:1` }))).toContain("中文");
});

it("R8 streamed fallback reports its decode provenance", async () => {
	const file = path.join(root, "large.c");
	const bytes = Buffer.alloc(4 * 1024 * 1024 + 1024, 0x61);
	bytes.set(source);
	await Bun.write(file, bytes);
	const result = await new ReadTool(session(root)).execute("r", { path: `${file}:raw:1-2` });
	expect(text(result)).toContain("中文");
	expect(text(result)).toContain("read-only automatic fallback");
});

it("R9 project .ompg config settings reach the actual ReadTool", async () => {
	const legacy = path.join(root, "legacy-control");
	await Bun.write(path.join(legacy, ".omp/config.yml"), "textEncoding:\n  readFallback: strict-utf8\n");
	const legacyFile = path.join(legacy, "main.c");
	await Bun.write(legacyFile, source);
	const legacySettings = await Settings.loadReadOnly({ cwd: legacy, agentDir: path.join(root, "isolated-agent") });
	const control = await new ReadTool(session(legacy, legacySettings)).execute("control", { path: legacyFile });
	expect(text(control)).toContain("not valid UTF-8");
	await Bun.write(path.join(root, ".ompg/config.yml"), "textEncoding:\n  readFallback: strict-utf8\n");
	const file = path.join(root, "main.c");
	await Bun.write(file, source);
	const settings = await Settings.loadReadOnly({ cwd: root, agentDir: path.join(root, "isolated-agent") });
	const result = await new ReadTool(session(root, settings)).execute("r", { path: file });
	expect(text(result)).not.toContain("// 中文");
});

it("R10 file mention enforces the same GBK/BOM conflict as ReadTool", async () => {
	await Bun.write(path.join(root, ".ompg/encoding.json"), policy("gbk"));
	const file = path.join(root, "main.c");
	await Bun.write(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("int x;\n")]));
	await expect(new ReadTool(session(root)).execute("direct", { path: file })).rejects.toThrow("UTF-8 BOM");
	const messages = await generateFileMentionMessages([file], root);
	expect(JSON.stringify(messages)).toContain("policy conflict");
});

it("R11 doctor reports the codec selected by strict-utf8 settings", async () => {
	const file = path.join(root, "main.c");
	await Bun.write(file, source);
	spyOn(Settings, "loadReadOnly").mockResolvedValue(Settings.isolated({ "textEncoding.readFallback": "strict-utf8" }));
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
	await Bun.write(path.join(root, ".ompg/protected-mode.json"), JSON.stringify(config));
	expect(checkProtectedCommand(root, `"${process.execPath}" --version`)?.denied).toBe(false);
	await Bun.write(path.join(root, ".omp/protected-mode.json"), JSON.stringify(config, null, 2));
	expect(checkProtectedCommand(root, `"${process.execPath}" --version`)?.denied).toBe(false);
});

it.skipIf(process.platform !== "win32")("R13 Windows home boundary is case insensitive", async () => {
	await Bun.write(path.join(root, ".omp/encoding.json"), policy("gbk"));
	const file = path.join(root, "child/main.c");
	await Bun.write(file, source);
	spyOn(os, "homedir").mockReturnValue(root);
	const owner = session(
		path.join(root, "child").toLowerCase(),
		Settings.isolated({ "textEncoding.readFallback": "strict-utf8" }),
	);
	const result = await new ReadTool(owner).execute("r", { path: file.toLowerCase() });
	expect(text(result)).not.toContain("// 中文");
});
