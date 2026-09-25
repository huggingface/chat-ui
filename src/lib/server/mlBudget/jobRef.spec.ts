import { describe, it, expect } from "vitest";
import { isHelpReply, jobRefFromStructured, jobRefFromText } from "./jobRef";

const JOB_ID = "0123456789abcdef01234567";
const SANDBOX_JOB_ID = "abcdefabcdefabcdefabcdef";

const jobResult = (job: unknown) => ({
	operation: "uv",
	outcome: { kind: "job", job, logs: ["..."], logs_finished: false, logs_truncated: false },
	total_results: 1,
	results_shared: 1,
});

const JOB = {
	id: JOB_ID,
	url: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
	flavor: "a10g-small",
	status: { stage: "SCHEDULING", message: null },
	owner: { id: "u1", name: "testuser", type: "user" },
	timeout_seconds: 1800,
};

const SANDBOX = {
	op: "create",
	handle: `hfsb2:testuser:${SANDBOX_JOB_ID}`,
	name: "smoke",
	namespace: "testuser",
	job_id: SANDBOX_JOB_ID,
	url: `https://${SANDBOX_JOB_ID}--49983.hf.jobs`,
	job_url: `https://huggingface.co/jobs/testuser/${SANDBOX_JOB_ID}`,
	volumes: [],
};

const HELP = {
	operation: "uv",
	outcome: {
		kind: "help",
		operation: "uv",
		reason: "requested",
		instructions: "# Command help: uv ...",
	},
	total_results: 0,
	results_shared: 0,
};

describe("jobRefFromStructured", () => {
	it("reads a job's id and owner", () => {
		expect(jobRefFromStructured("job", jobResult(JOB))).toEqual({
			jobId: JOB_ID,
			namespace: "testuser",
		});
	});

	it("reads a sandbox's job id and namespace", () => {
		expect(jobRefFromStructured("sandbox", SANDBOX)).toEqual({
			jobId: SANDBOX_JOB_ID,
			namespace: "testuser",
		});
	});

	it("reads each kind only from where that kind keeps it", () => {
		expect(jobRefFromStructured("sandbox", jobResult(JOB))).toBeUndefined();
		expect(jobRefFromStructured("job", SANDBOX)).toBeUndefined();
	});

	it("finds no job in a help reply", () => {
		expect(jobRefFromStructured("job", HELP)).toBeUndefined();
	});

	it.each([
		["undefined", undefined],
		["null", null],
		["a string", `{"outcome":{"job":{"id":"${JOB_ID}"}}}`],
		["an array", [jobResult(JOB)]],
		["an outcome that is not an object", { outcome: "job" }],
		["a job that is not an object", jobResult(JOB_ID)],
		["a missing id", jobResult({ owner: { name: "testuser" } })],
		["a numeric id", jobResult({ ...JOB, id: 42 })],
		["an uppercase id", jobResult({ ...JOB, id: JOB_ID.toUpperCase() })],
		["a short id", jobResult({ ...JOB, id: JOB_ID.slice(1) })],
		["an id with a suffix", jobResult({ ...JOB, id: `${JOB_ID}0` })],
		["an id with a trailing newline", jobResult({ ...JOB, id: `${JOB_ID}\n` })],
		["an id inside a path", jobResult({ ...JOB, id: `../${JOB_ID}` })],
	])("trusts nothing from %s", (_label, structured) => {
		expect(jobRefFromStructured("job", structured)).toBeUndefined();
	});

	it.each([
		["a bad sandbox id", { ...SANDBOX, job_id: "not-an-id" }],
		["a missing sandbox id", { ...SANDBOX, job_id: undefined }],
	])("trusts nothing from %s", (_label, structured) => {
		expect(jobRefFromStructured("sandbox", structured)).toBeUndefined();
	});

	it.each([
		["a missing owner", { ...JOB, owner: undefined }],
		["a numeric owner name", { ...JOB, owner: { name: 7 } }],
		["an owner name that is a path", { ...JOB, owner: { name: "../../api/whoami" } }],
		["an empty owner name", { ...JOB, owner: { name: "" } }],
	])("keeps the id but drops the namespace given %s", (_label, job) => {
		expect(jobRefFromStructured("job", jobResult(job))).toEqual({ jobId: JOB_ID });
	});
});

describe("isHelpReply", () => {
	it("recognizes a usage-help outcome", () => {
		expect(isHelpReply(HELP)).toBe(true);
	});

	it.each([
		["a real submission", jobResult(JOB)],
		["a sandbox create", SANDBOX],
		["nothing", undefined],
		["a string that says help", "help"],
		["help one level too high", { kind: "help" }],
	])("does not mistake %s for one", (_label, structured) => {
		expect(isHelpReply(structured)).toBe(false);
	});
});

describe("jobRefFromText", () => {
	it("prefers a job URL, then a sandbox handle, then a bare id", () => {
		expect(jobRefFromText(`see https://huggingface.co/jobs/my-org/${JOB_ID}`, "fallback")).toEqual({
			jobId: JOB_ID,
			namespace: "my-org",
		});
		expect(jobRefFromText(`Handle: hfsb2:my-org:${SANDBOX_JOB_ID}`, "fallback")).toEqual({
			jobId: SANDBOX_JOB_ID,
			namespace: "my-org",
		});
		expect(jobRefFromText(`Job started: ${JOB_ID}`, "fallback")).toEqual({
			jobId: JOB_ID,
			namespace: "fallback",
		});
	});

	it("finds nothing in text without an id", () => {
		expect(jobRefFromText("# Command help: uv ...")).toBeUndefined();
	});
});
