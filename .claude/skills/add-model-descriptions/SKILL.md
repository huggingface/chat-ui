---
name: add-model-descriptions
description: Add descriptions for new models from the HuggingFace router to chat-ui configuration, and flag reasoning-capable ones. Use when new models are released on the router and need descriptions added to prod.yaml and dev.yaml. Triggers on requests like "add new model descriptions", "update models from router", "sync models", or when explicitly invoking /add-model-descriptions.
---

# Add Model Descriptions

Add descriptions for new models available in the HuggingFace router to chat-ui's `prod.yaml` and `dev.yaml`. Also flag models that support the OpenAI-compatible `reasoning_effort` parameter so chat-ui shows the thinking-effort selector for them.

## Workflow

1. **Fetch models from router**

   ```
   WebFetch https://router.huggingface.co/v1/models
   ```

   Extract all model IDs from the response.

2. **Read current configuration**

   - Read `chart/env/prod.yaml`
   - Extract model IDs from the `MODELS` JSON array in `envVars`

3. **Identify missing models**
   Compare router models with prod.yaml. Missing = in router but not in prod.yaml.

   **Only operate on these missing models for the rest of the workflow.** Never edit, re-flag, or re-describe entries that already exist in `prod.yaml` / `dev.yaml` — even if you think their reasoning capability or description could be improved. Existing entries are intentionally curated and may have been hand-tuned for known quirks. Out of scope unless the user explicitly asks for a re-audit.

4. **Research each missing model**
   For each missing model, search the web for its specifications:

   - Model architecture (dense, MoE, parameters)
   - Key capabilities (coding, reasoning, vision, multilingual, etc.)
   - Target use cases
   - **Whether it's a reasoning model** (see step 5)

5. **Decide if the model is reasoning-capable**
   A model is "reasoning-capable" for chat-ui purposes if it accepts the OpenAI-style `reasoning_effort: low|medium|high` parameter via the HF router and _meaningfully changes its chain-of-thought depth_ in response. Whether that holds depends on **both the model and the providers serving it** — the router is a transparent proxy, so behavior comes from each provider's implementation. Don't decide from the name alone.

   **Heuristic shortlist (candidates worth verifying):**

   - Name contains `gpt-oss`, `-Thinking`, `-thinking`, `-Reasoning`, `-reasoning`, `QwQ`, `R1`, `MiniMax-M`, `Kimi-K2-Thinking`, `cogito-`
   - Hybrid models with a thinking switch: DeepSeek V3.1+, GLM-4.5 / 4.6 / 4.7 / 5.x, Qwen3 thinking variants
   - Model card mentions "thinking mode", "reasoning traces", "extended thinking", "test-time compute", or shows `<think>...</think>` examples

   **Skip without further checking:**

   - Generic "good at reasoning" marketing copy — every modern LLM claims this. Only flag when reasoning is the _mode of operation_.
   - Non-thinking siblings (`Qwen3-235B-A22B-Instruct-2507` ≠ `Qwen3-235B-A22B-Thinking-2507`).
   - Translation / vision-only / guard / coder-only models with no documented thinking mode.

   **Verify each candidate via provider docs** before flagging:

   For each model on the heuristic shortlist, look up its `live` providers in the `/v1/models` payload, then check those providers' chat-completions documentation for `reasoning_effort`, `reasoning_content`, `enable_thinking`, or a `thinking` parameter. If at least one live provider documents it for this model (or for the model family in general), flag it as reasoning-capable. The HF router will proxy the parameter to whichever provider it picks.

   Provider docs to consult (use WebFetch / WebSearch):

   - **fireworks-ai**: <https://docs.fireworks.ai/api-reference/post-chatcompletions>
   - **groq**: <https://console.groq.com/docs/reasoning>
   - **cerebras**: <https://inference-docs.cerebras.ai/capabilities/reasoning>
   - **together**: <https://docs.together.ai/docs/gpt-oss>
   - **novita**: <https://novita.ai/docs/guides/llm-interleaved-thinking>
   - **sambanova**: search "sambanova reasoning_effort"
   - **deepinfra**: <https://docs.deepinfra.com/chat/overview>
   - **nscale**, **scaleway**, **ovhcloud**, **hyperbolic**, **zai-org**, **cohere**, **featherless-ai**: search "<provider> reasoning_effort" or check their model catalog pages

   If none of the live providers document reasoning support for the model, don't flag it — even if the name pattern-matches. If documentation is ambiguous, lean toward not flagging and mention it in the commit so it can be revisited.

6. **Write descriptions**
   Match existing style:

   - 8-12 words
   - Sentence fragments (no period needed)
   - No articles ("a", "the") unless necessary
   - Focus on: architecture, specialization, key capability

   Examples:

   - `"Flagship GLM MoE for coding, reasoning, and agentic tool use."`
   - `"MoE agent model with multilingual coding and fast outputs."`
   - `"Vision-language Qwen for documents, GUI agents, and visual reasoning."`
   - `"Mobile agent for multilingual Android device automation."`

7. **Update both files**
   Add new models at the TOP of the MODELS array in:

   - `chart/env/prod.yaml`
   - `chart/env/dev.yaml`

   Format for non-reasoning models:

   ```json
   { "id": "org/model-name", "description": "Description here." }
   ```

   Format for reasoning-capable models — append `"supportsReasoning": true`:

   ```json
   { "id": "org/model-name", "description": "Description here.", "supportsReasoning": true }
   ```

   This flag is what makes chat-ui render the Thinking-effort dropdown in the chat footer for that model and forward `reasoning_effort` to the router.

8. **Commit changes**
   In the commit message, mention how many of the new models are reasoning-capable so it's easy to review.
   ```
   git add chart/env/prod.yaml chart/env/dev.yaml
   git commit -m "feat: add descriptions for N new models from router (M reasoning-capable)"
   ```

## Notes

- FP8 variants: describe as "FP8 [base model] for efficient inference with [key capability]". If the base model is reasoning-capable, the FP8 variant is too — flag both.
- Vision models: mention "vision-language" and key visual tasks. A vision model can still be reasoning-capable (e.g. `Qwen3-VL-*-Thinking`) — judge by the same rules.
- Agent models: mention "agent" and automation capabilities.
- Regional models: mention language focus (e.g., "European multilingual", "Southeast Asian").
