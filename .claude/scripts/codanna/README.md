# Codanna Context Provider Scripts

Node.js utilities that provide structured context from Codanna CLI to Claude Code slash commands.

## Architecture

```
┌─────────────────┐
│ Slash Command   │ /symbol, /find, etc.
└────────┬────────┘
         │ Invokes via Bash tool
         ▼
┌─────────────────┐
│ context-provider│ Main CLI entry point
└────────┬────────┘
         │
    ┌────┴────┬──────────┬───────────┐
    ▼         ▼          ▼           ▼
┌────────┐ ┌──────┐ ┌──────────┐ ┌──────────┐
│Executor│ │Schema│ │Formatter │ │  Config  │
│        │ │Valid │ │          │ │ Resolver │
└────────┘ └──────┘ └──────────┘ └──────────┘
    │
    ▼
┌─────────────────┐
│  codanna CLI    │ --config /path/to/settings.toml
└─────────────────┘
```

## Design Principles

**1. Token Efficiency**
- Pre-process JSON responses before presenting to Claude
- Format output for readability (markdown/json/compact)
- Filter irrelevant data

**2. Configuration Discovery**
- Read `.codanna/.project-id` from working directory
- Lookup project in `~/.codanna/projects.json`
- Resolve settings path automatically
- Support monorepos (multiple indexes)

**3. Zero-Config for Simple Cases**
- Works out of the box with default settings
- Explicit configuration only for edge cases
- Uses `CLAUDE_WORKING_DIR` environment variable

## Components

### context-provider.js
Main CLI interface for slash commands.

**Commands:**
```bash
node context-provider.js symbol <name> [--format=markdown|json|compact] [--lang=rust|python|...]
node context-provider.js callers <function-name|symbol_id:ID> [--lang=...]
node context-provider.js calls <function-name|symbol_id:ID> [--lang=...]
node context-provider.js search <query> [--limit=5] [--lang=...]
node context-provider.js describe <symbol-name|symbol_id:ID> [--lang=...]
node context-provider.js find <query> [--limit=5] [--lang=...] [--format=markdown|json|compact]
```

**Output formats:**
- `markdown` (default): Rich formatted output with relationships
- `json`: Raw JSON for programmatic use
- `compact`: One-line summary

### lib/executor.js
Executes Codanna CLI commands and parses JSON responses.

**Key features:**
- Uses `ConfigResolver` to find project settings
- Adds `--config` flag automatically when settings.toml exists
- Handles exit code 3 (not found) gracefully
- Runs in `CLAUDE_WORKING_DIR` or `process.cwd()`

**Methods:**
- `findSymbol(name)` → Symbol details with relationships
- `findCallers(name)` → Functions that call this symbol
- `findCalls(name)` → Functions called by this symbol
- `search(query, limit)` → Full-text search results
- `describe(name)` → Comprehensive symbol information

### lib/config-resolver.js
Discovers Codanna configuration using existing infrastructure.

**Resolution flow:**
```
1. Read .codanna/.project-id from working directory
2. Load ~/.codanna/projects.json global registry
3. Find project path by ID
4. Return path to {project_path}/.codanna/settings.toml
5. Fallback: .codanna/settings.toml in current directory
```

**Methods:**
- `readProjectId()` → Project UUID
- `loadProjectsRegistry()` → Global projects index
- `findProjectPath(id)` → Absolute path to project
- `resolveSettingsPath()` → Path to settings.toml
- `getCodannaCommand(binary)` → Command with --config flag
- `getProjectMetadata()` → Symbol count, file count, last modified

### lib/validator.js
Validates JSON responses against schemas.

**Capabilities:**
- Loads schemas from `schemas/` directory
- Basic validation (required fields, enum values)
- Schema caching for performance
- Extensible for full JSON Schema validation (ajv)

### formatters/symbol.js
Transforms symbol data into readable output.

**Format methods:**
- `format(response)` → Markdown with full context
- `formatCompact(response)` → One-line summary
- `formatJson(response)` → Pretty-printed JSON

**Markdown output includes:**
- Symbol metadata (kind, language, visibility)
- Location (file:line, module path)
- Signature and documentation
- Relationships (implements, calls, called_by, defines)
- Scope context

### schemas/symbol.json
JSON Schema definition for Codanna symbol responses.

**Response structure:**
```json
{
  "status": "success|not_found|error",
  "entity_type": "symbol",
  "count": 1,
  "items": [{
    "symbol": { "id", "name", "kind", "signature", ... },
    "file_path": "src/file.rs:line",
    "relationships": {
      "implements": [...],
      "called_by": [...],
      "calls": [...],
      "defines": [...]
    }
  }]
}
```

## Symbol ID Workflow

Commands display `[symbol_id:123]` for all symbols, enabling unambiguous follow-up queries.

**Example workflow:**
```bash
# Step 1: Find symbols with semantic search
node context-provider.js find "error handling" --limit=3

# Output shows:
# 1. handle_error (Function) [symbol_id:1234]
#    - Calls: validate_input (Function) [symbol_id:5678]
#    - Called by: process_file (Function) [symbol_id:9012]

# Step 2: Investigate specific symbol using its ID (unambiguous)
node context-provider.js calls symbol_id:1234

# Step 3: Follow relationships
node context-provider.js describe symbol_id:5678
```

