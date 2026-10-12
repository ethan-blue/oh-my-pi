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
import * as path from "node:path";
import {
	findProjectConfigUpward,
	invalidateProjectConfigCaches,
	type ProjectConfigNamespace,
} from "@oh-my-pi/pi-utils";
import {
	EncodingPolicy,
	type SourceEncodingDiagnostic,
	encodingDecodeStrict,
	encodingEncodeStrict,
	encodingUtf8AmbiguousWithGbk,
	encodingValidateSource,
} from "@oh-my-pi/pi-natives";

export const ENCODING_CONFIG_FILE = "encoding.json";
/** Legacy fixed-`.omp` relative path; kept for diagnostics and older callers. */
export const ENCODING_CONFIG_RELATIVE = path.join(".omp", ENCODING_CONFIG_FILE);

/** Encodings this fork implements; anything else is rejected up front. */
export type ManagedEncoding = "utf8" | "gbk";

export interface DiscoveredEncodingPolicy {
	/** Compiled native policy; `resolve()` answers per-path questions. */
	policy: EncodingPolicy;
	/** Absolute project root — the directory whose config namespace this is. */
	root: string;
	/** Namespace directory that holds the selected file (".ompg" or ".omp"). */
	namespace: ProjectConfigNamespace;
	/** Absolute path of the selected encoding.json. */
	configPath: string;
	/** `mtimeMs` of the config file. */
	mtimeMs: number;
	/** Raw file contents (passed to edit sessions so Rust compiles the same rules). */
	json: string;
}

/**
 * Typed encoding-configuration failure: a config file that exists but cannot
 * be read (permission) or does not compile (invalid schema/globs/encodings).
 * These are configuration errors the user must fix — never silently treated
 * as "no policy" and never silently routed to an older config file.
 */
