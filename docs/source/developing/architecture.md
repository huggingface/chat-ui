# Architecture

This document discusses the high level overview of the Chat UI codebase. If you're looking to contribute or just want to understand how the codebase works, this is the place for you!

## Overview

Chat UI provides a simple interface connecting LLMs to external information and tools. The project uses [MongoDB](https://www.mongodb.com/) and [SvelteKit](https://kit.svelte.dev/) with [Tailwind](https://tailwindcss.com/).

## Code Map

This section discusses various modules of the codebase briefly. The headings are not paths since the codebase structure may change.

### `routes`

Provides all of the routes rendered with SSR via SvelteKit. The majority of backend and frontend logic can be found here, with some modules being pulled out into `lib` for the client and `lib/server` for the server.

### `textGeneration`

Provides a standard interface for most chat features such as model output, web search, assistants and tools. Outputs `MessageUpdate`s which provide fine-grained updates on the request status such as new tokens and web search results.

### `endpoints`/`embeddingEndpoints`

Provides a common streaming interface for many third party LLM and embedding providers.

### `websearch`

Implements web search querying and RAG. See the [Web Search](../configuration/web-search) section for more information.

### `tools`

Provides a common interface for external tools called by LLMs. See the [Tools](../configuration/models/tools.md) section for more information

### `migrations`

Includes all MongoDB migrations for maintaining backwards compatibility across schema changes. Any changes to the schema must include a migration
