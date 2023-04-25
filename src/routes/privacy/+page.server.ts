import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, normalize } from "path";
import { fileURLToPath } from "url";
import type { PageServerLoad } from "./$types";
import { marked } from "marked";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDirFinder = function (): string {
	const parts = __dirname.split("/");
	let level = parts.length - 1;
	while (level > 0) {
		const currentPath = parts.slice(0, level).join("/");
		try {
			if (existsSync(`${currentPath}/package.json`)) {
				return normalize(currentPath);
			}
		} catch (err) {}
		level--;
	}
	return "";
};
const __rootDir = rootDirFinder();

export const load: PageServerLoad = async () => {
	const text = await readFile(__rootDir + "/PRIVACY.md", "utf-8");
	return {
		html: marked(text),
	};
};
