import { describe, expect, it } from "vitest";
import { redact } from "./redact";

const token = `hf_${"a".repeat(34)}`;

describe("redact", () => {
	it("catches a token after an escaped newline", () => {
		expect(redact(JSON.stringify(`line\n${token}`))).toBe(JSON.stringify("line\n[REDACTED]"));
	});

	it("catches OAuth tokens glued to text, Kaggle keys and URL passwords", () => {
		const jwt = `eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyIn0.${"s".repeat(20)}`;
		const text = JSON.stringify(
			`token=SEThf_oauth_${jwt}\nKGAT_${"3".repeat(32)}\nhttps://user:hf_oauth_${jwt}@huggingface.co/x`
		);
		expect(redact(text)).toBe(
			JSON.stringify(`token=SET[REDACTED]\n[REDACTED]\nhttps://user:[REDACTED]@huggingface.co/x`)
		);
		expect(redact(JSON.stringify("https://user:s3cretpassw0rd@example.com"))).toBe(
			JSON.stringify("https://user:[REDACTED]@example.com")
		);
	});

	it("catches keys assigned in code but not placeholders", () => {
		const code = JSON.stringify(
			`rf = Roboflow(api_key="abcd1234efgh5678ijkl")\nenv = {"WANDB_API_KEY": "wandb_v1_${"Lz8".repeat(10)}"}\nsecrets = {"ROBOFLOW_API_KEY": "k3yk3yk3yk3yk3yk3y"}\nnever write "k3yk3yk3yk3yk3yk3y"\nclient(api_key="YOUR_ANTHROPIC_API_KEY")`
		);
		expect(redact(code)).toBe(
			JSON.stringify(
				`rf = Roboflow(api_key="[REDACTED]")\nenv = {"WANDB_API_KEY": "[REDACTED]"}\nsecrets = {"ROBOFLOW_API_KEY": "[REDACTED]"}\nnever write "[REDACTED]"\nclient(api_key="YOUR_ANTHROPIC_API_KEY")`
			)
		);
	});

	it("leaves ids and names that only look like keys", () => {
		const text = JSON.stringify("task-0d6236bd-f4f3-4db6-a51c-0a120a633543 hf_hub_download");
		expect(redact(text)).toBe(text);
	});
});
