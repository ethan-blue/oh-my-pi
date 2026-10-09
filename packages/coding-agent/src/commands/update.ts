/**
 * Check for and install updates.
 */

import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { DISTRIBUTION_REPO } from "@oh-my-pi/pi-utils/dirs";
import { updateHelp as commandHelp } from "../cli/command-help";
import * as pluginCli from "../cli/plugin-cli";
import * as updateCli from "../cli/update-cli";
import { CliUsageError } from "../cli/usage-error";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

export default class Update extends Command {
	static description = commandHelp.description;
	static flags = {
		force: Flags.boolean({ char: "f", description: "Force update", default: false }),
		check: Flags.boolean({ char: "c", description: "Check for updates without installing", default: false }),
		plugins: Flags.boolean({ char: "l", description: "Update installed plugins", default: false }),
		canary: Flags.boolean({ description: "Switch to the canary channel and update", default: false }),
		stable: Flags.boolean({ description: "Switch back to the stable channel", default: false }),
	};

	static examples = [
		"omp update",
		"omp update --check",
		"omp update --canary",
		"# If GitHub rate-limits release metadata, set GITHUB_TOKEN or GH_TOKEN\n  GITHUB_TOKEN=... omp update",
	];

	async run(): Promise<void> {
		const { flags } = await this.parse(Update);
		await initTheme();
		if (flags.canary && flags.stable) throw new CliUsageError("--canary and --stable are mutually exclusive");
		if (flags.plugins) {
			await pluginCli.runPluginCommand({ action: "upgrade", args: [], flags: {} });
		} else {
			// ompg (fork) build: every automatic update channel installs the
			// UPSTREAM package and would silently replace this fork. Disable
			// self-update at the CLI surface and hand out manual steps; the
			// plugin updater below is unaffected (it is registry-agnostic).
			if (updateCli.FORK_DISTRIBUTION) {
				console.log(
					`Self-update is disabled in ompg (fork build).\n` +
						`Download the latest release from https://github.com/${DISTRIBUTION_REPO}/releases\n` +
						`(archive: ompg-<version>-windows-x64.zip, verify SHA256SUMS.txt),\n` +
						`then run install-ompg.ps1 from the archive. Re-run \`ompg --version\` after installing.`,
				);
				if (!flags.check) process.exitCode = 1;
				return;
			}
			await updateCli.runUpdateCommand({
				force: flags.force,
				check: flags.check,
				channel: flags.canary ? "canary" : flags.stable ? "stable" : undefined,
			});
		}
	}
}
