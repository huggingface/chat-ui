import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);
const { uploadFiles } = require("@huggingface/hub");
const { parse } = require("dotenv");
const env = parse(fs.readFileSync(".env.local"));
if (!env.SLACK_ML_DEPLOY_TOKEN) throw new Error("Set SLACK_ML_DEPLOY_TOKEN in .env.local");
const args = process.argv.slice(2);
const keepReadme = args.includes("--keep-readme");
const name = args.find((arg) => !arg.startsWith("--"));
if (!name)
	throw new Error("Usage: node integrations/slack/space/upload.mjs owner/space [--keep-readme]");
const repo = { type: "space", name };
const readme = fs.readFileSync("integrations/slack/space/README.md", "utf8");
// Dropping hf_oauth, even for one commit, deletes the Space's OAuth app and every login token.
if (!keepReadme) {
	const res = await fetch(`https://huggingface.co/spaces/${name}/raw/main/README.md`, {
		headers: { Authorization: `Bearer ${env.SLACK_ML_DEPLOY_TOKEN}` },
	});
	const oauth = /^hf_oauth:\s*true\s*$/m;
	if (res.ok && oauth.test(await res.text()) && !oauth.test(readme))
		throw new Error(
			`${name} uses hf_oauth, which this README would remove. Rerun with --keep-readme.`
		);
}
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
	...(keepReadme ? [] : [{ path: "README.md", content: new Blob([readme]) }]),
	{
		path: "docs/source/ml-intern/slack-bot.md",
		content: new Blob([fs.readFileSync("docs/source/ml-intern/slack-bot.md")]),
	}
);
for (const file of files) {
	const text = await file.content.text();
	for (const key of [
		"SLACK_ML_DEPLOY_TOKEN",
		"SLACK_ML_HF_TOKEN",
		"SLACK_ML_STATE_TOKEN",
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
			accessToken: env.SLACK_ML_DEPLOY_TOKEN,
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
