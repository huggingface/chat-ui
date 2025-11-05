# Codanna Hooks

This directory contains Claude Code hooks for the Codanna profile.

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure hooks in `.claude/settings.local.json`:**

   The hooks are already configured in the profile's settings file. They should reference this `codanna/` directory:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "npx --prefix \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna tsx \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna/skill-activation-prompt.ts"
             }
           ]
         }
       ],
       "PreToolUse": [
         {
           "matcher": "Read",
           "hooks": [
             {
               "type": "command",
               "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna/pre_read_use.js"
             }
           ]
         }
       ],
       "PostToolUse": [
         {
           "matcher": "*",
           "hooks": [
             {
               "type": "command",
               "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna/post_tool_use.js"
             }
           ]
         }
       ],
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna/stop.js"
             }
           ]
         }
       ],
       "SubagentStop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/codanna/subagent-stop.js"
             }
           ]
         }
       ]
     }
   }
   ```

## Hooks Overview

### UserPromptSubmit: `skill-activation-prompt.ts`
- **Trigger**: Before Claude sees user's prompt
- **Purpose**: Suggest relevant skills based on keywords and intent patterns
- **Output**: Injects skill reminders into Claude's context

### PreToolUse: `pre_read_use.js`
- **Trigger**: Before Read tool executes
- **Purpose**: Validate Read operations to prevent excessive line reads
- **Enforcement**:
  - Allow: ≤400 lines (silent)
  - Warn: 401-600 lines (shown to user, operation continues)
  - Block: >600 lines (shown to Claude, operation halted)
- **Logs**: `logs/tools/Read.jsonl`

### PostToolUse: `post_tool_use.js`
- **Trigger**: After any tool executes
- **Purpose**: Track tool usage and performance

### Stop: `stop.js`
- **Trigger**: When main session ends
- **Purpose**: Analyze session statistics (tokens, tools, duration)
- **Logs**:
  - `logs/stats/sessions.jsonl`
  - `logs/stats/latest-session.json`

### SubagentStop: `subagent-stop.js`
- **Trigger**: When subagent session ends
- **Purpose**: Analyze subagent session statistics
- **Logs**:
  - `logs/stats/subagent-sessions.jsonl`
  - `logs/stats/latest-subagent-session.json`

## Configuration

### `hooks-config.json`
Central configuration for all hooks:
- Read validation thresholds
- Tool tracking settings
- Session analytics options

### `skill-activation-prompt.ts` uses:
- `../../skills/skill-rules.json` - Skill trigger patterns

## Logs Directory Structure

```
logs/
├── tools/
│   └── Read.jsonl              # Read operation validations
└── stats/
    ├── sessions.jsonl          # Main session statistics
    ├── subagent-sessions.jsonl # Subagent session statistics
    ├── latest-session.json     # Most recent main session
    └── latest-subagent-session.json # Most recent subagent session
```

## Testing Hooks

Test fixtures are located in `tests/` directory. Use npm scripts for easy testing:

### Quick Testing
```bash
# Test all hooks
npm run test:all

# Test individual hooks
npm run test:prompt        # UserPromptSubmit - skill activation
npm run test:read-allow    # PreToolUse - allow (≤400 lines)
npm run test:read-warn     # PreToolUse - warn (401-600 lines)
npm run test:read-block    # PreToolUse - block (>600 lines)
npm run test:post-tool     # PostToolUse - tool tracking
```

### Manual Testing
You can also pipe fixture files directly:
```bash
# Test UserPromptSubmit
tsx skill-activation-prompt.ts < tests/test-prompt-input.json

# Test Read validation
node pre_read_use.js < tests/test-read-warn.json

# Test with custom input
echo '{"session_id":"test","prompt":"your test here"}' | tsx skill-activation-prompt.ts
```

### Test Fixtures
- `tests/test-prompt-input.json` - UserPromptSubmit test
- `tests/test-read-allow.json` - Read ≤400 lines (silent)
- `tests/test-read-warn.json` - Read 401-600 lines (warns)
- `tests/test-read-block.json` - Read >600 lines (blocks)
- `tests/test-post-tool.json` - PostToolUse test

## Environment Variables

- `CLAUDE_PROJECT_DIR`: Set by Claude Code to the profile directory
- `SKIP_SKILL_GUARDRAILS`: Set to `true` to disable all PreToolUse blocks (emergency override)

## Troubleshooting

1. **Hooks not executing:**
   - Verify paths in `.claude/settings.local.json`
   - Ensure `npm install` was run
   - Check `CLAUDE_PROJECT_DIR` is set correctly

2. **Logs not created:**
   - Hooks use `$CLAUDE_PROJECT_DIR || process.cwd()` for log location
   - When testing manually, run from the profile directory

3. **TypeScript hook fails:**
   - Ensure `tsx` is installed: `npm install -D tsx`
   - Check `tsconfig.json` exists

## Documentation

For detailed documentation on creating and managing skills, see:
- `../../skills/skill-developer/SKILL.md` - Main skill developer guide
- `../../skills/skill-rules.json` - Skill trigger configuration
