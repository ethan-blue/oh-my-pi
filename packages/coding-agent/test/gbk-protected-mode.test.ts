/**
 * R10 acceptance (A01–A10): after a native-tool encoding failure, the agent
 * must be able to RECOVER through native tools — and must NOT be able to
 * route around the edit pipeline through bash/eval once the project opts
 * into protected mode. All dispatch-level tests are deterministic (no model).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { applyWorkspaceEdit } from "@oh-my-pi/pi-coding-agent/lsp/edits";
import { fileToUri } from "@oh-my-pi/pi-coding-agent/lsp/utils";
import {
	checkProtectedCommand,
	protectedCommandDenial,
	protectedEvalDenial,
} from "@oh-my-pi/pi-coding-agent/tools/protected-mode";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function makeSession(cwd: string): ToolSession {
	return {
		cwd,
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
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
		.map(b => b.text)
		.join("\n");
}

function gbkBytes(text: string): Uint8Array<ArrayBuffer> {
	const map: Record<string, number[]> = {
		校: [0xd0, 0xa3],
		验: [0xd1, 0xe9],
		静: [0xbe, 0xb2],
		态: [0xcc, 0xac],
		布: [0xb2, 0xbc],
		置: [0xd6, 0xc3],
		中: [0xd6, 0xd0],
		文: [0xce, 0xc4],
		改: [0xb8, 0xc4],
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

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const PROTECTED = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	buildTasks: [{ id: "probe", exe: "cmd", args: ["/c", "*"] }],
});

describe("R10 protected mode and native recovery (A01–A10)", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-r10-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, "tests"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("A01: uncovered GBK .py reports the rule gap and bash rewrites are refused pre-exec", async () => {
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
		await fs.writeFile(path.join(tmpDir, ".omp", "protected-mode.json"), PROTECTED, "utf8");

		const file = path.join(tmpDir, "tests", "verify_static_layout.py");
		const original = gbkBytes("# 校验静态布置\nx = 1\n");
		await Bun.write(file, Buffer.from(original));

		// Read fails with the policy-gap diagnosis, not a bare binary refusal.
		const session = makeSession(tmpDir);
		const read = await new ReadTool(session).execute("read-1", { path: file });
		const text = resultText(read);
		expect(text).toContain("encoding.json");
		expect(text).toContain("tests/verify_static_layout.py");
		expect(text).toContain("Do not rewrite");

		// The python-bash rewrite the incident used is refused BEFORE spawn.
		let denied = "";
		try {
			await new BashTool(session).execute("b-1", {
				command: `python -c "open(r'${file.replace(/\\/g, "/")}','wb').write(b'...')"`,
			});
		} catch (error) {
			denied = error instanceof Error ? error.message : String(error);
		}
		expect(denied).toContain("protected mode");
		// Source bytes untouched.
		expect(sha256(new Uint8Array(await fs.readFile(file)))).toBe(sha256(original));
	});

	it("A02: after adding the confirmed rule, native read→edit succeeds (recovery loop)", async () => {
		const file = path.join(tmpDir, "tests", "verify_static_layout.py");
		// A Python 3 GBK source must also declare its charset to the interpreter.
		const original = gbkBytes("# coding: gbk\n# 校验静态布置\nx = 1\n");
		await Bun.write(file, Buffer.from(original));
		// The user confirms the encoding: extend the rule to tests/*.py.
		await fs.writeFile(
			path.join(tmpDir, ".omp", "encoding.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				include: ["src/**", "tests/**/*.py"],
				defaultEncoding: "gbk",
				newFileEncoding: "gbk",
				overrides: [],
			}),
			"utf8",
		);

		const session = makeSession(tmpDir);
		const read = await new ReadTool(session).execute("read-1", { path: file });
		expect(resultText(read)).toContain("# 校验静态布置");

		const outcome = await new EditTool(session, "replace").execute("edit-1", {
			path: file,
			old_string: "x = 1",
			new_string: "x = 2",
		});
		expect(outcome.isError).toBeFalsy();
		expect(new Uint8Array(await fs.readFile(file))).toEqual(gbkBytes("# coding: gbk\n# 校验静态布置\nx = 2\n"));
	});

	it("A03: mixed-encoding directory — each file follows its own rule", async () => {
		await fs.writeFile(
			path.join(tmpDir, ".omp", "encoding.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				include: ["src/**/*.c", "src/**/*.py"],
				defaultEncoding: "gbk",
				newFileEncoding: "gbk",
				overrides: [{ glob: "src/utf8/**", encoding: "utf8" }],
			}),
			"utf8",
		);
		await fs.mkdir(path.join(tmpDir, "src", "utf8"), { recursive: true });

		await Bun.write(path.join(tmpDir, "src", "g.c"), Buffer.from(gbkBytes("// 中文\nint a = 1;\n")));
		await Bun.write(path.join(tmpDir, "src", "utf8", "u.py"), Buffer.from("# 中文\n", "utf8"));
		await Bun.write(path.join(tmpDir, "src", "ascii.txt"), Buffer.from("plain ascii\n", "ascii"));

		const session = makeSession(tmpDir);
		const readGbk = await new ReadTool(session).execute("r-1", { path: path.join(tmpDir, "src", "g.c") });
		expect(resultText(readGbk)).toContain("// 中文");
		const readUtf8 = await new ReadTool(session).execute("r-2", { path: path.join(tmpDir, "src", "utf8", "u.py") });
		expect(resultText(readUtf8)).toContain("# 中文");
		const readAscii = await new ReadTool(session).execute("r-3", { path: path.join(tmpDir, "src", "ascii.txt") });
		expect(resultText(readAscii)).toContain("plain ascii");

		// Each edit preserves its file's encoding.
		await new EditTool(session, "replace").execute("e-1", {
			path: path.join(tmpDir, "src", "g.c"),
			old_string: "int a = 1;",
			new_string: "int a = 2;",
		});
		await new EditTool(session, "replace").execute("e-2", {
			path: path.join(tmpDir, "src", "utf8", "u.py"),
			old_string: "# 中文",
			new_string: "# 中文改",
		});
		expect(new Uint8Array(await fs.readFile(path.join(tmpDir, "src", "g.c")))).toEqual(
			gbkBytes("// 中文\nint a = 2;\n"),
		);
		const utf8After = Buffer.from(await fs.readFile(path.join(tmpDir, "src", "utf8", "u.py")));
		expect(utf8After.toString("utf8")).toBe("# 中文改\n");
	});

	it("A04: ambiguity/invalid bytes block without offering a shell fallback", async () => {
		await fs.writeFile(
			path.join(tmpDir, ".omp", "encoding.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				include: ["tests/**"],
				defaultEncoding: "gbk",
				newFileEncoding: "gbk",
				overrides: [],
			}),
			"utf8",
		);
		const file = path.join(tmpDir, "tests", "broken.py");
		await Bun.write(file, Buffer.from([0x78, 0x20, 0x3d, 0x20, 0xd6, 0x7f, 0x0a]));

		const session = makeSession(tmpDir);
		let message = "";
		try {
			await new ReadTool(session).execute("read-1", { path: file });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("invalid GBK");
		expect(message).not.toContain("python");
	});

	it("A05: python/powershell/node, redirection, script files, eval, nesting all refused pre-exec", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "protected-mode.json"), PROTECTED, "utf8");
		for (const command of [
			"python -c \"open('x','w').write('y')\"",
			"pwsh -Command Set-Content x y",
			"node -e \"require('fs').writeFileSync('x','y')\"",
			"echo hi > file.txt",
			"powershell -File script.ps1",
			"python script.py",
			"cat a | tee b",
			"python -c \"import subprocess; subprocess.run(['cmd'])\"",
		]) {
			const verdict = checkProtectedCommand(tmpDir, command);
			expect(verdict !== undefined && verdict.denied, command).toBe(true);
			if (verdict !== undefined && verdict.denied) {
				expect(verdict.reason.length > 0, command).toBe(true);
			}
		}
		// Eval backends: refused wholesale.
		expect(protectedEvalDenial(tmpDir)).toContain("eval tool is refused");
	});

	it("A06: nested/sub-agent cwds inherit the constraint (walk-up discovery)", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "protected-mode.json"), PROTECTED, "utf8");
		const nested = path.join(tmpDir, "deeply", "nested", "work");
		await fs.mkdir(nested, { recursive: true });

		// A child session rooted in the nested directory inherits the gate.
		const childSession = makeSession(nested);
		let denied = "";
		try {
			await new BashTool(childSession).execute("b-1", { command: "python rewrite.py" });
		} catch (error) {
			denied = error instanceof Error ? error.message : String(error);
		}
		expect(denied).toContain("protected mode");
		expect(protectedEvalDenial(nested)).toContain("eval tool is refused");
	});

	it("A07: a configured build task runs; a failing build surfaces its exit code", async () => {
		await Bun.write(
			path.join(tmpDir, ".omp", "protected-mode.json"),
			JSON.stringify({
				schemaVersion: 1,
				enabled: true,
				buildTasks: [
					{ id: "compiler-probe", exe: process.execPath, args: ["--version"] },
					{ id: "failure-probe", exe: process.execPath, args: ["run", "missing-ompg-probe.ts"] },
				],
			}),
		);
		const session = makeSession(tmpDir);

		const exe = process.execPath.replaceAll("\\", "/");
		const ok = await new BashTool(session).execute("build-1", { command: `"${exe}" --version` });
		expect(resultText(ok)).toContain(Bun.version);

		const fail = await new BashTool(session).execute("build-2", { command: `"${exe}" run missing-ompg-probe.ts` });
		expect(fail.isError).toBe(true);
	});

	it("session protection survives an outside cwd and configuration writes", async () => {
		const config = path.join(tmpDir, ".omp", "protected-mode.json");
		await Bun.write(config, PROTECTED);
		const session = makeSession(tmpDir);
		await expect(
			new BashTool(session).execute("escape", { cwd: os.tmpdir(), command: "echo bypass > escaped.txt" }),
		).rejects.toThrow("protected mode");
		await expect(
			new WriteTool(session).execute("disable", { path: config, content: '{"schemaVersion":1,"enabled":false}' }),
		).rejects.toThrow("user-managed");
		expect(await Bun.file(config).text()).toBe(PROTECTED);
		const edit = await new EditTool(session, "replace").execute("edit-config", {
			path: config,
			old_string: '"enabled":true',
			new_string: '"enabled":false',
		});
		expect(edit.isError).toBe(true);
		const normal = path.join(tmpDir, "normal.txt");
		await Bun.write(normal, "untouched");
		await expect(
			applyWorkspaceEdit(
				{
					changes: {
						[fileToUri(normal)]: [
							{
								range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } },
								newText: "changed",
							},
						],
						[fileToUri(config)]: [
							{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: " " },
						],
					},
				},
				tmpDir,
			),
		).rejects.toThrow("user-managed");
		expect(await Bun.file(normal).text()).toBe("untouched");
		expect(await Bun.file(config).text()).toBe(PROTECTED);
		const alias = path.join(tmpDir, "alias.json");
		await fs.link(config, alias);
		await expect(new WriteTool(session).execute("alias", { path: alias, content: "{}" })).rejects.toThrow(
			"user-managed",
		);
	});

	it("a configured executable cannot be replaced by a same-name binary or shell expansion", async () => {
		const trusted = path.join(tmpDir, "trusted", "probe.exe");
		const untrusted = path.join(tmpDir, "untrusted", "probe.exe");
		await Bun.write(trusted, Bun.file(process.execPath));
		await Bun.write(untrusted, Bun.file(process.execPath));
		await Bun.write(
			path.join(tmpDir, ".omp", "protected-mode.json"),
			JSON.stringify({ schemaVersion: 1, enabled: true, buildTasks: [{ id: "probe", exe: trusted, args: ["*"] }] }),
		);
		const command = (exe: string, args: string) => `"${exe.replaceAll("\\", "/")}" ${args}`;
		expect(checkProtectedCommand(tmpDir, command(untrusted, "--version"))?.denied).toBe(true);
		expect(checkProtectedCommand(tmpDir, command(trusted, '"`echo bad`"'))?.denied).toBe(true);
		expect(checkProtectedCommand(tmpDir, command(trusted, "-c source.c"))?.denied).toBe(false);
	});

	it("A08: the agent cannot widen the gate; native rule recovery still works", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "protected-mode.json"), PROTECTED, "utf8");
		const session = makeSession(tmpDir);
		// Non-task command (would-be widening attempt) refused.
		let denied = "";
		try {
			await new BashTool(session).execute("b-1", { command: "cmd /c echo hi && python evil.py" });
		} catch (error) {
			denied = error instanceof Error ? error.message : String(error);
		}
		expect(denied).toContain("protected mode");
		// Meanwhile native editing of a covered file proceeds.
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
		const file = path.join(tmpDir, "src", "a.c");
		await Bun.write(file, Buffer.from(gbkBytes("// 中文\nint a = 1;\n")));
		const outcome = await new EditTool(session, "replace").execute("e-1", {
			path: file,
			old_string: "int a = 1;",
			new_string: "int a = 2;",
		});
		expect(outcome.isError).toBeFalsy();
	});

	it("A09: a synthetic read/search/write/edit task completes under protected mode without bash", async () => {
		await fs.writeFile(path.join(tmpDir, ".omp", "protected-mode.json"), PROTECTED, "utf8");
		const session = makeSession(tmpDir);
		const tool = new WriteTool(session);
		const sheet = path.join(tmpDir, "src", "props.inc");
		await tool.execute("w-1", { path: sheet, content: "PROP_A=1\nPROP_B=2\n" });
		const edit = new EditTool(session, "replace");
		await edit.execute("e-1", { path: sheet, old_string: "PROP_B=2", new_string: "PROP_B=3" });
		const read = await new ReadTool(session).execute("r-1", { path: sheet });
		expect(resultText(read)).toContain("PROP_B=3");
	});

	it("A10: without protected-mode.json the bash contract is unchanged", async () => {
		const session = makeSession(tmpDir);
		const result = await new BashTool(session).execute("b-1", { command: "cmd /c echo open-mode" });
		expect(resultText(result)).toContain("open-mode");
		expect(protectedCommandDenial(tmpDir, "python anything")).toBeUndefined();
	});
});
