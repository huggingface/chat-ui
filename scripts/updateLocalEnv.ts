import fs from "fs";
import yaml from "js-yaml";

const file = fs.readFileSync("chart/env/prod.yaml", "utf8");

// have to do a weird stringify/parse because of some node error
const prod = JSON.parse(JSON.stringify(yaml.load(file)));
const vars = prod.envVars as Record<string, string>;

let PUBLIC_CONFIG = "";

Object.entries(vars)
	// filter keys used in prod with the proxy
	.filter(([key]) => !["XFF_DEPTH", "ADDRESS_HEADER"].includes(key))
	.forEach(([key, value]) => {
		PUBLIC_CONFIG += `${key}=\`${value}\`\n`;
	});

const SECRET_CONFIG =
	(fs.existsSync(".env.SECRET_CONFIG")
		? fs.readFileSync(".env.SECRET_CONFIG", "utf8")
		: process.env.SECRET_CONFIG) ?? "";

// Prepend the content of the env variable SECRET_CONFIG
let full_config = `${PUBLIC_CONFIG}\n${SECRET_CONFIG}`;

// replace the internal proxy url with the public endpoint
full_config = full_config.replaceAll(
	"https://internal.api-inference.huggingface.co",
	"https://api-inference.huggingface.co"
);

// Write full_config to .env.local
fs.writeFileSync(".env.local", full_config);
