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
import {
	EncodingPolicy,
	type SourceEncodingDiagnostic,
	encodingDecodeStrict,
	encodingEncodeStrict,
	encodingUtf8AmbiguousWithGbk,
	encodingValidateSource,
} from "@oh-my-pi/pi-natives";

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
 * Negative results (no policy anywhere above `cwd`), with a short TTL: a
 * policy-less project would otherwise re-walk the whole parent chain on
 * every file read. The TTL bounds how long a newly created policy file can
 * go unnoticed (mtime revalidation covers edits to an existing one).
 */
const NEGATIVE_CACHE_TTL_MS = 1000;
const negativeCache = new Map<string, number>();

/**
 * Find the nearest `.omp/encoding.json` at or above `cwd` and return its
 * compiled policy. The walk stops at the filesystem root and never consults
 * the user's home directory itself (a home-level policy must not leak into
 * every project under it).
 *
 * A cached compiled policy is reused only while the config file's mtime AND
 * CONTENT both match — mtime alone cannot prove the config unchanged (a
 * rewrite inside the filesystem's timestamp granularity, or a same-mtime
 * overwrite, would otherwise keep serving the old rules). The small config
 * read happens on every discovery; the expensive glob compilation only when
 * the policy actually changed. Within one tool operation the returned object
 * is stable, so repeated resolutions reuse the same verified policy.
 */
