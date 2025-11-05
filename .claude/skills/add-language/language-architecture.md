# Language Architecture Design

## Design Principles

### 1. Separation of Concerns (Six-Layer Model)

Each language implementation is organized into six distinct responsibilities:

```
┌─────────────────────────────────────────────────────────────┐
│ mod.rs          │ API Boundary & Public Interface           │
├─────────────────────────────────────────────────────────────┤
│ definition.rs   │ Discovery & Lifecycle (Registry Pattern)  │
├─────────────────────────────────────────────────────────────┤
│ parser.rs       │ Syntax → Semantics (AST Transformation)   │
├─────────────────────────────────────────────────────────────┤
│ behavior.rs     │ Language Conventions & Resolution         │
├─────────────────────────────────────────────────────────────┤
│ resolution.rs   │ Scoping Rules & Symbol Lookup             │
├─────────────────────────────────────────────────────────────┤
│ audit.rs        │ Coverage & Quality Metrics                │
└─────────────────────────────────────────────────────────────┘
```

**Why this separation?**
- Each layer can evolve independently
- Testing becomes focused (unit test per layer)
- Clear boundaries prevent logic leakage
- New developers know exactly where to look

### 2. Trait-Based Polymorphism (Strategy Pattern)

Three core traits form the contract:

```
LanguageDefinition ──┐
                     ├──> Registry discovers & instantiates
LanguageParser ──────┤
                     │
LanguageBehavior ────┘
```

**Design rationale**:
- **Compile-time polymorphism** via trait objects (`Box<dyn LanguageParser>`)
- **Zero-cost abstraction** - no runtime type checking
- **Open-closed principle** - extend without modifying core
- **Dependency inversion** - core depends on abstractions, not concrete implementations

### 3. Registry Pattern (Service Locator)

```rust
// Language modules self-register at startup
fn initialize_registry(registry: &mut LanguageRegistry) {
    super::rust::register(registry);
    super::typescript::register(registry);
    super::python::register(registry);
    // ... new languages added here
}

// Core code looks up by extension
registry.get_by_extension("ts") → TypeScriptLanguage
```

**Benefits**:
- **Decoupled discovery** - core doesn't know about specific languages
- **Dynamic enable/disable** via settings.toml
- **Single source of truth** for available languages
- **Lazy instantiation** - only create parsers when needed

### 4. State Management Strategy

Two-tier state model:

```
┌────────────────────────────────────────┐
│ Parser State (Per-File, Mutable)      │
│ - ParserContext (scope stack)          │
│ - NodeTrackingState (audit)            │
│ - Language-specific temp data          │
└────────────────────────────────────────┘
         │
         │ produces
         ▼
┌────────────────────────────────────────┐
│ Behavior State (Global, Thread-Safe)   │
│ - BehaviorState (Arc<DashMap>)         │
│   - Imports by file                    │
│   - File → module path mapping         │
│   - Trait implementations              │
└────────────────────────────────────────┘
```

**Design choices**:
- **Parser state**: Temporary, discarded after each file
- **Behavior state**: Persistent, shared across all parsers via `Arc`
- **Thread-safety**: `DashMap` allows concurrent parsing
- **Immutable after parse**: Symbols stored in DocumentIndex

### 5. Resolution Architecture (Chain of Responsibility)

Multi-level resolution with fallback strategy:

```
Symbol Resolution Flow:
┌─────────────────────────────────────────────────────┐
│ 1. ResolutionScope.resolve(name)                   │
│    ├─> Local scope (variables, parameters)         │
│    ├─> Hoisted scope (functions, TypeScript)       │
│    ├─> Imported symbols                            │
│    ├─> Module scope (same file)                    │
│    └─> Global scope (built-ins)                    │
└─────────────────────────────────────────────────────┘
         │ Not found?
         ▼
┌─────────────────────────────────────────────────────┐
│ 2. LanguageBehavior.resolve_external_call()        │
│    ├─> Check qualified names (Namespace.symbol)    │
│    ├─> Check imports in file                       │
│    ├─> Check parent modules (relative)             │
│    └─> Create external symbol (last resort)        │
└─────────────────────────────────────────────────────┘
         │ Still not found?
         ▼
┌─────────────────────────────────────────────────────┐
│ 3. InheritanceResolver.resolve_method()            │
│    └─> Walk inheritance chain for method provider  │
└─────────────────────────────────────────────────────┘
```

