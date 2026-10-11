import { logger, readLines, Snowflake } from "@oh-my-pi/pi-utils";
import type { Subprocess } from "bun";
import { type KernelDisplayOutput, renderKernelDisplay } from "./py/display";
import type { ShadowBarrier, ShadowControlNode, ShadowOperation } from "./speculation/types";
import { OutputDecodeAccumulator, type OutputDecodeProvenance, RawOutputReader } from "./output-decode";
import { TailBuffer } from "@oh-my-pi/pi-tui/tools/streaming-output";

const STARTUP_CONTROL_TIMEOUT_MS = 5_000;

async function raceControlTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
	const signal = AbortSignal.timeout(timeoutMs);
	const { promise: timeout, reject } = Promise.withResolvers<never>();
	const onAbort = (): void => reject(new Error(reason));
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

export type KernelRuntimeEnv = Record<string, string | null>;

export interface KernelExecuteOptions {
	outputEncoding?: "utf8" | "gbk";
	id?: string;
	/** Source filename for file-backed execution and tracebacks. */
	filename?: string;
	/** Runtime working directory applied immediately before this request executes. */
	cwd?: string;
	/** Managed runtime environment variables applied immediately before this request executes. */
	env?: Record<string, string | undefined> | Record<string, string | null>;
	signal?: AbortSignal;
	onChunk?: (text: string) => Promise<void> | void;
	onDisplay?: (output: KernelDisplayOutput) => Promise<void> | void;
	timeoutMs?: number;
	silent?: boolean;
	storeHistory?: boolean;
	allowStdin?: boolean;
}

export interface KernelExecuteResult extends OutputDecodeProvenance {
	/** Kernel-scope raw output. Request ownership is deliberately not asserted. */
	kernelOutput?: string;
	status: "ok" | "error";
	executionCount?: number;
	error?: { name: string; value: string; traceback: string[] };
	cancelled: boolean;
	timedOut: boolean;
	stdinRequested: boolean;
	/** True when an atomic retained-runtime admission check rejected this execution before user code ran. */
	admissionRejected?: boolean;
	/**
	 * True when the kernel subprocess was killed as part of settling this
	 * execution (e.g. SIGINT was ignored and we escalated to shutdown, or the
	 * kernel died unexpectedly). When false, the kernel remains reusable.
	 */
	kernelKilled?: boolean;
}

export interface KernelShutdownResult {
	confirmed: boolean;
}

export interface KernelShutdownOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** Per-language lifecycle configuration consumed by each kernel's `start()`. */
export interface KernelStartOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	/** Explicit interpreter path; skips discovery when set. */
	interpreter?: string;
	signal?: AbortSignal;
	deadlineMs?: number;
}

/** Per-language configuration handed to {@link BaseKernel} by each subclass. */
export interface BaseKernelOptions<TExecuteOptions extends KernelExecuteOptions = KernelExecuteOptions> {
	/** Human-readable language label used in log messages and errors. */
	languageName: string;
	/** When true, every IPC frame is logged at debug level. */
	traceIpc: boolean;
	/** Wire payload asking the runner to exit cleanly. */
	exitPayload: string;
	/** How long to wait after SIGINT before escalating to subprocess termination. */
	interruptEscalationMs: number;
	/** Default grace period applied by {@link BaseKernel.shutdown}. */
	shutdownGraceMs: number;
	/** Serializes an execution request into the runner's wire protocol. */
	buildPayload: (code: string, msgId: string, options?: TExecuteOptions) => string;
}

export type FrameType =
	| "started"
	| "stdout"
	| "stderr"
	| "display"
	| "result"
	| "error"
	| "done"
	| "raw_start"
	| "raw_chunk"
	| "raw_end"
	| "raw_ack"
	| "raw_abort"
	| "kernel_bytes"
	| "shadow_snapshot"
	| "shadow_plan";

