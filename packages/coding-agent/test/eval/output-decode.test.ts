import { describe, expect, it } from "bun:test";
import { OutputDecodeAccumulator, RawOutputReader } from "../../src/eval/output-decode";

describe("raw output framing and aggregation", () => {
	it("keeps GBK carry across chunks and counts a trailing partial character at EOF", () => {
		const reader = new RawOutputReader("gbk");
		expect(reader.push(0, Buffer.from([0xd6]).toString("base64"))).toBe("");
		expect(reader.push(1, Buffer.from([0xd0, 0x81]).toString("base64"))).toBe("中");
		expect(reader.finish(2)).toBe("�");
		expect(reader.decoder.replacements).toBe(1);
	});

	it("rejects malformed, oversized and reordered frames before decoding them", () => {
		for (const data of [
			"!not-base64",
			"a",
			"A".repeat(87_388),
			Buffer.alloc(65_537).toString("base64"),
			Buffer.alloc(65_538).toString("base64"),
		]) {
			const reader = new RawOutputReader("utf8");
			expect(() => reader.push(0, data)).toThrow("payload");
		}
		expect(new RawOutputReader("utf8").push(0, Buffer.alloc(65_536, 0x61).toString("base64"))).toHaveLength(65_536);
		expect(() => new RawOutputReader().push(1, "YQ==")).toThrow("sequence");
	});

	it("rejects duplicate EOF and writes after EOF", () => {
		const reader = new RawOutputReader();
		reader.finish(0);
		expect(() => reader.finish(0)).toThrow("sequence");
		expect(() => reader.push(0, "YQ==")).toThrow("sequence");
	});

	it("retains observed encodings but withholds totals when another reader is unknown", () => {
		const reader = new RawOutputReader("gbk");
		reader.push(0, "YQ==");
		reader.finish(1);
		const report = new OutputDecodeAccumulator();
		report.complete(reader.decoder);
		report.unknown();
		expect(report.result()).toEqual({
			outputEncoding: undefined,
			outputReplacements: undefined,
			outputEncodings: ["gbk"],
			outputEncodingUnknownReaders: 1,
		});
	});

	it("reports mixed completed readers without inventing a uniform encoding", () => {
		const report = new OutputDecodeAccumulator();
		for (const encoding of ["gbk", "utf8"] as const) {
			const reader = new RawOutputReader(encoding);
			reader.finish(0);
			report.complete(reader.decoder);
		}
		expect(report.result().outputEncoding).toBeUndefined();
		expect(report.result().outputEncodings).toEqual(["gbk", "utf8"]);
		expect(report.result().outputReplacements).toBe(0);
	});
});