export function discoverEncodingPolicy(cwd: string): DiscoveredEncodingPolicy | undefined {
	const start = path.resolve(cwd);
	const negativeAt = negativeCache.get(start);
	if (negativeAt !== undefined && Date.now() - negativeAt < NEGATIVE_CACHE_TTL_MS) {
		return undefined;
	}
	const home = os.homedir();
	let dir = start;
	for (;;) {
		const configPath = path.join(dir, ENCODING_CONFIG_RELATIVE);
		let stat: fs.Stats | undefined;
		try {
			stat = fs.statSync(configPath);
		} catch {
			// not present here — keep walking
		}
		if (stat?.isFile()) {
			const json = fs.readFileSync(configPath, "utf8");
			const cached = policyCache.get(dir);
			if (cached && cached.mtimeMs === stat.mtimeMs && cached.json === json) return cached;
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
		if (dir === home || path.dirname(dir) === dir) {
			negativeCache.set(start, Date.now());
			return undefined;
		}
		dir = path.dirname(dir);
	}
}

/**
 * Resolve the encoding an absolute path persists with.
 * `undefined` = unmanaged (upstream UTF-8 behavior).
 */
export function resolveFileEncoding(
	cwd: string,
	absolutePath: string,
	exists: boolean,
	capturedPolicy?: DiscoveredEncodingPolicy | null,
): ManagedEncoding | undefined {
	// null pins an unmanaged call; undefined preserves ordinary discovery.
	const discovered = capturedPolicy === undefined ? discoverEncodingPolicy(cwd) : capturedPolicy;
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

export interface AmbiguityNoticeOptions {
	scope?: "file" | "window";
	/** False for a fragment or a range whose original bytes were not retained. */
	complete?: boolean;
	incompleteReason?: "budget" | "fragment";
	/** A scanned range need not be part of the displayed selection. */
	displayed?: boolean;
	window?: {
		startLine?: number;
		lineCount?: number;
	};
}

export const ENCODING_DIAGNOSTIC_MAX_BYTES = 4 * 1024 * 1024;

export interface EncodingDiagnostic {
	kind: "ambiguous" | "checked" | "invalid-gbk" | "invalid-gbk-utf8" | "not-applicable" | "unavailable";
	scope: "file" | "window";
	complete: boolean;
	checkedRange: { byteLength: number; startLine?: number; lineCount?: number };
	reason?: "budget" | "io" | "fragment";
	notice?: string;
}

export function unavailableEncodingDiagnostic(
	absolutePath: string,
	reason: "budget" | "io" | "fragment",
	options: AmbiguityNoticeOptions = {},
): EncodingDiagnostic {
	return {
		kind: "unavailable",
		scope: options.scope ?? "file",
		complete: false,
		checkedRange: { byteLength: 0, ...options.window },
		reason,
		notice: `${absolutePath}: encoding ambiguity precheck unavailable (${reason}); no complete ${options.scope ?? "file"} encoding proof was obtained`,
	};
}

/** Acquire only a bounded diagnostic copy; normal write validation is independent. */
export async function readGbkAmbiguityDiagnostic(cwd: string, absolutePath: string): Promise<EncodingDiagnostic> {
	let bytes: Uint8Array;
	try {
		bytes = await Bun.file(absolutePath)
			.slice(0, ENCODING_DIAGNOSTIC_MAX_BYTES + 1)
			.bytes();
	} catch {
		return unavailableEncodingDiagnostic(absolutePath, "io");
	}
	return inspectGbkAmbiguity(cwd, absolutePath, bytes);
}

/** Typed evidence is distinct from the optional model-visible ambiguity warning. */
export function inspectGbkAmbiguity(
	cwd: string,
	absolutePath: string,
	bytes: Uint8Array,
	options: AmbiguityNoticeOptions = {},
): EncodingDiagnostic {
	const discovered = discoverEncodingPolicy(cwd);
	const resolved = discovered?.policy.resolveDetailed(absolutePath, true);
	const evidence = {
		scope: options.scope ?? "file",
		complete: true,
		checkedRange: { byteLength: bytes.length, ...options.window },
	} as const;
	if (!discovered || !resolved || resolved.encoding !== "gbk" || resolved.fromOverride)
		return { ...evidence, kind: "not-applicable", complete: false, checkedRange: { byteLength: 0 } };
	if (options.complete === false)
		return unavailableEncodingDiagnostic(absolutePath, options.incompleteReason ?? "fragment", options);
	if (bytes.length > ENCODING_DIAGNOSTIC_MAX_BYTES)
		return unavailableEncodingDiagnostic(absolutePath, "budget", options);
	try {
		decodeStrict(bytes, "gbk");
	} catch {
		const notice = gbkDecodeFailureUtf8Hint(absolutePath, bytes, options);
		return { ...evidence, kind: notice ? "invalid-gbk-utf8" : "invalid-gbk", ...(notice ? { notice } : {}) };
	}
	if (!encodingUtf8AmbiguousWithGbk(bytes)) return { ...evidence, kind: "checked" };
	return { ...evidence, kind: "ambiguous", notice: formatGbkAmbiguityNotice(absolutePath, discovered.root, options) };
}

export interface AstEncodingDiagnostics {
	ambiguousEncodingFiles?: string[];
	ambiguousEncodingFilesTruncated?: boolean;
	encodingDiagnostics?: SourceEncodingDiagnostic[];
	encodingDiagnosticsTruncated?: boolean;
}

export function mergeAstDiagnosticEvidence(
	target: AstEncodingDiagnostics,
	source: AstEncodingDiagnostics,
	rebase: (file: string) => string,
): void {
	if (source.encodingDiagnosticsTruncated) target.encodingDiagnosticsTruncated = true;
	for (const diagnostic of source.encodingDiagnostics ?? []) {
		const file = rebase(diagnostic.path);
		const rows = (target.encodingDiagnostics ??= []);
		if (rows.some(row => row.path === file)) continue;
		if (rows.length === 10) {
			target.encodingDiagnosticsTruncated = true;
			continue;
		}
		rows.push({ ...diagnostic, path: file });
	}
}

/** Both AST tools and all preview/apply branches use the same bounded formatter. */
export function formatAstEncodingNotes(result: AstEncodingDiagnostics): string | undefined {
	const notes: string[] = [];
	if (result.ambiguousEncodingFiles?.length) {
		const files = result.ambiguousEncodingFiles;
		const truncated = result.ambiguousEncodingFilesTruncated;
		const omission = truncated ? " (further files omitted; total unknown)" : "";
		notes.push(
			`GBK policy decoded ${files.length} searched file(s)${omission} whose bytes are also valid UTF-8 — the two readings differ; add an explicit override (glob + "encoding": "utf8") in this project's .omp/encoding.json for any that is actually UTF-8: ${files.join(", ")}${truncated ? " …" : ""}`,
		);
	}
	const incomplete = result.encodingDiagnostics?.filter(row => !row.complete) ?? [];
	if (incomplete.length) {
		const visible = incomplete.slice(0, Math.max(0, 10 - (result.ambiguousEncodingFiles?.length ?? 0)));
		notes.push(
			`Encoding ambiguity precheck unavailable (budget): no complete file UTF-8/GBK ambiguity proof was obtained for ${visible.length ? visible.map(row => row.path).join(", ") : "additional checked files"}${result.encodingDiagnosticsTruncated || visible.length < incomplete.length ? " (further files omitted; total unknown)" : ""}`,
		);
	} else if (result.encodingDiagnosticsTruncated && !result.ambiguousEncodingFilesTruncated) {
		notes.push("Further encoding diagnostics omitted; total unknown.");
	}
	return notes.length ? notes.join("\n\n") : undefined;
}

/**
 * G4 ambiguity diagnostic: a GBK include rule (not an explicit override)
 * covers `bytes` that are BOM-free, non-ASCII, and also strictly valid UTF-8 —
 * both encodings decode them to different text, so the policy alone cannot
 * tell which reading is right. Returns the model-visible notice, or
 * `undefined` when an override already answered for the path, the complete
 * bytes are pure ASCII (identical readings), or they are not valid UTF-8.
 * Incomplete eligible diagnostics return an explicit unavailable notice.
 *
 * Byte validity only — never character-frequency or content heuristics.
 */
export function gbkUtf8AmbiguityNotice(
	cwd: string,
	absolutePath: string,
	bytes: Uint8Array,
	options?: AmbiguityNoticeOptions,
): string | undefined {
	const diagnostic = inspectGbkAmbiguity(cwd, absolutePath, bytes, options);
	return diagnostic.kind === "ambiguous" || diagnostic.kind === "unavailable" ? diagnostic.notice : undefined;
}

function formatGbkAmbiguityNotice(absolutePath: string, policyRoot: string, options?: AmbiguityNoticeOptions): string {
	const targetLabel =
		options?.scope === "window" && options.window?.startLine !== undefined
			? `${absolutePath} (line${(options.window.lineCount ?? 1) > 1 ? `s ${options.window.startLine}-${options.window.startLine + (options.window.lineCount ?? 1) - 1}` : ` ${options.window.startLine}`})`
			: absolutePath;
	const bytesQualifier =
		options?.scope === "window"
			? options.displayed === false
				? "checked window bytes"
				: "displayed window bytes"
			: "same bytes";
	return `${targetLabel}: decoded as GBK by the project encoding policy, but the ${bytesQualifier} are also valid UTF-8 and the two readings differ. If this file is actually UTF-8, add an explicit override entry (glob + "encoding": "utf8") to ${policyRoot}${path.sep}.omp${path.sep}encoding.json; if GBK is correct, no action is needed.`;
}

/**
 * Definitive hint for a strict GBK decode failure: when the file's BOM-free,
 * non-ASCII bytes are valid UTF-8, the file cannot be GBK at all — say so
 * instead of leaving the reader to guess between a broken file and a wrong
 * policy. `undefined` when the bytes give no such proof.
 */
export function gbkDecodeFailureUtf8Hint(
	absolutePath: string,
	bytes: Uint8Array,
	options?: AmbiguityNoticeOptions,
): string | undefined {
	if (options?.complete === false || bytes.length > ENCODING_DIAGNOSTIC_MAX_BYTES) return undefined;
	try {
		decodeStrict(bytes, "gbk");
		return undefined;
	} catch {
		// Strict GBK decode failed as required for a failure hint.
	}
	if (!encodingUtf8AmbiguousWithGbk(bytes)) return undefined;
	const targetLabel =
		options?.scope === "window" && options.window?.startLine !== undefined
			? `${absolutePath} (line${(options.window.lineCount ?? 1) > 1 ? `s ${options.window.startLine}-${options.window.startLine + (options.window.lineCount ?? 1) - 1}` : ` ${options.window.startLine}`})`
			: absolutePath;
	const bytesQualifier =
		options?.scope === "window"
			? options.displayed === false
				? "checked window bytes"
				: "displayed window bytes"
			: "bytes";
	const cannotBe = options?.scope === "window" ? "cannot be a GBK window" : "cannot be a GBK file";
	return `${targetLabel}: the ${bytesQualifier} are valid UTF-8 and invalid GBK, so this ${cannotBe} — it is UTF-8 under a GBK rule. Add an explicit override entry (glob + "encoding": "utf8") for this path in the project's .omp/encoding.json, then re-read; do not rewrite the file.`;
}

/** Strictly encode text to bytes; throws on unrepresentable characters. */
export function encodeStrict(text: string, encoding: ManagedEncoding): Uint8Array {
	return encodingEncodeStrict(text, encoding);
}

/** Source declarations constrain the chosen charset; they never select it. */
export function assertSourceEncoding(filePath: string, text: string, encoding: ManagedEncoding = "utf8"): void {
	const extension = path.extname(filePath).toLowerCase();
	if (extension !== ".py" && extension !== ".pyw") return;
	encodingValidateSource(filePath, text, encoding);
}

/** Reject lossy normalization of valid but noncanonical GBK byte sequences. */
export function assertStableGbkBytes(bytes: Uint8Array, filePath: string): void {
	const encoded = encodeStrict(decodeStrict(bytes, "gbk"), "gbk");
	if (!Buffer.from(bytes).equals(Buffer.from(encoded))) {
		throw new Error(`${filePath}: GBK bytes are not round-trip stable; refusing to normalize untouched bytes`);
	}
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
	capturedPolicy?: DiscoveredEncodingPolicy | null,
): { text: string; encoding: ManagedEncoding | undefined } {
	const encoding = resolveFileEncoding(cwd, absolutePath, exists, capturedPolicy);
	if (encoding === "gbk") {
		// A UTF-8 BOM under a GBK rule is a policy conflict, not a choice.
		if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
			throw new Error(
				`${absolutePath}: policy conflict — the file carries a UTF-8 BOM but the encoding policy assigns GBK; add an override with encoding "utf8" for this path`,
			);
		}
		try {
			return { text: decodeStrict(bytes, "gbk"), encoding };
		} catch (error) {
			// Bytes that are valid UTF-8 prove the file cannot be GBK at all —
			// say so instead of a bare offset.
			const hint = gbkDecodeFailureUtf8Hint(absolutePath, bytes);
			throw new Error(hint ?? `${absolutePath}: ${String(error)}`);
		}
	}
	let text: string;
	try {
		text = decodeStrict(bytes, "utf8");
	} catch (error) {
		throw new Error(
			`${absolutePath}: ${String(error)}. No matching GBK policy; explicitly configure include and encoding overrides in this project's .omp/encoding.json, then re-read. Do not rewrite or guess the encoding.`,
		);
	}
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
	assertSourceEncoding(absolutePath, text, encoding ?? "utf8");
	if (encoding === "gbk") {
		return { data: encodeStrict(text, "gbk"), encoding };
	}
	return { data: text, encoding: undefined };
}

export type { EncodingPolicy };
