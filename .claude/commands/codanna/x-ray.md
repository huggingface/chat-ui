---
allowed-tools: Bash(node .claude/scripts/codanna/context-provider.js:*)
description: Deep codebase exploration using semantic search and relationship mapping
argument-hint: "<query>"
---

## Search Query Analysis

**User's Original Query**: "$ARGUMENTS"

### Query Optimization

Codanna's semantic search works best with technical terms and specific concepts. Analyze the query above and improve it for code search:

1. **If vague** (e.g., "that parsing thing") → Make it specific (e.g., "language parser implementation")
2. **If a question** (e.g., "how does parsing work?") → Extract keywords (e.g., "parsing implementation process")
3. **If conversational** (e.g., "the stuff that handles languages") → Use technical terms (e.g., "language handler processor")
4. **If too broad** (e.g., "errors") → Add context (e.g., "error handling exception management")

**OptimizedQuery**: _{Claude: Write your improved query here, then use it below}_

Execute this command with your optimized query:

## Your Workflow <Workflow>

### Gather Context <Step_1 GatherContext>

Use the Bash tool to perform semantic code search:

Execute: `node .claude/scripts/codanna/context-provider.js find "$OptimizedQuery" --limit=5`

**What Codanna returns:**
- Relevance scores (how well each result matches)
- Symbol signatures and documentation
- Relationships (calls, called_by, implements, defines)
- File locations with line ranges

### Your Workflow <Step_2 YourWorkflow>

1. Analyze the results with their relevance scores (focus on results with score > 0.6 (if possible))

2. **To see actual implementation** of interesting results:
   - Use the line range from the Location field to read just the relevant code
   - Example: If you see "Location: `src/io/exit_code.rs:108-120`"
   - Use the Read tool with:
      - `file_path`: `src/io/exit_code.rs` (use the working directory from your environment context <env> to construct the absolute path)
      - `offset`: 108 (start line)
      - `limit`: 13 (calculated as: 120 - 108 + 1)
   - Formula: `limit = end_line - start_line + 1`
   - Example: `Read(file_path="/full/path/to/src/io/exit_code.rs", offset=108, limit=13)`

3. **When relationships are shown** (called_by, calls, defines, implements):
   - If a relationship looks relevant to answering the query, investigate it
   - Execute: `node .claude/scripts/codanna/context-provider.js describe <relationship_symbol_name|symbol_id:ID>`
   - Example: If you see "Called by: `initialize_registry [symbol_id:123]`", run: `node .claude/scripts/codanna/context-provider.js describe initialize_registry` or `describe symbol_id:123`
   - Note: Following 1-2 key relationships per result is typically sufficient

4. Build a complete picture by following key relationships and reading relevant code sections

5. **If needed**, repeat <Step_1: GatherContext> with a refined query based on what you learned.

---

## Tips for Efficient Exploration

**The results include:**
- Relevance scores (how well each result matches the query)
- Symbol documentation and signatures
- Relationships (who calls this, what it calls, what it defines)
- System guidance for follow-up investigation

**sed (native on unix only):**
- You can also see actual implementation with `sed`: (works native on Unix based environments):
   - Use the line range from the Location field to read just the relevant code
   - Example: If you see "Location: `src/io/exit_code.rs:108-120`"
   - Execute: `sed -n '108,120p' src/io/exit_code.rs` to read lines 108-120
   - This shows the actual code implementation, not just the signature. It works like the Read tool.

- Add `--lang=rust` (or python, typescript, etc.) to narrow results by language if you work on multi-language projects
- Follow relationships that appear in multiple results (they're likely important)
- Use the `describe` command to get full details about interesting relationships

**Token awareness:**
- Each search uses ~500 tokens
- Each relationship follow uses ~300 tokens
- Each file read uses ~100-500 tokens (depends on size)
- Staying efficient keeps your context window clean for deeper analysis

**This command is for exploration:**
- Build understanding of the codebase
- Identify patterns and integration points
- Present findings and await user direction
- Don't start implementing or making changes yet

Based on the gathered context, engage with the user to narrow focus and help the user with further request.
