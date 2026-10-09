/**
 * Project protected mode (R10): an opt-in, execution-layer restriction for
 * projects whose text files must only be touched by the native tools.
 *
 * `.omp/protected-mode.json` (always UTF-8) at the project root:
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "enabled": true,
 *   "buildTasks": [
 *     { "id": "gcc-build", "exe": "gcc", "args": ["-c", "src/*"] }
 *   ]
 * }
 * ```
 *
 * When enabled, the bash and eval tools REFUSE to run in this project before
 * any process is spawned, unless the bash command is a simple (no shell
 * metacharacters) invocation that structurally matches a configured build
 * task: argv[0] resolves to the task's executable and every argument matches
 * the task's pattern (literal, or `prefix*`). This is a deny-by-default
 * capability gate enforced at tool dispatch — not a prompt suggestion and not
 * a command blacklist. Sub-agents inherit it automatically because discovery
 * is keyed on the working directory.
 *
 * Honest boundary (documented in the release notes): the gate restricts what
 * the AGENT may invoke from ompg. A trusted build executable that itself
 * writes source files is outside ompg's control on this platform; the
 * structured task exists so the user explicitly vouches for it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { extractLiteralAndChainSegments } from "./shell-tokenize";

export interface ProtectedBuildTask {
	id: string;
	/** Executable name (resolved via PATH at check time) or absolute path. */
	exe: string;
	/** Argument patterns: literal match, or `prefix*` suffix glob. */
	args: string[];
}

export interface ProtectedModeConfig {
	enabled: boolean;
	buildTasks: ProtectedBuildTask[];
}

export interface DiscoveredProtectedMode {
	root: string;
	mtimeMs: number;
	config: ProtectedModeConfig;
}

const CONFIG_RELATIVE = path.join(".omp", "protected-mode.json");
const cache = new Map<string, DiscoveredProtectedMode>();
const NEGATIVE_TTL_MS = 1000;
const negativeCache = new Map<string, number>();

/** Find the nearest `.omp/protected-mode.json` at or above `cwd`. */
export function discoverProtectedMode(cwd: string): DiscoveredProtectedMode | undefined {
	const start = path.resolve(cwd);
	const negativeAt = negativeCache.get(start);
	if (negativeAt !== undefined && Date.now() - negativeAt < NEGATIVE_TTL_MS) {
		return undefined;
	}
	const home = os.homedir();
	let dir = start;
	for (;;) {
		const configPath = path.join(dir, CONFIG_RELATIVE);
		let stat: fs.Stats | undefined;
		try {
			stat = fs.statSync(configPath);
		} catch {
			// keep walking
		}
		if (stat?.isFile()) {
			const cached = cache.get(dir);
			if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
			try {
				const parsed = parseConfig(fs.readFileSync(configPath, "utf8"));
				const discovered: DiscoveredProtectedMode = { root: dir, mtimeMs: stat.mtimeMs, config: parsed };
				cache.set(dir, discovered);
				return discovered;
			} catch (error) {
				// An invalid protected-mode file is a configuration error the
				// user must fix; fail closed (treat as enabled, deny-all).
				logger.warn("Invalid .omp/protected-mode.json; failing closed", {
					path: configPath,
					error: error instanceof Error ? error.message : String(error),
				});
				const discovered: DiscoveredProtectedMode = {
					root: dir,
					mtimeMs: stat.mtimeMs,
					config: { enabled: true, buildTasks: [] },
				};
				cache.set(dir, discovered);
				return discovered;
			}
		}
		if (dir === home || path.dirname(dir) === dir) {
			negativeCache.set(start, Date.now());
			return undefined;
		}
		dir = path.dirname(dir);
	}
}

function parseConfig(json: string): ProtectedModeConfig {
	const raw: unknown = JSON.parse(json);
	if (typeof raw !== "object" || raw === null) throw new Error("config must be an object");
	const record = raw as Record<string, unknown>;
	if (record.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
	if (typeof record.enabled !== "boolean") throw new Error("enabled must be a boolean");
	const enabled = record.enabled === true;
	const tasksRaw = Array.isArray(record.buildTasks) ? record.buildTasks : [];
	const buildTasks: ProtectedBuildTask[] = tasksRaw.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) throw new Error(`buildTasks[${index}] must be an object`);
		const task = entry as Record<string, unknown>;
		if (typeof task.id !== "string" || !task.id) throw new Error(`buildTasks[${index}].id must be a string`);
		if (typeof task.exe !== "string" || !task.exe) throw new Error(`buildTasks[${index}].exe must be a string`);
		const args = Array.isArray(task.args) ? task.args : [];
		for (const arg of args) {
			if (typeof arg !== "string") throw new Error(`buildTasks[${index}].args must be strings`);
			if (arg.includes("*") && !arg.endsWith("*")) {
				throw new Error(`buildTasks[${index}].args patterns may only use a trailing '*'`);
			}
		}
		return { id: task.id, exe: task.exe, args };
	});
	return { enabled, buildTasks };
}

/**
 * Tokenize a command the way a minimal POSIX shell would, REFUSING anything
 * with shell metacharacters or expansions. Returns `undefined` when the
 * command is not a simple invocation (quotes are fine; `|`, `>`, `$`, `;`,
 * `&&`, backticks, newlines are not).
 */
export function tokenizeSimpleCommand(command: string): string[] | undefined {
	const segments = extractLiteralAndChainSegments(command, 1, false);
	return segments?.length === 1 ? segments[0].argv : undefined;
}

