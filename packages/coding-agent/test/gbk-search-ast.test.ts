/**
 * GBK contracts for search (grep) and structured edits (ast_grep / ast_edit):
 * Chinese patterns match in GBK-managed files, result lines render as real
 * text (no mojibake), and AST rewrites decode before parsing then re-encode
 * strictly on write — tree-sitter byte offsets operate on the decoded text.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { astEdit, astGrep, grep } from "@oh-my-pi/pi-natives";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AstEditTool } from "@oh-my-pi/pi-coding-agent/tools/ast-edit";
import { ToolChoiceQueue } from "@oh-my-pi/pi-coding-agent/session/tool-choice-queue";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

const POLICY = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

function hex(bytes: readonly number[]): Uint8Array<ArrayBuffer> {
	return new Uint8Array(new ArrayBuffer(bytes.length)).map((_, index) => bytes[index]!);
}

function gbk(text: string): Uint8Array<ArrayBuffer> {
	// Rust-free expected bytes: hand-mapped GBK sequences for the fixture text.
	const map: Record<string, number[]> = {
		中: [0xd6, 0xd0],
		文: [0xce, 0xc4],
		注: [0xd7, 0xa2],
		释: [0xca, 0xcd],
		值: [0xd6, 0xb5],
		变: [0xb1, 0xe4],
		量: [0xc1, 0xbf],
		个: [0xb8, 0xf6],
	};
	const out: number[] = [];
	for (const ch of text) {
		if (ch.codePointAt(0)! < 0x80) {
			out.push(ch.charCodeAt(0));
		} else {
			const seq = map[ch];
			if (!seq) throw new Error(`no hand-mapped GBK sequence for ${ch}`);
			out.push(...seq);
		}
	}
	return hex(out);
}

describe("GBK search and AST", () => {
	let tmpDir: string;
	let policyOption: { root: string; json: string };

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-search-test-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY, "utf8");
		policyOption = { root: tmpDir, json: POLICY };
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("the single-path AST tool preview and apply both retain GBK Chinese bytes", async () => {
		const file = path.join(tmpDir, "src", "single.ts");
		await Bun.write(file, gbk("const 值 = 1;\n"));
		const queue = new ToolChoiceQueue();
		const session: ToolSession = {
			cwd: tmpDir,
			hasUI: true,
			settings: Settings.isolated(),
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			getToolChoiceQueue: () => queue,
			buildToolChoice: () => ({ type: "tool", name: "resolve" }),
			steer: () => {},
		};
		await new AstEditTool(session).execute("preview", {
			paths: [file],
			ops: [{ pat: "const $X = $Y", out: "const $X = 2;" }],
		});
		const invoke = queue.peekPendingInvoker();
		if (!invoke) throw new Error("AST preview did not offer an edit");
		await invoke({ action: "apply", reason: "GBK regression" });
		expect(await Bun.file(file).bytes()).toEqual(gbk("const 值 = 2;\n"));
	});

	it("grep matches a Chinese keyword in a GBK file and renders the line (E20)", async () => {
		// "// 中文注释\nint x = 1;\n"
		await fs.writeFile(path.join(tmpDir, "src", "a.c"), gbk("// 中文注释\nint x = 1;\n"));
		const result = await grep({
			pattern: "中文",
			path: path.join(tmpDir, "src"),
			maxColumns: 200,
			encodingPolicy: policyOption,
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0]!.lineNumber).toBe(1);
		expect(result.matches[0]!.line).toBe("// 中文注释");
		expect(result.matches[0]!.line).not.toContain("\uFFFD");
	});

	it("grep without the policy sees no match for the Chinese keyword (upstream behavior)", async () => {
		await fs.writeFile(path.join(tmpDir, "src", "a.c"), gbk("// 中文注释\nint x = 1;\n"));
		const result = await grep({
			pattern: "中文",
			path: path.join(tmpDir, "src"),
			maxColumns: 200,
		});
		expect(result.totalMatches).toBe(0);
	});

	it("ast_grep finds a pattern near Chinese text with offsets into the decoded text (E19)", async () => {
		await fs.writeFile(path.join(tmpDir, "src", "t.ts"), gbk("const 值 = 1;\nconst other = 值 + 2;\n"));
		const result = await astGrep({
			patterns: ["const $X = $Y"],
			lang: "typescript",
			path: path.join(tmpDir, "src", "t.ts"),
			encodingPolicy: policyOption,
		});
		expect(result.totalMatches).toBeGreaterThan(0);
		const first = result.matches[0]!;
		// Offsets are UTF-8 byte indexes into the DECODED text — a GBK byte
		// offset would point into the middle of a character.
		const decoded = "const 值 = 1;\nconst other = 值 + 2;\n";
		const slice = Buffer.from(decoded, "utf8").subarray(first.byteStart, first.byteEnd).toString("utf8");
		expect(slice).toBe(first.text);
		expect(first.text).toContain("值");
	});

	it("ast_edit rewrites near Chinese and persists GBK bytes (E19)", async () => {
		const file = path.join(tmpDir, "src", "t.ts");
		await fs.writeFile(file, gbk("const 值 = 1;\n"));
		const result = await astEdit({
			rewrites: { "const $X = $Y": "const $X = 2;" },
			path: file,
			lang: "typescript",
			dryRun: false,
			encodingPolicy: policyOption,
		});
		expect(result.applied).toBe(true);
		expect(result.totalReplacements).toBe(1);
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(gbk("const 值 = 2;\n"));
	});

	it("ast_edit refuses an unrepresentable replacement without touching disk", async () => {
		const file = path.join(tmpDir, "src", "t.ts");
		const original = gbk("const 值 = 1;\n");
		await fs.writeFile(file, original);
		let message = "";
		try {
			await astEdit({
				rewrites: { "const $X = $Y": "const $X = 2 // 完成 🎉" },
				path: file,
				lang: "typescript",
				dryRun: false,
				encodingPolicy: policyOption,
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("GBK");
		expect(new Uint8Array(await fs.readFile(file))).toEqual(original);
	});
});
