/**
 * R1—R5 rework regressions (designer review, docs/gbk-handoff/18):
 * segmented-chain decode provenance, unknown-reader semantics, ACP loss
 * counting, and mixed per-stream encodings.
 *
 * GBK bytes for 中文 are written as octal printf escapes (D6 D0 CE C4) —
 * independent of any codec under test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { executeBash, executeProtectedBuild } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { executeShell, OutputDecoder, Shell } from "@oh-my-pi/pi-natives";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

/** printf octal escapes emitting the GBK bytes for 中文 plus LF. */
const EMIT_GBK = "printf '\\326\\320\\316\\304\\n'";
const CHAIN = `${EMIT_GBK}; printf 'done\n'`;

interface RunOutcome {
	text: string;
	outputEncoding?: string;
	outputEncodings?: string[];
	outputReplacements?: number;
	outputEncodingUnknownReaders?: number;
}

async function runShell(
	command: string,
	options: { outputEncoding?: "utf8" | "gbk"; minimizer?: { enabled: boolean; maxCaptureBytes?: number } },
): Promise<RunOutcome> {
	let text = "";
	const result = await executeShell(
		{
			command,
			outputEncoding: options.outputEncoding,
			minimizer: options.minimizer,
		},
		(_error, chunk) => {
			text += chunk;
		},
	);
	return {
		text,
		outputEncoding: result.outputEncoding ?? undefined,
		outputEncodings: result.outputEncodings ?? undefined,
		outputReplacements: result.outputReplacements ?? undefined,
		outputEncodingUnknownReaders: result.outputEncodingUnknownReaders ?? undefined,
	};
}

/** Host ACP label, or undefined probing is inconclusive (never on cp936). */
function hostAcpIsCp936(): boolean {
	const probe = new OutputDecoder();
	probe.push(new Uint8Array([0x81]));
	return probe.encoding === "cp936";
}

describe("R2 segmented chain provenance (designer repro)", () => {
	it("utf8 + minimizer off: four replacements survive", async () => {
		const outcome = await runShell(CHAIN, { outputEncoding: "utf8", minimizer: { enabled: false } });
		expect(outcome.text).toContain("\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}");
		expect(outcome.text).toContain("done");
		expect(outcome.outputEncoding).toBe("utf8");
		expect(outcome.outputReplacements).toBe(4);
		expect(outcome.outputEncodingUnknownReaders).toBeUndefined();
	});

	it("utf8 + minimizer on: replacements must not collapse to 0", async () => {
		const outcome = await runShell(CHAIN, { outputEncoding: "utf8", minimizer: { enabled: true } });
		expect(outcome.text).toContain("\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}");
		expect(outcome.text).toContain("done");
		expect(outcome.outputEncoding).toBe("utf8");
		expect(outcome.outputEncodings).toEqual(["utf8"]);
		expect(outcome.outputReplacements).toBe(4);
	});

	it.skipIf(!hostAcpIsCp936())("auto + minimizer off on a cp936 host: fallback reported", async () => {
		const outcome = await runShell(CHAIN, { minimizer: { enabled: false } });
		expect(outcome.text).toContain("中文");
		expect(outcome.outputEncoding).toBe("cp936");
	});

	it.skipIf(!hostAcpIsCp936())("auto + minimizer on on a cp936 host: the cp936 source must not vanish", async () => {
		const outcome = await runShell(CHAIN, { minimizer: { enabled: true } });
		expect(outcome.text).toContain("中文");
		expect(outcome.text).toContain("done");
		// The first segment decoded via cp936, the second is clean UTF-8: no
		// uniform claim, both sources stay visible.
		expect(outcome.outputEncoding).toBeUndefined();
		expect(outcome.outputEncodings).toEqual(["cp936", "utf8"]);
		expect(outcome.outputReplacements).toBe(0);
	});

	it("multiple abnormal segments all count", async () => {
		const outcome = await runShell("printf '\\326\\320\\n'; printf '\\316\\304\\n'; printf 'ok\\n'", {
			outputEncoding: "utf8",
			minimizer: { enabled: true },
		});
		expect(outcome.outputEncoding).toBe("utf8");
		expect(outcome.outputReplacements).toBe(4);
	});

	it("a skipped tail segment contributes nothing", async () => {
		const outcome = await runShell(`${EMIT_GBK} && false && printf '\\326\\320\\n'`, {
			outputEncoding: "utf8",
			minimizer: { enabled: true },
		});
		expect(outcome.text).toContain("\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}");
		expect(outcome.text).not.toContain("never");
		expect(outcome.outputReplacements).toBe(4);
		expect(outcome.outputEncodingUnknownReaders).toBeUndefined();
	});

	it("capture-cap overflow keeps provenance for streamed segments", async () => {
		// The first segment overflows a tiny capture cap, so the aggregate is
		// dropped and the remaining segments stream raw — every segment still
		// ran a reader, so the replacements of the tail still count.
		const outcome = await runShell("printf 'abcdefgh%.0s' {1..20}; printf '\\326\\320\\n'", {
			outputEncoding: "utf8",
			minimizer: { enabled: true, maxCaptureBytes: 64 },
		});
		expect(outcome.text).toContain("abcdefgh");
		expect(outcome.outputEncoding).toBe("utf8");
		expect(outcome.outputReplacements).toBe(2);
	});

	it("a pipeline is one captured reader, not per-stage provenance", async () => {
		// Kernel pipes carry the intermediate bytes; only the final stage's
		// stdout is captured, so one part — the substitutions live in that
		// single reader.
		const outcome = await runShell(`${EMIT_GBK} | cat`, { outputEncoding: "utf8", minimizer: { enabled: false } });
		expect(outcome.text).toContain("\u{FFFD}\u{FFFD}\u{FFFD}\u{FFFD}");
		expect(outcome.outputEncodings).toEqual(["utf8"]);
		expect(outcome.outputReplacements).toBe(4);
	});
});

