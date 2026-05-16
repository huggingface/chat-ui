import { spawn } from "child_process";
import { join } from "path";

/**
 * FFI Bridge to Rust high-performance verification layer.
 */
export async function verifyPatternRust(input: string, pattern: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		// Use cargo run or a pre-compiled binary based on environment
		const binaryPath = join(process.cwd(), "src/lib/server/rust/fraction_hemisphere");
		const rustProc = spawn(binaryPath, [input, pattern]);

		let output = "";
		let error = "";

		rustProc.stdout.on("data", (data) => {
			output += data.toString();
		});

		rustProc.stderr.on("data", (data) => {
			error += data.toString();
		});

		rustProc.on("close", (code) => {
			if (code !== 0) {
				console.error("Rust Verification Error:", error);
				return reject(new Error("Rust layer verification failed"));
			}
			// Parse standard output for sub-millisecond match resolution
			resolve(output.includes("MATCH_FOUND=true"));
		});
	});
}
