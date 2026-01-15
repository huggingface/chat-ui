#!/usr/bin/env node

import { copyFile, access } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';

const [modeArg, actionArg] = process.argv.slice(2);
const mode = (modeArg || 'xp').toLowerCase();
const action = (actionArg || 'dev').toLowerCase();

const envFile = path.resolve(`.env.${mode}.local`);
const target = path.resolve(`.env.local`);

const ACTIONS = {
	dev: ['vite', ['dev', '--mode', mode]],
	build: ['vite', ['build', '--mode', mode]],
	preview: ['vite', ['preview', '--mode', mode]],
};

async function ensureEnvFile() {
	try {
		await access(envFile);
	} catch {
		console.error(`❌ Missing env file: ${envFile}`);
		console.error('Create it or adjust the mode argument.');
		process.exit(1);
	}
}

async function copyEnv() {
	await copyFile(envFile, target);
	console.log(`📄 Copied ${envFile} -> ${target}`);
}

function runAction() {
	const cmd = ACTIONS[action];
	if (!cmd) {
		console.error(`❌ Unknown action: ${action}. Use dev|build|preview.`);
		process.exit(1);
	}
	const [bin, args] = cmd;
	const child = spawn(bin, args, { stdio: 'inherit' });
	child.on('exit', (code) => process.exit(code ?? 0));
}

(async () => {
	await ensureEnvFile();
	await copyEnv();
	runAction();
})();
