/**
 * Project-local configuration directory resolution.
 *
 * A project expresses its configuration in `.ompg` (the fork's own namespace).
 * The legacy `.omp` directory remains a fully-supported alias so existing
 * projects keep working; per project root the NEW entry wins whole-file —
 * configs are never field-merged and two overrides lists are never spliced.
 *
 * Resolution rules (docs/gbk-handoff/31 §2.2/§2.3):
 * - Per root, `.ompg/<file>` is selected when it exists; only when the new
 *   namespace has no such file may the same root's `.omp/<file>` serve.
 * - An entry that exists but cannot even be stat'd (permission) is a typed
 *   error — it must NOT silently fall back to the other namespace.
 * - The walk upward never reads a config AT the user's home directory or at
 *   the fork's actual user-data root: those are user-level boundaries, and a
 *   home-level policy must not leak into every project under it. The check
 *   happens before that directory's configs are probed.
 * - After a directory containing `.git` has been probed, implicit
 *   inheritance from farther parents stops. A firmware tree without Git
 *   still resolves via its nearest explicit project config.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, normalizePathForComparison } from "./dirs";

/** The fork's project config namespace (preferred per root). */
export const PROJECT_CONFIG_NAMESPACE = ".ompg";
/** The legacy project config namespace (alias, fully supported). */
export const PROJECT_CONFIG_ALIAS = ".omp";

/** Namespaces in selection order for one root. */
export const PROJECT_CONFIG_NAMESPACES = [PROJECT_CONFIG_NAMESPACE, PROJECT_CONFIG_ALIAS] as const;

export type ProjectConfigNamespace = (typeof PROJECT_CONFIG_NAMESPACES)[number];

export interface ProjectConfigFile {
	status: "found";
	/** Project root containing the namespace directory. */
	root: string;
	/** Namespace directory that actually holds the file (".ompg" or ".omp"). */
	namespace: ProjectConfigNamespace;
	/** Absolute path of the selected config file. */
	configPath: string;
}

/** A namespace entry that exists but could not be inspected. */
export interface ProjectConfigPermissionError {
	status: "permission" | "invalid";
	/** The file whose inspection failed. */
	configPath: string;
	/** Wrapped filesystem error (EACCES). */
	cause: unknown;
}

export type ProjectConfigLookup = ProjectConfigFile | ProjectConfigPermissionError;

const isPermissionError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	((error as NodeJS.ErrnoException).code === "EACCES" || (error as NodeJS.ErrnoException).code === "EPERM");

/** Normalize for boundary comparisons: resolved, forward slashes, lowercase on Windows. */
function boundaryKey(target: string): string {
	return normalizePathForComparison(target).replaceAll("\\", "/");
}

function userDataRoot(): string {
	try {
		return getConfigRootDir();
	} catch {
		const override = process.env.PI_CONFIG_DIR;
		return override ? path.resolve(override) : path.join(os.homedir(), ".ompg");
	}
}

/** Directories whose configs must never serve as project policy. */
function isUserBoundary(dir: string, home: string): boolean {
	const key = boundaryKey(dir);
	return key === boundaryKey(home) || key === boundaryKey(userDataRoot());
}

interface StatEntry {
	isFile: boolean;
	invalid?: boolean;
	checkedAt: number;
}

const statEntries = new Map<string, StatEntry>();
const STAT_TTL_MS = 1000;

function statConfigFile(configPath: string): "file" | "eacces" | "invalid" | undefined {
	const now = Date.now();
	const cached = statEntries.get(configPath);
	if (cached && now - cached.checkedAt < STAT_TTL_MS) {
		return cached.invalid ? "invalid" : cached.isFile ? "file" : undefined;
	}
	try {
		const stat = fs.statSync(configPath);
		statEntries.set(configPath, { isFile: stat.isFile(), invalid: !stat.isFile(), checkedAt: now });
		return stat.isFile() ? "file" : "invalid";
	} catch (error) {
		if (isPermissionError(error)) return "eacces";
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOTDIR") {
			statEntries.set(configPath, { isFile: false, invalid: true, checkedAt: now });
			return "invalid";
		}
		if (code === "ENOENT") {
			// Windows may report ENOENT for a child of a regular file instead
			// of ENOTDIR. A broken namespace still must not permit fallback.
			try {
				if (!fs.statSync(path.dirname(configPath)).isDirectory()) {
					statEntries.set(configPath, { isFile: false, invalid: true, checkedAt: now });
					return "invalid";
				}
			} catch (parentError) {
				const parentCode = (parentError as NodeJS.ErrnoException)?.code;
				if (parentCode === "ENOTDIR") return "invalid";
				if (parentCode !== "ENOENT") return "eacces";
			}
			statEntries.set(configPath, { isFile: false, checkedAt: now });
			return undefined;
		}
		return "eacces";
	}
}

const negativeWalkCache = new Map<string, number>();
const NEGATIVE_WALK_TTL_MS = 1000;

/**
 * Walk up from `startDir` and locate `<root>/<ns>/<file>` for the nearest
 * applicable root. `.ompg` wins over `.omp` at the same root; an
 * unstat-able entry is a typed permission error; user-level boundaries stop
 * the walk before their configs are probed; a `.git` root stops implicit
 * inheritance once it has been probed.
 */
export function findProjectConfigUpward(
	startDir: string,
	file: string | readonly string[],
	options: { home?: string; stopAt?: string | null } = {},
): ProjectConfigLookup | undefined {
	const start = path.resolve(startDir);
	const filenames = typeof file === "string" ? [file] : file;
	const home = options.home ?? os.homedir();
	const stopAt = options.stopAt ? boundaryKey(options.stopAt) : undefined;
	const negKey = `${boundaryKey(start)}\0${filenames.join("\0")}\0${boundaryKey(home)}\0${stopAt ?? ""}`;
	const negAt = negativeWalkCache.get(negKey);
	if (negAt !== undefined && Date.now() - negAt < NEGATIVE_WALK_TTL_MS) {
		return undefined;
	}
	let dir = start;
	for (;;) {
		if (isUserBoundary(dir, home)) {
			negativeWalkCache.set(negKey, Date.now());
			return undefined;
		}
		for (const namespace of PROJECT_CONFIG_NAMESPACES) {
			for (const filename of filenames) {
				const configPath = path.join(dir, namespace, filename);
				const stat = statConfigFile(configPath);
				if (stat === "invalid") {
					return { status: "invalid", configPath, cause: new Error("Configuration entry is not a regular file") };
				}
				if (stat === "eacces") {
					// A preferred entry that cannot be inspected is an immediate
					// configuration error — never silently fall back to an alias!
					return {
						status: "permission",
						configPath,
						cause: Object.assign(new Error(`Permission denied while accessing '${configPath}'`), {
							code: "EACCES",
						}),
					};
				}
				if (stat === "file") {
					return { status: "found", root: dir, namespace, configPath };
				}
				// No such file in this namespace at this root — the alias below
				// may still serve.
			}
		}
		if (boundaryKey(dir) === stopAt || fs.existsSync(path.join(dir, ".git"))) {
			// This directory was probed; implicit inheritance from farther
			// parents stops at the nearest repository boundary.
			negativeWalkCache.set(negKey, Date.now());
			return undefined;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			negativeWalkCache.set(negKey, Date.now());
			return undefined;
		}
		dir = parent;
	}
}

/** Drop every cached probe result (after a config write or removal). */
export function invalidateProjectConfigCaches(): void {
	statEntries.clear();
	negativeWalkCache.clear();
}