export interface Frame {
	protocol?: number;
	stream?: string;
	seq?: number;
	type: FrameType;
	id?: string;
	data?: string;
	bundle?: Record<string, unknown>;
	ename?: string;
	evalue?: string;
	traceback?: string[];
	status?: "ok" | "error";
	operations?: ShadowOperation[];
	controls?: ShadowControlNode[];
	barrier?: ShadowBarrier | null;
	executionCount?: number;
	cancelled?: boolean;
	eligible?: boolean;
	reason?: string;
	revision?: number;
	digest?: string;
	admissionRejected?: boolean;
	values?: Record<string, unknown>;
}

interface PendingExecution {
	rawReaders: Map<string, RawOutputReader>;
	rawEndSequences: Map<string, number>;
	rawTerminals: Map<string, "complete" | "failed">;
	decodeReport: OutputDecodeAccumulator;
	resolve: (result: KernelExecuteResult) => void;
	options?: KernelExecuteOptions;
	status: "ok" | "error";
	executionCount?: number;
	error?: { name: string; value: string; traceback: string[] };
	cancelled: boolean;
	timedOut: boolean;
	admissionRejected?: boolean;
	stdinRequested: boolean;
	kernelKilled: boolean;
	settled: boolean;
	escalationTimer?: NodeJS.Timeout;
	finalize?: () => void;
}

export function getRemainingTimeMs(deadlineMs?: number): number | undefined {
	if (deadlineMs === undefined) return undefined;
	return Math.max(0, deadlineMs - Date.now());
}

/**
 * True when `pid` is safe to use as a process-group target for `kill(2)`.
 *
 * `process.kill(-pid, …)` is a group signal, and the degenerate targets are
 * catastrophic rather than merely useless: `-0` signals *our own* process group
 * (omp would kill itself along with the whole terminal job) and `-1` signals
 * every process the user is permitted to signal. Both must be rejected before
 * the negation is applied.
 */
export function isSignalableProcessGroup(pid: number | undefined): pid is number {
	return typeof pid === "number" && Number.isInteger(pid) && pid > 1;
}

/**
 * Signal the whole process group led by `pid`, returning true when a signal was
 * actually delivered.
 *
 * Kernels are spawned with `detached: true` on POSIX (see `shouldDetachKernel`),
 * so each runner calls `setsid()` and becomes the leader of its own session and
 * process group. Signalling only the direct PID therefore leaves anything the
 * runner itself spawned behind, and those orphans keep the kernel's pipes open
 * for the remainder of the omp process lifetime (#7714).
 *
 * Windows has no process groups, so this is a no-op there and callers keep
 * relying on the direct-PID kill.
 */
export function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
	if (process.platform === "win32") return false;
	if (!isSignalableProcessGroup(pid)) return false;
	try {
		process.kill(-pid, signal);
		return true;
	} catch {
		// ESRCH: the group is already gone, which is the outcome we wanted anyway.
		// EPERM: not ours to signal. Neither is worth failing a shutdown over.
		return false;
	}
}

export function createAbortError(name: "AbortError" | "TimeoutError", message: string): Error {
	const err = new Error(message);
	err.name = name;
	return err;
}

export function throwIfAborted(signal: AbortSignal | undefined, fallbackReason: string): void {
	if (!signal?.aborted) return;
	const reason = signal.reason;
	if (reason instanceof Error) throw reason;
	throw createAbortError("AbortError", typeof reason === "string" ? reason : fallbackReason);
}

export function isTimeoutReason(reason: unknown): boolean {
	if (reason instanceof DOMException) return reason.name === "TimeoutError";
	if (reason instanceof Error) return reason.name === "TimeoutError";
	return false;
}

/**
 * Shared subprocess-backed kernel machinery for the language runners. Each
 * language subclasses this, supplying its binary/runner via a static `start()`
 * and its wire protocol via {@link BaseKernelOptions.buildPayload}. The IPC loop
 * speaks NDJSON: the runner emits one JSON {@link Frame} per line; outbound
 * requests are serialized by `buildPayload` (which may itself be NDJSON or any
 * other line-delimited encoding).
 *
 * `TExecuteOptions` is the language's own execute-options type so each runner's
 * `buildPayload` sees its precise option shape (e.g. environment-map variants).
 */