export class EncodingConfigError extends Error {
	constructor(
		public readonly configPath: string,
		public readonly kind: "permission" | "invalid",
		cause?: unknown,
	) {
		super(
			kind === "permission"
				? `${configPath}: permission denied while reading the encoding policy; fix the file's permissions — this is not treated as "no policy"`
				: `${configPath}: invalid encoding policy: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = "EncodingConfigError";
		this.cause = cause;
	}
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

/** Drop every cached policy/discovery result (after a config write). */
export function invalidateEncodingCaches(): void {
	policyCache.clear();
	negativeCache.clear();
	invalidateProjectConfigCaches();
}

/**
 * Find the nearest `encoding.json` at or above `cwd` — `.ompg` preferred
 * over `.omp` at the same root, whole-file, never merged — and return its
 * compiled policy.
 *
 * Boundaries (docs/gbk-handoff/31 §2.3): the walk never reads a config at
 * the user's home directory or at the fork's user-data root; probing stops
 * after the nearest `.git` root has been checked. An entry that exists but
 * cannot be inspected raises {@link EncodingConfigError} — permission is not
 * absence. A cached compiled policy is reused only while the file's CONTENT
 * matches (mtime alone cannot prove the config unchanged); the expensive
 * glob compilation happens only when the policy actually changed.
 */
export function discoverEncodingPolicy(cwd: string): DiscoveredEncodingPolicy | undefined {
	const start = path.resolve(cwd);
	const negativeAt = negativeCache.get(start);
	if (negativeAt !== undefined && Date.now() - negativeAt < NEGATIVE_CACHE_TTL_MS) {
		return undefined;
	}
	const lookup = findProjectConfigUpward(start, ENCODING_CONFIG_FILE);
	if (!lookup) {
		negativeCache.set(start, Date.now());
		return undefined;
	}
	if (lookup.status !== "found") {
		negativeCache.delete(start);
		throw new EncodingConfigError(lookup.configPath, lookup.status, lookup.cause);
	}
	let json: string;
	try {
		json = fs.readFileSync(lookup.configPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EACCES") {
			throw new EncodingConfigError(lookup.configPath, "permission", error);
		}
		throw error;
	}
	const cached = policyCache.get(lookup.configPath);
	if (cached && cached.json === json && cached.namespace === lookup.namespace) return cached;
	let policy: EncodingPolicy;
	try {
		policy = new EncodingPolicy(lookup.root, json);
	} catch (error) {
		throw new EncodingConfigError(lookup.configPath, "invalid", error);
	}
	const discovered: DiscoveredEncodingPolicy = {
		policy,
		root: lookup.root,
		namespace: lookup.namespace,
		configPath: lookup.configPath,
		mtimeMs: 0,
		json,
	};
	policyCache.set(lookup.configPath, discovered);
	return discovered;
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

/** How a text read may decode: fixed codec, or the read-only fallback order. */
export type TextDecodeMode = "utf8" | "gbk" | "utf8-then-gbk";

/** Per-target read assignment resolved from the file's own project tree. */
export interface TextReadDecision {
	/** Fixed policy encoding, `auto` (schema 2 read branch), or `unmanaged`. */
	assignment: "utf8" | "gbk" | "auto" | "unmanaged";
	discovered?: DiscoveredEncodingPolicy;
	fromOverride?: boolean;
}

/**
 * Resolve the read assignment for one absolute path from the TARGET's own
 * directory — never from the session cwd, so an external project keeps its
 * own policy and a session-level GBK default never blankets external trees.
 * `auto` and `unmanaged` files decode by the caller's fallback setting.
 */
export function resolveTextDecision(absolutePath: string): TextReadDecision {
	const discovered = discoverEncodingPolicy(path.dirname(path.resolve(absolutePath)));
	if (!discovered) return { assignment: "unmanaged" };
	const resolved = discovered.policy.resolveDetailed(absolutePath, true);
	if (!resolved) return { assignment: "unmanaged" };
	return {
		assignment: resolved.encoding as TextReadDecision["assignment"],
		discovered,
		fromOverride: resolved.fromOverride,
	};
}

/**
 * Decode `bytes` per `mode`: fixed codecs stay strict; `utf8-then-gbk` tries
 * strict UTF-8 first and only then strict GBK. Throws a combined, path-annotated
 * error when both orders fail — never substitutes.
 */
export function decodeTextByMode(bytes: Uint8Array, mode: TextDecodeMode, absolutePath: string): string {
	if (mode === "gbk") {
		if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
			throw new Error(
				`${absolutePath}: policy conflict — the file carries a UTF-8 BOM but the encoding policy assigns GBK; add an override with encoding "utf8" for this path`,
			);
		}
		return decodeStrict(bytes, "gbk");
	}
	if (mode === "utf8-then-gbk") {
		try {
			return decodeStrict(bytes, "utf8");
		} catch (utf8Error) {
			try {
				return decodeStrict(bytes, "gbk");
			} catch (gbkError) {
				throw new Error(
					`${absolutePath}: neither strict UTF-8 (${String(utf8Error)}) nor strict GBK (${String(gbkError)}) decodes this file. Configure this project's encoding policy (.ompg/encoding.json via \`ompg encoding init\`) or fix the file's encoding; do not rewrite it to recover a read.`,
				);
			}
		}
	}
	return decodeStrict(bytes, mode);
}

/**
 * The visible notice when a file with no fixed policy assignment was read
 * through the automatic GBK fallback: `undefined` when the bytes are valid
 * UTF-8 (no fallback happened) or not valid GBK either (not fallback-readable).
 * The fallback is READ-ONLY — it never authorizes GBK writes.
 */
export function unmanagedGbkFallbackNotice(absolutePath: string, bytes: Uint8Array): string | undefined {
	try {
		decodeStrict(bytes, "utf8");
		return undefined;
	} catch {
		// fall through to the GBK probe
	}
	try {
		decodeStrict(bytes, "gbk");
	} catch {
		return undefined;
	}
	return `${absolutePath}: not valid UTF-8; decoded as GBK through the read-only automatic fallback (no encoding policy covers this path). This inference does NOT authorize GBK writes — create an explicit project policy (ompg encoding init --profile gbk-source) before editing this file.`;
}

/**
 * Write eligibility for a text target: an EXISTING file whose bytes are
 * undecodable as UTF-8 (i.e. would have been read via the GBK fallback) must
 * not be rewritten by the UTF-8 write path — that would silently corrupt it.
 * Refuse with the explicit-policy guidance instead. New files and valid
 * UTF-8 files stay writable; policy-managed files follow their own rules.
 */
export function assertTextWriteEligibility(
	absolutePath: string,
	exists: boolean,
	probeBytes?: () => Uint8Array | undefined,
): void {
	if (!exists) return;
	const decision = resolveTextDecision(absolutePath);
	if (decision.fromOverride || decision.assignment === "gbk" || decision.assignment === "utf8") return;

	let bytes: Uint8Array | undefined;
	try {
		bytes = probeBytes?.();
	} catch (err) {
		throw new Error(
			`${absolutePath}: failed to read file bytes to verify encoding write eligibility: ${err instanceof Error ? err.message : String(err)}. Refusing to write without verifying file encoding.`,
		);
	}
	if (!bytes) {
		throw new Error(
			`${absolutePath}: could not probe file bytes for encoding write eligibility; refusing to overwrite existing file without an explicit encoding policy.`,
		);
	}

	if (decision.assignment === "auto") {
		let dualValid = false;
		if (encodingUtf8AmbiguousWithGbk(bytes)) {
			try {
				decodeStrict(bytes, "gbk");
				dualValid = true;
			} catch {
				// UTF-8 alone is unambiguous: the GBK reading must also be legal.
			}
		}
		if (dualValid) {
			throw new Error(
				`${absolutePath}: file contains non-ASCII text that is ambiguous under schemaVersion 2 'auto' policy (valid in both UTF-8 and GBK). Add an explicit override rule ("encoding": "utf8" or "gbk") in .ompg/encoding.json before editing this file.`,
			);
		}
	}

	try {
		decodeStrict(bytes, "utf8");
	} catch {
		throw new Error(
			`${absolutePath}: this file is not valid UTF-8 and has no explicit encoding policy, so writing it as UTF-8 would corrupt it. Create a project policy first (ompg encoding init --profile gbk-source, or add an include rule + override in .ompg/encoding.json), then edit through the native tools.`,
		);
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
export * from "./settings";
