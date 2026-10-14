import { describe, expect, it } from "bun:test";
import { convertMessages } from "@oh-my-pi/pi-ai/providers/google-shared";
import type { Context, Model, ToolCall, Usage } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";

// Regression for #9638 and #10602. A Gemini 3 parallel turn carries a thought
// signature only on the first call, while cross-model replay can make the first
// call unsigned. Cloud Code Assist accepts unsigned secondary calls after a
// signed first call, but requires the bypass sentinel when the first call itself
// is unsigned. The public Gemini API requires a signature on every call; Vertex
// rejects the sentinel.
//
// The contract therefore splits by transport:
//   - public Gemini API: substitute the sentinel for every unsigned call.
//   - CCA/Antigravity: substitute it only when the first call is unsigned.
//   - Vertex: omit `thoughtSignature` on unsigned calls.

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const VALID_SIGNATURE = "QUJDRA==";
const SENTINEL = "skip_thought_signature_validator";

type GoogleApi = "google-generative-ai" | "google-gemini-cli" | "google-vertex";

function buildGeminiModel(api: GoogleApi, provider: string, id: string): Model<GoogleApi> {
	return buildModel({
		id,
		name: id,
		api,
		provider,
		baseUrl: "https://example.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65536,
	});
}

function assistantTurn(api: GoogleApi, provider: string, id: string, content: ToolCall[]): Context {
	return {
		messages: [
			{ role: "user", content: "Optimize the code", timestamp: 1000 },
			{
				role: "assistant",
				provider,
				api,
				model: id,
				content,
				usage: ZERO_USAGE,
				stopReason: "toolUse",
				timestamp: 2000,
			},
		],
	};
}

/** One assistant turn with three parallel tool calls; only the first is signed. */
function parallelToolCalls(api: GoogleApi, provider: string, id: string): Context {
	return assistantTurn(api, provider, id, [
		{ type: "toolCall", id: "call_1", name: "todo", arguments: { op: "init" }, thoughtSignature: VALID_SIGNATURE },
		{ type: "toolCall", id: "call_2", name: "grep", arguments: { pattern: "helperExec" } },
		{ type: "toolCall", id: "call_3", name: "grep", arguments: { pattern: "shift" } },
	]);
}

/** One assistant turn whose sole tool call has no signature (cross-model replay / redacted args). */
function unsignedFirstCall(api: GoogleApi, provider: string, id: string): Context {
	return assistantTurn(api, provider, id, [
		{ type: "toolCall", id: "call_1", name: "grep", arguments: { pattern: "shift" } },
	]);
}

function toolCallParts(model: Model<GoogleApi>, context: Context) {
	const contents = convertMessages(model, context);
	return contents.find(c => c.role === "model")?.parts?.filter(part => part.functionCall) ?? [];
}

