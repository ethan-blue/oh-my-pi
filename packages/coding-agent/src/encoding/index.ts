/**
 * Project text-encoding policy (`.omp/encoding.json`) and the strict codec
 * boundary shared with the Rust engine.
 *
 * One policy, two enforcement layers: the TypeScript tools resolve paths
 * through the compiled native [`EncodingPolicy`] (same matcher the Rust edit
 * engine compiles from the same JSON), and every byte-level read/write in the
 * tool shell goes through this module. Files the policy does not manage keep
 * upstream UTF-8 behavior byte-for-byte.
 *
 * Contract highlights (docs/gbk-handoff/02-encoding-contract.md):
 * - strict decode/encode only — never replacement characters or HTML
 *   numeric references;
 * - discovery walks up from the cwd but never consults the user's home
 *   directory or above it;
 * - an invalid policy fails loudly at first use instead of degrading to
 *   UTF-8.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EncodingPolicy, encodingDecodeStrict, encodingEncodeStrict } from "@oh-my-pi/pi-natives";

export const ENCODING_CONFIG_RELATIVE = path.join(".omp", "encoding.json");

/** Encodings this fork implements; anything else is rejected up front. */
export type ManagedEncoding = "utf8" | "gbk";

export interface DiscoveredEncodingPolicy {
	/** Compiled native policy; `resolve()` answers per-path questions. */
	policy: EncodingPolicy;
	/** Absolute project root — the directory whose `.omp/encoding.json` this is. */
	root: string;
	/** `mtimeMs` of the config file, for cheap cache invalidation. */
	mtimeMs: number;
	/** Raw file contents (passed to edit sessions so Rust compiles the same rules). */
	json: string;
}

const policyCache = new Map<string, DiscoveredEncodingPolicy>();

/**
 * Find the nearest `.omp/encoding.json` at or above `cwd` and return its
 * compiled policy. The walk stops at the filesystem root and never consults
 * the user's home directory itself (a home-level policy must not leak into
 * every project under it). Results are cached per root and revalidated by
 * mtime so editing the policy takes effect on the next resolution.
 */
export function discoverEncodingPolicy(cwd: string): DiscoveredEncodingPolicy | undefined {
	const home = os.homedir();
	let dir = path.resolve(cwd);
	for (;;) {
		const configPath = path.join(dir, ENCODING_CONFIG_RELATIVE);
		let stat: fs.Stats | undefined;
		try {
			stat = fs.statSync(configPath);
		} catch {
			// not present here — keep walking
		}
		if (stat?.isFile()) {
			const cached = policyCache.get(dir);
			if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
			const json = fs.readFileSync(configPath, "utf8");
			const policy = new EncodingPolicy(dir, json);
			const discovered: DiscoveredEncodingPolicy = {
				policy,
				root: dir,
				mtimeMs: stat.mtimeMs,
				json,
			};
			policyCache.set(dir, discovered);
			return discovered;
		}
		if (dir === home || path.dirname(dir) === dir) return undefined;
		dir = path.dirname(dir);
	}
}

/**
 * Resolve the encoding an absolute path persists with.
 * `undefined` = unmanaged (upstream UTF-8 behavior).
 */
export function resolveFileEncoding(cwd: string, absolutePath: string, exists: boolean): ManagedEncoding | undefined {
	const discovered = discoverEncodingPolicy(cwd);
	if (!discovered) return undefined;
	const answer = discovered.policy.resolve(absolutePath, exists);
	if (answer === null || answer === undefined) return undefined;
	if (answer !== "utf8" && answer !== "gbk") {
		throw new Error(`encoding policy returned unsupported encoding '${answer}'`);
	}
	return answer;
}

/**
 * Encoding a write to `absolutePath` must persist with; discovers the policy
 * from the file's own directory (a managed file always lives under its policy
 * root), so write sinks need no session cwd.
 */
export function resolveWriteEncoding(absolutePath: string, exists: boolean): "gbk" | undefined {
	const encoding = resolveFileEncoding(path.dirname(path.resolve(absolutePath)), absolutePath, exists);
	return encoding === "gbk" ? "gbk" : undefined;
}

/** Strictly decode bytes; throws with byte offset context on invalid input. */
export function decodeStrict(bytes: Uint8Array, encoding: ManagedEncoding): string {
	return encodingDecodeStrict(bytes, encoding);
}

/** Strictly encode text to bytes; throws on unrepresentable characters. */
export function encodeStrict(text: string, encoding: ManagedEncoding): Uint8Array {
	return encodingEncodeStrict(text, encoding);
}

/**
 * Read a file's text through the encoding policy: managed GBK files are
 * strictly decoded, everything else keeps upstream UTF-8 semantics. A leading
 * UTF-8 BOM is stripped exactly like `Bun.file().text()`. Throws (never
 * substitutes) on undecodable bytes.
 */
export function readTextWithPolicy(
	cwd: string,
	absolutePath: string,
	bytes: Uint8Array,
	exists = true,
): { text: string; encoding: ManagedEncoding | undefined } {
	const encoding = resolveFileEncoding(cwd, absolutePath, exists);
	if (encoding === "gbk") {
		// A UTF-8 BOM under a GBK rule is a policy conflict, not a choice.
		if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
			throw new Error(
				`${absolutePath}: policy conflict — the file carries a UTF-8 BOM but the encoding policy assigns GBK; add an override with encoding "utf8" for this path`,
			);
		}
		return { text: decodeStrict(bytes, "gbk"), encoding };
	}
	const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
	return { text: text.startsWith("\u{FEFF}") ? text.slice(1) : text, encoding: undefined };
}

/**
 * Encode text for writing: GBK-managed paths get strict GBK bytes, everything
 * else the UTF-8 string itself (the sink's default). Throws on characters GBK
 * cannot represent — callers surface that before touching disk.
 */
export function encodeForWrite(
	cwd: string,
	absolutePath: string,
	text: string,
	exists: boolean,
): { data: string | Uint8Array; encoding: "gbk" | undefined } {
	const encoding = resolveFileEncoding(cwd, absolutePath, exists);
	if (encoding === "gbk") {
		return { data: encodeStrict(text, "gbk"), encoding };
	}
	return { data: text, encoding: undefined };
}

export type { EncodingPolicy };