**Why symbol_id:**
- **Unambiguous**: Works even when multiple symbols have the same name
- **Workflow-optimized**: Copy ID from search results, paste into next command
- **Token-efficient**: No need to re-search or disambiguate

## Usage from Slash Commands

### Pattern 1: Auto-execution (Context Gathering)
```markdown
---
allowed-tools: Bash(node:*)
---

!`node .claude/scripts/codanna/context-provider.js symbol $1`

Based on the symbol above, ...
```

**Use when:** Gathering context before Claude decides what to do.

### Pattern 2: Workflow Instructions
```markdown
---
description: Ask a question about a symbol
---

## Your task

1. Execute: `node .claude/scripts/codanna/context-provider.js symbol $1`
2. Analyze the output
3. Answer the question: "$2"
```

**Use when:** Claude should control when and how to fetch data.

## Language Filtering

Reduces noise in polyglot codebases.

```bash
# Filter by language
node context-provider.js symbol main --lang=rust
node context-provider.js search "parse" --lang=python --limit=10
```

**Supported languages:** rust, python, typescript, go, php, c, cpp

**Error handling:**
- Not found with language filter → Suggests removing filter
- Shows language badge in results `[rust]`, `[python]`
- Language filter indicator in search output

## Configuration

The system uses Codanna's existing infrastructure:

**Project identification:**
```
.codanna/.project-id          → UUID (e.g., de9a0dcf92ce...)
~/.codanna/projects.json      → Registry of all indexed projects
{project}/.codanna/settings.toml → Project-specific settings
```

**No manual configuration needed** - the resolver automatically:
1. Detects the current project
2. Finds the correct index
3. Applies the right settings

**For monorepos:**
Each package can have its own `.codanna/.project-id`, pointing to separate indexes.

## Error Handling

**Exit codes:**
- `0`: Success
- `1`: Execution error (printed to stderr)
- `3`: Not found (Codanna returns JSON with status="not_found")

**Error messages:**
- Include context when language filter applied
- Suggest remediation (remove filter, check if indexed)
- Preserve structured JSON output with `--format=json`

## Extension Points

**Adding new commands:**
1. Add method to `ContextProvider` class
2. Handle in `run()` switch statement
3. Create formatter if needed
4. Add schema for validation
5. Update usage documentation

**Adding new formatters:**
1. Create `formatters/{type}.js`
2. Implement static methods: `format()`, `formatCompact()`, `formatJson()`
3. Export class

**Adding new schemas:**
1. Create `schemas/{type}.json`
2. Define JSON Schema structure
3. Validator auto-loads from filename

## Performance

**Optimization strategy:**
- JSON parsing happens once in Node.js
- Formatted output reduces Claude's parsing work
- Compact format for simple queries
- Schema validation is minimal (basic checks only)

**Typical execution times:**
- Symbol lookup: <50ms
- Search (5 results): <100ms
- Config resolution: <10ms (cached in-memory)

## Development

**Testing:**
```bash
# Test symbol lookup
node .claude/scripts/codanna/context-provider.js symbol index_file

# Test with formatting
node .claude/scripts/codanna/context-provider.js symbol main --format=compact

# Test language filtering
node .claude/scripts/codanna/context-provider.js search "parse" --lang=rust --limit=3

# Test search
node .claude/scripts/codanna/context-provider.js search "indexing" --limit=10
```

**Debugging config resolution:**
```bash
node -e "
const ConfigResolver = require('./.claude/scripts/codanna/lib/config-resolver');
const resolver = new ConfigResolver();
console.log('Project ID:', resolver.readProjectId());
console.log('Settings:', resolver.resolveSettingsPath());
console.log('Command:', resolver.getCodannaCommand());
"
```

## Integration with Claude Code

**Environment variables used:**
- `CLAUDE_WORKING_DIR` → Set by Claude Code, used as working directory

**Tool requirements:**
- Slash commands must include `allowed-tools: Bash(node:*)` for auto-execution
- Or inherit from conversation for manual execution

**Argument passing:**
- `$1`, `$2`, etc. → Positional arguments
- `$ARGUMENTS` → All arguments as string
- Quoted strings preserved: `"multi word arg"`

## Why This Design?

**Separation of concerns:**
- Codanna CLI: Index management, querying
- Node.js scripts: JSON parsing, workflow piping, formatting, and config discovery.
- Claude: Analysis, reasoning, answering questions

**Benefits:**
- Reduces Claude's token usage (pre-computed & pre-formatted output)
- Reuses Codanna's project infrastructure
- Works seamlessly with monorepos
- Extensible for new query types
- Testable independently of Claude

**Trade-offs:**
- Requires Node.js runtime
- Must keep schemas in sync with Codanna output

## Future Enhancements

**Potential improvements:**
- Full JSON Schema validation with ajv
- Caching for repeated queries
- Batch operations (multiple symbols at once)