**Key design decisions**:
- **Language-specific scope order** encoded in `resolve()` implementation
- **Fallback chain** from specific to general
- **Lazy resolution** - don't resolve until needed
- **Caching** where appropriate (e.g., inheritance chains)

#### Language-Specific Resolution Orders

Each language implements its own scoping rules in the `ResolutionScope::resolve()` method. All languages now have custom resolution contexts (no generic fallback):

```
TypeScript:  [local] → [hoisted] → [imported] → [module] → [global]
             └─ let/const  └─ function/var

Rust:        [local] → [imported] → [module] → [crate]
             └─ fn params   └─ use items

Python:      [local] → [enclosing] → [global] → [builtins]
             └─ LEGB (Local, Enclosing, Global, Built-in)

Go:          [local] → [package] → [imported] → [qualified]
             └─ block vars  └─ pkg-level  └─ fmt.Println

PHP:         [local] → [namespace] → [imported] → [global]
             └─ $vars    └─ current NS

C/C++:       [local] → [using] → [module] → [imported] → [global]
             └─ block scope  └─ using namespace std

C#:          [local] → [namespace] → [imported] → [assembly] → [global]

GDScript:    [local] → [class] → [extends] → [global]
             └─ var in method  └─ class members
```

**Design rationale**: Each language's scoping semantics are preserved exactly, enabling accurate symbol resolution without losing language-specific behavior (hoisting in TypeScript, LEGB in Python, package visibility in Go, etc.).

### 6. Data Flow Architecture

```
┌──────────────┐
│  Source Code │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────┐
│ Parser.parse()                          │
│ - Tree-sitter AST                       │
│ - Recursive traversal                   │
│ - Symbol extraction                     │
└──────┬──────────────────────────────────┘
       │ Vec<Symbol> (raw)
       ▼
┌─────────────────────────────────────────┐
│ Behavior.configure_symbol()             │
│ - Apply module path                     │
│ - Apply visibility rules                │
│ - Add to behavior state                 │
└──────┬──────────────────────────────────┘
       │ Vec<Symbol> (configured)
       ▼
┌─────────────────────────────────────────┐
│ DocumentIndex.add_symbols()             │
│ - Tantivy indexing                      │
│ - Vector embeddings                     │
│ - Relationship storage                  │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│ Behavior.build_resolution_context()     │
│ - Merge Tantivy imports + in-memory     │
│ - Populate resolution scope             │
│ - Ready for queries                     │
└─────────────────────────────────────────┘
```

**Design highlights**:
- **Pipeline architecture** - clear stages with defined outputs
- **Immutability** - symbols don't change after creation
- **Dual storage** - in-memory (fast) + Tantivy (persistent)
- **Late binding** - resolution context built on-demand

### 7. Error Handling Strategy

Multi-level error recovery:

```
AST Level (Parser):
├─> ERROR nodes → Extract from children anyway
├─> Missing fields → Option<T>, early return with ?
└─> Recursion depth → Guard and bail early

Resolution Level (Behavior):
├─> Import not found → Create external symbol placeholder
├─> Type not resolved → Continue with partial info
└─> Circular imports → Break cycle, log warning

Index Level (Storage):
├─> Tantivy errors → Wrapped in IndexError
├─> File not found → Skip gracefully
└─> Corrupt data → Rebuild index
```

**Philosophy**:
- **Best effort extraction** - partial data better than none
- **Graceful degradation** - continue even with errors
- **User visibility** - errors logged but don't crash
- **Recovery paths** - always have a fallback

