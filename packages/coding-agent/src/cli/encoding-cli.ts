/**
 * CLI handlers for `ompg encoding doctor` and `ompg encoding init` (Issue #4).
 *
 * Provides inspection of text encoding policies and safe, idempotent initialization
 * of `.ompg/encoding.json` for GBK firmware / legacy projects.
 */

import * as fsSync from "node:fs";
import * as path from "node:path";
import { APP_NAME, DISTRIBUTION_VERSION, findProjectConfigUpward, VERSION } from "@oh-my-pi/pi-utils";
import chalk from "@oh-my-pi/pi-utils/chalk";
import { EncodingPolicy } from "@oh-my-pi/pi-natives";
import {
	assertTextWriteEligibility,
	cfgTextEncodingInvalidSearchFile,
	cfgTextEncodingReadFallback,
	discoverEncodingPolicy,
	ENCODING_CONFIG_FILE,
	invalidateEncodingCaches,
	resolveTextDecision,
} from "../encoding/index";
import { Settings } from "../config/settings";

export interface EncodingDoctorReport {
	binary: {
		name: string;
		version: string;
		upstreamVersion: string;
	};
	cwd: string;
	targetPath: string;
	targetKind: "file" | "directory" | "missing";
	projectRoot?: string;
	config?: {
		selectedPath?: string;
		namespace?: ".ompg" | ".omp";
		legacyShadowedPath?: string;
		enabled?: boolean;
		schemaVersion?: number;
	};
	targetResolution?: {
		assignment: "gbk" | "utf8" | "auto" | "unmanaged";
		fromOverride: boolean;
		effectiveCodec: "gbk" | "utf8" | "auto" | "utf8-then-gbk";
		writeEligible: boolean;
		writeRefusalReason?: string;
	};
	globalSettings: {
		readFallback: "utf8-then-gbk" | "strict-utf8";
		invalidSearchFile: "report" | "fail";
	};
	nextAction: string;
}