describe("R5 ACP substitution counting", () => {
	it.skipIf(!hostAcpIsCp936())("counts the dangling-lead default-character substitution", () => {
		const decoder = new OutputDecoder();
		expect(decoder.push(new Uint8Array([0x81]))).toBe("");
		expect(decoder.finish()).toBe("?");
		expect(decoder.encoding).toBe("cp936");
		expect(decoder.replacements).toBe(1);
	});

	it.skipIf(!hostAcpIsCp936())("counts an invalid trail pair and keeps valid neighbors", () => {
		const decoder = new OutputDecoder();
		// Euro, 中文 (valid pairs), an invalid pair (D6 7F), then x.
		expect(decoder.push(new Uint8Array([0x80, 0xd6, 0xd0, 0xce, 0xc4, 0xd6, 0x7f, 0x78]))).toBe("€中文?x");
		expect(decoder.finish()).toBe("");
		expect(decoder.replacements).toBe(1);
	});

	it.skipIf(!hostAcpIsCp936())("legitimate '?' and U+FFFD in output are never counted", () => {
		const decoder = new OutputDecoder();
		// A literal '?' (0x3F) and the euro (0x80) are real mappings.
		expect(decoder.push(new Uint8Array([0x3f, 0x80, 0x78]))).toBe("?€x");
		expect(decoder.finish()).toBe("");
		expect(decoder.replacements).toBe(0);
	});
});

describe("R2 protected-build per-stream provenance", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-mixed-"));
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it.skipIf(!hostAcpIsCp936())("stdout UTF-8 + stderr GBK stays mixed, not one source", async () => {
		const script =
			"process.stdout.write(new TextEncoder().encode('中文\\n'));" +
			"process.stderr.write(new Uint8Array([0xd6,0xd0,0xce,0xc4,10]));";
		const result = await executeProtectedBuild([process.execPath, "-e", script], { cwd: tmpDir });
		expect(result.exitCode).toBe(0);
		// Both streams decode correctly, each with its own encoding.
		expect(result.output).toContain("中文");
		expect(result.outputEncoding).toBeUndefined();
		expect(result.outputEncodings).toContain("utf8");
		expect(result.outputEncodings).toContain("cp936");
	});

	it("both streams GBK stays uniform gbk", async () => {
		const script =
			"process.stdout.write(new Uint8Array([0xd6,0xd0,0xce,0xc4,10]));" +
			"process.stderr.write(new Uint8Array([0xd6,0xd0,0xce,0xc4,10]));";
		const result = await executeProtectedBuild([process.execPath, "-e", script], {
			cwd: tmpDir,
			outputEncoding: "gbk",
		});
		expect(result.outputEncoding).toBe("gbk");
		expect(result.outputEncodings).toEqual(["gbk"]);
		expect(result.outputReplacements).toBe(0);
	});
});

