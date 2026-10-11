import { describe, expect, it } from "bun:test";
import { BaseKernel, type Frame } from "../../src/eval/kernel-base";

class ProtocolKernel extends BaseKernel {
	constructor() {
		super(crypto.randomUUID(), {
			languageName: "Protocol fixture",
			traceIpc: false,
			exitPayload: JSON.stringify({ type: "exit" }),
			interruptEscalationMs: 100,
			shutdownGraceMs: 100,
			buildPayload: (code, id) => JSON.stringify({ code, id }),
		});
	}
}

async function runFrames(frames: Frame[]) {
	const kernel = new ProtocolKernel();
	const script = `let input = ''; process.stdin.on('data', chunk => {
 input += chunk.toString(); let end;
 while ((end = input.indexOf('\\n')) >= 0) {
  const req = JSON.parse(input.slice(0, end)); input = input.slice(end + 1);
  if (req.type === 'exit') process.exit(0);
  if (req.type === 'raw_text') continue;
  for (const frame of ${JSON.stringify(frames)}) process.stdout.write(JSON.stringify({...frame,id:req.id})+'\\n');
 }
});`;
	kernel.setProcess(Bun.spawn([process.execPath, "-e", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }));
	try {
		return await kernel.execute("fixture", { outputEncoding: "gbk", timeoutMs: 1_000 });
	} finally {
		await kernel.shutdown();
	}
}

describe("BaseKernel raw delivery evidence (controlled protocol transport)", () => {
	it("withholds a completed decoder's summary until the runner acknowledges text delivery", async () => {
		const result = await runFrames([
			{ type: "raw_start", protocol: 1, stream: "pipe" },
			{ type: "raw_end", protocol: 1, stream: "pipe", seq: 0 },
			{ type: "done" },
		]);
		expect(result.outputEncodingUnknownReaders).toBe(1);
		expect(result.outputEncoding).toBeUndefined();
		expect(result.outputReplacements).toBeUndefined();
	});

	it("retains a completed observation but marks a reused stream identity unknown", async () => {
		const result = await runFrames([
			{ type: "raw_start", protocol: 1, stream: "pipe" },
			{ type: "raw_end", protocol: 1, stream: "pipe", seq: 0 },
			{ type: "raw_ack", protocol: 1, stream: "pipe", seq: 0 },
			{ type: "raw_start", protocol: 1, stream: "pipe" },
			{ type: "done" },
		]);
		expect(result.outputEncodings).toEqual(["gbk"]);
		expect(result.outputEncodingUnknownReaders).toBe(1);
		expect(result.outputEncoding).toBeUndefined();
		expect(result.outputReplacements).toBeUndefined();
	});

	it("counts a reader once when a bad sequence is followed by abort", async () => {
		const result = await runFrames([
			{ type: "raw_start", protocol: 1, stream: "pipe" },
			{ type: "raw_chunk", protocol: 1, stream: "pipe", seq: 1, data: "YQ==" },
			{ type: "raw_abort", protocol: 1, stream: "pipe" },
			{ type: "done" },
		]);
		expect(result.outputEncodingUnknownReaders).toBe(1);
		expect(result.outputEncodings).toBeUndefined();
		expect(result.outputEncoding).toBeUndefined();
	});
});
