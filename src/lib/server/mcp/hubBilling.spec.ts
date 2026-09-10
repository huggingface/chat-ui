import { describe, expect, it } from "vitest";
import { createHubBillingRewrite } from "./hubBilling";

const HF_URL = "https://hf.co/mcp?login";
const rewrite = createHubBillingRewrite("acme");
const apply = (tool: string, args: Record<string, unknown>, serverUrl = HF_URL) =>
	rewrite({ serverUrl, tool, args });

describe("hub billing rewrite: jobs", () => {
	it("runs a submission under the billing organisation", () => {
		const args = {
			operation: "run",
			args: { image: "python:3.12", command: ["python", "-c", "1"] },
		};
		expect(apply("hf_jobs", args)).toEqual({
			operation: "run",
			args: { image: "python:3.12", command: ["python", "-c", "1"], namespace: "acme" },
		});
	});

	it("overrides a namespace the model wrote on a submission", () => {
		// Who pays is the user's setting; the model cannot opt a run out of it.
		for (const operation of ["run", "uv", "scheduled run", "scheduled uv"]) {
			const out = apply("hf_jobs", { operation, args: { script: "print(1)", namespace: "pngwn" } });
			expect((out.args as Record<string, unknown>).namespace).toBe("acme");
		}
	});

	it("fills in the namespace on a read that names none", () => {
		// The org's jobs live in the org's namespace; a bare id would 404 under the user.
		for (const operation of ["ps", "logs", "inspect", "cancel"]) {
			const out = apply("hf_jobs", { operation, args: { job_id: "abc" } });
			expect(out.args).toEqual({ job_id: "abc", namespace: "acme" });
		}
	});

	it("keeps a namespace the model named on a read", () => {
		// A job launched before the setting changed lives elsewhere, and its URL says where.
		const args = { operation: "logs", args: { job_id: "abc", namespace: "pngwn" } };
		expect(apply("hf_jobs", args)).toBe(args);
	});

	it("treats missing args as an empty object", () => {
		expect(apply("hf_jobs", { operation: "ps" })).toEqual({
			operation: "ps",
			args: { namespace: "acme" },
		});
	});

	it("leaves a call without an operation for the gate to refuse", () => {
		const args = { args: { image: "python:3.12" } };
		expect(apply("hf_jobs", args)).toBe(args);
	});

	it("leaves args that are not an object for the preflight to reject", () => {
		const args = { operation: "run", args: "python:3.12" };
		expect(apply("hf_jobs", args)).toBe(args);
	});

	it("does not mutate what the model sent", () => {
		const inner = { image: "python:3.12" };
		const args = { operation: "run", args: inner };
		apply("hf_jobs", args);
		expect(inner).toEqual({ image: "python:3.12" });
		expect(args.args).toBe(inner);
	});
});

describe("hub billing rewrite: sandboxes", () => {
	it("creates under the billing organisation", () => {
		const args = { cmd: "create", args: ["create", "--flavor", "cpu-basic", "--timeout", "1h"] };
		expect(apply("hf_sandbox", args)).toEqual({
			cmd: "create",
			args: ["create", "--flavor", "cpu-basic", "--timeout", "1h", "--namespace", "acme"],
		});
		expect(args.args).toHaveLength(5);
	});

	it("replaces a --namespace the model wrote", () => {
		const args = {
			cmd: "create",
			args: ["create", "--namespace", "pngwn", "--flavor", "cpu-basic"],
		};
		expect(apply("hf_sandbox", args).args).toEqual([
			"create",
			"--flavor",
			"cpu-basic",
			"--namespace",
			"acme",
		]);
	});

	it("collapses repeated --namespace flags to one", () => {
		// The Hub's parser takes the option once; a duplicate is rejected outright.
		const args = {
			cmd: "create",
			args: ["create", "--namespace", "pngwn", "--flavor", "cpu-basic", "--namespace", "acme"],
		};
		expect(apply("hf_sandbox", args).args).toEqual([
			"create",
			"--flavor",
			"cpu-basic",
			"--namespace",
			"acme",
		]);
	});

	it("supplies the value when --namespace is the last token", () => {
		const args = { cmd: "create", args: ["create", "--flavor", "cpu-basic", "--namespace"] };
		expect(apply("hf_sandbox", args).args).toEqual([
			"create",
			"--flavor",
			"cpu-basic",
			"--namespace",
			"acme",
		]);
	});

	it("leaves every other command alone", () => {
		// The handle already names the namespace.
		for (const cmd of ["status", "terminate", "ps", "kill"]) {
			const args = { cmd, args: [cmd, "hfsb2:acme:0123456789abcdef01234567"] };
			expect(apply("hf_sandbox", args)).toBe(args);
		}
	});

	it("leaves args that are not a token list for the preflight to reject", () => {
		const args = { cmd: "create", args: "create --flavor cpu-basic" };
		expect(apply("hf_sandbox", args)).toBe(args);
	});
});

describe("hub billing rewrite: scope", () => {
	it("ignores servers other than the Hub's", () => {
		// A custom server is free to export its own hf_jobs; its namespace is not ours to set.
		const args = { operation: "run", args: { image: "python:3.12" } };
		expect(apply("hf_jobs", args, "https://mcp.exa.ai/mcp")).toBe(args);
		expect(apply("hf_jobs", args, "https://evil.example/hf.co/mcp")).toBe(args);
	});

	it("covers the bare Hub endpoint as well as the login one", () => {
		const args = { operation: "run", args: { image: "python:3.12" } };
		expect(apply("hf_jobs", args, "https://huggingface.co/mcp").args).toEqual({
			image: "python:3.12",
			namespace: "acme",
		});
	});

	it("ignores Hub tools that spend nothing", () => {
		const args = { operations: [{ cmd: "ls", args: ["hf://models/trending"] }] };
		expect(apply("hf_fs", args)).toBe(args);
	});
});