function argMatches(pattern: string, arg: string): boolean {
	if (!pattern.includes("*")) return pattern === arg;
	const prefix = pattern.slice(0, -1);
	return arg.startsWith(prefix);
}

function resolveExecutable(executable: string, cwd: string): string | undefined {
	const resolved = Bun.which(executable, { cwd });
	if (!resolved || /\.(cmd|bat|ps1)$/i.test(resolved)) return undefined;
	try {
		return fs.realpathSync(resolved);
	} catch {
		return undefined;
	}
}

/**
 * Decide whether `command` may execute under the discovered protected mode.
 * `undefined` means unprotected (no mode configured); otherwise a denial
 * reason or `null` when a structured build task matches.
 */
export function checkProtectedCommand(
	cwd: string,
	command: string,
	executionCwd = cwd,
): { denied: false; argv: string[] } | { denied: true; reason: string } | undefined {
	const discovered = discoverProtectedMode(cwd);
	if (!discovered || !discovered.config.enabled) return undefined;
	let realRoot: string, realCwd: string;
	try {
		realRoot = fs.realpathSync(discovered.root);
		realCwd = fs.realpathSync(executionCwd);
	} catch {
		return { denied: true, reason: "protected mode: execution cwd cannot be resolved" };
	}
	const relative = path.relative(realRoot, realCwd);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return { denied: true, reason: "protected mode: execution cwd must remain inside the protected project" };
	}

	const tokens = tokenizeSimpleCommand(command);
	if (!tokens) {
		return {
			denied: true,
			reason:
				`protected mode is enabled for this project (${discovered.root}); arbitrary shell syntax ` +
				`(pipes, redirects, expansions, scripts) is refused before execution. Use the native ` +
				`read/edit/write/search tools for files; builds must go through a configured task in ` +
				`.omp/protected-mode.json as a simple invocation.`,
		};
	}
	const [invokedExe, ...invokedArgs] = tokens;
	const executable = resolveExecutable(invokedExe!, executionCwd);
	for (const task of discovered.config.buildTasks) {
		if (!executable || resolveExecutable(task.exe, discovered.root) !== executable) continue;
		const lastIsGlob = task.args.length > 0 && task.args[task.args.length - 1]!.endsWith("*");
		if (!lastIsGlob && invokedArgs.length > task.args.length) continue;
		if (invokedArgs.length < task.args.length - (lastIsGlob ? 1 : 0)) continue;
		let matched = true;
		for (let i = 0; i < invokedArgs.length; i++) {
			const pattern = i < task.args.length ? task.args[i]! : task.args[task.args.length - 1]!;
			if (!argMatches(pattern, invokedArgs[i]!)) {
				matched = false;
				break;
			}
		}
		if (matched) {
			return { denied: false, argv: [executable, ...invokedArgs] };
		}
	}
	return {
		denied: true,
		reason:
			`protected mode is enabled for this project (${discovered.root}); '${invokedExe}' is not a ` +
			`configured build task (allowed: ${discovered.config.buildTasks.map(t => t.id).join(", ") || "none"}). ` +
			`File work must use the native read/edit/write/search tools.`,
	};
}

/** Agent tools cannot change the control plane that grants their execution rights. */
export function assertProtectedConfigMutation(filePath: string): void {
	const absolute = path.resolve(filePath);
	let canonical = absolute;
	try {
		canonical = fs.realpathSync(absolute);
	} catch {
		try {
			canonical = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
		} catch {
			/* New ancestors. */
		}
	}
	const policy = discoverProtectedMode(path.dirname(absolute));
	if (policy) {
		let target: fs.Stats | undefined;
		let config: fs.Stats | undefined;
		try {
			target = fs.statSync(absolute);
			config = fs.statSync(path.join(policy.root, CONFIG_RELATIVE));
		} catch {
			/* A new target has no hardlink identity. Lexical checks still apply below. */
		}
		if (target && config && target.dev === config.dev && target.ino === config.ino)
			throw new Error("protected mode configuration is user-managed; agent tools cannot modify it");
	}
	for (const candidate of [absolute, canonical]) {
		if (
			candidate.replaceAll("\\", "/").toLowerCase().endsWith("/.omp/protected-mode.json") ||
			fs.existsSync(path.join(candidate, CONFIG_RELATIVE)) ||
			(path.basename(candidate).toLowerCase() === ".omp" &&
				fs.existsSync(path.join(candidate, "protected-mode.json")))
		) {
			throw new Error("protected mode configuration is user-managed; agent tools cannot modify or remove it");
		}
	}
}

/**
 * Execution-layer gate for bash-style commands. Returns a denial reason or
 * `undefined` when execution may proceed.
 */
export function protectedCommandDenial(cwd: string, command: string): string | undefined {
	const verdict = checkProtectedCommand(cwd, command);
	if (verdict === undefined || !verdict.denied) return undefined;
	return verdict.reason;
}

/**
 * Execution-layer gate for eval-style backends (py/js/node): protected mode
 * denies them outright — there is no structured-task surface there.
 */
export function protectedEvalDenial(cwd: string): string | undefined {
	const discovered = discoverProtectedMode(cwd);
	if (!discovered || !discovered.config.enabled) return undefined;
	return (
		`protected mode is enabled for this project (${discovered.root}); the eval tool is refused ` +
		`before execution. Use the native read/edit/write/search tools for files.`
	);
}