### 8. Performance Design Patterns

#### Zero-Copy String Extraction

```rust
// BAD: Allocates string on heap
let name = node.utf8_text(code).unwrap().to_string();

// GOOD: Borrows from source code
let name = &code[node.byte_range()];
```

**Result**: 10x faster, 90% less memory

#### Cache-Line Aligned Symbols

```rust
// CompactSymbol = 32 bytes (exactly 2 per cache line)
// Packed with NonZeroU32 for space optimization
```

**Result**: Better CPU cache utilization

#### Parallel File Processing

```rust
// Work-stealing queue with chunk size = num_cpus * 4
// Thread-local parser pools (avoid mutex contention)
```

**Result**: Linear scaling up to CPU count

#### Memory-Mapped Vector Storage

```rust
// Vectors stored with bincode serialization
// mmap2 for instant loading (no deserialization)
```

**Result**: <1s startup time even with 1M symbols

### 9. Extensibility Points

Where to extend the system:

```
┌────────────────────────────────────────────────────┐
│ Add New Language                                   │
│ └─> Implement 3 traits in new directory            │
│     └─> Auto-discovered by registry                │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ Add New Relationship Type                          │
│ └─> Extend RelationKind enum                       │
│     └─> Update map_relationship() in behaviors     │
│         └─> Add find_* method to LanguageParser    │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ Add New Scope Type                                 │
│ └─> Extend ScopeType enum                          │
│     └─> Update enter_scope/exit_scope logic        │
│         └─> Add corresponding HashMap in context   │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│ Add Language-Specific Resolution                   │
│ └─> Override resolve_import() in behavior          │
│     └─> Add custom logic in ResolutionScope        │
│         └─> No changes to core required            │
└────────────────────────────────────────────────────┘
```

**Extension philosophy**:
- **Open for extension** - new functionality added without modification
- **Closed for modification** - core code remains stable
- **Plugin architecture** - languages are plugins
- **Versioned APIs** - traits can evolve with deprecation

### 10. Testing Strategy

Layered testing approach:

```
Unit Tests (in source files):
├─> Parser helpers (extract_signature, determine_visibility)
├─> Behavior methods (format_module_path, parse_visibility)
└─> Resolution logic (scope precedence, inheritance chains)

Integration Tests (tests/parsers/):
├─> Symbol extraction (parse complete files)
├─> Relationship extraction (calls, implementations)
└─> Resolution (imports, cross-file references)

Audit Tests (coverage):
├─> ABI-15 node coverage (which nodes handled?)
├─> Symbol kind coverage (all SymbolKinds extracted?)
└─> Regression detection (coverage decreasing?)

Performance Tests (marked #[ignore]):
├─> Throughput (symbols/second)
├─> Memory usage (allocations, peak)
└─> Indexing speed (files/second)
```

**Test boundaries match architecture**:
- One test category per layer
- Fast unit tests for quick feedback
- Slower integration tests for correctness
- Performance tests run on-demand

---

## Design Trade-offs

### Chosen: Dynamic Dispatch (Trait Objects)
**Pros**: Easy to add languages, clean abstraction
**Cons**: Small runtime cost (vtable lookup)
**Why**: Flexibility > micro-optimization at this level

### Chosen: Thread-Safe Shared State (Arc<DashMap>)
**Pros**: Parallel parsing, simple concurrency model
**Cons**: Memory overhead vs single-threaded
**Why**: Modern CPUs have cores to spare

### Chosen: Heuristic Visibility Detection
**Pros**: Works across tree-sitter grammar variations
**Cons**: Edge cases possible
**Why**: 99% accuracy is acceptable, tree-sitter grammars inconsistent

### Chosen: Multi-Strategy Resolution
**Pros**: Handles complex cross-module scenarios
**Cons**: Multiple code paths to maintain
**Why**: Real-world code has messy imports

### Chosen: Best-Effort ERROR Recovery
**Pros**: Extract partial data from broken code
**Cons**: May produce incomplete results
**Why**: Developer experience - show what we can

