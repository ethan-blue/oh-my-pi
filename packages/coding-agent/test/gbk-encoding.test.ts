/**
 * GBK end-to-end contracts at the tool layer: the project encoding policy
 * (`.omp/encoding.json`) drives strict decode on read and strict encode on
 * write through the real read/edit/write tools, preserving original bytes.
 *
 * Expected GBK byte sequences are written as independent hex literals (never
 * produced by the codec under test): 中文 = D6 D0 CE C4.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { getEditStore } from "@oh-my-pi/pi-coding-agent/edit/store";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
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

function hex(bytes: readonly number[]): Uint8Array<ArrayBuffer> {
	return new Uint8Array(new ArrayBuffer(bytes.length)).map((_, index) => bytes[index]!);
}

/** "// 中文\nint x = 1;\nint y = 2;\n" in GBK. */
const GBK_SOURCE = hex([
	0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x31, 0x3b, 0x0a,
	0x69, 0x6e, 0x74, 0x20, 0x79, 0x20, 0x3d, 0x20, 0x32, 0x3b, 0x0a,
]);

/** "// 中文\nint x = 42;\nint y = 2;\n" in GBK. */
const GBK_EDITED = hex([
	0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x78, 0x20, 0x3d, 0x20, 0x34, 0x32, 0x3b,
	0x0a, 0x69, 0x6e, 0x74, 0x20, 0x79, 0x20, 0x3d, 0x20, 0x32, 0x3b, 0x0a,
]);

const POLICY = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