export async function runEncodingDoctorCommand(targetPath?: string, flags?: { json?: boolean }): Promise<void> {
	const cwd = process.cwd();
	const targetAbsolute = path.resolve(cwd, targetPath ?? ".");
	const exists = fsSync.existsSync(targetAbsolute);
	const stat = exists ? fsSync.statSync(targetAbsolute) : undefined;
	const isFile = Boolean(stat?.isFile());
	const isDirectory = Boolean(stat?.isDirectory());
	const targetKind = isFile ? "file" : isDirectory ? "directory" : "missing";

	const searchBase = isFile ? path.dirname(targetAbsolute) : targetAbsolute;
	const upward = findProjectConfigUpward(searchBase, ENCODING_CONFIG_FILE);

	let projectRoot: string | undefined;
	let selectedConfigPath: string | undefined;
	let selectedNamespace: ".ompg" | ".omp" | undefined;
	let legacyShadowedPath: string | undefined;

	if (upward?.status === "found") {
		projectRoot = upward.root;
		selectedConfigPath = upward.configPath;
		selectedNamespace = upward.namespace;
		if (upward.namespace === ".ompg") {
			const ompCandidate = path.join(upward.root, ".omp", ENCODING_CONFIG_FILE);
			if (fsSync.existsSync(ompCandidate)) {
				legacyShadowedPath = ompCandidate;
			}
		}
	}

	const discovered = discoverEncodingPolicy(searchBase);
	let enabled: boolean | undefined;
	let schemaVersion: number | undefined;

	if (discovered) {
		projectRoot ??= discovered.root;
		selectedConfigPath ??= discovered.configPath;
		selectedNamespace ??= discovered.namespace;
		try {
			const parsed = JSON.parse(discovered.json);
			enabled = parsed.enabled !== false;
			schemaVersion = parsed.schemaVersion ?? 1;
		} catch {
			enabled = false;
		}
	}

	const settings = await Settings.loadReadOnly({ cwd });
	const readFallback = cfgTextEncodingReadFallback.get(settings);
	const invalidSearchFile = cfgTextEncodingInvalidSearchFile.get(settings);

	let targetResolution: EncodingDoctorReport["targetResolution"] | undefined;
	if (isFile) {
		const decision = resolveTextDecision(targetAbsolute);
		let writeEligible = true;
		let writeRefusalReason: string | undefined;
		try {
			assertTextWriteEligibility(targetAbsolute, true, () => {
				try {
					return fsSync.readFileSync(targetAbsolute);
				} catch {
					return undefined;
				}
			});
		} catch (err) {
			writeEligible = false;
			writeRefusalReason = err instanceof Error ? err.message : String(err);
		}

		const effectiveCodec =
			decision.assignment === "gbk"
				? "gbk"
				: decision.assignment === "utf8"
					? "utf8"
					: decision.assignment === "auto"
						? "auto"
						: readFallback === "strict-utf8"
							? "utf8"
							: "utf8-then-gbk";

		targetResolution = {
			assignment: decision.assignment,
			fromOverride: Boolean(decision.fromOverride),
			effectiveCodec,
			writeEligible,
			writeRefusalReason,
		};
	}

	let nextAction: string;
	if (!discovered || !selectedConfigPath) {
		nextAction = `Run \`ompg encoding init --profile gbk-source\` to generate an explicit project encoding policy (.ompg/encoding.json).`;
	} else if (isFile && targetResolution?.assignment === "unmanaged") {
		nextAction = `Target file is not covered by the include rules in ${selectedConfigPath}. Add its path pattern to the "include" array.`;
	} else if (isFile && !targetResolution?.writeEligible) {
		nextAction = `Target file contains non-UTF-8 bytes and has no explicit policy. ${targetResolution?.writeRefusalReason ?? "Explicit policy required."}`;
	} else if (isFile && targetResolution?.assignment === "gbk") {
		nextAction = `File is governed by GBK policy. Read and edits are strictly managed by the native GBK codec.`;
	} else {
		nextAction = `Encoding policy active at ${selectedConfigPath}. All tools resolve per-file policies from project roots.`;
	}

	const report: EncodingDoctorReport = {
		binary: {
			name: APP_NAME,
			version: DISTRIBUTION_VERSION,
			upstreamVersion: VERSION,
		},
		cwd,
		targetPath: targetAbsolute,
		targetKind,
		projectRoot,
		config: selectedConfigPath
			? {
					selectedPath: selectedConfigPath,
					namespace: selectedNamespace,
					legacyShadowedPath,
					enabled,
					schemaVersion,
				}
			: undefined,
		targetResolution,
		globalSettings: {
			readFallback,
			invalidSearchFile,
		},
		nextAction,
	};

	if (flags?.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log(chalk.bold("\n=== OMPG Text Encoding Doctor ==="));
	console.log(`Program:           ${chalk.cyan(report.binary.name)} (v${report.binary.version})`);
	console.log(`Working Directory: ${report.cwd}`);
	console.log(`Target:            ${report.targetPath} (${report.targetKind})`);
	if (report.projectRoot) {
		console.log(`Project Root:      ${report.projectRoot}`);
	}
	if (report.config?.selectedPath) {
		console.log(
			`Selected Policy:   ${chalk.green(report.config.selectedPath)} [${report.config.namespace ?? ".ompg"}] (v${report.config.schemaVersion ?? 1}, enabled: ${report.config.enabled ?? true})`,
		);
		if (report.config.legacyShadowedPath) {
			console.log(`Legacy Policy:     ${chalk.yellow(report.config.legacyShadowedPath)} (shadowed by .ompg)`);
		}
	} else {
		console.log(`Selected Policy:   ${chalk.yellow("None found upward (unmanaged mode)")}`);
	}

	if (report.targetResolution) {
		const res = report.targetResolution;
		const color = res.assignment === "gbk" ? chalk.green : res.assignment === "utf8" ? chalk.blue : chalk.yellow;
		console.log(
			`Target Decision:   ${color(res.assignment.toUpperCase())} (effective codec: ${res.effectiveCodec}, override: ${res.fromOverride})`,
		);
		console.log(
			`Write Eligible:    ${res.writeEligible ? chalk.green("YES") : chalk.red("NO: " + (res.writeRefusalReason ?? ""))}`,
		);
	}

	console.log(
		`Global Fallback:   readFallback=${report.globalSettings.readFallback}, invalidSearchFile=${report.globalSettings.invalidSearchFile}`,
	);
	console.log(chalk.bold("\nNext Action:"));
	console.log(`  ${report.nextAction}\n`);
}

export interface EncodingInitOptions {
	path?: string;
	profile?: string;
	flags?: { json?: boolean };
}

export async function runEncodingInitCommand(options: EncodingInitOptions): Promise<void> {
	const cwd = process.cwd();
	const targetRoot = path.resolve(cwd, options.path ?? ".");
	const ompgDir = path.join(targetRoot, ".ompg");
	const ompgConfigPath = path.join(ompgDir, ENCODING_CONFIG_FILE);
	const ompConfigPath = path.join(targetRoot, ".omp", ENCODING_CONFIG_FILE);
	const profile = options.profile ?? "gbk-source";
	if (options.profile && options.profile !== "gbk-source") {
		throw new Error(`Unknown encoding profile '${options.profile}' (supported: gbk-source)`);
	}

	if (fsSync.existsSync(ompgConfigPath)) {
		const msg = `Encoding policy already exists at ${ompgConfigPath}; not overwriting. Run \`ompg encoding doctor\` to inspect.`;
		if (options.flags?.json) {
			console.log(JSON.stringify({ status: "exists", configPath: ompgConfigPath, root: targetRoot, message: msg }));
		} else {
			console.log(chalk.yellow(msg));
		}
		return;
	}

	if (fsSync.existsSync(ompConfigPath)) {
		const msg = `Existing legacy policy found at ${ompConfigPath}; keeping existing policy. To migrate to .ompg, create ${ompgConfigPath} explicitly.`;
		if (options.flags?.json) {
			console.log(
				JSON.stringify({ status: "legacy_exists", configPath: ompConfigPath, root: targetRoot, message: msg }),
			);
		} else {
			console.log(chalk.yellow(msg));
		}
		return;
	}

	const configTemplate = {
		schemaVersion: 1,
		enabled: true,
		include: ["**/*.c", "**/*.h"],
		defaultEncoding: "gbk",
		newFileEncoding: "gbk",
		overrides: [],
	};

	const content = JSON.stringify(configTemplate, null, 2) + "\n";

	// Verify compilation with native parser before writing to disk
	try {
		new EncodingPolicy(targetRoot, content);
	} catch (err) {
		throw new Error(
			`Failed to compile generated encoding policy: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	await fsSync.promises.mkdir(ompgDir, { recursive: true });
	try {
		await fsSync.promises.writeFile(ompgConfigPath, content, { flag: "wx", encoding: "utf8" });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			const msg = `Encoding policy already exists at ${ompgConfigPath}; not overwriting. Run \`ompg encoding doctor\` to inspect.`;
			if (options.flags?.json) {
				console.log(
					JSON.stringify({ status: "exists", configPath: ompgConfigPath, root: targetRoot, message: msg }),
				);
			} else {
				console.log(chalk.yellow(msg));
			}
			return;
		}
		throw err;
	}
	invalidateEncodingCaches();

	const successMsg = `Created encoding policy at ${ompgConfigPath} (profile: ${profile}).\nDefault and new file encoding: GBK. Covered patterns: **/*.c, **/*.h.\nCaches invalidated.`;

	if (options.flags?.json) {
		console.log(
			JSON.stringify(
				{
					status: "created",
					configPath: ompgConfigPath,
					root: targetRoot,
					profile,
					policy: configTemplate,
				},
				null,
				2,
			),
		);
	} else {
		console.log(chalk.green(successMsg));
	}
}