export abstract class BaseKernel<TExecuteOptions extends KernelExecuteOptions = KernelExecuteOptions> {
	readonly id: string;
	#proc: Subprocess | null = null;
	#stdin: Bun.FileSink | null = null;
	#alive = true;
	#disposed = false;
	#shutdownConfirmed = false;
	#shutdownInFlight: Promise<KernelShutdownResult> | null = null;
	#exitedPromise: Promise<number> | null = null;
	#pending = new Map<string, PendingExecution>();
	#pendingControls = new Map<string, PromiseWithResolvers<Frame>>();
	#kernelReader = new RawOutputReader();
	#kernelRawObserved = false;
	#kernelOutput = new TailBuffer(65_536);
	#kernelOutputBytes = 0;
	readonly #options: BaseKernelOptions<TExecuteOptions>;

	constructor(id: string, options: BaseKernelOptions<TExecuteOptions>) {
		this.id = id;
		this.#options = options;
	}

	setProcess(proc: Subprocess<"pipe", "pipe", "pipe">) {
		this.#proc = proc;
		this.#stdin = proc.stdin;
		this.#exitedPromise = proc.exited;
		void this.#exitedPromise.then(code => {
			this.#alive = false;
			this.#abortPendingExecutions(`${this.#options.languageName} kernel exited with code ${code}`, {
				kernelKilled: true,
			});
		});

		this.#startReader(proc.stdout as ReadableStream<Uint8Array>);
		this.#startStderrDrain(proc.stderr as ReadableStream<Uint8Array>);
	}

	isAlive(): boolean {
		return this.#alive && !this.#disposed;
	}

	async execute(code: string, options?: TExecuteOptions): Promise<KernelExecuteResult> {
		const msgId = options?.id ?? Snowflake.next();
		return await this.#submit(msgId, this.#options.buildPayload(code, msgId, options), options, true);
	}

	/** Submit a raw runner request without sending SIGINT when its caller cancels. */
	async submitRequest(msgId: string, payload: string, options?: TExecuteOptions): Promise<KernelExecuteResult> {
		return await this.#submit(msgId, payload, options, false);
	}

	async #submit(
		msgId: string,
		payload: string,
		options: TExecuteOptions | undefined,
		interruptOnCancel: boolean,
	): Promise<KernelExecuteResult> {
		if (!this.isAlive()) {
			throw new Error(`${this.#options.languageName} kernel is not running`);
		}

		const { promise, resolve } = Promise.withResolvers<KernelExecuteResult>();
		const pending: PendingExecution = {
			rawReaders: new Map(),
			rawEndSequences: new Map(),
			rawTerminals: new Map(),
			decodeReport: new OutputDecodeAccumulator(),
			resolve,
			options,
			status: "ok",
			cancelled: false,
			timedOut: false,
			stdinRequested: false,
			settled: false,
			kernelKilled: false,
		};
		this.#pending.set(msgId, pending);

		const finalize = () => {
			if (pending.settled) return;
			pending.settled = true;
			this.#pending.delete(msgId);
			cleanup();
			pending.decodeReport.unknown(pending.rawReaders.size);
			if (this.#kernelRawObserved) pending.decodeReport.unknown();
			const kernelOutput = this.#kernelOutput.text();
			const kernelOutputTruncated = this.#kernelOutputBytes > 65_536;
			this.#kernelOutput = new TailBuffer(65_536);
			this.#kernelOutputBytes = 0;
			resolve({
				...pending.decodeReport.result(),
				kernelOutput: kernelOutput
					? `[kernel-scope output; request ownership unknown${kernelOutputTruncated ? "; tail truncated to 65536 UTF-8 bytes" : ""}]\n${kernelOutput}`
					: undefined,
				status: pending.status,
				executionCount: pending.executionCount,
				error: pending.error,
				cancelled: pending.cancelled,
				timedOut: pending.timedOut,
				stdinRequested: pending.stdinRequested,
				admissionRejected: pending.admissionRejected,
				kernelKilled: pending.kernelKilled,
			});
		};

		let requestWritten = false;
		const requestCancel = () => {
			if (pending.settled || pending.escalationTimer) return;
			if (!requestWritten || !interruptOnCancel) {
				finalize();
				return;
			}
			void this.interrupt();
			const escalation = setTimeout(() => {
				if (pending.settled) return;
				logger.warn(`${this.#options.languageName} runner did not respond to SIGINT; terminating subprocess`, {
					kernelId: this.id,
				});
				pending.kernelKilled = true;
				void this.shutdown();
			}, this.#options.interruptEscalationMs);
			escalation.unref?.();
			pending.escalationTimer = escalation;
		};

		const onAbort = () => {
			pending.cancelled = true;
			pending.timedOut = pending.timedOut || isTimeoutReason(options?.signal?.reason);
			requestCancel();
		};
		const timeoutId =
			typeof options?.timeoutMs === "number" && options.timeoutMs > 0
				? setTimeout(() => {
						pending.timedOut = true;
						pending.cancelled = true;
						requestCancel();
					}, options.timeoutMs)
				: undefined;

		const cleanup = () => {
			clearTimeout(timeoutId);
			clearTimeout(pending.escalationTimer);
			pending.escalationTimer = undefined;
			options?.signal?.removeEventListener("abort", onAbort);
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
				if (options.signal.aborted) {
					options.signal.removeEventListener("abort", onAbort);
					onAbort();
				}
			}
		}

		pending.finalize = finalize;

		if (pending.settled) {
			return promise;
		}

		requestWritten = true;
		const transportFailed = (err: unknown) => {
			if (!pending.settled) {
				pending.status = "error";
				pending.cancelled = true;
				// The kernel is retired below and a partial write may have run code: completion is uncertain.
				pending.kernelKilled = true;
				pending.error = {
					name: "TransportError",
					value: err instanceof Error ? err.message : String(err),
					traceback: [],
				};
				finalize();
			}
			// A broken stdin pipe is terminal even if this request already settled (e.g. aborted first):
			// retire the kernel so the session starts a fresh one.
			void this.shutdown();
		};
		try {
			await this.#writeLine(payload, transportFailed);
		} catch (err) {
			transportFailed(err);
		}

		return promise;
	}
	async requestControl(
		payload: string,
		id = Snowflake.next(),
		timeoutMs = STARTUP_CONTROL_TIMEOUT_MS,
	): Promise<Frame> {
		if (!this.isAlive()) throw new Error(`${this.#options.languageName} kernel is not running`);
		const deferred = Promise.withResolvers<Frame>();
		this.#pendingControls.set(id, deferred);
		try {
			// A broken stdin pipe is terminal: fail this control request and retire the kernel.
			await this.#writeLine(payload, err => {
				deferred.reject(err);
				void this.shutdown();
			});
			return await raceControlTimeout(
				deferred.promise,
				timeoutMs,
				`${this.#options.languageName} control request timed out`,
			);
		} finally {
			this.#pendingControls.delete(id);
		}
	}

	async interrupt(): Promise<void> {
		if (!this.#proc || this.#disposed) return;
		try {
			this.#proc.kill("SIGINT");
		} catch (err) {
			logger.warn(`Failed to interrupt ${this.#options.languageName.toLowerCase()} runner`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Concurrent calls (e.g. several in-flight requests hitting the same broken pipe) share one
	 * shutdown sequence. An unconfirmed shutdown clears the slot so a later call can retry.
	 */
	shutdown(options?: KernelShutdownOptions): Promise<KernelShutdownResult> {
		if (this.#shutdownConfirmed) return Promise.resolve({ confirmed: true });
		this.#shutdownInFlight ??= this.#shutdown(options).finally(() => {
			this.#shutdownInFlight = null;
		});
		return this.#shutdownInFlight;
	}

	async #shutdown(options?: KernelShutdownOptions): Promise<KernelShutdownResult> {
		this.#alive = false;
		this.#abortPendingExecutions(`${this.#options.languageName} kernel shutdown`, { kernelKilled: true });

		const timeoutMs = options?.timeoutMs ?? this.#options.shutdownGraceMs;
		const proc = this.#proc;
		if (!proc) {
			this.#shutdownConfirmed = true;
			this.#disposed = true;
			return { confirmed: true };
		}

		try {
			await this.#writeLine(this.#options.exitPayload).catch(() => {});
		} catch {
			/* writer may already be closed */
		}

		try {
			this.#stdin?.end();
		} catch {
			/* ignore */
		}

		const exited = this.#waitForExitWithTimeout(timeoutMs);
		let result = await exited;
		if (result === null) {
			try {
				proc.kill("SIGTERM");
			} catch {
				/* ignore */
			}
			// The runner leads its own process group (setsid), so the direct-PID
			// signal above never reaches anything it spawned. Sweep the group too.
			killProcessGroup(proc.pid, "SIGTERM");
			result = await this.#waitForExitWithTimeout(timeoutMs);
			if (result === null) {
				try {
					proc.kill("SIGKILL");
				} catch {
					/* ignore */
				}
			}
		}
		// A confirmed leader exit does not prove its descendants exited, even
		// when the runner honored the shutdown request without any signals.
		killProcessGroup(proc.pid, "SIGKILL");
		if (result === null) result = await this.#waitForExitWithTimeout(timeoutMs);

		const confirmed = result !== null;
		if (!confirmed) {
			// Nothing acknowledged the exit. Record the pid so an operator can find
			// the survivor; the group SIGKILL above is our last automatic recourse.
			logger.warn(`${this.#options.languageName} kernel did not confirm exit after SIGKILL`, {
				kernelId: this.id,
				pid: proc.pid,
			});
		}
		this.#shutdownConfirmed = confirmed;
		this.#disposed = true;
		return { confirmed };
	}

	#abortPendingExecutions(reason: string, options?: { kernelKilled?: boolean }): void {
		for (const pending of this.#pendingControls.values()) {
			pending.reject(new Error(reason));
		}
		this.#pendingControls.clear();
		if (this.#pending.size === 0) return;
		const pending = Array.from(this.#pending.values());
		this.#pending.clear();
		const kernelKilledDefault = options?.kernelKilled ?? false;
		for (const entry of pending) {
			if (entry.settled) continue;
			void entry.options?.onChunk?.(`[kernel] ${reason}\n`);
			entry.status = "error";
			entry.cancelled = true;
			entry.kernelKilled ||= kernelKilledDefault;
			entry.finalize?.();
		}
	}

	async #writeLine(line: string, onWriteFailed?: (err: unknown) => void): Promise<void> {
		if (!this.#stdin) {
			throw new Error(`${this.#options.languageName} kernel stdin is not open`);
		}
		if (this.#options.traceIpc) {
			logger.debug(`${this.#options.languageName}Kernel send`, { preview: line.slice(0, 120) });
		}
		// Not awaited: callers' timeouts start after this returns, so a wedged pipe must not block here.
		// A failed write (sync throw or rejection) is reported through onWriteFailed; the kernel may stay
		// alive without an exit event.
		const stdin = this.#stdin;
		const write = Promise.try(() => stdin.write(`${line}\n`));
		void write.catch(() => {});
		void Promise.all([write, Promise.try(() => stdin.flush())]).catch(err => {
			logger.debug(`${this.#options.languageName} kernel stdin write failed`, { error: String(err) });
			onWriteFailed?.(err);
		});
	}

	#startReader(stream: ReadableStream<Uint8Array>): void {
		const decoder = new TextDecoder();
		const loop = async () => {
			try {
				for await (const bytes of readLines(stream)) {
					const line = decoder.decode(bytes);
					if (!line.trim()) continue;
					let frame: Frame;
					try {
						frame = JSON.parse(line) as Frame;
					} catch (err) {
						logger.warn(`${this.#options.languageName} runner emitted invalid JSON`, {
							line: line.slice(0, 200),
							error: err instanceof Error ? err.message : String(err),
						});
						continue;
					}
					if (this.#options.traceIpc) {
						logger.debug(`${this.#options.languageName}Kernel recv`, { type: frame.type, id: frame.id });
					}
					await this.#handleFrame(frame);
				}
			} catch (err) {
				logger.warn(`${this.#options.languageName} kernel reader failed`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};
		void loop();
	}

	#startStderrDrain(stream: ReadableStream<Uint8Array>): void {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		const loop = async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const text = decoder.decode(value);
					if (text.trim()) {
						logger.warn(`${this.#options.languageName} runner stderr`, { text });
					}
				}
			} catch {
				/* ignore */
			} finally {
				try {
					reader.releaseLock();
				} catch {
					/* ignore */
				}
			}
		};
		void loop();
	}

	#writeRawText(frame: Record<string, unknown>): void {
		const stdin = this.#stdin;
		if (!stdin) throw new Error("Raw-output response channel is closed");
		try {
			stdin.write(`${JSON.stringify(frame)}\n`);
			// Keep reading stdout while replies drain: the runner's decoded-text
			// callback also writes stdout. Awaiting flush in that same reader
			// deadlocks duplex pipes. Runner credits bound outstanding replies.
			void raceControlTimeout(Promise.resolve(stdin.flush()), 30_000, "Raw-output response channel stalled").catch(
				() => {
					void this.shutdown();
				},
			);
		} catch (error) {
			void this.shutdown();
			throw error;
		}
	}

	async #handleFrame(frame: Frame): Promise<void> {
		if (frame.type === "kernel_bytes") {
			this.#kernelRawObserved = true;
			try {
				if (frame.protocol !== 1) throw new Error("Invalid kernel output protocol");
				const text = this.#kernelReader.push(frame.seq, frame.data);
				this.#kernelOutput.append(text);
				this.#kernelOutputBytes += Buffer.byteLength(text);
			} catch {
				this.#kernelOutput.append("[kernel raw output unavailable: invalid sequence or payload]\n");
			}
			return;
		}
		const rid = frame.id;
		if (!rid) return;
		const control = this.#pendingControls.get(rid);
		if (control) {
			control.resolve(frame);
			return;
		}
		const pending = this.#pending.get(rid);
		if (!pending) return;

		switch (frame.type) {
			case "raw_start":
			case "raw_chunk":
			case "raw_end":
			case "raw_ack":
			case "raw_abort": {
				const stream = frame.stream ?? "";
				try {
					if (frame.protocol !== 1 || !stream || stream.length > 128)
						throw new Error("Invalid raw-output protocol");
					if (frame.type === "raw_abort") throw new Error("Runner abandoned raw-output delivery");
					if (frame.type === "raw_start") {
						if (
							pending.rawReaders.has(stream) ||
							pending.rawTerminals.has(stream) ||
							pending.rawReaders.size >= 32 ||
							pending.rawTerminals.size >= 1024
						)
							throw new Error("Duplicate or excessive raw-output readers");
						pending.rawReaders.set(stream, new RawOutputReader(pending.options?.outputEncoding));
						return;
					}
					const reader = pending.rawReaders.get(stream);
					if (!reader) throw new Error("Raw-output reader was not started");
					if (frame.type === "raw_ack") {
						if (frame.seq !== pending.rawEndSequences.get(stream) || !pending.rawEndSequences.has(stream))
							throw new Error("Raw-output delivery acknowledged without matching EOF");
						pending.rawReaders.delete(stream);
						pending.rawEndSequences.delete(stream);
						pending.rawTerminals.set(stream, "complete");
						pending.decodeReport.complete(reader.decoder);
						return;
					}
					const done = frame.type === "raw_end";
					const text = done ? reader.finish(frame.seq) : reader.push(frame.seq, frame.data);
					if (done && frame.seq !== undefined) pending.rawEndSequences.set(stream, frame.seq);
					this.#writeRawText({
						type: "raw_text",
						protocol: 1,
						id: rid,
						stream,
						seq: frame.seq,
						data: text,
						done,
					});
				} catch (error) {
					pending.rawReaders.delete(stream);
					pending.rawEndSequences.delete(stream);
					if (pending.rawTerminals.get(stream) !== "failed") pending.decodeReport.unknown();
					if (pending.rawTerminals.size < 1024) pending.rawTerminals.set(stream, "failed");
					if (frame.type === "raw_abort") return;
					this.#writeRawText({
						type: "raw_text",
						protocol: 1,
						id: rid,
						stream,
						done: true,
						error: String(error),
					});
				}
				return;
			}
			case "started":
				return;
			case "stdout":
			case "stderr": {
				const text = frame.data ?? "";
				if (text && pending.options?.onChunk) {
					await pending.options.onChunk(text);
				}
				return;
			}
			case "display":
			case "result": {
				const bundle = frame.bundle ?? {};
				const { text, outputs } = await renderKernelDisplay(bundle);
				if (text && pending.options?.onChunk) {
					await pending.options.onChunk(text);
				}
				if (outputs.length > 0 && pending.options?.onDisplay) {
					for (const output of outputs) {
						await pending.options.onDisplay(output);
					}
				}
				return;
			}
			case "error": {
				const traceback = Array.isArray(frame.traceback) ? frame.traceback.map(String) : [];
				pending.status = "error";
				pending.error = {
					name: String(frame.ename ?? "Error"),
					value: String(frame.evalue ?? ""),
					traceback,
				};
				const message =
					traceback.length > 0 ? `${traceback.join("\n")}\n` : `${pending.error.name}: ${pending.error.value}\n`;
				if (pending.options?.onChunk) {
					await pending.options.onChunk(message);
				}
				return;
			}
			case "done": {
				if (typeof frame.executionCount === "number") {
					pending.executionCount = frame.executionCount;
				}
				if (frame.status === "error" && pending.status === "ok") {
					pending.status = "error";
				}
				if (frame.cancelled) {
					pending.cancelled = true;
				}
				if (frame.admissionRejected) {
					pending.admissionRejected = true;
				}
				pending.finalize?.();
				return;
			}
		}
	}

	async executeWithBudget(
		code: string,
		signal: AbortSignal | undefined,
		timeoutMs: number,
		label: string,
	): Promise<void> {
		const controller = new AbortController();
		const cleanups: Array<() => void> = [];
		if (signal) {
			if (signal.aborted) {
				controller.abort(signal.reason);
			} else {
				const onAbort = () => controller.abort(signal.reason);
				signal.addEventListener("abort", onAbort, { once: true });
				cleanups.push(() => signal.removeEventListener("abort", onAbort));
			}
		}
		const timer =
			timeoutMs > 0
				? setTimeout(() => controller.abort(createAbortError("TimeoutError", `${label} timed out`)), timeoutMs)
				: undefined;
		if (timer) cleanups.push(() => clearTimeout(timer));
		try {
			throwIfAborted(controller.signal, label);
			const result = await this.execute(code, {
				signal: controller.signal,
				silent: true,
				storeHistory: false,
			} as TExecuteOptions);
			if (result.cancelled) {
				throw createAbortError(result.timedOut ? "TimeoutError" : "AbortError", `${label} cancelled`);
			}
			if (result.status === "error") {
				const reason = result.error?.value ?? `${this.#options.languageName} kernel init failed`;
				throw new Error(`${label} failed: ${reason}`);
			}
		} finally {
			for (const cleanup of cleanups) cleanup();
		}
	}

	#waitForExitWithTimeout(timeoutMs: number): Promise<number | null> {
		if (!this.#exitedPromise) return Promise.resolve(0);
		const exitedPromise = this.#exitedPromise;
		const timeout = new Promise<null>(resolve => {
			const timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
			timer.unref?.();
		});
		return Promise.race([exitedPromise.then(code => code as number | null), timeout]);
	}
}
