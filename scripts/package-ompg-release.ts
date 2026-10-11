#!/usr/bin/env bun
/**
 * Packages the ompg (GBK fork) Windows x64 distribution.
 *
 * Inputs (built by earlier gates):
 *   packages/coding-agent/dist/omp.exe                 — compiled from the release commit
 *   packages/natives/native/pi_natives.win32-x64-modern.node — the native addon embedded at compile time
 *   scripts/install-ompg.ps1                            — fork installer
 *
 * Output: release-staging/<version>/ (previous release assets are preserved)
 *   ompg-<version>-windows-x64.zip   — ompg.exe, install-ompg.ps1, README.zh-CN.md,
 *                                      encoding.example.json, build-info.json, LICENSE,
 *                                      THIRD-PARTY-NOTICES.txt
 *   SHA256SUMS.txt                   — hashes of every published asset (not itself)
 *
 * Usage: bun scripts/package-ompg-release.ts [--version 18.8.7-gbk.1] [--sha <git-sha>]
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { $ } from "bun";
import { version as upstreamVersion } from "../packages/utils/package.json" with { type: "json" };

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
	const index = args.indexOf(`--${name}`);
	if (index >= 0 && args[index + 1]) return args[index + 1];
	const inline = args.find(arg => arg.startsWith(`--${name}=`));
	return inline?.split("=", 2)[1];
}

const root = import.meta.dir.replace(/[/\\]scripts$/, "");
const version = argValue("version") ?? `${upstreamVersion}-gbk.1`;
if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(version)) throw new Error("Invalid release version");
const staging = path.join(root, "release-staging", version);
const sha = argValue("sha") ?? (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim();
const dirty = (await $`git status --porcelain`.cwd(root).quiet().text()).trim();
if (dirty) {
	console.error("Refusing to package from a dirty worktree — commit or stash first.");
	process.exit(1);
}

const exeSource = path.join(root, "packages", "coding-agent", "dist", "omp.exe");
const addonPath = path.join(root, "packages", "natives", "native", "pi_natives.win32-x64-modern.node");
for (const required of [exeSource, addonPath, path.join(root, "scripts", "install-ompg.ps1")]) {
	await fs.access(required);
}

const reportedVersion = (await $`${exeSource} --version`.quiet().text()).trim();
if (reportedVersion !== `ompg/${version}`) throw new Error(`Binary version mismatch: ${reportedVersion}`);
const currentSha = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim();
if (sha !== currentSha) throw new Error("Release SHA must match HEAD");
await fs.mkdir(staging, { recursive: true });
const archiveDir = path.join(staging, `ompg-${version}-windows-x64`);
await fs.mkdir(archiveDir);

await fs.copyFile(exeSource, path.join(archiveDir, "ompg.exe"));
await fs.copyFile(path.join(root, "scripts", "install-ompg.ps1"), path.join(archiveDir, "install-ompg.ps1"));
await fs.copyFile(path.join(root, "LICENSE"), path.join(archiveDir, "LICENSE"));
await fs.copyFile(path.join(root, "THIRD-PARTY-NOTICES.txt"), path.join(archiveDir, "THIRD-PARTY-NOTICES.txt"));
await fs.copyFile(
	path.join(root, "scripts", "release-assets", "README.zh-CN.md"),
	path.join(archiveDir, "README.zh-CN.md"),
);
await fs.copyFile(
	path.join(root, "scripts", "release-assets", "encoding.example.json"),
	path.join(archiveDir, "encoding.example.json"),
);

const addonHash = createHash("sha256")
	.update(await fs.readFile(addonPath))
	.digest("hex");
const bunVersion = Bun.version;
const rustcVersion = (await $`rustc --version`.cwd(root).quiet().text()).trim();
const buildInfo = {
	distribution: "ompg",
	repository: "ethan-blue/oh-my-pi",
	upstreamRepository: "can1357/oh-my-pi",
	version,
	upstreamBaseVersion: upstreamVersion,
	commitSha: sha,
	platform: "windows-x64",
	bunVersion,
	rustToolchain: rustcVersion,
	nativeAddon: {
		embedded: true,
		file: "pi_natives.win32-x64-modern.node",
		sha256: addonHash,
		// The addon ships inside ompg.exe (bun --compile embeds the package
		// assets); this hash pins which build it came from.
	},
	gbkSupport: true,
	builtAt: new Date().toISOString(),
};
await fs.writeFile(path.join(archiveDir, "build-info.json"), JSON.stringify(buildInfo, null, "\t") + "\n", "utf8");

const payloadSums: string[] = [];
for (const entry of await fs.readdir(archiveDir, { withFileTypes: true })) {
	if (!entry.isFile()) continue;
	const hash = createHash("sha256")
		.update(await fs.readFile(path.join(archiveDir, entry.name)))
		.digest("hex");
	payloadSums.push(`${hash}  ${entry.name}`);
}
await fs.writeFile(path.join(archiveDir, "SHA256SUMS.txt"), payloadSums.join("\n") + "\n", "utf8");

const zipPath = path.join(staging, `ompg-${version}-windows-x64.zip`);
if (process.platform === "win32") {
	const winArchive = archiveDir.replace(/\//g, "\\");
	await $`powershell -NoProfile -Command Compress-Archive -Path '${winArchive}' -DestinationPath '${zipPath.replace(/\//g, "\\")}' -Force`.cwd(
		root,
	);
} else {
	await $`cd ${archiveDir} && zip -r ${zipPath} .`.cwd(root);
}

const assets = [`ompg-${version}-windows-x64.zip`, "SHA256SUMS.txt", "RELEASE_NOTES.md", "VALIDATION.md"];
await fs.copyFile(
	path.join(root, "scripts", "release-assets", "RELEASE_NOTES.md"),
	path.join(staging, "RELEASE_NOTES.md"),
);
await fs.copyFile(path.join(root, "scripts", "release-assets", "VALIDATION.md"), path.join(staging, "VALIDATION.md"));

const sums: string[] = [];
for (const asset of assets.filter(name => name !== "SHA256SUMS.txt")) {
	const file = path.join(staging, asset);
	if (!(await fs.stat(file)).isFile()) continue;
	const hash = createHash("sha256")
		.update(await fs.readFile(file))
		.digest("hex");
	sums.push(`${hash}  ${path.basename(asset)}`);
}
await fs.writeFile(path.join(staging, "SHA256SUMS.txt"), sums.join("\n") + "\n", "utf8");

console.log(`Packaged ${zipPath}`);
console.log(`Version ${version} @ ${sha}`);
for (const line of sums) console.log(line);
