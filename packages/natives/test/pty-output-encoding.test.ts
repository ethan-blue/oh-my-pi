import { describe, expect, it } from "bun:test";
import { PtySession } from "../native";

async function runPty(outputEncoding: "utf8" | "gbk", script: string) {
	const session = new PtySession();
	let output = "";
	const result = await session.startArgv(
		{ application: process.execPath, args: ["-e", script], outputEncoding, timeoutMs: 10_000 },
		(error, chunk) => {
			if (error) throw error;
			output += chunk;
		},
	);
	return { result, output };
}

describe("PTY decode provenance", () => {
	it("reports one completed merged reader after forwarding its UTF-8 output", async () => {
		const { result, output } = await runPty("utf8", "process.stdout.write('PTY中文\\n')");
		expect(output).toContain("PTY中文");
		expect(result.exitCode).toBe(0);
		expect(result.outputEncoding).toBe("utf8");
		expect(result.outputEncodings).toEqual(["utf8"]);
		expect(result.outputReplacements).toBe(0);
		expect(result.outputEncodingUnknownReaders).toBeUndefined();
	});

	// ConPTY itself converts console output into UTF-8. Raw GBK bytes written
	// by the child do not survive this boundary unchanged, so these byte-level
	// cases exercise a POSIX PTY; Windows has the real UTF-8 ConPTY test above.
	it.skipIf(process.platform === "win32")("decodes GBK bytes split across child writes", async () => {
		const { result, output } = await runPty(
			"gbk",
			"process.stdout.write(Buffer.from([0xd6]));setTimeout(()=>process.stdout.write(Buffer.from([0xd0,0xce,0xc4,10])),30)",
		);
		expect(output).toContain("中文");
		expect(result.outputEncoding).toBe("gbk");
		expect(result.outputReplacements).toBe(0);
	});

	it("accepts an explicit GBK preference through the native PTY boundary", async () => {
		const { result, output } = await runPty("gbk", "process.stdout.write('ASCII\\n')");
		expect(output).toContain("ASCII");
		expect(result.outputEncoding).toBe("gbk");
		expect(result.outputEncodings).toEqual(["gbk"]);
	});

	it("withholds totals and uniform encoding when cancellation abandons capture", async () => {
		const session = new PtySession();
		const controller = new AbortController();
		const result = await session.startArgv(
			{
				application: process.execPath,
				args: ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
				outputEncoding: "utf8",
				signal: controller.signal,
				timeoutMs: 10_000,
			},
			(_error, chunk) => {
				if (chunk.includes("ready")) controller.abort();
			},
		);
		expect(result.cancelled).toBeTrue();
		expect(result.outputEncoding).toBeUndefined();
		expect(result.outputReplacements).toBeUndefined();
		expect(result.outputEncodingUnknownReaders).toBe(1);
	});

	it("rejects unsupported preferences before spawning a child", async () => {
		const session = new PtySession();
		expect(() => session.startArgv({ application: process.execPath, args: [], outputEncoding: "invalid" })).toThrow(
			"outputEncoding",
		);
	});
});
