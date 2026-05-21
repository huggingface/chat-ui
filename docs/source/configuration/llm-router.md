# LLM Router

Chat UI includes an intelligent routing system that automatically selects the best model for each request. When enabled, users see a virtual "Omni" model that routes to specialized models based on the conversation context.

Route selection runs locally as a synchronous heuristic — no separate router service or selection model is called.

## How It Works

When a user sends a message via the Omni alias, the router picks a route in this order:

1. **Image input present** → `multimodal` route (if defined in the policy)
2. **MCP server selected** → `agentic` route (if defined in the policy)
3. **Otherwise** → `default` route (configurable via `LLM_ROUTER_DEFAULT_ROUTE`)

The selected route's `primary_model` is tried first; on error, each `fallback_models` entry is tried in order. If none of the route's models are reachable, the request falls back to `LLM_ROUTER_FALLBACK_MODEL`. The chosen route and model are emitted as `RouterMetadata` so the UI can display them.

## Configuration

### Basic Setup

```ini
# Path to your routes policy JSON
LLM_ROUTER_ROUTES_PATH=./config/routes.json

# Route name used when no specific heuristic matches (default: "default")
LLM_ROUTER_DEFAULT_ROUTE=default

# Model to use if every candidate in the selected route fails
LLM_ROUTER_FALLBACK_MODEL=meta-llama/Llama-3.3-70B-Instruct
```

### Routes Policy

Create a JSON array of routes. With heuristic routing, three route names are recognized: `default`, `multimodal`, and `agentic`. Add the ones you need.

```json
[
	{
		"name": "default",
		"description": "General purpose route for all conversations.",
		"primary_model": "moonshotai/Kimi-K2.6",
		"fallback_models": ["zai-org/GLM-4.6", "deepseek-ai/DeepSeek-V3.1"]
	},
	{
		"name": "multimodal",
		"description": "Route for requests with image inputs.",
		"primary_model": "Qwen/Qwen3-VL-235B-A22B-Instruct",
		"fallback_models": ["moonshotai/Kimi-K2.6"]
	},
	{
		"name": "agentic",
		"description": "Route for MCP server tool calling.",
		"primary_model": "moonshotai/Kimi-K2.6",
		"fallback_models": ["zai-org/GLM-4.6"]
	}
]
```

## Multimodal Shortcut

When `LLM_ROUTER_ENABLE_MULTIMODAL=true` and an image is attached, the router bypasses the policy file entirely and routes directly to `LLM_ROUTER_MULTIMODAL_MODEL`:

```ini
LLM_ROUTER_ENABLE_MULTIMODAL=true
LLM_ROUTER_MULTIMODAL_MODEL=moonshotai/Kimi-K2.6
```

If the flag is off, image inputs still flow through the heuristic and pick the `multimodal` route from the policy file.

## Tools Shortcut

When `LLM_ROUTER_ENABLE_TOOLS=true` and the user has at least one MCP server enabled, the router bypasses the policy file and routes directly to `LLM_ROUTER_TOOLS_MODEL`:

```ini
LLM_ROUTER_ENABLE_TOOLS=true
LLM_ROUTER_TOOLS_MODEL=moonshotai/Kimi-K2.6
```

If the flag is off (or no tools-capable model is found), tool-active requests flow through the heuristic and pick the `agentic` route from the policy file.

## UI Customization

Customize how the router appears in the model selector:

```ini
PUBLIC_LLM_ROUTER_ALIAS_ID=omni
PUBLIC_LLM_ROUTER_DISPLAY_NAME=Omni
PUBLIC_LLM_ROUTER_LOGO_URL=https://example.com/logo.png
```
