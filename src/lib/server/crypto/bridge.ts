import { spawn } from "child_process";
import { join } from "path";

/**
 * Node.js bridge to execute the Python Cryptographic Layer securely.
 */
export async function executeCryptoVerification(
	input: string
): Promise<{ encoded: string; signature: string }> {
	return new Promise((resolve, reject) => {
		const pythonScript = join(process.cwd(), "src/lib/server/crypto/crypto_polyglotte.py");
		const proc = spawn("python3", [pythonScript, input], {
			env: {
				...process.env,
				POLYGLOTTE_SECRET_KEY: process.env.POLYGLOTTE_SECRET_KEY || "fallback-key-0000",
			},
		});

		let output = "";
		let error = "";

		proc.stdout.on("data", (data) => {
			output += data.toString();
		});

		proc.stderr.on("data", (data) => {
			error += data.toString();
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				console.error("Crypto layer failed:", error);
				return reject(new Error("Cryptographic verification failed"));
			}

			let encoded = "";
			let signature = "";
			const lines = output.split("\n");
			for (const line of lines) {
				if (line.startsWith("ENCODED::")) encoded = line.replace("ENCODED::", "").trim();
				if (line.startsWith("SIGNATURE::")) signature = line.replace("SIGNATURE::", "").trim();
			}

			resolve({ encoded, signature });
		});
	});
}