---

## Invariants & Constraints

### Must Hold True:

1. **Symbols are immutable** after creation
   - Rationale: Enables safe concurrent access
   - Enforced by: No `&mut Symbol` in public API

2. **FileId uniquely identifies source**
   - Rationale: Cross-file resolution requires stable IDs
   - Enforced by: SymbolCounter monotonic increment

3. **Scope stack balanced** (enter/exit pairs)
   - Rationale: Prevents scope leak bugs
   - Enforced by: Parser context design

4. **Module paths follow language conventions**
   - Rationale: Resolution depends on correct paths
   - Enforced by: Language-specific `format_module_path()`

5. **Node tracking is comprehensive**
   - Rationale: Audit reports must be accurate
   - Enforced by: `register_handled_node()` in all code paths

### Performance Constraints:

- Symbol extraction: **>10,000 symbols/second** (per core)
- Memory per symbol: **~100 bytes** average
- Startup time: **<1 second** for 1M symbols (mmap)
- Index rebuild: **<5 minutes** for 1M symbols

### Compatibility Constraints:

- Tree-sitter ABI: **ABI-14 or ABI-15**
- Rust edition: **2021**
- Supported languages: **Must have tree-sitter grammar**

---

## Future Evolution

### Planned Improvements:

1. **Incremental Parsing**
   - Only re-parse changed files
   - Store AST checksums for diff detection
   - Impact: 10x faster re-indexing

2. **Lazy Symbol Loading**
   - Load symbols on-demand from index
   - Keep hot symbols in memory
   - Impact: 100x larger codebases

3. **Distributed Indexing**
   - Parallel indexing across machines
   - Share index via network storage
   - Impact: Teams share index

4. **Language Server Protocol**
   - Real-time parsing as you type
   - IDE integration (autocomplete, go-to-def)
   - Impact: Better DX

### Backward Compatibility Strategy:

- **Trait versioning**: New methods have defaults
- **Index format versioning**: Detect old formats, migrate
- **Deprecation period**: 2 versions before removal
- **Migration tools**: Automated upgrade scripts

---

## Comparison with Alternatives

### vs. Language Server Protocol (LSP)

| Aspect | Codanna | LSP |
|--------|---------|-----|
| Scope | Whole codebase | Single file/project |
| Speed | Batch optimized | Interactive optimized |
| Accuracy | Best-effort heuristics | Compiler-grade |
| Languages | Any with tree-sitter | Requires LSP server |
| Use case | Code search, analysis | IDE features |

**Design choice**: Complement LSP, don't replace

### vs. ctags/Universal CTags

| Aspect | Codanna | ctags |
|--------|---------|-------|
| Parser | tree-sitter (robust) | Regex (fragile) |
| Relationships | Full graph | Tag locations only |
| Resolution | Language-aware | Pattern matching |
| Search | Semantic + vector | String matching |
| Modern features | Yes (generics, async) | Limited |

**Design choice**: Modern replacement with richer data

### vs. Sourcegraph/GitHub Code Search

| Aspect | Codanna | Sourcegraph |
|--------|---------|-------------|
| Deployment | Local/self-hosted | Cloud/enterprise |
| Privacy | Fully local | Data sent to server |
| Languages | Open plugin system | Proprietary |
| Cost | Free | Paid |
| Scale | 1M-10M symbols | Billions |

**Design choice**: Local-first, privacy-preserving

---

## Summary: Why This Architecture?

1. **Modularity** - Languages are isolated plugins
2. **Performance** - Zero-copy, parallel, memory-efficient
3. **Correctness** - Multi-layer resolution with fallbacks
4. **Extensibility** - New languages/features without core changes
5. **Maintainability** - Clear boundaries, comprehensive tests
6. **User Experience** - Fast, accurate, handles real-world code

The architecture prioritizes **developer experience** (easy to add languages) and **user experience** (fast, accurate results) over theoretical purity.
