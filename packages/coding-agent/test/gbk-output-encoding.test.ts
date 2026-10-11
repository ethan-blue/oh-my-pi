/**
 * G5 contracts: observable decode provenance for captured child-process
 * output. The bash tool's `outputEncoding` parameter pins the stream's
 * encoding (gbk = CP936, utf8 = UTF-8 only), the embedded-shell and
 * protected-build (ptree) paths share the same native OutputDecoder, and the
 * result names the encoding actually used plus any U+FFFD replacements.
 *
 * GBK bytes for 中文 are written as octal printf escapes (D6 D0 CE C4) —
 * independent of any codec under test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { executeProtectedBuild } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { OutputDecoder } from "@oh-my-pi/pi-natives";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function makeSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "artifact-1", path: path.join(cwd, "artifact-1.log") }),
		settings: Settings.isolated({
			"async.enabled": false,
			"bash.autoBackground.enabled": false,
			"bash.autoBackground.thresholdMs": 60_000,
			"bashInterceptor.enabled": false,
			"astGrep.enabled": false,
			"astEdit.enabled": false,
			"grep.enabled": false,
			"glob.enabled": false,
		}),
		getClientBridge: () => undefined,
	} as unknown as ToolSession;
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
		.map(b => b.text)
		.join("\n");
}

/** printf octal escapes emitting the GBK bytes for 中文 plus LF. */
const EMIT_GBK = "printf '\\326\\320\\316\\304\\n'";

describe("subprocess output encoding protocol (G5)", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-output-"));
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("native OutputDecoder decodes explicit GBK across chunk boundaries and reports it", () => {
		const decoder = new OutputDecoder("gbk");
		expect(decoder.push(new Uint8Array([0xd6]))).toBe("");
		expect(decoder.push(new Uint8Array([0xd0, 0xce]))).toBe("中");
		expect(decoder.push(new Uint8Array([0xc4, 0x0a]))).toBe("文\n");
		expect(decoder.finish()).toBe("");
		expect(decoder.encoding).toBe("gbk");
		expect(decoder.replacements).toBe(0);
	});

	it("native OutputDecoder in utf8-only mode replaces invalid bytes and counts them", () => {
		const decoder = new OutputDecoder("utf8");
		// GBK 中文 is invalid UTF-8: three bad lead bytes, the fourth resolves
		// at EOF.
		expect(decoder.push(new Uint8Array([0xd6, 0xd0, 0xce]))).toBe("\u{FFFD}\u{FFFD}");
		expect(decoder.finish()).toBe("\u{FFFD}");
		expect(decoder.encoding).toBe("utf8");
		expect(decoder.replacements).toBe(3);
	});

	it("bash with outputEncoding gbk decodes GBK output and the result says so", async () => {
		const result = await new BashTool(makeSession(tmpDir)).execute("bash-gbk", {
			command: EMIT_GBK,
			outputEncoding: "gbk",
		});
		expect(result.isError).toBeFalsy();
		const text = resultText(result);
		expect(text).toContain("中文");
		expect(text).toContain("output decoded as GBK (cp936)");
	});

	it("bash with outputEncoding utf8 keeps GBK bytes as counted replacements", async () => {
		const result = await new BashTool(makeSession(tmpDir)).execute("bash-utf8", {
			command: EMIT_GBK,
			outputEncoding: "utf8",
		});
		expect(result.isError).toBeFalsy();
		const text = resultText(result);
		expect(text).toContain("\u{FFFD}");
		expect(text).toMatch(/output decoded as UTF-8; \d+ undecodable byte sequence/);
		expect(text).toContain("outputEncoding");
	});

	it("clean UTF-8 output carries no decode notice", async () => {
		const result = await new BashTool(makeSession(tmpDir)).execute("bash-plain", {
			command: "printf 'hello world'",
		});
		expect(result.isError).toBeFalsy();
		const text = resultText(result);
		expect(text).toContain("hello world");
		expect(text).not.toContain("output decoded as");
	});

	it("protected build decodes GBK stdout and stderr through the shared decoder", async () => {
		const script =
			"process.stdout.write(new Uint8Array([0xd6,0xd0,0xce,0xc4,10]));" +
			"process.stderr.write(new Uint8Array([0xd6,0xd0,0xce,0xc4,10]));";
		const result = await executeProtectedBuild([process.execPath, "-e", script], {
			cwd: tmpDir,
			outputEncoding: "gbk",
		});
		expect(result.exitCode).toBe(0);
		// Both streams decode as GBK through the injected native decoder.
		expect(result.output).toContain("中文");
		expect(result.outputEncoding).toBe("gbk");
		expect(result.outputReplacements).toBe(0);
	});
});
