import * as fs from "fs";
import * as readline from "readline";

/**
 * Automation script: Fine-Tuning Dataset Preparator
 * Converts chat history JSONL streams into clean training datasets.
 */

interface ChatLog {
	prompt: string;
	response: string;
	metadata?: Record<string, unknown>;
}

interface TrainingFormat {
	messages: { role: string; content: string }[];
	systemic_state: Record<string, unknown>;
}

async function prepareDataset(inputPath: string, outputPath: string) {
	const fileStream = fs.createReadStream(inputPath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	const outputStream = fs.createWriteStream(outputPath, { flags: "a" });

	for await (const line of rl) {
		if (!line.trim()) continue;

		try {
			const chat: ChatLog = JSON.parse(line);

			// Append multi-dimensional state parameters safely referencing prompt and structure
			const trainingData: TrainingFormat = {
				messages: [
					{ role: "system", content: "You are an AI mapped with systemic state awareness." },
					{ role: "user", content: chat.prompt },
					{ role: "assistant", content: chat.response },
				],
				systemic_state: {
					structural_integrity: 1.0,
					extracted_meta: chat.metadata || {},
					resolution_flag: true,
				},
			};

			outputStream.write(JSON.stringify(trainingData) + "\n");
		} catch (error) {
			console.error("Dataset Parsing Error on line:", line, error);
		}
	}

	outputStream.end();
	console.log(`Dataset preparation completed. Output saved to ${outputPath}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
	console.log("Usage: npx vite-node scripts/prepare_dataset.ts <input_jsonl> <output_jsonl>");
	process.exit(1);
}

prepareDataset(args[0], args[1]);
