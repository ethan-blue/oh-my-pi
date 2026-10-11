import * as path from "node:path";
import { buildSystemPrompt } from "../../src/system-prompt";
import { buildSystemPrompt as buildSdkSystemPrompt, createAgentSession } from "../../src/sdk";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import {
	APP_NAME,
	DISTRIBUTION_VERSION,
	getAgentDir,
	getConfigRootDir,
	getHistoryDbPath,
	getAgentDbPath,
	getSessionsDir,
} from "@oh-my-pi/pi-utils";

const outputs = [];
for (const variant of [
	{},
	{ customPrompt: "Custom instructions" },
	{ systemPromptTemplate: "Custom template" },
	{ subagent: true },
]) {
	const result = await buildSystemPrompt({
		cwd: process.cwd(),
		contextFiles: [],
		skills: [],
		rules: [],
		toolNames: [],
		workspaceTree: { rootPath: process.cwd(), rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
		...variant,
	});
	outputs.push(result.systemPrompt.join("\n"));
}
const sdkAgentDir = process.argv[2];
const sdkOutputs = [];
if (sdkAgentDir) {
	const built = await buildSdkSystemPrompt({
		cwd: process.cwd(),
		agentDir: sdkAgentDir,
		customPrompt: "SDK prompt",
		skills: [],
		contextFiles: [],
		tools: [],
	});
	sdkOutputs.push(built.systemPrompt.join("\n"));
	const authStorage = await AuthStorage.create(":memory:");
	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentDir: sdkAgentDir,
		authStorage,
		modelRegistry: new ModelRegistry(authStorage, path.join(sdkAgentDir, "models.yml")),
		settings: Settings.isolated({ "compaction.enabled": false }),
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: getBundledModel("openai", "gpt-4o-mini"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
	});
	try {
		sdkOutputs.push(session.systemPrompt.join("\n"));
		await session.newSession();
		sdkOutputs.push(session.systemPrompt.join("\n"));
	} finally {
		await session.dispose();
		authStorage.close();
	}
}
process.stdout.write(
	JSON.stringify({
		outputs,
		sdkOutputs,
		name: APP_NAME,
		version: DISTRIBUTION_VERSION,
		paths: [getAgentDir(), getConfigRootDir(), getHistoryDbPath(), getAgentDbPath(), getSessionsDir()],
		sdkPaths: sdkAgentDir
			? [
					sdkAgentDir,
					getConfigRootDir(),
					getHistoryDbPath(sdkAgentDir),
					getAgentDbPath(sdkAgentDir),
					getSessionsDir(sdkAgentDir),
				]
			: [],
	}),
);
