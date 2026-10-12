import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);
const { uploadFiles } = require("@huggingface/hub");
const { parse } = require("dotenv");
const env = parse(fs.readFileSync(".env.local"));
if (!process.argv[2])
	throw new Error("Usage: node integrations/slack/space/upload.mjs owner/space");
const repo = { type: "space", name: process.argv[2] };
const paths = [
	...new Set(
		execFileSync("git", ["ls-files", "--cached", "-z"], {
			maxBuffer: 10e6,
		})
			.toString()
			.split("\0")
			.filter(Boolean)
	),
].filter(
	(p) =>
		!p.startsWith(".agents/") &&
		p !== "AGENTS.md" &&
		!p.startsWith(".github/") &&
		!p.startsWith("docs/") &&
		p !== "README.md" &&
		p !== "Dockerfile" &&
		!p.startsWith(".env.") &&
		!p.endsWith(".patch")
);
const files = paths
	.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
	.map((path) => ({ path, content: new Blob([fs.readFileSync(path)]) }));
files.push(
	{
		path: "Dockerfile",
		content: new Blob([fs.readFileSync("integrations/slack/space/Dockerfile")]),
	},
	{ path: "README.md", content: new Blob([fs.readFileSync("integrations/slack/space/README.md")]) },
	{
		path: "docs/source/ml-intern/slack-bot.md",
		content: new Blob([fs.readFileSync("docs/source/ml-intern/slack-bot.md")]),
	}
);
for (const file of files) {
	const text = await file.content.text();
	for (const key of [
		"SLACK_ML_HF_TOKEN",
		"SLACK_ML_BOT_TOKEN",
		"SLACK_ML_APP_TOKEN",
		"OPENAI_API_KEY",
		"OPENID_CLIENT_SECRET",
	])
		if (env[key] && text.includes(env[key]))
			throw new Error(`Secret found in upload: ${file.path}`);
}
for (let i = Number(process.env.UPLOAD_START ?? 0); i < files.length; i += 200) {
	try {
		await uploadFiles({
			repo,
			accessToken: env.SLACK_ML_HF_TOKEN,
			files: files.slice(i, i + 200),
			commitTitle: `Deploy ML Intern Slack worker (${Math.floor(i / 200) + 1})`,
		});
		console.log(`Uploaded ${Math.min(i + 200, files.length)}/${files.length}`);
	} catch (error) {
		console.error(JSON.stringify({ status: error.statusCode, detail: error.data }));
		process.exitCode = 1;
		break;
	}
}
