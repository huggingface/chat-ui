import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List

from huggingface_hub import hf_hub_download

MODELS_CONFIG = Path("chat.env.local")


def read_models_info(path: Path = MODELS_CONFIG) -> Dict[str, Any]:
    with path.open() as config_file:
        models_info = config_file.read().split("`")[1]
        models_info = json.loads(models_info)
        return {model["shortName"]: model for model in models_info}


def download_model(model_info: Dict[str, Any], local_dir: str = "data/") -> None:
    if "weightsFilename" not in model_info:
        raise ValueError("weightsFilename not found in model_info")

    output_path = Path(local_dir) / model_info["weightsFilename"]
    if not output_path.exists():
        output_path.parent.mkdir(parents=True, exist_ok=True)
        hf_hub_download(
            repo_id=model_info["name"],
            filename=model_info["weightsFilename"],
            local_dir=local_dir,
            local_dir_use_symlinks=False,
        )


def start_chat(model_info: Dict[str, Any]):
    download_model(model_info)

    os.environ["MODEL_ID"] = model_info["name"]
    os.environ["WEIGHTS_FILENAME"] = model_info["weightsFilename"]
    os.environ["NGL"] = str(model_info["nGpuLayers"])
    os.environ["CONTEXT_LENGTH"] = str(model_info["contextLength"])

    os.system("docker compose up")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("model", help="model name", type=str)
    args = parser.parse_args()

    models_info = read_models_info()

    if args.model not in models_info:
        raise ValueError(
            f"model {args.model} not found, choose from {list(models_info.keys())}"
        )

    start_chat(models_info[args.model])
