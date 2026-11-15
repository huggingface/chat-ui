import { describe, expect, it } from "vitest";
import {
	expectedPushesIn,
	expectedPushesOfJob,
	unguardedCreatesIn,
	unguardedCreatesOfJob,
} from "./expectedPushes";

const script = (...lines: string[]) => [lines.join("\n")];

describe("expectedPushesIn", () => {
	it("finds hub_model_id as a keyword, a dict key and a cli flag", () => {
		expect(
			expectedPushesIn(
				script(
					'args = SFTConfig(output_dir="out", push_to_hub=True, hub_model_id="pngwn/qwen-sft")',
					"config = {'hub_model_id': 'pngwn/qwen-dpo'}"
				)
			)
		).toEqual([
			{ kind: "model", uri: "hf://models/pngwn/qwen-sft" },
			{ kind: "model", uri: "hf://models/pngwn/qwen-dpo" },
		]);
		expect(
			expectedPushesIn(["trl sft --push_to_hub --hub_model_id pngwn/a --hub-model-id=pngwn/b"])
		).toEqual([
			{ kind: "model", uri: "hf://models/pngwn/a" },
			{ kind: "model", uri: "hf://models/pngwn/b" },
		]);
	});

	it("finds push_to_hub by its first argument or repo_id", () => {
		expect(
			expectedPushesIn(
				script(
					'model.push_to_hub("pngwn/merged")',
					'tokenizer.push_to_hub(repo_id="pngwn/merged", private=True)',
					"trainer.push_to_hub(commit_message='End of training')"
				)
			)
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/merged", guessed: true }]);
	});

	it("guesses a dataset from the receiver of push_to_hub", () => {
		expect(
			expectedPushesIn(
				script(
					'train_ds.push_to_hub("pngwn/capybara-clean")',
					'dataset_dict.push_to_hub("pngwn/capybara-splits")'
				)
			)
		).toEqual([
			{ kind: "dataset", uri: "hf://datasets/pngwn/capybara-clean", guessed: true },
			{ kind: "dataset", uri: "hf://datasets/pngwn/capybara-splits", guessed: true },
		]);
	});

	it("reads repo_type on upload_folder, upload_file and create_repo, and skips spaces", () => {
		expect(
			expectedPushesIn(
				script(
					"api = HfApi()",
					'api.create_repo("pngwn/evals", repo_type="dataset", exist_ok=True)',
					"api.upload_folder(",
					'    folder_path="out",',
					'    repo_id="pngwn/qwen-sft",',
					'    commit_message="final (step 900)",',
					")",
					'upload_file(path_or_fileobj="r.json", path_in_repo="r.json", repo_id="pngwn/evals", repo_type="dataset")',
					'create_repo("pngwn/demo", repo_type="space")'
				)
			)
		).toEqual([
			{ kind: "dataset", uri: "hf://datasets/pngwn/evals" },
			{ kind: "model", uri: "hf://models/pngwn/qwen-sft" },
		]);
	});

	it("resolves a name assigned a literal once", () => {
		expect(
			expectedPushesIn(
				script(
					'HUB_MODEL_ID = "pngwn/qwen-sft"',
					'OUT: str = "pngwn/qwen-merged"  # merged weights',
					"cfg = SFTConfig(hub_model_id=HUB_MODEL_ID)",
					"model.push_to_hub(OUT)"
				)
			)
		).toEqual([
			{ kind: "model", uri: "hf://models/pngwn/qwen-sft" },
			{ kind: "model", uri: "hf://models/pngwn/qwen-merged", guessed: true },
		]);
	});

	it("ignores anything computed", () => {
		expect(
			expectedPushesIn(
				script(
					'user = whoami()["name"]',
					'cfg = SFTConfig(hub_model_id=f"{user}/qwen-sft")',
					'model.push_to_hub(f"{user}/merged")',
					"api.upload_folder(repo_id=args.repo, folder_path='out')",
					'REPO = "pngwn/first"',
					'REPO = "pngwn/second"',
					"model.push_to_hub(REPO)",
					'dataset.push_to_hub(os.environ.get("OUT", "pngwn/fallback"))',
					'model.push_to_hub("qwen-sft")'
				)
			)
		).toEqual([]);
	});

	it("leaves trackio out", () => {
		expect(
			expectedPushesIn(
				script(
					'trackio.init(project="sft", space_id="pngwn/sft-trackio", dataset_id="pngwn/sft-data")',
					'trackio.push_to_hub("pngwn/metrics")',
					'create_repo("pngwn/sft-trackio-dataset", repo_type="dataset")',
					'model.push_to_hub("pngwn/qwen-sft")'
				)
			)
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/qwen-sft", guessed: true }]);
	});

	it("skips commented out lines and lists a repo once, an explicit kind over a guess", () => {
		expect(
			expectedPushesIn(
				script(
					'# model.push_to_hub("pngwn/old-name")',
					'merged.push_to_hub("pngwn/evals")',
					'create_repo("pngwn/evals", repo_type="dataset")',
					'model.push_to_hub("pngwn/evals")'
				)
			)
		).toEqual([{ kind: "dataset", uri: "hf://datasets/pngwn/evals" }]);
	});

	it("ignores push calls in trailing comments and docstrings", () => {
		expect(
			expectedPushesIn(
				script(
					'"""Fine-tune, then call model.push_to_hub("pngwn/docstring-example")."""',
					'pass  # model.push_to_hub("pngwn/old-name")',
					"def save(model):",
					"    '''",
					'    upload_folder(repo_id="pngwn/also-an-example", folder_path="out")',
					"    '''",
					'    model.push_to_hub("pngwn/qwen-sft")  # the real one'
				)
			)
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/qwen-sft", guessed: true }]);
	});

	it("keeps a hash inside a string", () => {
		expect(
			expectedPushesIn(script('api.upload_folder(commit_message="step #3", repo_id="pngwn/x")'))
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/x" }]);
	});

	it("is not thrown by a parenthesis inside a string or an unclosed call", () => {
		expect(
			expectedPushesIn(script('api.upload_folder(commit_message="a) b", repo_id="pngwn/x"'))
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/x" }]);
	});
});

describe("expectedPushesOfJob", () => {
	it("reads a uv script with its arguments and a docker command", () => {
		expect(
			expectedPushesOfJob({
				script: 'model.push_to_hub("pngwn/a")',
				script_args: ["--hub_model_id", "pngwn/b"],
			})
		).toEqual([
			{ kind: "model", uri: "hf://models/pngwn/a", guessed: true },
			{ kind: "model", uri: "hf://models/pngwn/b" },
		]);
		expect(
			expectedPushesOfJob({
				image: "python:3.12",
				command: ["python", "-c", 'ds.push_to_hub("pngwn/c")'],
			})
		).toEqual([{ kind: "dataset", uri: "hf://datasets/pngwn/c", guessed: true }]);
	});

	it("keeps a hash in one argument from hiding the rest", () => {
		expect(
			expectedPushesOfJob({
				script: "print(1)",
				script_args: ["--run-name", "#1", "--hub_model_id", "pngwn/b"],
			})
		).toEqual([{ kind: "model", uri: "hf://models/pngwn/b" }]);
	});

	it("finds nothing in a script that is a url", () => {
		expect(
			expectedPushesOfJob({
				script: "https://raw.githubusercontent.com/huggingface/trl/main/trl/scripts/sft.py",
			})
		).toEqual([]);
	});
});

describe("unguardedCreatesIn", () => {
	it("flags create_repo left at exist_ok=False, in any spelling", () => {
		expect(
			unguardedCreatesIn(
				script(
					"from huggingface_hub import HfApi, create_repo",
					'create_repo("pngwn/a")',
					'HfApi().create_repo(repo_id="pngwn/b", private=True)',
					"api = HfApi()",
					'api.create_repo("pngwn/c", repo_type="dataset", exist_ok=False)'
				)
			)
		).toEqual([
			{ uri: "hf://models/pngwn/a", repo: "pngwn/a", call: "create_repo" },
			{ uri: "hf://models/pngwn/b", repo: "pngwn/b", call: "create_repo" },
			{ uri: "hf://datasets/pngwn/c", repo: "pngwn/c", call: "create_repo" },
		]);
	});

	it("passes create_repo with exist_ok set, or with kwargs that may carry it", () => {
		expect(
			unguardedCreatesIn(
				script(
					'create_repo("pngwn/a", exist_ok=True)',
					'api.create_repo(repo_id="pngwn/b", exist_ok=tolerate)',
					'create_repo("pngwn/c", **repo_options)'
				)
			)
		).toEqual([]);
	});

	it("flags SentenceTransformer.push_to_hub in a sentence_transformers script, the way the lost runs were written", () => {
		expect(
			unguardedCreatesIn(
				script(
					"from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer",
					'REPO_ID = "pngwn/minilm-retrieval"',
					'model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")',
					"trainer = SentenceTransformerTrainer(model=model, args=args, train_dataset=train_ds)",
					"trainer.train()",
					"model.push_to_hub(REPO_ID)"
				)
			)
		).toEqual([
			{
				uri: "hf://models/pngwn/minilm-retrieval",
				repo: "pngwn/minilm-retrieval",
				call: "push_to_hub",
			},
		]);
		expect(
			unguardedCreatesIn(
				script("import sentence_transformers", 'model.push_to_hub(repo_id="pngwn/a")')
			)
		).toHaveLength(1);
	});

	it("passes the pushes that create with exist_ok=True themselves", () => {
		expect(
			unguardedCreatesIn(
				script(
					"from sentence_transformers import SentenceTransformer",
					"from sentence_transformers import SentenceTransformerTrainingArguments",
					'args = SentenceTransformerTrainingArguments(output_dir="out", push_to_hub=True, hub_model_id="pngwn/a")',
					"trainer.push_to_hub()",
					'sentence_trainer.push_to_hub("pngwn/b")',
					'train_ds.push_to_hub("pngwn/c")',
					'dataset.push_to_hub("pngwn/d")',
					'model.push_to_hub("pngwn/e", exist_ok=True)',
					'model.push_to_hub("pngwn/f", repo_type="model")',
					'api.upload_folder(folder_path="out", repo_id="pngwn/g")'
				)
			)
		).toEqual([]);
		expect(
			unguardedCreatesIn(
				script(
					"from transformers import AutoModelForCausalLM",
					'model.push_to_hub("pngwn/a")',
					'tokenizer.push_to_hub("pngwn/a")'
				)
			)
		).toEqual([]);
	});

	it("keeps both calls when a script creates and pushes the same repo", () => {
		expect(
			unguardedCreatesIn(
				script(
					"from sentence_transformers import SentenceTransformer",
					'create_repo("pngwn/a")',
					'model.push_to_hub("pngwn/a")',
					'create_repo("pngwn/a", private=True)'
				)
			)
		).toEqual([
			{ uri: "hf://models/pngwn/a", repo: "pngwn/a", call: "create_repo" },
			{ uri: "hf://models/pngwn/a", repo: "pngwn/a", call: "push_to_hub" },
		]);
	});

	it("ignores comments, docstrings, trackio and ids built at runtime", () => {
		expect(
			unguardedCreatesIn(
				script(
					"from sentence_transformers import SentenceTransformer",
					'# create_repo("pngwn/a")',
					'"""model.push_to_hub("pngwn/b")"""',
					'trackio.create_repo("pngwn/c")',
					'create_repo(f"{user}/d")',
					"model.push_to_hub(repo_name)"
				)
			)
		).toEqual([]);
	});
});

describe("unguardedCreatesOfJob", () => {
	it("reads a uv script and a docker command", () => {
		expect(unguardedCreatesOfJob({ script: 'create_repo("pngwn/a")' })).toEqual([
			{ uri: "hf://models/pngwn/a", repo: "pngwn/a", call: "create_repo" },
		]);
		expect(
			unguardedCreatesOfJob({
				image: "python:3.12",
				command: [
					"python",
					"-c",
					'import os; from sentence_transformers import SentenceTransformer; m.push_to_hub("pngwn/b")',
				],
			})
		).toEqual([{ uri: "hf://models/pngwn/b", repo: "pngwn/b", call: "push_to_hub" }]);
	});
});
