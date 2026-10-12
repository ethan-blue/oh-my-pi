/**
 * Inspect and initialize project text encoding policies.
 */

import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { encodingHelp as commandHelp } from "../cli/command-help";
import { runEncodingDoctorCommand, runEncodingInitCommand } from "../cli/encoding-cli";

const ACTIONS = ["doctor", "init"] as const;
type EncodingAction = (typeof ACTIONS)[number];

export default class Encoding extends Command {
	static description = commandHelp.description;
	static args = {
		action: Args.string({
			description: "Encoding action (doctor | init)",
			required: false,
			options: ACTIONS,
		}),
		target: Args.string({
			description: "Target file or project path",
			required: false,
		}),
	};

	static flags = {
		json: Flags.boolean({ description: "Output JSON" }),
		path: Flags.string({ description: "Project root path (for init/doctor)" }),
		profile: Flags.string({ description: "Encoding profile for init (default: gbk-source)" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Encoding);
		const action = (args.action ?? "doctor") as EncodingAction;

		if (action === "init") {
			await runEncodingInitCommand({
				path: flags.path ?? args.target,
				profile: flags.profile,
				flags: { json: flags.json },
			});
			return;
		}

		await runEncodingDoctorCommand(flags.path ?? args.target, { json: flags.json });
	}
}
