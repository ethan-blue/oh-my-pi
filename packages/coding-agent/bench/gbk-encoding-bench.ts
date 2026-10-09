/**
 * GBK/UTF-8 encoding-path benchmark (P13).
 *
 * Measures the tool-layer cost of the encoding policy on this machine:
 *   A. utf8-baseline  — no `.omp/encoding.json` anywhere (upstream behavior).
 *   B. utf8-policy    — policy present but its include globs miss every file.
 *   C. gbk-managed    — files decode/encode as GBK.
 *
 * Workloads: whole-file read (snapshot path), one-line edit (replace mode),
 * native grep over a 50-file directory. 5 warmup + 40 measured iterations;
 * reports p50/p95/min in milliseconds, peak RSS per mode, and the raw
 * per-iteration samples (reproducibility evidence). Run:
 *   bun packages/coding-agent/bench/gbk-encoding-bench.ts
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { grep } from "@oh-my-pi/pi-natives";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function createSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => path.join(cwd, "session.jsonl"),
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(cwd, "artifacts"),
		allocateOutputArtifact: async () => ({ id: "a", path: path.join(cwd, "a.log") }),
		settings: Settings.isolated(),
		enableLsp: false,
	};
}

const LINE = "// 这是一个用于基准测试的行 padding padding padding padding padding\n";
const LINE_COUNT = 800;

function gbkLineBytes(): Uint8Array {
	const map: Record<string, number[]> = {
		这: [0xd5, 0xe2],
		是: [0xca, 0xc7],
		一: [0xd2, 0xbb],
		个: [0xb8, 0xf6],
		用: [0xd3, 0xc3],
		于: [0xd3, 0xda],
		基: [0xbb, 0xf9],
		准: [0xd7, 0xbc],
		测: [0xb2, 0xe2],
		试: [0xca, 0xd4],
		的: [0xb5, 0xc4],
		行: [0xd0, 0xd0],
	};
	const out: number[] = [];
	for (const ch of LINE) {
		if (ch.codePointAt(0)! < 0x80) out.push(ch.charCodeAt(0));
		else {
			const seq = map[ch];
			if (!seq) throw new Error(`no map ${ch}`);
			out.push(...seq);
		}
	}
	return Uint8Array.from(out);
}

const POLICY_PRESENT_UNMATCHED = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["legacy/**/*.c"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

const POLICY_GBK = JSON.stringify({
	schemaVersion: 1,
	enabled: true,
	include: ["src/**"],
	defaultEncoding: "gbk",
	newFileEncoding: "gbk",
	overrides: [],
});

interface Mode {
	name: string;
	policy: string | undefined;
	writeGbk: boolean;
}

const MODES: Mode[] = [
	{ name: "utf8-baseline", policy: undefined, writeGbk: false },
	{ name: "utf8-policy-unmatched", policy: POLICY_PRESENT_UNMATCHED, writeGbk: false },
	{ name: "gbk-managed", policy: POLICY_GBK, writeGbk: true },
];

const WARMUP = 5;
const ITERATIONS = 40;

function percentile(sorted: number[], p: number): number {
	const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[index]!;
}

async function runMode(mode: Mode) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `gbk-bench-${mode.name}-`));
	await fs.mkdir(path.join(root, "src"), { recursive: true });
	await fs.mkdir(path.join(root, "grepdir"), { recursive: true });
	if (mode.policy !== undefined) {
		await fs.mkdir(path.join(root, ".omp"), { recursive: true });
		await fs.writeFile(path.join(root, ".omp", "encoding.json"), mode.policy, "utf8");
	}
	const mainFile = path.join(root, "src", "bench.txt");
	const body = LINE.repeat(LINE_COUNT);
	if (mode.writeGbk) {
		const oneLine = gbkLineBytes();
		const chunk = Buffer.from(oneLine);
		const parts = Array.from({ length: LINE_COUNT }, () => chunk);
		await Bun.write(mainFile, Buffer.concat(parts));
	} else {
		await Bun.write(mainFile, body);
	}
	for (let i = 0; i < 50; i++) {
		const file = path.join(root, "grepdir", `f${i}.txt`);
		if (mode.writeGbk) {
			const oneLine = gbkLineBytes();
			await Bun.write(file, Buffer.concat(Array.from({ length: 60 }, () => Buffer.from(oneLine))));
		} else {
			await Bun.write(file, LINE.repeat(60));
		}
	}

	const session = createSession(root);
	const read = new ReadTool(session);
	const edit = new EditTool(session, "replace");

	const readSamples: number[] = [];
	const editSamples: number[] = [];
	const grepSamples: number[] = [];
	// Peak RSS observed across this mode's loop (sampled after every
	// workload so allocations retained by the tool paths are visible).
	let peakRssBytes = 0;
	const sampleRss = () => {
		peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
	};

	for (let i = 0; i < WARMUP + ITERATIONS; i++) {
		// read: whole file (snapshot path)
		let start = performance.now();
		await read.execute(`r-${i}`, { path: mainFile });
		if (i >= WARMUP) readSamples.push(performance.now() - start);
		sampleRss();

		// edit: flip a marker line back and forth (real write each time)
		const from = i % 2 === 0 ? "padding padding padding padding" : "padding padding padding padding padding";
		const to = i % 2 === 0 ? "padding padding padding padding padding" : "padding padding padding padding";
		start = performance.now();
		await edit.execute(`e-${i}`, { path: mainFile, old_string: from, new_string: to });
		if (i >= WARMUP) editSamples.push(performance.now() - start);
		sampleRss();

		// grep: keyword over 50 files
		start = performance.now();
		await grep({ pattern: mode.writeGbk ? "基准" : "padding", path: path.join(root, "grepdir"), maxColumns: 200 });
		if (i >= WARMUP) grepSamples.push(performance.now() - start);
		sampleRss();
	}
	sampleRss();

	await removeWithRetries(root);
	const stats = (samples: number[]) => {
		const sorted = [...samples].sort((a, b) => a - b);
		return {
			p50: Number(percentile(sorted, 50).toFixed(2)),
			p95: Number(percentile(sorted, 95).toFixed(2)),
			min: Number(sorted[0]!.toFixed(2)),
		};
	};
	return {
		mode: mode.name,
		read: stats(readSamples),
		edit: stats(editSamples),
		grep: stats(grepSamples),
		peakRssBytes,
		// Raw per-iteration samples (ms), iteration order — reproducibility
		// evidence for the p50/p95 figures above.
		rawSamples: {
			read: readSamples.map(value => Number(value.toFixed(3))),
			edit: editSamples.map(value => Number(value.toFixed(3))),
			grep: grepSamples.map(value => Number(value.toFixed(3))),
		},
	};
}

await Settings.init({ inMemory: true });
const results = [];
for (const mode of MODES) {
	results.push(await runMode(mode));
}
console.log(
	JSON.stringify(
		{ timestamp: new Date().toISOString(), bun: Bun.version, warmup: WARMUP, iterations: ITERATIONS, results },
		null,
		2,
	),
);
