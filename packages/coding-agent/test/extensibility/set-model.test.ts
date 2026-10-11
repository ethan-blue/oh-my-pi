import { afterEach, expect, test, vi } from "bun:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { logger } from "@oh-my-pi/pi-utils";
import type { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { runExtensionSetModel } from "../../src/extensibility/extensions/compact-handler";

afterEach(() => vi.restoreAllMocks());

test("selectors and roles switch through the resolver, objects remain compatible, and failures preserve the active model", async () => {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Missing bundled test model");
	let active: Model | undefined;
	const getActive = (): Model | undefined => active;
	let credential: string | undefined = "secret-not-for-logs";
	const keyLookup = vi.fn(async () => credential);
	const warnings = vi.spyOn(logger, "warn").mockImplementation(() => {});
	const session = {
		modelRegistry: { getAvailable: () => [model], getApiKey: keyLookup } as unknown as ModelRegistry,
		settings: Settings.isolated({ modelRoles: { slow: `${model.provider}/${model.id}` } }),
		setModel: async (next: Model) => {
			active = next;
		},
	};
	for (const input of [`${model.provider}/${model.id}`, "@slow", model]) {
		active = undefined;
		expect(await runExtensionSetModel(session, input)).toBe(true);
		expect(getActive()).toBe(model);
	}
	const callsBeforeInvalid = keyLookup.mock.calls.length;
	for (const input of [
		"",
		"  ",
		"no-such-model-secret",
		null,
		42,
		{},
		{ ...model, id: "" },
		{ ...model, provider: " " },
		{ ...model, api: "" },
	]) {
		expect(await runExtensionSetModel(session, input as Model)).toBe(false);
		expect(active).toBe(model);
	}
	expect(keyLookup.mock.calls.length).toBe(callsBeforeInvalid);
	credential = undefined;
	expect(await runExtensionSetModel(session, model)).toBe(false);
	expect(active).toBe(model);
	expect(warnings.mock.calls.length).toBe(10);
	expect(JSON.stringify(warnings.mock.calls)).not.toContain("secret");
});
