import process from "node:process";

import { $env } from "@oh-my-pi/pi-utils";

interface OmpCommand {
	cmd: string;
	args: string[];
	shell: boolean;
}

const DEFAULT_CMD = process.platform === "win32" ? "ompg.cmd" : "ompg";
const DEFAULT_SHELL = process.platform === "win32";

/**
 * Resolve the command that re-enters THIS distribution for subprocesses
 * (sub-agents, workers, `omp ps` helpers). Resolution order:
 *
 * 1. `PI_SUBPROCESS_CMD` — explicit override, contract with embedders.
 * 2. Source runs (`argv[1]` is a `.ts`/`.js` entry): the current Bun runtime
 *    with that entry file.
 * 3. A compiled binary (`argv[1]` is the executable itself, or Bun reports
 *    the standalone runtime): re-enter the current executable directly —
 *    never fall through to PATH, which could resolve the ORIGINAL `omp`
 *    install sitting next to this fork.
 * 4. `ompg` from PATH (dev installs via link).
 */
export function resolveOmpCommand(): OmpCommand {
	const envCmd = $env.PI_SUBPROCESS_CMD;
	if (envCmd?.trim()) {
		return { cmd: envCmd, args: [], shell: DEFAULT_SHELL };
	}

	const entry = process.argv[1];
	if (entry && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
		return { cmd: process.execPath, args: [entry], shell: false };
	}

	// Compiled `bun --compile` binaries re-enter themselves: `argv[1]` names
	// the executable (or argv collapses to it). process.execPath points at the
	// real binary for a shim-launched run too.
	if (process.platform === "win32" && entry?.toLowerCase().endsWith(".exe")) {
		return { cmd: entry, args: [], shell: false };
	}
	if (entry && process.execPath === entry) {
		return { cmd: entry, args: [], shell: false };
	}

	return { cmd: DEFAULT_CMD, args: [], shell: DEFAULT_SHELL };
}
