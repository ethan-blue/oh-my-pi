import { OutputDecoder } from "@oh-my-pi/pi-natives";

export interface OutputDecodeProvenance {
	outputEncoding?: string;
	outputReplacements?: number;
	outputEncodings?: string[];
	outputEncodingUnknownReaders?: number;
}

function encodingLabel(code: string): string {
	if (code === "gbk") return "GBK (cp936)";
	if (code === "cp936") return "GBK via the Windows ANSI code page (cp936)";
	if (code.startsWith("cp")) return `Windows ANSI code page ${code.slice(2)}`;
	return code;
}

export function formatOutputEncodingNotice(
	encoding: string | undefined,
	encodings: readonly string[] | undefined,
	replacements: number | undefined,
	unknownReaders: number | undefined,
): string | undefined {
	if (unknownReaders !== undefined && unknownReaders > 0) {
		const observed = encodings?.length ? `; observed: ${encodings.map(encodingLabel).join(", ")}` : "";
		return `output decode provenance incomplete (${unknownReaders} output reader(s) did not finish)${observed} — the encoding of some output is unknown`;
	}
	const loss =
		replacements !== undefined && replacements > 0
			? `; ${replacements} undecodable byte sequence(s) substituted`
			: "";
	const modes = encodings ?? (encoding !== undefined ? [encoding] : []);
	if (modes.length > 1) return `output decoded with mixed encodings (${modes.map(encodingLabel).join(" + ")})${loss}`;
	const mode = encoding ?? modes[0];
	if (mode === undefined) return undefined;
	if (mode === "utf8")
		return loss === ""
			? undefined
			: `output decoded as UTF-8${loss} — the tool may have written another encoding (pass outputEncoding)`;
	return `output decoded as ${encodingLabel(mode)}${loss}`;
}

/** Summaries belong to completed readers; display truncation does not end a reader. */
export class OutputDecodeAccumulator {
	#encodings = new Set<string>();
	#replacements = 0;
	#completed = 0;
	#unknown = 0;

	complete(decoder: OutputDecoder): void {
		this.#completed += 1;
		this.#encodings.add(decoder.encoding);
		this.#replacements = Math.min(0xffff_ffff, this.#replacements + decoder.replacements);
	}

	unknown(count = 1): void {
		this.#unknown = Math.min(0xffff_ffff, this.#unknown + count);
	}

	result(): OutputDecodeProvenance {
		const encodings = [...this.#encodings];
		return {
			outputEncoding: this.#unknown === 0 && encodings.length === 1 ? encodings[0] : undefined,
			outputReplacements: this.#unknown === 0 && this.#completed > 0 ? this.#replacements : undefined,
			outputEncodings: encodings.length ? encodings : undefined,
			outputEncodingUnknownReaders: this.#unknown || undefined,
		};
	}
}

/** Versioned raw reader, used only at the bytes boundary; Python str bypasses it. */
export class RawOutputReader {
	readonly decoder: OutputDecoder;
	#next = 0;
	#finished = false;

	constructor(encoding?: "utf8" | "gbk") {
		this.decoder = new OutputDecoder(encoding);
	}

	push(seq: number | undefined, data: string | undefined): string {
		if (
			this.#finished ||
			seq !== this.#next ||
			data === undefined ||
			data.length > 87_384 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)
		) {
			throw new Error("Invalid raw-output chunk sequence or payload");
		}
		const byteLength = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
		if (byteLength > 65_536) throw new Error("Invalid raw-output chunk payload: exceeds 65536 bytes");
		this.#next += 1;
		return this.decoder.push(Buffer.from(data, "base64"));
	}

	finish(seq: number | undefined): string {
		if (this.#finished || seq !== this.#next) throw new Error("Invalid raw-output end sequence");
		this.#finished = true;
		return this.decoder.finish();
	}
}
