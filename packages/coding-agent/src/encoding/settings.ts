/**
 * Global text-encoding behavior settings (docs/gbk-handoff/31 §2.1).
 *
 * These provide READ-side defaults for inputs with no explicit project
 * policy. They never override an explicit UTF-8/GBK rule, never authorize
 * GBK writes by themselves, and never depend on the Windows ACP: the strict
 * Rust codec decides, the same on every host.
 */
import { register, type SettingValueOf } from "../config/registry";

export const cfgTextEncodingReadFallback = register({
	id: "textEncoding.readFallback",
	type: "enum",
	values: ["utf8-then-gbk", "strict-utf8"] as const,
	default: "utf8-then-gbk",
	ui: {
		tab: "tools",
		group: "Text Encoding",
		label: "Unmanaged File Read Fallback",
		description:
			"Read-only decode for text files with no project encoding policy: strict UTF-8 first, then strict GBK (reported as an automatic fallback, never used to authorize writes). 'strict-utf8' refuses non-UTF-8 text with recovery guidance.",
	},
});

export const cfgTextEncodingInvalidSearchFile = register({
	id: "textEncoding.invalidSearchFile",
	type: "enum",
	values: ["report", "fail"] as const,
	default: "report",
	ui: {
		tab: "tools",
		group: "Text Encoding",
		label: "Undecodable Search Files",
		description:
			"'report' keeps searching the remaining files and reports which files could not be searched (never as zero matches); 'fail' aborts the search with an actionable encoding error.",
	},
});

export type TextEncodingReadFallback = SettingValueOf<typeof cfgTextEncodingReadFallback>;
export type TextEncodingInvalidSearchFile = SettingValueOf<typeof cfgTextEncodingInvalidSearchFile>;
