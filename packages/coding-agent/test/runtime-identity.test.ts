import { expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";

test.each(["", "review-profile"])(
	"prompt modes and SDK sessions report resolved paths for profile '%s' rather than another installation",
	async profile => {
		using temp = TempDir.createSync("@ompg-identity-");
		const agentDir = temp.join("custom-agent");
		const sdkAgentDir = temp.join("sdk-agent");
		const configRoot = temp.join("custom-root");
		const originalDb = temp.join(".omp", "agent", "history.db");
		await Bun.write(originalDb, "OTHER INSTALLATION DATA MUST NOT BE INJECTED");
		const child = Bun.spawn(
			[process.execPath, path.join(import.meta.dir, "fixtures/runtime-identity.ts"), sdkAgentDir],
			{
				cwd: temp.path(),
				env: {
					...process.env,
					PI_CONFIG_DIR: path.relative(os.homedir(), configRoot),
					PI_CODING_AGENT_DIR: agentDir,
					OMP_PROFILE: profile,
					PI_PROFILE: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code, stderr).toBe(0);
		const result = JSON.parse(stdout) as {
			outputs: string[];
			sdkOutputs: string[];
			name: string;
			version: string;
			paths: string[];
			sdkPaths: string[];
		};
		const expectedRoot = profile ? path.join(configRoot, "profiles", profile) : configRoot;
		expect(result.paths[0]).toBe(profile ? path.join(expectedRoot, "agent") : agentDir);
		expect(result.paths[1]).toBe(expectedRoot);
		for (const output of result.outputs) {
			expect(output).toContain(`Application: ${result.name}`);
			expect(output).toContain(`Distribution version: ${result.version}`);
			for (const resolved of result.paths) expect(output).toContain(path.resolve(resolved));
			expect(output).not.toContain(originalDb);
			expect(output).not.toContain("OTHER INSTALLATION DATA");
		}
		for (const output of result.sdkOutputs) {
			for (const resolved of result.sdkPaths) expect(output).toContain(path.resolve(resolved));
			expect(output).not.toContain(agentDir);
			expect(output).not.toContain(originalDb);
			expect(output).not.toContain("OTHER INSTALLATION DATA");
		}
	},
);
