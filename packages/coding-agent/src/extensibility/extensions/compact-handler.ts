/**
 * Helper for wiring the `compact` action of an {@link ExtensionContext}.
 *
 * Extension-facing APIs accept `string | CompactOptions`, but `AgentSession.compact`
 * takes two positional arguments `(instructions, options)`. This helper splits the
 * union so the same adapter can be reused by print-mode, rpc-mode, and the executor.
 */
import type { Model } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import type { ModelRegistry } from "../../config/model-registry";
import type { Settings } from "../../config/settings";
import { createExtensionModelQuery } from "./model-api";
import type { CompactOptions } from "./types";

interface CompactableSession {
	compact(instructions?: string, options?: CompactOptions): Promise<unknown>;
}

export async function runExtensionCompact(
	session: CompactableSession,
	instructionsOrOptions: string | CompactOptions | undefined,
): Promise<void> {
	const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
	const options =
		instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
	await session.compact(instructions, options);
}

interface SetModelCapableSession {
	modelRegistry: ModelRegistry;
	settings?: Settings;
	setModel(model: Model): Promise<unknown>;
}

/**
 * Helper for wiring the `setModel` action of an {@link ExtensionContext}.
 *
 * Returns false when no API key is available for the requested model.
 */
export async function runExtensionSetModel(session: SetModelCapableSession, input: Model | string): Promise<boolean> {
	if (typeof input === "string" && !input.trim()) {
		logger.warn("Extension setModel rejected an empty selector");
		return false;
	}
	const model =
		typeof input === "string"
			? createExtensionModelQuery(session.modelRegistry, session.settings, () => undefined).resolve(input)
			: input;
	if (
		!model ||
		typeof model !== "object" ||
		typeof model.id !== "string" ||
		!model.id.trim() ||
		typeof model.provider !== "string" ||
		!model.provider.trim() ||
		typeof model.api !== "string" ||
		!model.api.trim()
	) {
		logger.warn("Extension setModel rejected an invalid or unresolved model");
		return false;
	}
	const key = await session.modelRegistry.getApiKey(model);
	if (!key) {
		logger.warn("Extension setModel rejected a model without available credentials");
		return false;
	}
	await session.setModel(model);
	return true;
}
