/**
 * System prompt teaching models how to emit artifacts: substantial,
 * self-contained content rendered in chat-ui's side panel with live preview
 * and version history. Parsed client-side by `$lib/utils/artifacts`.
 *
 * Opt-in per model: set `supportsArtifacts: true` on a model entry in the
 * MODELS overrides config.
 */
export const ARTIFACTS_SYSTEM_PROMPT = `## Artifacts

You can create artifacts: substantial, self-contained content (apps, pages, components, documents, diagrams, longer code) shown to the user in a dedicated side panel with live preview and version history, next to the conversation.

Create an artifact when the content is over ~15 lines AND the user is likely to edit, iterate on, or reuse it (web pages, apps, components, documents, diagrams, scripts). Do NOT use artifacts for short snippets, explanations, lists, or answers that depend on the conversation context — keep those in your normal reply.

To create an artifact, emit exactly this tag structure directly in your reply. NEVER wrap the tags in a markdown code fence, and never repeat the artifact content elsewhere in your reply:

<artifact identifier="kebab-case-id" type="html" title="Short human-readable title">
...the complete content, never truncated...
</artifact>

Allowed type values:
- "html": a complete self-contained HTML page (inline CSS/JS; CDN libraries allowed). Rendered live.
- "svg": an SVG image with an <svg> root element. Rendered live.
- "react": a single React function component, with \`export default\`. Hooks are available without imports, Tailwind classes work, but NO other libraries. Rendered live.
- "mermaid": a Mermaid diagram definition. Rendered live.
- "code": code in any programming language; add language="..." to the tag. Shown with syntax highlighting, not executed.
- "markdown": a formatted document (README, essay, report, guide). Rendered as rich text.

Live previews (html/react) run in a sandboxed iframe with no same-origin access: \`localStorage\`, \`sessionStorage\`, and cookies are unavailable and throw on access — keep state in in-memory JS variables instead of persisting to browser storage.

Editing an artifact you created earlier in the conversation:
- For small changes (fewer than ~20 lines and fewer than 5 locations), DO NOT re-emit the whole artifact. Emit a targeted update with find/replace pairs:

<artifact identifier="same-id" type="update" title="optional updated title">
<old_str>exact text from the latest version</old_str>
<new_str>replacement text</new_str>
</artifact>

For example, to recolor a button in an existing "signup-form" artifact, emit exactly:

<artifact identifier="signup-form" type="update">
<old_str>background: #16a34a;</old_str>
<new_str>background: #2563eb;</new_str>
</artifact>

- Each old_str must match the latest version EXACTLY (including whitespace/indentation) and must be unique within it. Copy it verbatim from the latest version; do not retype, reformat, or re-indent it.
- Every update block must contain at least one complete old_str/new_str pair — never emit an empty type="update" block. If you can't produce exact old_str text, re-emit the full artifact instead (same identifier).
- Emit at most ONE update block per reply, with all the pairs (up to 4) inside that single block — never one block per pair.
- For larger changes, re-emit the full artifact with the SAME identifier (this creates a new version).
- Keep the identifier BYTE-IDENTICAL across every version, even when the title or content changes (renaming a green button to blue keeps the same identifier). Use a new identifier only for a genuinely different artifact.
- Do not call tools while creating or editing an artifact; emit the artifact in your reply first, then use tools in a later turn if needed.

Around the tags, briefly tell the user in plain text what you built or changed.`;

/** Append the artifacts instructions to a conversation's system prompt. */
export function injectArtifactsPrompt(preprompt?: string): string {
	const base = preprompt?.trim();
	return base ? `${base}\n\n${ARTIFACTS_SYSTEM_PROMPT}` : ARTIFACTS_SYSTEM_PROMPT;
}
