import fs from "fs";
import yaml from "js-yaml";

const file = fs.readFileSync("chart/env/prod.yaml", "utf8");

// have to do a weird stringify/parse because of some node error
const prod = JSON.parse(JSON.stringify(yaml.load(file)));
const vars = prod.envVars as Record<string, string>;
const secrets = prod.externalSecrets.parameters;

let PUBLIC_CONFIG = "";
Object.entries(vars).forEach(([key, value]) => {
	PUBLIC_CONFIG += `${key}=\`${value}\`\n`;
});

let SECRET_CONFIG =
	(fs.existsSync(".env.SECRET_CONFIG")
		? fs.readFileSync(".env.SECRET_CONFIG", "utf8")
		: process.env.SECRET_CONFIG) ?? "";

if (!SECRET_CONFIG) {
	console.log(
		"SECRET_CONFIG is not defined. We will now try to fill in secrets found in the prod environemnt with environment variables."
	);

	Object.keys(secrets).forEach((key) => {
		const value = process.env[key];

		if (!value) {
			throw new Error(
				`Secret ${key} was found in prod.yaml but was not available as an environment variable.`
			);
		}

		SECRET_CONFIG += `${key}=${value}\n`;
	});
}

// Prepend the content of the env variable SECRET_CONFIG
const full_config = `${PUBLIC_CONFIG}\n${SECRET_CONFIG}`;

// Write full_config to .env.local
fs.writeFileSync(".env.local", full_config);
