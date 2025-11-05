---
description: Looks up a symbol by name. Returns its location, signature, line range, documentation, calls, callers, implementations, and definitions.
argument-hint: <symbol-name> "<question>"
---

## Context

Symbol to analyze: **$1**

User's question: **$2**

## Your task

Use the Bash tool to fetch symbol information, then answer the user's question.

**Workflow:**
1. Execute: `node .claude/scripts/codanna/context-provider.js symbol $1`
2. Analyze the symbol details returned (includes `[symbol_id:123]` for all symbols)
3. Answer the question: "$2"

When answering:
- Reference actual code locations (file:line_range)
- Explain relationships (calls, called_by, implements, defines)
- Use the signature and documentation from the symbol
- Be specific about how the symbol is used in the codebase

**Following relationships:**
- Use `<symbol_name|symbol_id:ID>` for follow-up queries
- Commands: `calls`, `callers`, `describe` accept either format

Focus on what the code actually shows, not general programming principles.
