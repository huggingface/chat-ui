import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
	type MessageToolResultUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { casesFor } from "./mine";

const CONVERSATION_ID = "5f2a9c1b8d3e4a5b6c7d8e90";
const FAILED_JOB_ID = "5f2a9c1b8d3e4a5b6c7d8e91";
const RESUBMITTED_JOB_ID = "5f2a9c1b8d3e4a5b6c7d8e92";

const call = (
	uuid: string,
	name: string,
	args: Record<string, unknown>
): MessageToolCallUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name, parameters: {} },
	argumentsRaw: JSON.stringify(args),
});

const result = (uuid: string, name: string, text: string): MessageToolResultUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: { status: ToolResultStatus.Success, call: { name, parameters: {} }, outputs: [{ text }] },
});

const message = (
	id: string,
	from: Message["from"],
	updates: MessageUpdate[],
	ancestors: string[]
): Message => ({ id, from, content: "", updates, ancestors });

/** a job submit as the tools store it: the script under a nested v-file path with a version tag */
const submit = (uuid: string, script: string, jobId: string): MessageUpdate[] => [
	call(uuid, "hf_jobs", { operation: "uv", args: { operation: "uv", script } }),
	result(uuid, "hf_jobs", `Submitted job ${jobId}, it will start shortly.`),
];

describe("casesFor", () => {
	it("records the nested path of the script a failed job ran", () => {
		const messages: Message[] = [
			message("m-user", "user", [], []),
			message(
				"m-submit",
				"assistant",
				submit("c1", "v-file://baseline/train.py@v1", FAILED_JOB_ID),
				["m-user"]
			),
			message(
				"m-decide",
				"assistant",
				[
					call("c2", "check_job", { job_id: FAILED_JOB_ID, task: "why did it fail" }),
					result("c2", "check_job", "Status: failed\nValueError: invalid shape"),
					...submit("c3", "v-file://candidate/train.py@v2", RESUBMITTED_JOB_ID),
				],
				["m-user", "m-submit"]
			),
		];

		const cases = casesFor(
			{ _id: { $oid: CONVERSATION_ID }, model: "test/model", mlAssistant: true, messages },
			"conversations-2026-11-25.ndjson.gz"
		);

		const failure = cases.find((c) => c.family === "after-job-failure");
		expect(
			failure,
			"the check_job status that failed the job is an after-job-failure case"
		).toBeDefined();
		expect(failure?.context.failedScript).toBe("baseline/train.py");
		// the miner labels the case it stores, so the recorded path is the one the scorer compares
		expect(failure?.observed.label).toBe("different-job");
		expect(failure?.observed.pass).toBeNull();
	});
});
