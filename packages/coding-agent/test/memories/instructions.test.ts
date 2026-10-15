import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { buildMemoryToolDeveloperInstructions, getMemoryRoot } from "@oh-my-pi/pi-coding-agent/memories";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-instructions-"));
	try {
		return await fn(dir);
	} finally {
		await removeWithRetries(dir);
	}
}

describe("buildMemoryToolDeveloperInstructions", () => {
	it("does not instruct learned-only projects to read a summary that does not exist", async () => {
		await withTempDir(async agentDir => {
			const settings = Settings.isolated({ "memory.backend": "local" });
			const root = getMemoryRoot(agentDir, settings.getCwd());
			await Bun.write(path.join(root, "learned.md"), "- Use the native edit tool for source changes.\n");
			const instructions = await buildMemoryToolDeveloperInstructions(agentDir, settings.getCwd(), settings);
			expect(instructions).toContain("Use the native edit tool for source changes.");
			expect(instructions).not.toContain("Read `memory://root/memory_summary.md` first");
			expect(instructions).toContain("not yet available");
			expect(await Bun.file(path.join(root, "memory_summary.md")).exists()).toBe(false);
		});
	});

	it("injects all learned rules even when consolidated-summary injection is disabled", async () => {
		await withTempDir(async agentDir => {
			const settings = Settings.isolated({ "memory.backend": "local", "memories.summaryInjectionTokenLimit": 0 });
			const root = getMemoryRoot(agentDir, settings.getCwd());
			const rules =
				"- Keep firmware edits in the native tool flow.\n".repeat(600) +
				"- Preserve the final explicit formatting constraint.";
			await Bun.write(path.join(root, "learned.md"), rules);
			const instructions = await buildMemoryToolDeveloperInstructions(agentDir, settings.getCwd(), settings);
			expect(instructions).toContain("Keep firmware edits in the native tool flow.");
			expect(instructions).toContain("Preserve the final explicit formatting constraint.");
		});
	});

	it("uses memory:// URLs and does not expose raw memory root paths", async () => {
		await withTempDir(async agentDir => {
			const settings = Settings.isolated({ "memories.enabled": true });
			const memoryRoot = getMemoryRoot(agentDir, settings.getCwd());
			await fs.mkdir(memoryRoot, { recursive: true });
			await Bun.write(path.join(memoryRoot, "memory_summary.md"), "Use structured retries for flaky network calls.");

			const instructions = await buildMemoryToolDeveloperInstructions(agentDir, settings.getCwd(), settings);
			expect(instructions).toBeDefined();
			expect(instructions).toContain("memory://root/memory_summary.md");
			expect(instructions).toContain("memory://root/skills/<name>/SKILL.md");
			expect(instructions).not.toContain(memoryRoot);
		});
	});
});
