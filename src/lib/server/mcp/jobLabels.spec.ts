import { describe, expect, it } from "vitest";
import { composeRewrites } from "$lib/server/textGeneration/mcp/toolArgs";
import { createHubBillingRewrite } from "./hubBilling";
import { createJobLabelRewrite, JOB_NAME_PREFIX, SESSION_LABEL_KEY } from "./jobLabels";

const HF_URL = "https://hf.co/mcp?login";
const SESSION = "3f9a0c1e7b2d4a68";
const OWN_JOB = "0123456789abcdef01234567";
const OTHER_JOB = "fedcbafedcbafedcbafedcba";

function makeRewrite(ownJobs = new Map<string, string | undefined>()) {
	const rewrite = createJobLabelRewrite({ session: SESSION, ownJobs });
	return (tool: string, args: Record<string, unknown>, serverUrl = HF_URL) =>
		rewrite({ serverUrl, tool, args });
}

describe("job label rewrite: submissions", () => {
	it("stamps the session label and prefixes the name on run and uv", () => {
		const apply = makeRewrite();
		for (const operation of ["run", "uv"]) {
			const out = apply("hf_jobs", {
				operation,
				args: { script: "print(1)", name: "sft-qwen-smoke" },
			});
			expect(out).toEqual({
				operation,
				args: {
					script: "print(1)",
					labels: { name: "ml-intern-sft-qwen-smoke", [SESSION_LABEL_KEY]: SESSION },
				},
			});
		}
	});

	it("keeps the model's own labels and a name it put inside them", () => {
		const out = makeRewrite()("hf_jobs", {
			operation: "uv",
			args: { labels: { name: "eval-run", experiment: "lr-sweep", stage: "smoke" } },
		});
		expect((out.args as Record<string, unknown>).labels).toEqual({
			name: "ml-intern-eval-run",
			experiment: "lr-sweep",
			stage: "smoke",
			[SESSION_LABEL_KEY]: SESSION,
		});
	});

	it("sends one name when the model passed name and labels.name", () => {
		const out = makeRewrite()("hf_jobs", {
			operation: "run",
			args: { name: "real-run", labels: { name: "other", dataset: "capybara" } },
		});
		expect(out.args).toEqual({
			labels: { name: "ml-intern-real-run", dataset: "capybara", [SESSION_LABEL_KEY]: SESSION },
		});
	});

	it("replaces a session label the model wrote", () => {
		const out = makeRewrite()("hf_jobs", {
			operation: "run",
			args: { labels: { [SESSION_LABEL_KEY]: "made-up" } },
		});
		expect(out.args).toEqual({ labels: { [SESSION_LABEL_KEY]: SESSION } });
	});

	it("adds no name when the model gave none", () => {
		const out = makeRewrite()("hf_jobs", { operation: "uv" });
		expect(out.args).toEqual({ labels: { [SESSION_LABEL_KEY]: SESSION } });
	});

	it("does not prefix twice and keeps the name within the label limit", () => {
		const apply = makeRewrite();
		const prefixed = apply("hf_jobs", { operation: "run", args: { name: "ml-intern-dpo" } });
		expect((prefixed.args as { labels: Record<string, string> }).labels.name).toBe("ml-intern-dpo");
		const long = apply("hf_jobs", { operation: "run", args: { name: "x".repeat(100) } });
		const name = (long.args as { labels: Record<string, string> }).labels.name;
		expect(name).toHaveLength(100);
		expect(name.startsWith(JOB_NAME_PREFIX)).toBe(true);
	});

	it("leaves arguments the tool's schema will refuse for the preflight", () => {
		const apply = makeRewrite();
		const notObject = { operation: "run", args: "python:3.12" };
		expect(apply("hf_jobs", notObject)).toBe(notObject);
		const badLabels = { operation: "run", args: { labels: ["a"] } };
		expect(apply("hf_jobs", badLabels)).toBe(badLabels);
	});

	it("does not mutate what the model sent", () => {
		const labels = { stage: "smoke" };
		const inner = { name: "a", labels };
		makeRewrite()("hf_jobs", { operation: "run", args: inner });
		expect(inner).toEqual({ name: "a", labels: { stage: "smoke" } });
		expect(labels).toEqual({ stage: "smoke" });
	});
});