describe("R2 bash tool surfaces the mixed provenance", () => {
	it.skipIf(!hostAcpIsCp936())("a mixed auto chain carries a mixed-encoding notice", async () => {
		const session = {
			cwd: process.cwd(),
			hasUI: false,
			skills: [],
			getSessionFile: () => null,
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
		// The minimizer is on by default, so the `;` chain runs segmented and
		// the GBK first segment decodes via cp936 while the ASCII tail is
		// valid UTF-8.
		const result = await new BashTool(session).execute("chain-mixed", { command: CHAIN });
		const text = result.content.find(block => block.type === "text")?.text ?? "";
		expect(text).toContain("中文");
		expect(text).toContain("done");
		expect(text).toContain("output decoded with mixed encodings");
		expect(text).toContain("cp936");
	});
});

describe("R3 persistent consumer provenance regression (executor & BashTool)", () => {
	it("executeBash and BashTool handle known + unknown readers at Shell.prototype.run seam", async () => {
		const session = {
			cwd: process.cwd(),
			hasUI: false,
			skills: [],
			getSessionFile: () => null,
			settings: Settings.isolated({
				"async.enabled": false,
				"bash.autoBackground.enabled": false,
				"bash.autoBackground.thresholdMs": 60_000,
				"bashInterceptor.enabled": false,
			}),
			getClientBridge: () => undefined,
		} as unknown as ToolSession;

		const runSpy = spyOn(Shell.prototype, "run").mockImplementation(function (this: Shell, _options, onChunk) {
			onChunk?.(null, "中文\n");
			return Promise.resolve({
				exitCode: 0,
				cancelled: false,
				timedOut: false,
				workingDir: process.cwd(),
				outputEncoding: undefined,
				outputEncodings: ["cp936"],
				outputReplacements: undefined,
				outputEncodingUnknownReaders: 1,
			});
		});

		try {
			// 1. Assert real executeBash preserves absent uniform encoding/replacements and retains provenance
			const execResult = await executeBash("echo test", { cwd: process.cwd() });
			expect(execResult.output).toContain("中文");
			expect(execResult.outputEncoding).toBeUndefined();
			expect(execResult.outputReplacements).toBeUndefined();
			expect(execResult.outputEncodings).toEqual(["cp936"]);
			expect(execResult.outputEncodingUnknownReaders).toBe(1);

			// 2. Assert real BashTool formats the incomplete provenance notice without false uniform claims
			const toolResult = await new BashTool(session).execute("r3-partial", { command: "echo test" });
			const text = toolResult.content.find(block => block.type === "text")?.text ?? "";
			expect(text).toContain("中文");
			expect(text).toContain(
				"output decode provenance incomplete (1 output reader(s) did not finish); observed: GBK via the Windows ANSI code page (cp936) — the encoding of some output is unknown",
			);
			expect(text).not.toContain("output decoded as cp936");
			expect(text).not.toContain("output decoded as UTF-8");
			expect(text).not.toContain("output decoded with mixed encodings");
		} finally {
			runSpy.mockRestore();
		}
	});

	it("executeBash and BashTool handle pure unknown readers without observed prefix at Shell.prototype.run seam", async () => {
		const session = {
			cwd: process.cwd(),
			hasUI: false,
			skills: [],
			getSessionFile: () => null,
			settings: Settings.isolated({
				"async.enabled": false,
				"bash.autoBackground.enabled": false,
				"bash.autoBackground.thresholdMs": 60_000,
				"bashInterceptor.enabled": false,
			}),
			getClientBridge: () => undefined,
		} as unknown as ToolSession;

		const runSpy = spyOn(Shell.prototype, "run").mockImplementation(function (this: Shell, _options, onChunk) {
			onChunk?.(null, "some text\n");
			return Promise.resolve({
				exitCode: 0,
				cancelled: false,
				timedOut: false,
				workingDir: process.cwd(),
				outputEncoding: undefined,
				outputEncodings: undefined,
				outputReplacements: undefined,
				outputEncodingUnknownReaders: 2,
			});
		});

		try {
			// 1. Assert real executeBash preserves absent uniform encoding/replacements and no observed encodings
			const execResult = await executeBash("echo test", { cwd: process.cwd() });
			expect(execResult.output).toContain("some text");
			expect(execResult.outputEncoding).toBeUndefined();
			expect(execResult.outputReplacements).toBeUndefined();
			expect(execResult.outputEncodings).toBeUndefined();
			expect(execResult.outputEncodingUnknownReaders).toBe(2);

			// 2. Assert real BashTool formats incomplete notice without observed prefix
			const toolResult = await new BashTool(session).execute("r3-unobserved", { command: "echo test" });
			const text = toolResult.content.find(block => block.type === "text")?.text ?? "";
			expect(text).toContain(
				"output decode provenance incomplete (2 output reader(s) did not finish) — the encoding of some output is unknown",
			);
			expect(text).not.toContain("observed:");
		} finally {
			runSpy.mockRestore();
		}
	});
});
