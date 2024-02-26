import fs from "fs";

const HF_DEPLOYMENT_TOKEN = process.env.HF_DEPLOYMENT_TOKEN; // token used for pushing to hub

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const OPENID_CONFIG = process.env.OPENID_CONFIG;
const MONGODB_URL = process.env.MONGODB_URL;
const HF_TOKEN = process.env.HF_TOKEN ?? process.env.HF_ACCESS_TOKEN; // token used for API requests in prod
const WEBHOOK_URL_REPORT_ASSISTANT = process.env.WEBHOOK_URL_REPORT_ASSISTANT; // slack webhook url used to get "report assistant" events
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET;

// Read the content of the file .env.template
const PUBLIC_CONFIG = fs.readFileSync(".env.template", "utf8");

// Prepend the content of the env variable SECRET_CONFIG
const full_config = `${PUBLIC_CONFIG}
MONGODB_URL=${MONGODB_URL}
OPENID_CONFIG=${OPENID_CONFIG}
SERPER_API_KEY=${SERPER_API_KEY}
HF_TOKEN=${HF_TOKEN}
WEBHOOK_URL_REPORT_ASSISTANT=${WEBHOOK_URL_REPORT_ASSISTANT}
ADMIN_API_SECRET=${ADMIN_API_SECRET}
`;

// Make an HTTP POST request to add the space secrets
fetch(`https://huggingface.co/api/spaces/huggingchat/chat-ui/secrets`, {
	method: "POST",
	body: JSON.stringify({
		key: "DOTENV_LOCAL",
		value: full_config,
		description: `Env variable for HuggingChat. Last updated ${new Date().toISOString()}`,
	}),
	headers: {
		Authorization: `Bearer ${HF_DEPLOYMENT_TOKEN}`,
		"Content-Type": "application/json",
	},
});
