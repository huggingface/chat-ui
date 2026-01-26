# Skills Integration Research for HuggingChat

## Executive Summary

This document presents a comprehensive research analysis for integrating [Anthropic Agent Skills](https://github.com/anthropics/skills) into HuggingChat (chat-ui). Skills are a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows. They address a fundamental challenge: **giving agents task-specific knowledge without overwhelming context windows, while maintaining portability and auditability**.

The Skills framework is emerging as an **open industry standard**, already adopted by 20+ agent products including VS Code, Cursor, Goose, Amp, OpenCode, and GitHub Copilot.

---

## Table of Contents

1. [What Are Agent Skills?](#1-what-are-agent-skills)
2. [Current chat-ui Architecture](#2-current-chat-ui-architecture)
3. [Integration Architecture Proposal](#3-integration-architecture-proposal)
4. [Implementation Phases](#4-implementation-phases)
5. [Technical Deep Dive](#5-technical-deep-dive)
6. [UI/UX Design Patterns](#6-uiux-design-patterns)
7. [Security Considerations](#7-security-considerations)
8. [Configuration & Environment](#8-configuration--environment)
9. [Files to Create/Modify](#9-files-to-createmodify)
10. [Comparison with Alternatives](#10-comparison-with-alternatives)

---

## 1. What Are Agent Skills?

### 1.1 Definition

Agent Skills are **folders containing instructions, scripts, and resources** that agents can discover and load dynamically to improve performance on specialized tasks. They solve the problem of agents lacking context needed for reliable real-world work.

### 1.2 Core Benefits

| Benefit | Description |
|---------|-------------|
| **Procedural Knowledge** | Teaching Claude how to complete specific tasks in a repeatable way |
| **Domain Expertise** | Packaging specialized knowledge into reusable instructions |
| **Efficient Context** | Progressive disclosure loads information only when needed |
| **Portability** | Works across Claude.ai, Claude Code, Claude Agent SDK, and third-party tools |
| **Interoperability** | Same skill works across 20+ skills-compatible agent products |

### 1.3 Skill Structure

```
skill-name/
├── SKILL.md          # Required: instructions + metadata
├── scripts/          # Optional: executable code (Python, Bash, JS)
├── references/       # Optional: documentation files
└── assets/           # Optional: templates, resources
```

### 1.4 SKILL.md Format

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents.
license: Apache-2.0
compatibility: Requires python>=3.8, poppler-utils
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Bash(jq:*) Read
---

# PDF Processing

## When to use this skill
Use this skill when the user needs to work with PDF files...

## How to extract text
1. Use pdfplumber for text extraction...

## Examples
- Extract text: `page.extract_text()`
- Merge PDFs: `writer.add_page(page)`
```

### 1.5 Three-Tier Progressive Disclosure

Skills use a token-efficient loading strategy:

| Tier | What's Loaded | Token Cost | When |
|------|---------------|------------|------|
| **Tier 1: Discovery** | `name` + `description` from frontmatter only | ~100 tokens/skill | At startup |
| **Tier 2: Activation** | Full `SKILL.md` body | ~5000 tokens max | When task matches skill |
| **Tier 3+: Execution** | Referenced files (scripts, references) | Variable | On demand |

---

## 2. Current chat-ui Architecture

### 2.1 Text Generation Pipeline

```
┌─────────────────────────────────────────────────────┐
│ HTTP Endpoint: POST /conversation/[id]              │
├─────────────────────────────────────────────────────┤
│ Request Handling & Validation                       │
├─────────────────────────────────────────────────────┤
│ Conversation Tree Building                          │
├─────────────────────────────────────────────────────┤
│ Message Preprocessing Pipeline                      │  ◄── EXTENSION POINT A
├─────────────────────────────────────────────────────┤
│ TextGeneration Context Setup                        │  ◄── EXTENSION POINT B
├─────────────────────────────────────────────────────┤
│ Parallel Generation Flows:                          │
│ ├─ Title Generator (async)                          │
│ ├─ Text Generator (MCP or fallback)                 │  ◄── EXTENSION POINT C
│ └─ Keep-Alive Heartbeat                             │
├─────────────────────────────────────────────────────┤
│ MCP Flow (Tool Calling Loop):                       │
│ ├─ Server discovery & tool listing                  │  ◄── EXTENSION POINT D
│ ├─ Preprompt injection                              │  ◄── EXTENSION POINT E
│ ├─ OpenAI completion with tools                     │
│ ├─ Tool execution loop (up to 10x)                  │  ◄── EXTENSION POINT F
│ └─ Follow-up completions with tool results          │
├─────────────────────────────────────────────────────┤
│ Message Update Handler                              │  ◄── EXTENSION POINT G
├─────────────────────────────────────────────────────┤
│ ReadableStream (client receives as JSONL)           │
└─────────────────────────────────────────────────────┘
```

### 2.2 Existing MCP Integration

chat-ui already has robust MCP (Model Context Protocol) integration that provides:

- **Server registry** with runtime configuration
- **Tool discovery** via `listTools()`
- **Tool execution** with streaming progress
- **Connection pooling** with automatic cleanup
- **Error recovery** with graceful fallbacks
- **Agentic loop** (up to 10 iterations)

### 2.3 Router System

The LLM router provides capability-aware model selection:

- **Multimodal routing**: Image input → multimodal-capable model
- **Tools routing**: MCP servers active → tools-capable model
- **Arch routing**: Intent classification → best-fit model
- **Fallback chain**: Primary → fallbacks → global fallback

---

## 3. Integration Architecture Proposal

### 3.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    HuggingChat + Skills                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐  │
│  │   Skills    │   │   Skills    │   │   Skills Runtime    │  │
│  │  Registry   │──▶│  Selector   │──▶│   (Execution Env)   │  │
│  └─────────────┘   └─────────────┘   └─────────────────────┘  │
│        ▲                 │                      │              │
│        │                 ▼                      ▼              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐  │
│  │   Skills    │   │  Preprompt  │   │   MCP Integration   │  │
│  │   Sources   │   │  Injection  │   │   (Tool Execution)  │  │
│  └─────────────┘   └─────────────┘   └─────────────────────┘  │
│        │                 │                      │              │
│        │                 ▼                      │              │
│        │         ┌─────────────┐               │              │
│        │         │    LLM      │◀──────────────┘              │
│        │         │  Endpoint   │                              │
│        │         └─────────────┘                              │
│        │                                                      │
│  Sources:                                                     │
│  ├─ Built-in (bundled with chat-ui)                          │
│  ├─ Environment (SKILLS_PATH, SKILLS_URL)                    │
│  ├─ User-uploaded (per conversation)                         │
│  └─ Hub (Hugging Face Spaces/Datasets)                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 Core Components

#### 3.2.1 Skills Registry

```typescript
// src/lib/server/skills/registry.ts

interface SkillMetadata {
  name: string;                    // Unique identifier
  description: string;             // When to use (for discovery)
  path: string;                    // Full path to SKILL.md
  source: "builtin" | "env" | "user" | "hub";
  version?: string;
  author?: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];         // Pre-approved tools
}

interface SkillRegistry {
  // Tier 1: Discovery
  listSkills(): SkillMetadata[];

  // Tier 2: Activation
  loadSkill(name: string): Promise<SkillContent>;

  // Tier 3: Resources
  loadSkillResource(name: string, resourcePath: string): Promise<string>;

  // Management
  registerSkill(skill: SkillMetadata): void;
  refreshSkills(): Promise<void>;
}
```

#### 3.2.2 Skills Selector

```typescript
// src/lib/server/skills/selector.ts

interface SkillSelector {
  // Automatic selection based on user message
  selectSkills(
    messages: Message[],
    availableSkills: SkillMetadata[]
  ): Promise<SkillMetadata[]>;

  // LLM-based classification for ambiguous cases
  classifyIntent(
    userMessage: string,
    skills: SkillMetadata[]
  ): Promise<{ skill: string; confidence: number }[]>;
}
```

#### 3.2.3 Skills Runtime

```typescript
// src/lib/server/skills/runtime.ts

interface SkillsRuntime {
  // Context injection
  buildSkillsPreprompt(skills: SkillMetadata[]): string;

  // Script execution (sandboxed)
  executeScript(
    skillName: string,
    scriptPath: string,
    args: Record<string, unknown>
  ): Promise<ScriptResult>;

  // MCP tool integration
  getSkillTools(skills: SkillMetadata[]): OpenAiTool[];
}
```

### 3.3 Integration with Existing Systems

#### MCP Synergy

Skills and MCP are **complementary**, not competing:

| Aspect | MCP | Skills | Combined |
|--------|-----|--------|----------|
| **Focus** | Tool execution | Domain knowledge | Tools + Knowledge |
| **Format** | Protocol (transport-agnostic) | File-based (SKILL.md) | Skills can expose MCP tools |
| **Runtime** | Remote servers | Local/bundled | Skills can invoke MCP servers |
| **State** | Stateless per call | Stateful knowledge | Skills provide context for tools |

**Implementation Strategy**:
1. Skills provide **domain knowledge** (SKILL.md instructions)
2. Skills can bundle **scripts** that become MCP-like tools
3. Skills can reference **MCP servers** for external capabilities
4. The existing MCP loop handles execution

#### Router Integration

```typescript
// Skills-aware routing in src/lib/server/router/

// New route type for skills
{
  "name": "pdf_processing",
  "description": "Document manipulation tasks requiring PDF skill",
  "primary_model": "model-with-code-execution",
  "requires_skills": ["pdf"],
  "fallback_models": [...]
}

// Route selection considers skill requirements
if (activeSkills.some(s => s.compatibility?.includes("code_execution"))) {
  return selectCodeExecutionCapableModel();
}
```

---

## 4. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic skills discovery and preprompt injection

- [ ] Create skills registry with file system scanning
- [ ] Implement SKILL.md parser (YAML frontmatter + Markdown body)
- [ ] Add skills metadata to system prompt (Tier 1)
- [ ] Create `/api/v2/skills` endpoint for listing skills
- [ ] Add `SKILLS_PATH` environment variable

**Deliverables**:
- Skills appear in conversation context
- LLM can reference skill instructions
- Basic API for skill discovery

### Phase 2: Activation & UI (Week 3-4)

**Goal**: Skills selection UI and full content injection

- [ ] Implement skill activation (Tier 2 loading)
- [ ] Create skills selection component (sidebar/modal)
- [ ] Add per-conversation skill configuration
- [ ] Implement skill search and filtering
- [ ] Store skill selections in conversation metadata

**Deliverables**:
- Users can browse and select skills
- Selected skills inject full instructions
- Conversation-level skill persistence

### Phase 3: Execution Runtime (Week 5-6)

**Goal**: Execute skill scripts safely

- [ ] Implement sandboxed script execution
- [ ] Create skill-to-MCP-tool adapter
- [ ] Add skill script progress streaming
- [ ] Implement resource loading (Tier 3)
- [ ] Add skill execution metrics/logging

**Deliverables**:
- Skills with scripts can execute code
- Results stream back to conversation
- Audit trail for skill usage

### Phase 4: Hub Integration (Week 7-8)

**Goal**: Community skills from Hugging Face Hub

- [ ] Create Skills Hub browser component
- [ ] Implement Hub skill fetching (`hf.co/spaces/skills/*`)
- [ ] Add skill installation/management
- [ ] Implement skill versioning and updates
- [ ] Create skill rating/feedback system

**Deliverables**:
- Browse community skills from Hub
- Install skills from Hub to conversation
- Version management and updates

### Phase 5: Advanced Features (Week 9+)

**Goal**: Power user and enterprise features

- [ ] Skill composition (skills referencing skills)
- [ ] Custom skill creation UI
- [ ] Skill sharing and publishing
- [ ] Enterprise skill policies
- [ ] Skill analytics dashboard

---

## 5. Technical Deep Dive

### 5.1 Skills Registry Implementation

```typescript
// src/lib/server/skills/registry.ts

import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { glob } from "glob";

const SkillFrontmatterSchema = z.object({
  name: z.string().max(64).regex(/^[a-z0-9-]+$/),
  description: z.string().max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string()).optional(),
  "allowed-tools": z.string().optional(),
});

export class SkillsRegistry {
  private skills: Map<string, SkillMetadata> = new Map();
  private skillsPath: string[];

  constructor() {
    this.skillsPath = (env.SKILLS_PATH || "").split(":").filter(Boolean);
  }

  async discover(): Promise<void> {
    for (const basePath of this.skillsPath) {
      const skillDirs = await glob(`${basePath}/*/SKILL.md`);

      for (const skillMdPath of skillDirs) {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const { frontmatter, body } = this.parseFrontmatter(content);

        const validated = SkillFrontmatterSchema.parse(frontmatter);

        this.skills.set(validated.name, {
          ...validated,
          path: path.dirname(skillMdPath),
          source: "env",
          bodyPreview: body.slice(0, 500), // For search
        });
      }
    }

    logger.info(`Discovered ${this.skills.size} skills`);
  }

  // Tier 1: Return only metadata (~100 tokens per skill)
  listSkills(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  // Tier 2: Load full SKILL.md content
  async loadSkill(name: string): Promise<SkillContent> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);

    const content = await fs.readFile(
      path.join(skill.path, "SKILL.md"),
      "utf-8"
    );

    return {
      metadata: skill,
      body: this.stripFrontmatter(content),
    };
  }

  // Tier 3: Load additional resources
  async loadResource(name: string, resourcePath: string): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);

    const fullPath = path.join(skill.path, resourcePath);
    // Security: Ensure path is within skill directory
    if (!fullPath.startsWith(skill.path)) {
      throw new Error("Path traversal attempt blocked");
    }

    return fs.readFile(fullPath, "utf-8");
  }
}
```

### 5.2 Preprompt Injection

```typescript
// src/lib/server/skills/preprompt.ts

export function buildSkillsDiscoveryPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";

  const skillsXml = skills.map(s => `
  <skill>
    <name>${s.name}</name>
    <description>${s.description}</description>
    <location>${s.path}/SKILL.md</location>
  </skill>`).join("\n");

  return `
<available_skills>
${skillsXml}
</available_skills>

When a user's request matches one of the available skills:
1. Read the skill's SKILL.md file to get detailed instructions
2. Follow the skill's procedures exactly
3. Load additional resources from the skill as needed

Only read skills that are directly relevant to the user's current request.
`;
}

export function buildSkillActivationPrompt(
  skill: SkillContent
): string {
  return `
<active_skill name="${skill.metadata.name}">
${skill.body}
</active_skill>

Follow the instructions in the active skill above for this task.
`;
}
```

### 5.3 Integration with Text Generation

```typescript
// src/lib/server/textGeneration/skills/integration.ts

export async function injectSkillsContext(
  ctx: TextGenerationContext,
  skillsRegistry: SkillsRegistry
): Promise<TextGenerationContext> {
  // Get available skills
  const allSkills = skillsRegistry.listSkills();

  // Get conversation's active skills (user-selected)
  const activeSkillNames = ctx.conv.skills || [];
  const activeSkills = await Promise.all(
    activeSkillNames.map(name => skillsRegistry.loadSkill(name))
  );

  // Build combined preprompt
  const skillsDiscovery = buildSkillsDiscoveryPrompt(
    allSkills.filter(s => !activeSkillNames.includes(s.name))
  );

  const skillsActivation = activeSkills
    .map(buildSkillActivationPrompt)
    .join("\n\n");

  // Merge with existing preprompt
  const enhancedPreprompt = [
    ctx.conv.preprompt,
    skillsDiscovery,
    skillsActivation,
  ].filter(Boolean).join("\n\n");

  return {
    ...ctx,
    conv: {
      ...ctx.conv,
      preprompt: enhancedPreprompt,
    },
  };
}
```

### 5.4 Skill Script Execution

```typescript
// src/lib/server/skills/runtime.ts

import { spawn } from "child_process";
import { createSandbox } from "./sandbox";

interface ScriptResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export async function executeSkillScript(
  skill: SkillMetadata,
  scriptPath: string,
  args: Record<string, unknown>,
  onProgress?: (progress: string) => void
): Promise<ScriptResult> {
  const sandbox = await createSandbox({
    workDir: skill.path,
    timeout: env.SKILL_SCRIPT_TIMEOUT_MS || 30000,
    allowedCommands: parseAllowedTools(skill.allowedTools),
  });

  const start = Date.now();

  try {
    const result = await sandbox.execute(scriptPath, args, {
      onStdout: onProgress,
      onStderr: onProgress,
    });

    return {
      success: true,
      output: result.stdout,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error.message,
      duration: Date.now() - start,
    };
  } finally {
    await sandbox.cleanup();
  }
}
```

### 5.5 Skills as MCP Tools Adapter

```typescript
// src/lib/server/skills/mcpAdapter.ts

import type { OpenAiTool } from "../mcp/tools";

export function skillScriptsToMcpTools(
  skill: SkillContent
): OpenAiTool[] {
  const scripts = await glob(`${skill.metadata.path}/scripts/*.{py,sh,js}`);

  return scripts.map(scriptPath => {
    const name = path.basename(scriptPath, path.extname(scriptPath));
    const ext = path.extname(scriptPath);

    return {
      type: "function",
      function: {
        name: `${skill.metadata.name}_${name}`,
        description: `Execute ${name} script from ${skill.metadata.name} skill`,
        parameters: {
          type: "object",
          properties: {
            args: {
              type: "object",
              description: "Arguments to pass to the script",
            },
          },
        },
      },
      // Custom metadata for skill execution
      __skill: {
        skillName: skill.metadata.name,
        scriptPath,
        interpreter: getInterpreter(ext),
      },
    };
  });
}

function getInterpreter(ext: string): string {
  switch (ext) {
    case ".py": return "python3";
    case ".sh": return "bash";
    case ".js": return "node";
    default: throw new Error(`Unsupported script type: ${ext}`);
  }
}
```

---

## 6. UI/UX Design Patterns

### 6.1 Skills Discovery UI

```
┌─────────────────────────────────────────────────────┐
│ 🎯 Skills                                     [+]   │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔍 Search skills...                             │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Active Skills (2)                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📄 pdf-processing                          [×]  │ │
│ │ Extract text, fill forms, merge documents       │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📊 data-analysis                           [×]  │ │
│ │ Analyze datasets, generate charts              │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Available Skills                                    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 💻 code-review                             [+]  │ │
│ │ Review code, suggest improvements              │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📝 technical-writing                       [+]  │ │
│ │ Write documentation, API guides                │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [Browse Hub Skills...]                              │
└─────────────────────────────────────────────────────┘
```

### 6.2 Skill Activation Indicator

During conversation, show skill activation:

```
┌─────────────────────────────────────────────────────┐
│ User: Can you extract text from this PDF?           │
├─────────────────────────────────────────────────────┤
│ 🎯 Activating pdf-processing skill...              │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%             │
├─────────────────────────────────────────────────────┤
│ Assistant: I'll help you extract text from the PDF. │
│ Using the pdf-processing skill, I can...            │
└─────────────────────────────────────────────────────┘
```

### 6.3 Script Execution Feedback

```
┌─────────────────────────────────────────────────────┐
│ 🔧 Executing pdf_extract script                     │
│ ├─ Reading document.pdf...                         │
│ ├─ Extracting page 1/5...                          │
│ ├─ Extracting page 2/5...                          │
│ └─ ✓ Completed in 2.3s                             │
├─────────────────────────────────────────────────────┤
│ Extracted Text:                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Lorem ipsum dolor sit amet, consectetur...      │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 6.4 Svelte Components Structure

```
src/lib/components/skills/
├── SkillsPanel.svelte          # Main sidebar panel
├── SkillCard.svelte            # Individual skill card
├── SkillSearch.svelte          # Search/filter skills
├── SkillActivationBadge.svelte # Activation indicator
├── SkillExecutionProgress.svelte # Script execution UI
├── SkillHubBrowser.svelte      # Hub integration
└── SkillEditor.svelte          # Custom skill creation
```

---

## 7. Security Considerations

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| **Malicious scripts** | Sandboxed execution with restricted syscalls |
| **Path traversal** | Validate all paths stay within skill directory |
| **Resource exhaustion** | Timeout + resource limits per script |
| **Prompt injection** | Skill content treated as trusted (admin-controlled) |
| **Data exfiltration** | Network access disabled in sandbox |
| **SSRF via Hub** | Validate Hub URLs, no private networks |

### 7.2 Sandbox Implementation

```typescript
// src/lib/server/skills/sandbox.ts

import { Firecracker } from "firecracker-node"; // or Docker

interface SandboxConfig {
  workDir: string;
  timeout: number;
  maxMemoryMb: number;
  allowNetwork: boolean;
  allowedPaths: string[];
}

export async function createSandbox(config: SandboxConfig) {
  // Option 1: Docker container
  const container = await docker.createContainer({
    Image: "skills-runtime:latest",
    Cmd: ["sleep", "infinity"],
    HostConfig: {
      Memory: config.maxMemoryMb * 1024 * 1024,
      NetworkMode: config.allowNetwork ? "bridge" : "none",
      ReadonlyRootfs: true,
      Binds: [`${config.workDir}:/workspace:ro`],
    },
  });

  // Option 2: Firecracker microVM (more secure)
  const microvm = await Firecracker.spawn({
    kernelPath: "/var/lib/firecracker/kernel",
    rootfsPath: "/var/lib/firecracker/rootfs",
    memSizeMb: config.maxMemoryMb,
  });

  return {
    execute: async (script, args) => { /* ... */ },
    cleanup: async () => { /* ... */ },
  };
}
```

### 7.3 Permission Model

```typescript
// src/lib/server/skills/permissions.ts

type SkillPermission =
  | "read_files"      // Read files in skill directory
  | "execute_scripts" // Run bundled scripts
  | "network_access"  // Make HTTP requests (disabled by default)
  | "mcp_tools"       // Invoke MCP tools
  | "file_upload"     // Access user-uploaded files;

interface SkillPolicy {
  maxExecutionTime: number;  // ms
  maxMemory: number;         // bytes
  allowedPermissions: SkillPermission[];
  blockedPatterns: RegExp[]; // Block certain commands
}

// Default policy: restrictive
const DEFAULT_POLICY: SkillPolicy = {
  maxExecutionTime: 30_000,
  maxMemory: 256 * 1024 * 1024,
  allowedPermissions: ["read_files", "execute_scripts"],
  blockedPatterns: [
    /rm\s+-rf/,
    /curl|wget/,
    /nc|netcat/,
  ],
};
```

---

## 8. Configuration & Environment

### 8.1 Environment Variables

```bash
# Skills Configuration
SKILLS_ENABLE=true                      # Enable skills feature
SKILLS_PATH=/app/skills:/custom/skills  # Colon-separated skill directories
SKILLS_HUB_ENABLE=true                  # Enable Hub skill discovery
SKILLS_HUB_BASE_URL=https://huggingface.co/spaces/skills

# Execution Settings
SKILLS_SCRIPT_TIMEOUT_MS=30000          # Script execution timeout
SKILLS_MAX_MEMORY_MB=256                # Memory limit per script
SKILLS_SANDBOX_TYPE=docker              # docker | firecracker | none

# Security
SKILLS_ALLOW_NETWORK=false              # Allow scripts network access
SKILLS_ALLOW_USER_UPLOAD=true           # Allow user-uploaded skills

# Router Integration
LLM_ROUTER_ENABLE_SKILLS=true           # Skills-aware routing
LLM_ROUTER_SKILLS_MODEL=model-id        # Model for skill execution
```

### 8.2 Skills Configuration Schema

```typescript
// src/lib/server/skills/config.ts

const skillsConfig = z.object({
  enable: z.boolean().default(false),
  paths: z.array(z.string()).default([]),
  hub: z.object({
    enable: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
  }).default({}),
  execution: z.object({
    timeoutMs: z.number().default(30000),
    maxMemoryMb: z.number().default(256),
    sandboxType: z.enum(["docker", "firecracker", "none"]).default("docker"),
    allowNetwork: z.boolean().default(false),
  }).default({}),
  security: z.object({
    allowUserUpload: z.boolean().default(true),
    requireApproval: z.boolean().default(false),
    auditLog: z.boolean().default(true),
  }).default({}),
});
```

---

## 9. Files to Create/Modify

### 9.1 New Files

```
src/lib/server/skills/
├── index.ts                 # Main exports
├── registry.ts              # Skill discovery and loading
├── parser.ts                # SKILL.md parsing
├── selector.ts              # Automatic skill selection
├── preprompt.ts             # Prompt injection
├── runtime.ts               # Script execution
├── sandbox.ts               # Sandboxed execution
├── mcpAdapter.ts            # Skills → MCP tools
├── permissions.ts           # Permission model
└── config.ts                # Configuration schema

src/lib/server/api/routes/skills/
├── index.ts                 # Route definitions
├── list.ts                  # GET /skills
├── get.ts                   # GET /skills/:name
├── activate.ts              # POST /skills/:name/activate
└── execute.ts               # POST /skills/:name/execute

src/lib/components/skills/
├── SkillsPanel.svelte       # Main sidebar component
├── SkillCard.svelte         # Skill display card
├── SkillSearch.svelte       # Search component
├── SkillBadge.svelte        # Active skill badge
├── SkillProgress.svelte     # Execution progress
└── SkillHub.svelte          # Hub browser

src/lib/stores/
└── skills.ts                # Skills state management

src/lib/types/
└── Skill.ts                 # Skill type definitions
```

### 9.2 Files to Modify

| File | Changes |
|------|---------|
| `src/lib/server/textGeneration/index.ts` | Inject skills context |
| `src/lib/server/textGeneration/mcp/runMcpFlow.ts` | Add skill tools |
| `src/lib/server/textGeneration/utils/toolPrompt.ts` | Skill preprompt |
| `src/lib/server/router/endpoint.ts` | Skills-aware routing |
| `src/lib/types/Conversation.ts` | Add `skills: string[]` field |
| `src/routes/conversation/[id]/+server.ts` | Handle skill updates |
| `src/lib/components/chat/ChatWindow.svelte` | Skills panel integration |
| `src/hooks.server.ts` | Skills registry initialization |
| `.env` | Add skills configuration |

---

## 10. Comparison with Alternatives

### 10.1 Skills vs MCP

| Aspect | Skills | MCP | Recommendation |
|--------|--------|-----|----------------|
| **Purpose** | Domain knowledge | Tool execution | Use both: Skills for knowledge, MCP for actions |
| **Format** | File-based (SKILL.md) | Protocol (JSON-RPC) | Skills are simpler to create |
| **Execution** | Local/sandboxed | Remote servers | Skills for bundled, MCP for external |
| **State** | Can be stateful | Stateless | Skills can maintain context |
| **Discovery** | File system scan | Server `listTools` | Similar patterns |
| **Adoption** | Open standard (20+ tools) | Open standard (growing) | Both have industry support |

### 10.2 Skills vs Custom GPTs

| Aspect | Skills | Custom GPTs | Advantage |
|--------|--------|-------------|-----------|
| **Portability** | Works across 20+ tools | OpenAI only | Skills |
| **Open Source** | Yes | No | Skills |
| **Local execution** | Yes | No (API only) | Skills |
| **Customization** | Full control | Limited | Skills |
| **Marketplace** | Hub integration | GPT Store | Comparable |

### 10.3 Skills vs LangChain Tools

| Aspect | Skills | LangChain | Advantage |
|--------|--------|-----------|-----------|
| **Format** | Simple (SKILL.md) | Python classes | Skills (simpler) |
| **Integration** | Universal | Python ecosystem | LangChain (deeper) |
| **Chaining** | Via LLM | Explicit chains | LangChain |
| **Learning curve** | Low | Medium-high | Skills |

---

## Conclusion

Integrating Skills into HuggingChat offers a powerful opportunity to:

1. **Enhance LLM capabilities** with domain-specific knowledge
2. **Leverage the open standard** adopted by 20+ agent products
3. **Build on existing MCP infrastructure** for tool execution
4. **Create a competitive feature** for the Hugging Face ecosystem

The proposed architecture maximizes reuse of existing chat-ui components while adding a clean skills layer. The phased implementation approach allows incremental delivery with early user value.

### Next Steps

1. Review and approve this architecture proposal
2. Create detailed technical specifications for Phase 1
3. Set up skills development environment
4. Implement core registry and discovery
5. Begin UI component development

---

## References

- [Anthropic Skills GitHub](https://github.com/anthropics/skills)
- [Agent Skills Specification](https://agentskills.io)
- [Anthropic Engineering Blog - Equipping Agents for the Real World](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [OpenWebUI Plugin Architecture](https://docs.openwebui.com/features/plugin/)
- [Vercel AI SDK Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
