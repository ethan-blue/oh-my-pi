import { afterAll, describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { disposeAllVmContexts } from "../../src/eval/js/context-manager";
import { disposeAllKernelSessions } from "../../src/eval/py/executor";
import { cfgPythonInterpreter } from "../../src/eval/settings";
import { type ToolSession } from "../../src/tools";
import { EvalTool } from "../../src/tools/eval";

function session(): ToolSession {
	return {
		cwd: process.cwd(),
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated(),
	};
}

describe("EvalTool output encoding consumers", () => {
	afterAll(async () => {
		await disposeAllVmContexts();
		await disposeAllKernelSessions();
	});

	it("routes split JS stdio bytes through the host decoder and reports the open stream", async () => {
		const tool = new EvalTool(session());
		const result = await tool.execute("js-gbk", {
			language: "js",
			outputEncoding: "gbk",
			timeout: 5,
			code: "process.stdout.write(Buffer.from([0xd6])); process.stdout.write(Buffer.from([0xd0,0xce,0xc4]));",
		});
		const text = result.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join("\n");
		expect(text).toContain("中文");
		expect(text).toContain("provenance incomplete");
		expect(result.details?.cells?.[0]?.outputEncodingUnknownReaders).toBe(1);
		expect(result.details?.cells?.[0]?.outputReplacements).toBeUndefined();
		expect(result.details?.cells?.[0]?.outputEncoding).toBeUndefined();
	}, 20_000);

	it("preserves JS strings with a GBK byte preference", async () => {
		const result = await new EvalTool(session()).execute("js-str", {
			language: "js",
			outputEncoding: "gbk",
			code: "process.stdout.write('中文😀');",
		});
		const text = result.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join("\n");
		expect(text).toContain("中文😀");
		expect(text).not.toContain("provenance incomplete");
	});

	const python = Bun.which("python") ?? Bun.which("python3");
	it.skipIf(!python)(
		"propagates completed Python PIPE provenance to real tool details and text",
		async () => {
			const current = session();
			cfgPythonInterpreter.set(current.settings, python!);
			const command =
				process.platform === "win32"
					? `"${python}" -c "import os;os.write(1,bytes([214,208,206,196]))"`
					: `'${python}' -c 'import os;os.write(1,bytes([214,208,206,196]))'`;
			const result = await new EvalTool(current).execute("py-gbk", {
				language: "py",
				outputEncoding: "gbk",
				timeout: 5,
				code: `!${command}`,
			});
			const text = result.content
				.filter(part => part.type === "text")
				.map(part => part.text)
				.join("\n");
			expect(text).toContain("中文");
			expect(text).toContain("output decoded as GBK (cp936)");
			expect(result.details?.cells?.[0]?.outputEncoding).toBe("gbk");
			expect(result.details?.cells?.[0]?.outputReplacements).toBe(0);
		},
		20_000,
	);
});
