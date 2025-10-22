# Web Search Fix - Test Guide

## Summary

Fixed the web search query builder to ensure it correctly picks the **last user message** from a conversation, preventing the "wrong query" bug.

## Implementation Details

### 1. Query Builder (`src/lib/tools/webSearch.ts`)

- **Strategy**: Prefer the most recent (last) user message in the conversation
- **Fallback**: If no user messages exist, use the most recent any message
- **Sanitization**: Strips code fences, inline code, and citation markers `[1]`, `[12]`, etc.

**Key Function**:

```typescript
export function buildWebSearchQuery(messages: Message[] = []): string {
	// Loop from END of messages array backwards to find LAST user message
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.from === "user" && m.content && m.content.trim().length) {
			return stripMarkdownAndCitations(m.content);
		}
	}
	// ... fallback logic
}
```

### 2. Unit Tests (`src/lib/tools/webSearch.test.ts`)

Four test cases verify correctness:

- ✅ Empty conversation returns empty string
- ✅ **Picks the LAST user message** (not first)
- ✅ Falls back to assistant message if no user messages
- ✅ Strips markdown code fences, inline code, and citations

### 3. Server Endpoint (`src/routes/api/tools/websearch/+server.ts`)

- Accepts POST request with message history
- Returns the correct query built from last user message
- Prevents "wrong query" by using deterministic builder

## How to Test

### Test 1: Verify Query Builder Selects Correct Message

```bash
curl -X POST http://localhost:5173/api/tools/websearch \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"from": "user", "content": "first question"},
      {"from": "assistant", "content": "first answer"},
      {"from": "user", "content": "second question - THIS SHOULD BE PICKED"}
    ]
  }'
```

**Expected Response**:

```json
{ "query": "second question - THIS SHOULD BE PICKED" }
```

### Test 2: Verify Markdown Sanitization

```bash
curl -X POST http://localhost:5173/api/tools/websearch \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "from": "user",
        "content": "Show code:\n\`\`\`python\nprint(1)\n\`\`\`\n[1] See also `x=1`"
      }
    ]
  }'
```

**Expected Response**:

```json
{ "query": "Show code: See also" }
```

(Code blocks, inline code, and citations removed)

### Test 3: Run Unit Tests

```bash
npm test -- src/lib/tools/webSearch.test.ts --run
```

## Why This Fixes the Bug

**Before**: If web search didn't explicitly select the last user message, it might:

- Use the first message instead of the most recent question
- Include assistant responses or system messages
- Search for the wrong topic due to confusion in message order

**After**: With our deterministic query builder:

- Always searches for the **last user query** (most recent intent)
- Strips formatting noise (code, citations)
- Fully testable with unit tests
- Consistent and predictable behavior

## Files Modified/Created

1. `src/lib/tools/webSearch.ts` - Query builder utility
2. `src/lib/tools/webSearch.test.ts` - Unit tests (4 passing)
3. `src/routes/api/tools/websearch/+server.ts` - Server endpoint
