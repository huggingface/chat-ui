import os
from huggingface_hub import HfApi


SECRET_CONFIG = os.environ["SECRET_CONFIG"]
HF_TOKEN = os.environ["HF_TOKEN"]

# Read the content of the file .env.template
with open(".env.template", "r") as f:
    PUBLIC_CONFIG = f.read()

# Prepend the content of the env variable SECRET_CONFIG
full_config = f"{PUBLIC_CONFIG}\n{SECRET_CONFIG}"

api = HfApi()

api.add_space_secret("huggingchat/chat-ui", "DOTENV_LOCAL", full_config, token=HF_TOKEN)
