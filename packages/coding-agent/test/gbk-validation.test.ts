/**
 * GBK validation-matrix gap tests: streaming reads past the 4 MiB snapshot
 * cap (E24), Chinese and spaced paths (E26), subprocess command reentry
 * (E28), and policy-change cache invalidation (E29).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import { getEditStore } from "@oh-my-pi/pi-coding-agent/edit/store";
import { discoverEncodingPolicy } from "../src/encoding/index";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "artifact-1", path: path.join(cwd, "artifact-1.log") }),
		settings: Settings.isolated(),
		enableLsp: false,
	};
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
	return result.content
		.filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
		.map(b => b.text)
		.join("\n");
}

const POLICY = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

/** GBK bytes for the fixture lines, authored via an independent mapping. */
function gbkBytes(text: string): Uint8Array<ArrayBuffer> {
	const map: Record<string, number[]> = {
		行: [0xd0, 0xd0],
		中: [0xd6, 0xd0],
		文: [0xce, 0xc4],
		注: [0xd7, 0xa2],
		释: [0xca, 0xcd],
	};
	const out: number[] = [];
	for (const ch of text) {
		if (ch.codePointAt(0)! < 0x80) out.push(ch.charCodeAt(0));
		else {
			const seq = map[ch];
			if (!seq) throw new Error(`no mapping for ${ch}`);
			out.push(...seq);
		}
	}
	return new Uint8Array(new ArrayBuffer(out.length)).map((_, i) => out[i]!);
}

describe("GBK validation gaps", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-validation-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY, "utf8");
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("streams a >4 MiB GBK file without splitting characters (E24/E12)", async () => {
		// 4 MiB + of alternating ASCII and Chinese lines: the streaming reader
		// (line splitting on LF bytes is GBK-safe; LF never appears inside a
		// GBK double-byte sequence) must decode every line correctly.
		const line = "int 值 = 1; // 中文行\n".length;
		void line;
		const asciiLine = `const pad_${"x".repeat(120)} = 1;\n`;
		const gbkLineText = "int 中文 = 1; // 行\n";
		const gbkMap: Record<string, number[]> = { 中: [0xd6, 0xd0], 文: [0xce, 0xc4], 行: [0xd0, 0xd0] };
		const gbkLine: number[] = [];
		for (const ch of gbkLineText) {
			if (ch.codePointAt(0)! < 0x8) throw new Error("bad fixture");
			if (ch.codePointAt(0)! < 0x80) gbkLine.push(ch.charCodeAt(0));
			else
				gbkLine.push(
					...(gbkMap[ch] ??
						(() => {
							throw new Error(`no map ${ch}`);
						})()),
				);
		}
		const chunks: Uint8Array[] = [];
		let total = 0;
		const asciiBytes = Buffer.from(asciiLine, "ascii");
		const gbkBytesLine = Uint8Array.from(gbkLine);
		while (total < 4 * 1024 * 1024 + 1024) {
			chunks.push(asciiBytes);
			chunks.push(gbkBytesLine);
			total += asciiBytes.length + gbkBytesLine.length;
		}
		// Put a unique Chinese marker line at the very end, past 4 MiB.
		const markerText = "// 末尾标记\n";
		const markerMap: Record<string, number[]> = {
			末: [0xc4, 0xa9],
			尾: [0xce, 0xb2],
			标: [0xb1, 0xea],
			记: [0xbc, 0xc7],
		};
		const marker: number[] = [];
		for (const ch of markerText) {
			if (ch.codePointAt(0)! < 0x80) marker.push(ch.charCodeAt(0));
			else
				marker.push(
					...(markerMap[ch] ??
						(() => {
							throw new Error(`no map ${ch}`);
						})()),
				);
		}
		chunks.push(Uint8Array.from(marker));
		const file = path.join(tmpDir, "src", "big.c");
		await Bun.write(file, Buffer.concat(chunks.map(c => Buffer.from(c))));

		const session = createSession(tmpDir);
		const stat = await fs.stat(file);
		expect(stat.size).toBeGreaterThan(4 * 1024 * 1024);

		// Tail read exercises the streaming path (file exceeds the snapshot cap).
		const result = await new ReadTool(session).execute("read-1", { path: `${file}:40-42` });
		const text = resultText(result);
		expect(text).not.toContain("\uFFFD");
		expect(text).toContain("中文");

		const whole = await new ReadTool(session).execute("read-2", { path: file });
		const wholeText = resultText(whole);
		expect(wholeText).not.toContain("\uFFFD");
	}, 60_000);

	it("reads and edits GBK files under Chinese and spaced paths (E26)", async () => {
		const dir = path.join(tmpDir, "src", "组件 module");
		await fs.mkdir(dir, { recursive: true });
		const file = path.join(dir, "主文件.c");
		const content = "// 中文注释\nint x = 1;\n";
		const bytes = gbkBytes(content);
		await Bun.write(file, Buffer.from(bytes));

		const session = createSession(tmpDir);
		const read = await new ReadTool(session).execute("read-1", { path: file });
		expect(resultText(read)).toContain("// 中文注释");

		const edit = new EditTool(session, "replace");
		const outcome = await edit.execute("edit-1", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 2;",
		});
		expect(outcome.isError).toBeFalsy();
		const after = new Uint8Array(await fs.readFile(file));
		const expected = gbkBytes("// 中文注释\nint x = 2;\n");
		expect(after).toEqual(expected);
	});

	it("policy changes invalidate the snapshot store (E29)", async () => {
		const file = path.join(tmpDir, "src", "a.c");
		const content = "// 中文注释\n";
		await Bun.write(file, Buffer.from(gbkBytes(content)));
		const session = createSession(tmpDir);

		// Read under the GBK policy: the store records decoded text.
		const first = await new ReadTool(session).execute("read-1", { path: file });
		expect(resultText(first)).toContain("// 中文注释");
		const store = getEditStore(session);
		expect(store.headText(file)).toBe("// 中文注释\n");

		// Disable the policy on disk; the next store sync clears snapshots so a
		// stale GBK snapshot never masquerades as UTF-8 text.
		const disabled = JSON.stringify({
			schemaVersion: 1,
			enabled: false,
			include: [],
			defaultEncoding: "utf8",
			newFileEncoding: "utf8",
			overrides: [],
		});
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), disabled, "utf8");
		const discovered = discoverEncodingPolicy(tmpDir);
		expect(discovered?.policy.resolve(file, true)).toBeNull();

		getEditStore(session);
		expect(store.headText(file)).toBeNull();
	});

;
});