describe("Gemini 3 unsigned tool-call signatures (#9638, #10602)", () => {
	it("applies the Cloud Code Assist signature contract to a custom provider alias after fallback", () => {
		const model = buildGeminiModel("google-gemini-cli", "my-cca", "gemini-3.8-flash");
		const context = unsignedFirstCall("google-gemini-cli", "my-cca", model.id);
		const prior = context.messages[1];
		if (prior.role !== "assistant") throw new Error("Expected assistant fixture");
		prior.api = "openai-completions";
		prior.provider = "zhipu";
		prior.model = "glm-5.3";
		expect(toolCallParts(model, context)[0]?.thoughtSignature).toBe(SENTINEL);
		const signed = toolCallParts(model, parallelToolCalls(model.api, model.provider, model.id));
		expect(signed[0]?.thoughtSignature).toBe(VALID_SIGNATURE);
		expect(signed[1]?.thoughtSignature).toBeUndefined();
	});

	it("does not replay an interrupted unsigned call or orphan its result in the next Gemini request", () => {
		const model = buildGeminiModel("google-gemini-cli", "google-antigravity", "gemini-3.8-flash");
		const context = unsignedFirstCall(model.api, model.provider, model.id);
		const interrupted = context.messages[1];
		if (interrupted.role !== "assistant") throw new Error("Expected assistant fixture");
		interrupted.stopReason = "aborted";
		context.messages.push({
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "grep",
			content: [{ type: "text", text: "previous partial scan found main.c" }],
			isError: false,
			timestamp: 3000,
		});
		context.messages.push({ role: "user", content: "Continue safely", timestamp: 4000 });
		const stored = JSON.stringify(context);
		const parts = convertMessages(model, context).flatMap(content => content.parts ?? []);
		expect(parts.some(part => part.functionCall || part.functionResponse)).toBe(false);
		expect(parts.some(part => part.text === "previous partial scan found main.c")).toBe(true);
		expect(JSON.stringify(context)).toBe(stored);
	});

	it("preserves signed-first parallel calls after interruption without inventing sibling signatures", () => {
		const model = buildGeminiModel("google-gemini-cli", "google-antigravity", "gemini-3.8-flash");
		const context = parallelToolCalls(model.api, model.provider, model.id);
		const interrupted = context.messages[1];
		if (interrupted.role !== "assistant") throw new Error("Expected assistant fixture");
		interrupted.stopReason = "error";
		const calls = toolCallParts(model, context);
		expect(calls).toHaveLength(3);
		expect(calls[0].thoughtSignature).toBe(VALID_SIGNATURE);
		expect(calls[1].thoughtSignature).toBeUndefined();
	});

	it("uses the sentinel only for an unsigned first call on Cloud Code Assist", () => {
		for (const provider of ["google-antigravity", "google-gemini-cli"]) {
			const model = buildGeminiModel("google-gemini-cli", provider, "gemini-3.7-flash");

			const parallel = parallelToolCalls("google-gemini-cli", provider, "gemini-3.7-flash");
			const parallelCalls = toolCallParts(model, parallel);
			expect(parallelCalls).toHaveLength(3);
			expect(parallelCalls[0]?.thoughtSignature).toBe(VALID_SIGNATURE);
			expect(parallelCalls[1]?.thoughtSignature).toBeUndefined();
			expect(parallelCalls[2]?.thoughtSignature).toBeUndefined();

			const unsigned = unsignedFirstCall("google-gemini-cli", provider, "gemini-3.7-flash");
			expect(toolCallParts(model, unsigned)[0]?.thoughtSignature).toBe(SENTINEL);
		}
	});

	it("carries the first-call bypass policy on the bundled CCA catalog entry", () => {
		// The runtime consumes models.json rows verbatim, so the baked compat — not
		// the KDL — is what actually reaches convertMessages for a selected model.
		const model = getBundledModel<"google-gemini-cli">("google-antigravity", "gemini-3.7-flash");
		expect(model.compat.requiresSkipThoughtSignatureOnFirstFunctionCall).toBe(true);

		const unsigned = unsignedFirstCall("google-gemini-cli", "google-antigravity", "gemini-3.7-flash");
		expect(toolCallParts(model as Model<GoogleApi>, unsigned)[0]?.thoughtSignature).toBe(SENTINEL);
	});

	it("omits unsigned signatures and never emits the sentinel on Vertex", () => {
		const model = buildGeminiModel("google-vertex", "google-vertex", "gemini-3-flash");
		const unsigned = unsignedFirstCall("google-vertex", "google-vertex", "gemini-3-flash");
		const calls = toolCallParts(model, unsigned);

		expect(calls[0]?.thoughtSignature).toBeUndefined();
		expect(JSON.stringify(convertMessages(model, unsigned))).not.toContain(SENTINEL);
	});

	it("keeps the sentinel bypass for unsigned calls on the public Gemini API", () => {
		const model = buildGeminiModel("google-generative-ai", "google", "gemini-3-flash");

		// An unsigned first call (cross-model replay / redacted args) must carry the
		// sentinel — the public endpoint 400s on a missing signature.
		const unsigned = unsignedFirstCall("google-generative-ai", "google", "gemini-3-flash");
		expect(toolCallParts(model, unsigned)[0]?.thoughtSignature).toBe(SENTINEL);

		// Parallel: the real signature is kept, the unsigned siblings get the sentinel.
		const parallelCalls = toolCallParts(model, parallelToolCalls("google-generative-ai", "google", "gemini-3-flash"));
		expect(parallelCalls[0]?.thoughtSignature).toBe(VALID_SIGNATURE);
		expect(parallelCalls[1]?.thoughtSignature).toBe(SENTINEL);
		expect(parallelCalls[2]?.thoughtSignature).toBe(SENTINEL);
	});

	it("uses the public Gemini bypass for custom google-generative-ai providers", () => {
		const model = buildGeminiModel("google-generative-ai", "build", "gemini-3.7-flash");
		const unsigned = unsignedFirstCall("google-generative-ai", "build", "gemini-3.7-flash");

		expect(model.identity.class).toBe("gemini");
		expect(toolCallParts(model, unsigned)[0]?.thoughtSignature).toBe(SENTINEL);
	});
});
