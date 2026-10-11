import { describe, expect, it } from "bun:test";
import { PythonKernel } from "../../../src/eval/py/kernel";

const interpreter = Bun.which("python") ?? Bun.which("python3");
function quoteShell(value: string): string {
	return process.platform === "win32" ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", `'"'"'`)}'`;
}

describe.skipIf(!interpreter)("Python native raw-output protocol", () => {
	it("decodes PIPE GBK bytes and preserves the shell helper return value", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			let output = "";
			const child =
				"import os,time;os.write(1,bytes([0xd6]));time.sleep(.05);os.write(1,bytes([0xd0,0xce,0xc4,10]))";
			const result = await kernel.execute(
				`result = !${quoteShell(interpreter!)} -c ${quoteShell(child)}\nprint('returned=' + result.n + ':' + str(result.returncode))`,
				{
					outputEncoding: "gbk",
					timeoutMs: 10_000,
					onChunk: text => {
						output += text;
					},
				},
			);
			expect(result.status).toBe("ok");
			expect(output).toContain("中文");
			expect(output).toContain("returned=中文:0");
			expect(result.outputEncoding).toBe("gbk");
			expect(result.outputReplacements).toBe(0);
			expect(result.outputEncodingUnknownReaders).toBeUndefined();
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("keeps ordinary str output unchanged without a fabricated reader summary", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			let output = "";
			const result = await kernel.execute("print('中文😀')", {
				outputEncoding: "gbk",
				onChunk: text => {
					output += text;
				},
			});
			expect(output).toBe("中文😀\n");
			expect(result.outputEncoding).toBeUndefined();
			expect(result.outputReplacements).toBeUndefined();
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("counts an incomplete GBK character at PIPE EOF", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			const result = await kernel.execute(
				`!${quoteShell(interpreter!)} -c ${quoteShell("import os;os.write(1,bytes([0x81]))")}`,
				{ outputEncoding: "gbk", timeoutMs: 10_000 },
			);
			expect(result.status).toBe("ok");
			expect(result.outputEncoding).toBe("gbk");
			expect(result.outputReplacements).toBe(1);
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("decodes a kernel-defined tool's PIPE with the same native protocol", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			const child = "import os;os.write(1,bytes([0xd6,0xd0,0xce,0xc4]))";
			const command = `${quoteShell(interpreter!)} -c ${quoteShell(child)}`;
			await kernel.execute(`@tool\ndef captured() -> str:\n    return __omp_shell(${JSON.stringify(command)}).n`);
			let output = "";
			const result = await kernel.invokeTool(
				{ op: "call", name: "captured", args: {} },
				{
					outputEncoding: "gbk",
					timeoutMs: 5_000,
					onChunk: text => {
						output += text;
					},
				},
			);
			expect(result.status).toBe("ok");
			expect(output).toContain("中文");
			expect(result.outputEncoding).toBe("gbk");
			expect(result.outputReplacements).toBe(0);
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("keeps a queued second execution separate while a PIPE response window is open", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			const started = Promise.withResolvers<void>();
			const child = "import os,time;os.write(1,b'first');time.sleep(.2);os.write(1,b'last')";
			const first = kernel.execute(`!${quoteShell(interpreter!)} -c ${quoteShell(child)}`, {
				outputEncoding: "utf8",
				timeoutMs: 5_000,
				onChunk: text => {
					if (text.includes("first")) started.resolve();
				},
			});
			await started.promise;
			let secondOutput = "";
			const second = kernel.execute("print('second')", {
				timeoutMs: 5_000,
				onChunk: text => {
					secondOutput += text;
				},
			});
			const [a, b] = await Promise.all([first, second]);
			expect(a.outputEncoding).toBe("utf8");
			expect(b.status).toBe("ok");
			expect(secondOutput).toBe("second\n");
			expect(b.outputEncoding).toBeUndefined();
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("keeps draining and counting after the helper's UTF-8 display budget is exhausted", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			let output = "";
			const child = "import os;os.write(1,b'x'*(1024*1024+17));os.write(1,bytes([0x81]))";
			const result = await kernel.execute(
				`r = !${quoteShell(interpreter!)} -c ${quoteShell(child)}\nprint('captured=' + str(len(r.n)))`,
				{
					outputEncoding: "gbk",
					timeoutMs: 10_000,
					onChunk: text => {
						output += text;
					},
				},
			);
			expect(result.status).toBe("ok");
			expect(output).toContain("output truncated: shell helper exceeded");
			expect(output).toContain("captured=1048576");
			expect(result.outputReplacements).toBe(1);
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("does not transfer a kernel fd-1 fragment into the next request's stdout", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			const first = await kernel.execute(
				"import os,asyncio\nos.write(1,bytes([0xf0,0x9f]))\nawait asyncio.sleep(.1)",
			);
			let secondStdout = "";
			const second = await kernel.execute(
				"os.write(1,bytes([0x98,0x80]))\nawait asyncio.sleep(.1)\nprint('second')",
				{
					onChunk: text => {
						secondStdout += text;
					},
				},
			);
			expect(first.outputEncodingUnknownReaders).toBe(1);
			expect(secondStdout).toBe("second\n");
			expect(second.kernelOutput).toContain("request ownership unknown");
			expect(second.kernelOutput).toContain("😀");
			expect(second.outputEncoding).toBeUndefined();
			expect(second.outputReplacements).toBeUndefined();
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("holds idle late fd-1 output in the kernel-scope queue", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			await kernel.execute(
				"import threading,os\nt = threading.Timer(.1, lambda: os.write(1,b'late-kernel'))\nt.start()",
			);
			await Bun.sleep(200);
			let stdout = "";
			const next = await kernel.execute("print('new-request')", {
				onChunk: text => {
					stdout += text;
				},
			});
			expect(stdout).toBe("new-request\n");
			expect(next.kernelOutput).toContain("late-kernel");
			expect(next.kernelOutput).toContain("request ownership unknown");
			expect(next.outputEncodingUnknownReaders).toBe(1);
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);

	it("does not fabricate a completed summary after a live PIPE capture is cancelled", async () => {
		const kernel = await PythonKernel.start({ cwd: process.cwd(), interpreter: interpreter ?? undefined });
		try {
			const controller = new AbortController();
			const child = "import os,time;os.write(1,b'ready');time.sleep(10)";
			const result = await kernel.execute(`!${quoteShell(interpreter!)} -c ${quoteShell(child)}`, {
				outputEncoding: "utf8",
				signal: controller.signal,
				timeoutMs: 5_000,
				onChunk: text => {
					if (text.includes("ready")) controller.abort();
				},
			});
			expect(result.cancelled).toBeTrue();
			expect(result.outputEncoding).toBeUndefined();
			expect(result.outputReplacements).toBeUndefined();
			expect(result.outputEncodingUnknownReaders).toBe(1);
		} finally {
			await kernel.shutdown();
		}
	}, 20_000);
});
