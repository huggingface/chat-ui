import fs from "fs";

const HF_TOKEN = process.env.HF_TOKEN;
const SECRET_CONFIG = fs.existsSync(".env.SECRET_CONFIG")
	? fs.readFileSync(".env.SECRET_CONFIG", "utf8")
	: process.env.SECRET_CONFIG;

if (!SECRET_CONFIG) {
	throw new Error(
		"SECRET_CONFIG is not defined. Please provide it either in a file or as an environment variable."
	);
}

// Read the content of the file .env.template
const PUBLIC_CONFIG = fs.readFileSync(".env.template", "utf8");

// Prepend the content of the env variable SECRET_CONFIG
const full_config = `${PUBLIC_CONFIG}\n${SECRET_CONFIG}`;

// Make an HTTP POST request to add the space secre
fetch(`https://huggingface.co/api/spaces/huggingchat/chat-ui/secrets`, {
	method: "POST",
	body: JSON.stringify({
		key: "DOTENV_LOCAL",
		value: full_config,
		description: `Env variable for HuggingChat. Last updated ${new Date().toISOString()}`,
	}),
	headers: {
		Authorization: `Bearer ${HF_TOKEN}`,
		"Content-Type": "application/json",
	},
});