describe("GBK project encoding policy", () => {
	let tmpDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
	});

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gbk-tool-test-"));
		await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tmpDir, ".omp"), { recursive: true });
		await fs.writeFile(path.join(tmpDir, ".omp", "encoding.json"), POLICY, "utf8");
	});

	afterEach(async () => {
		await removeWithRetries(tmpDir);
	});

	it("read displays GBK Chinese correctly (E01)", async () => {
		await fs.writeFile(path.join(tmpDir, "src", "main.c"), GBK_SOURCE);
		const session = createSession(tmpDir);
		const result = await new ReadTool(session).execute("read-1", {
			path: path.join(tmpDir, "src", "main.c"),
		});
		const text = resultText(result);
		expect(text).toContain("// 中文");
		expect(text).toContain("int x = 1;");
		expect(text).not.toContain("\uFFFD");
	});

	it("read→edit→read keeps GBK bytes and later anchors work (E02)", async () => {
		const file = path.join(tmpDir, "src", "main.c");
		await fs.writeFile(file, GBK_SOURCE);
		const session = createSession(tmpDir);
		await new ReadTool(session).execute("read-1", { path: file });

		const edit = new EditTool(session, "replace");
		const outcome = await edit.execute("edit-1", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 42;",
		});
		expect(outcome.isError).toBeFalsy();

		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(GBK_EDITED);

		const reRead = await new ReadTool(session).execute("read-2", { path: file });
		expect(resultText(reRead)).toContain("int x = 42;");
	});

	it("no-change edit leaves bytes untouched (E05)", async () => {
		const file = path.join(tmpDir, "src", "main.c");
		await fs.writeFile(file, GBK_SOURCE);
		const session = createSession(tmpDir);
		const edit = new EditTool(session, "replace");
		const outcome = await edit.execute("edit-1", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 1;",
		});
		expect(outcome.isError).toBeTruthy();
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(GBK_SOURCE);
	});

	it("write overwrites an existing GBK file with GBK bytes", async () => {
		const file = path.join(tmpDir, "src", "main.c");
		await fs.writeFile(file, GBK_SOURCE);
		const session = createSession(tmpDir);
		const tool = new WriteTool(session);
		const result = await tool.execute("write-1", {
			path: file,
			content: "// 重写\nint z = 3;\n",
		});
		expect(result.isError).toBeFalsy();
		// "重写" in GBK: D6 D8 D0 B4.
		const expected = hex([
			0x2f, 0x2f, 0x20, 0xd6, 0xd8, 0xd0, 0xb4, 0x0a, 0x69, 0x6e, 0x74, 0x20, 0x7a, 0x20, 0x3d, 0x20, 0x33, 0x3b,
			0x0a,
		]);
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(expected);
	});

	it("write creates a new managed file as GBK (E06 new-file rule)", async () => {
		const file = path.join(tmpDir, "src", "fresh.c");
		const session = createSession(tmpDir);
		const tool = new WriteTool(session);
		await tool.execute("write-1", { path: file, content: "// 新建\n" });
		// "新建" in GBK: D0 C2 BD A8.
		const expected = hex([0x2f, 0x2f, 0x20, 0xd0, 0xc2, 0xbd, 0xa8, 0x0a]);
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(expected);
	});

	it("unrepresentable characters refuse the edit before writing (E09)", async () => {
		const file = path.join(tmpDir, "src", "main.c");
		await fs.writeFile(file, GBK_SOURCE);
		const session = createSession(tmpDir);
		const edit = new EditTool(session, "replace");
		const outcome = await edit.execute("edit-1", {
			path: file,
			old_string: "int x = 1;",
			new_string: "int x = 2; // 🎉",
		});
		const text = resultText(outcome);
		expect(outcome.isError).toBeTruthy();
		expect(text).toContain("GBK");
		const onDisk = new Uint8Array(await fs.readFile(file));
		expect(onDisk).toEqual(GBK_SOURCE);
	});

	it("invalid GBK bytes read as a clear error, not mojibake (E10)", async () => {
		const file = path.join(tmpDir, "src", "broken.c");
		// 0xD6 0x7F is an invalid GBK pair.
		await fs.writeFile(file, hex([0x69, 0x6e, 0x74, 0x0a, 0xd6, 0x7f, 0x0a]));
		const session = createSession(tmpDir);
		let message = "";
		try {
			await new ReadTool(session).execute("read-1", { path: file });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("invalid GBK");
	});

	it("UTF-8 BOM under a GBK rule is a policy conflict (E11)", async () => {
		const file = path.join(tmpDir, "src", "bom.c");
		const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("// ok\n", "utf8")]);
		await fs.writeFile(file, content);
		const session = createSession(tmpDir);
		let message = "";
		try {
			await new ReadTool(session).execute("read-1", { path: file });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("policy conflict");
	});

	it("unmanaged paths keep upstream behavior (no policy → UTF-8 world)", async () => {
		// Outside the include glob: plain UTF-8 stays UTF-8, and a non-UTF-8
		// file still hits the binary refusal exactly like upstream.
		const utf8File = path.join(tmpDir, "notes.md");
		await fs.writeFile(utf8File, "说明\n");
		const session = createSession(tmpDir);
		const tool = new WriteTool(session);
		await tool.execute("write-1", { path: utf8File, content: "改写\n" });
		const onDisk = Buffer.from(await fs.readFile(utf8File));
		expect(onDisk.toString("utf8")).toBe("改写\n");

		const gbkFile = path.join(tmpDir, "outside.dat");
		await fs.writeFile(gbkFile, GBK_SOURCE);
		const read = await new ReadTool(session).execute("read-2", { path: gbkFile });
		expect(resultText(read)).toContain("not valid UTF-8 text");
	});

	it("read records a snapshot the edit engine accepts", async () => {
		const file = path.join(tmpDir, "src", "main.c");
		await fs.writeFile(file, GBK_SOURCE);
		const session = createSession(tmpDir);
		const read = await new ReadTool(session).execute("read-1", { path: file });
		expect(resultText(read)).toContain("// 中文");
		// The snapshot store must have decoded text (not mojibake) for the
		// hashline header the read emitted.
		const store = getEditStore(session);
		const text = store.headText(file);
		expect(text).toBe("// 中文\nint x = 1;\nint y = 2;\n");
	});
});
