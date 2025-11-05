# Codanna Code Intelligence Workflow

## Query Optimization

Codanna's semantic search works best with technical terms and specific concepts. Before searching, optimize vague queries:

1. **If vague** (e.g., "that parsing thing") → Make it specific (e.g., "language parser implementation")
2. **If a question** (e.g., "how does parsing work?") → Extract keywords (e.g., "parsing implementation process")
3. **If conversational** (e.g., "the stuff that handles languages") → Use technical terms (e.g., "language handler processor")
4. **If too broad** (e.g., "errors") → Add context (e.g., "error handling exception management")

## Search and Explore

### Step 1: Semantic Search

```bash
codanna mcp semantic_search_with_context query:"your search" limit:5
```

Returns:
```
1. unified - Method at src/io/output.rs:257-301 [symbol_id:896]
   Similarity Score: 0.726
   Documentation: Output a UnifiedOutput structure...
```

You get:
- Line ranges: `257-301`
- Symbol ID: `[symbol_id:896]`
- Relevance score (focus on > 0.6)

### Step 2: Read Code

Use line ranges to read only what you need:

**Formula:** `limit = end_line - start_line + 1`

**Example:** For range `257-301`:
```
Read tool with:
  file_path: "src/io/output.rs"
  offset: 257
  limit: 45  (301 - 257 + 1)
```

**Alternative (Unix/macOS):**
```bash
sed -n '257,301p' src/io/output.rs
```

### Step 3: Explore Details

```bash
codanna retrieve describe symbol_id:896
```

Shows full signature, documentation, calls, and callers.

### Step 4: Follow Relationships

```bash
# Who calls it
codanna retrieve callers symbol_id:896

# What it calls
codanna retrieve calls symbol_id:896
```

### Step 5: Refine

Run semantic search again with refined terms.

---

## Quick Reference

**Semantic search (start here):**
```bash
codanna mcp semantic_search_with_context query:"..." limit:5
```

**Explore symbol:**
```bash
codanna retrieve describe <name|symbol_id:XXX>
```

**Relationships:**
```bash
codanna retrieve callers <name|symbol_id:XXX>
codanna retrieve calls <name|symbol_id:XXX>
```

**Direct lookup:**
```bash
codanna retrieve symbol <name>
```

---

## Tips

- Read only line ranges provided (saves tokens)
- Use symbol_id to chain commands
- Add `lang:rust` to filter by language
- Semantic search uses ~500 tokens, targeted reads use ~100-200 tokens
- Use `rg` (ripgrep) for pattern matching when available: `rg "pattern" src/`
