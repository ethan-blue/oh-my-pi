/**
 * The native project walk-up must never treat `~/.omp` as a project config dir.
 * A cwd under home with no closer repo root (Windows temp dirs, scratch folders)
 * otherwise loads the user's ~/.omp/SYSTEM.md, RULES.md and AGENTS.md as project
 * config, even when the agent dir points elsewhere (profiles, isolated runs).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCapability } from "@oh-my-pi/pi-coding-agent/capability";
import { type ContextFile, contextFileCapability } from "@oh-my-pi/pi-coding-agent/capability/context-file";
import { type MCPServer, mcpCapability } from "@oh-my-pi/pi-coding-agent/capability/mcp";
import { type Settings as NativeSettings, settingsCapability } from "@oh-my-pi/pi-coding-agent/capability/settings";
import { clearCache } from "@oh-my-pi/pi-coding-agent/capability/fs";
import { type Skill, skillCapability } from "@oh-my-pi/pi-coding-agent/capability/skill";
import { type Rule, ruleCapability } from "@oh-my-pi/pi-coding-agent/capability/rule";
import { type SystemPrompt, systemPromptCapability } from "@oh-my-pi/pi-coding-agent/capability/system-prompt";
import type { LoadContext } from "@oh-my-pi/pi-coding-agent/capability/types";
// Importing discovery registers all providers as a side effect.
import "@oh-my-pi/pi-coding-agent/discovery";
import { __resetDirsFromEnvForTests, getMCPConfigPath, removeSyncWithRetries, setAgentDir } from "@oh-my-pi/pi-utils";

let tempDir: string;
let home: string;
// setAgentDir() rewrites these; restore them all so later test files see the original resolver.
const ENV_KEYS = ["PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE"] as const;
let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

function writeFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

async function loadNative<T>(capabilityId: string, ctx: LoadContext): Promise<T[]> {
	const native = getCapability(capabilityId)?.providers.find(p => p.id === "native");
	if (!native) throw new Error(`native provider missing for ${capabilityId}`);
	const result = await (native.load as (ctx: LoadContext) => Promise<{ items: T[] }>)(ctx);
	return result.items;
}

beforeEach(() => {
	savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])) as typeof savedEnv;
	clearCache();
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-home-walkup-"));
	home = path.join(tempDir, "home");
	// The user config root holds operator files; the active agent dir is isolated elsewhere.
	writeFile(path.join(home, ".omp", "SYSTEM.md"), "operator system prompt\n");
	writeFile(path.join(home, ".omp", "RULES.md"), "operator rule\n");
	writeFile(path.join(home, ".omp", "AGENTS.md"), "operator agents\n");
	writeFile(
		path.join(home, ".omp", "skills", "operator", "SKILL.md"),
		"---\nname: operator\ndescription: operator skill\n---\nbody\n",
	);
	setAgentDir(path.join(tempDir, "isolated-agent"));
});

afterEach(() => {
	clearCache();
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	__resetDirsFromEnvForTests();
	removeSyncWithRetries(tempDir);
});

test("a cwd under home without a repo does not load ~/.omp files as project config", async () => {
	const cwd = path.join(home, "AppData", "Local", "Temp", "work");
	fs.mkdirSync(cwd, { recursive: true });
	const ctx: LoadContext = { cwd, home, repoRoot: null };

	const prompts = await loadNative<SystemPrompt>(systemPromptCapability.id, ctx);
	const rules = await loadNative<Rule>(ruleCapability.id, ctx);
	const contexts = await loadNative<ContextFile>(contextFileCapability.id, ctx);
	const skills = await loadNative<Skill>(skillCapability.id, ctx);

	const fromHome = (p: string) => p.startsWith(path.join(home, ".omp") + path.sep);
	expect(prompts.filter(p => fromHome(p.path))).toEqual([]);
	expect(rules.filter(r => fromHome(r.path))).toEqual([]);
	expect(contexts.filter(c => fromHome(c.path))).toEqual([]);
	expect(skills.filter(s => fromHome(s.path))).toEqual([]);
});

test("a project .omp between cwd and home is still found", async () => {
	const project = path.join(home, "scratch");
	const cwd = path.join(project, "nested");
	fs.mkdirSync(cwd, { recursive: true });
	writeFile(path.join(project, ".omp", "SYSTEM.md"), "project system prompt\n");

	const prompts = await loadNative<SystemPrompt>(systemPromptCapability.id, { cwd, home, repoRoot: null });

	expect(prompts.map(p => [p.path, p.level])).toEqual([[path.join(project, ".omp", "SYSTEM.md"), "project"]]);
});

test("an encoding-only .ompg directory does not shadow legacy prompt artifacts", async () => {
	const project = path.join(home, "mixed");
	writeFile(path.join(project, ".ompg", "encoding.json"), "{}");
	writeFile(path.join(project, ".omp", "SYSTEM.md"), "legacy prompt\n");
	writeFile(path.join(project, ".omp", "AGENTS.md"), "legacy instructions\n");
	const ctx: LoadContext = { cwd: project, home, repoRoot: project };
	const prompts = await loadNative<SystemPrompt>(systemPromptCapability.id, ctx);
	const contexts = await loadNative<ContextFile>(contextFileCapability.id, ctx);
	expect(prompts.map(item => item.path)).toEqual([path.join(project, ".omp", "SYSTEM.md")]);
	expect(contexts.map(item => item.path)).toEqual([path.join(project, ".omp", "AGENTS.md")]);
});

test("MCP selects the preferred whole file and skills discover both project namespaces", async () => {
	const project = path.join(home, "preferred");
	writeFile(
		path.join(project, ".ompg", "mcp.json"),
		JSON.stringify({ mcpServers: { preferred: { command: "preferred-test" } } }),
	);
	writeFile(
		path.join(project, ".omp", "mcp.json"),
		JSON.stringify({ mcpServers: { legacy: { command: "legacy-test" } } }),
	);
	for (const [namespace, name] of [
		[".ompg", "new-skill"],
		[".omp", "old-skill"],
	]) {
		writeFile(
			path.join(project, namespace!, "skills", name!, "SKILL.md"),
			`---\nname: ${name}\ndescription: test skill\n---\nbody\n`,
		);
	}
	const ctx: LoadContext = { cwd: project, home, repoRoot: project };
	const servers = await loadNative<MCPServer>(mcpCapability.id, ctx);
	expect(servers.map(item => item.name)).toEqual(["preferred"]);
	expect(getMCPConfigPath("project", project)).toBe(path.join(project, ".ompg", "mcp.json"));
	const skills = await loadNative<Skill>(skillCapability.id, ctx);
	expect(skills.map(item => item.name).sort()).toEqual(["new-skill", "old-skill"]);
});

test.each(["config.yml", "config.yaml"])(
	"project settings prefer a whole .ompg %s without merging legacy fields",
	async filename => {
		const project = path.join(home, "settings");
		writeFile(path.join(project, ".ompg", filename), "textEncoding:\n  readFallback: strict-utf8\n");
		writeFile(
			path.join(project, ".omp", "config.yml"),
			"textEncoding:\n  readFallback: utf8-then-gbk\ntheme: legacy-only\n",
		);
		const settings = await loadNative<NativeSettings>(settingsCapability.id, {
			cwd: project,
			home,
			repoRoot: project,
		});
		expect(settings).toHaveLength(1);
		expect(settings[0]?.path).toBe(path.join(project, ".ompg", filename));
		expect(settings[0]?.data).toEqual({ textEncoding: { readFallback: "strict-utf8" } });
	},
);

test("noncanonical home never becomes a native project config root", async () => {
	const project = path.join(home, "scratch");
	const cwd = path.join(project, "nested");
	const link = path.join(tempDir, "home-link");
	fs.mkdirSync(cwd, { recursive: true });
	fs.symlinkSync(home, link, "dir");
	writeFile(path.join(project, ".omp", "SYSTEM.md"), "project system prompt\n");

	for (const alias of [`${home}${path.sep}`, link]) {
		const ctx: LoadContext = { cwd, home: alias, repoRoot: null };
		const prompts = await loadNative<SystemPrompt>(systemPromptCapability.id, ctx);
		const rules = await loadNative<Rule>(ruleCapability.id, ctx);
		const skills = await loadNative<Skill>(skillCapability.id, ctx);

		expect(prompts.map(p => p.path)).toEqual([path.join(project, ".omp", "SYSTEM.md")]);
		expect(rules.filter(rule => rule.path === path.join(home, ".omp", "RULES.md"))).toEqual([]);
		expect(skills.filter(skill => skill.path === path.join(home, ".omp", "skills", "operator", "SKILL.md"))).toEqual(
			[],
		);
	}

	const atHome: LoadContext = { cwd: home, home: link, repoRoot: null };
	expect((await loadNative<Rule>(ruleCapability.id, atHome)).some(rule => rule._source.level === "project")).toBe(
		false,
	);
});