describe("job label rewrite: update-labels", () => {
	it("keeps the session label and the name when the model replaces the set", () => {
		const apply = makeRewrite(new Map([[OWN_JOB, "ml-intern-sft-qwen-smoke"]]));
		for (const labels of [{}, { stage: "eval" }]) {
			const out = apply("hf_jobs", {
				operation: "update-labels",
				args: { job_id: OWN_JOB, labels },
			});
			expect(out.args).toEqual({
				job_id: OWN_JOB,
				labels: {
					...labels,
					name: "ml-intern-sft-qwen-smoke",
					[SESSION_LABEL_KEY]: SESSION,
				},
			});
		}
	});

	it("lets the model rename, and folds a top-level name in since the operation drops it", () => {
		const apply = makeRewrite(new Map([[OWN_JOB, "ml-intern-old"]]));
		for (const args of [
			{ job_id: OWN_JOB, labels: { name: "renamed" } },
			{ job_id: OWN_JOB, name: "renamed", labels: {} },
		]) {
			const out = apply("hf_jobs", { operation: "update-labels", args });
			expect(out.args).toEqual({
				job_id: OWN_JOB,
				labels: { name: "ml-intern-renamed", [SESSION_LABEL_KEY]: SESSION },
			});
		}
	});

	it("leaves a job that is not this conversation's as the model wrote it", () => {
		const apply = makeRewrite(new Map([[OWN_JOB, undefined]]));
		const args = { operation: "update-labels", args: { job_id: OTHER_JOB, labels: {} } };
		expect(apply("hf_jobs", args)).toBe(args);
	});

	it("leaves a call without labels for the preflight", () => {
		const apply = makeRewrite(new Map([[OWN_JOB, undefined]]));
		const args = { operation: "update-labels", args: { job_id: OWN_JOB } };
		expect(apply("hf_jobs", args)).toBe(args);
	});
});

describe("job label rewrite: scope", () => {
	it("never touches a sandbox, whose labels carry its auth", () => {
		const apply = makeRewrite();
		const args = { cmd: "create", args: ["--flavor", "t4-small", "--name", "box"] };
		expect(apply("hf_sandbox", args)).toBe(args);
	});

	it("leaves every other operation, tool and server alone", () => {
		const apply = makeRewrite(new Map([[OWN_JOB, undefined]]));
		for (const operation of ["ps", "logs", "inspect", "cancel", "scheduled run", "scheduled uv"]) {
			const args = { operation, args: { job_id: OWN_JOB } };
			expect(apply("hf_jobs", args)).toBe(args);
		}
		const read = { cmd: "ls", args: ["hf://models/x"] };
		expect(apply("hf_fs", read)).toBe(read);
		const custom = { operation: "run", args: { name: "x" } };
		expect(apply("hf_jobs", custom, "https://other.example/mcp")).toBe(custom);
	});
});

describe("job label rewrite: composed with billing", () => {
	it("applies both to one submission", () => {
		const rewrite = composeRewrites([
			createHubBillingRewrite({ namespace: "acme" }),
			createJobLabelRewrite({ session: SESSION, ownJobs: new Map() }),
		]);
		const out = rewrite?.({
			serverUrl: HF_URL,
			tool: "hf_jobs",
			args: { operation: "uv", args: { script: "print(1)", name: "smoke" } },
		});
		expect(out).toEqual({
			operation: "uv",
			args: {
				script: "print(1)",
				namespace: "acme",
				labels: { name: "ml-intern-smoke", [SESSION_LABEL_KEY]: SESSION },
			},
		});
	});

	it("hands back the same object when neither changes the call", () => {
		const rewrite = composeRewrites([
			createHubBillingRewrite({ namespace: "acme" }),
			createJobLabelRewrite({ session: SESSION, ownJobs: new Map() }),
		]);
		const args = { operation: "logs", args: { job_id: OWN_JOB, namespace: "acme" } };
		expect(rewrite?.({ serverUrl: HF_URL, tool: "hf_jobs", args })).toBe(args);
	});

	it("is no rewrite at all outside the mode, where neither is built", () => {
		expect(composeRewrites([undefined, undefined])).toBeUndefined();
	});
});
