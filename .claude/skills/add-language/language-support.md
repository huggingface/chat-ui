# Adding Language Support

Languages self-register via the modular registry system. Each language lives in its own subdirectory with complete isolation and language-specific resolution capabilities.

**✅ Production Ready:**
- Language registry architecture with self-registration
- Language-specific resolution API with full type tracking
- Complete signature extraction for all symbol types
- Comprehensive scope context tracking with parent relationships
- Automatic ABI-15 node coverage tracking

**✅ Supported Languages:**
- **Rust** - Traits, generics, lifetimes, comprehensive type system
- **TypeScript** - Interfaces, type aliases, generics, inheritance tracking, TSX/JSX support
- **Python** - Classes, functions, type hints, inheritance
- **PHP** - Classes, traits, interfaces, namespaces
- **Go** - Structs, interfaces, methods, generics (1.18+), package visibility
- **C** - Structs, functions, enums, preprocessor macros
- **C++** - Classes, templates, namespaces, inheritance
- **C#** - Classes, interfaces, generics, LINQ
- **GDScript** - Godot game engine scripting language

**🎯 Ready for new languages** - The architecture is mature and well-tested.

### Implementation Status

All languages have custom resolution contexts with language-specific scoping:

| Language | Resolution Context | Scoping Model | Inheritance | Import Tracking |
|----------|-------------------|---------------|-------------|-----------------|
| **TypeScript** | TypeScriptResolutionContext | Hoisting + type space | ✅ Interfaces | ✅ ESM + tsconfig paths |
| **Rust** | RustResolutionContext | Crate hierarchy | ✅ Traits | ✅ use statements |
| **Python** | PythonResolutionContext | LEGB scoping | ✅ Classes | ✅ import/from |
| **Go** | GoResolutionContext | Package-level | ✅ Interfaces (implicit) | ✅ go.mod imports |
| **PHP** | PhpResolutionContext | Namespace-based | ✅ Traits + Interfaces | ✅ use/namespace |
| **C** | CResolutionContext | File/function scope | ❌ No OOP | ✅ #include |
| **C++** | CppResolutionContext | Namespace + using | ✅ Inheritance | ✅ #include + using |
| **C#** | CSharpResolutionContext | Namespace + assembly | ✅ Interfaces | ✅ using directives |
| **GDScript** | GdscriptResolutionContext | Class-based | ✅ extends | ✅ preload/load |

## Quick Start

For detailed implementation patterns, internal conventions, and best practices, see:

**📖 [Language Implementation Patterns](./language-patterns.md)**

This document provides the high-level overview and API contracts. The patterns guide shows you **how** to implement them with consistent patterns extracted from TypeScript and Rust.

For system design principles and architecture decisions, see:

**🏗️ [Language Architecture](./language-architecture.md)**

---

## Architecture Overview

Each language implementation consists of **6 files** in its own subdirectory:

```
src/parsing/{language}/
├── mod.rs         # Module re-exports and public API
├── definition.rs  # Registry integration (LanguageDefinition trait)
├── parser.rs      # Symbol extraction (LanguageParser trait)
├── behavior.rs    # Language behaviors (LanguageBehavior trait)
├── resolution.rs  # Language-specific symbol resolution
└── audit.rs       # ABI-15 coverage tracking and reporting
```

**Note**: TypeScript has an additional `tsconfig.rs` for project configuration parsing.

### Trait Overview

| Trait | Location | Purpose |
|-------|----------|---------|
| **LanguageDefinition** | definition.rs | Registry integration, factory methods |
| **LanguageParser** | parser.rs | Symbol extraction, relationship tracking |
| **LanguageBehavior** | behavior.rs | Module paths, visibility, resolution |
| **ResolutionScope** | resolution.rs | Language-specific scoping rules |
| **InheritanceResolver** | resolution.rs | Inheritance and trait/interface resolution |

---

## File Structure Reference

### 1. mod.rs (Module Exports)

```rust
//! {Language} language parser implementation

pub mod audit;
pub mod behavior;
pub mod definition;
pub mod parser;
pub mod resolution;

pub use behavior::{Language}Behavior;
pub use definition::{Language}Language;
pub use parser::{Language}Parser;
pub use resolution::{Language}InheritanceResolver, {Language}ResolutionContext};

// Re-export for registry registration
pub(crate) use definition::register;
```

### 2. definition.rs (Registry Integration)

Implements `LanguageDefinition` trait for registry discovery.

**Key responsibilities**:
- Provide language ID and metadata
- Define file extensions
- Create parser and behavior instances
- Configure default enabled state

**Example**:
```rust
pub struct TypeScriptLanguage;

impl LanguageDefinition for TypeScriptLanguage {
    fn id(&self) -> LanguageId {
        LanguageId::new("typescript")
    }

    fn name(&self) -> &'static str {
        "TypeScript"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["ts", "tsx", "mts", "cts"]
    }

    fn create_parser(&self, _settings: &Settings) -> IndexResult<Box<dyn LanguageParser>> {
        let parser = TypeScriptParser::new()
            .map_err(|e| IndexError::General(e.to_string()))?;
        Ok(Box::new(parser))
    }

    fn create_behavior(&self) -> Box<dyn LanguageBehavior> {
        Box::new(TypeScriptBehavior::new())
    }

    fn default_enabled(&self) -> bool {
        true
    }

    fn is_enabled(&self, settings: &Settings) -> bool {
        settings
            .languages
            .get("typescript")
            .map(|config| config.enabled)
            .unwrap_or(self.default_enabled())
    }
}

pub(crate) fn register(registry: &mut LanguageRegistry) {
    registry.register(Arc::new(TypeScriptLanguage));
}
```

### 3. parser.rs (Symbol Extraction)

Implements `LanguageParser` and `NodeTracker` traits.

**Key responsibilities**:
- Parse source code into symbols
- Extract relationships (calls, implementations, imports)
- Extract signatures and documentation
- Track AST node handling for audit

**Core methods**:
```rust
pub trait LanguageParser: Send + Sync {
    // Main entry point
    fn parse(&mut self, code: &str, file_id: FileId, counter: &mut SymbolCounter) -> Vec<Symbol>;

    // Relationship extraction
    fn find_calls<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_method_calls(&mut self, code: &str) -> Vec<MethodCall>;
    fn find_implementations<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_extends<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_uses<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_defines<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_imports(&mut self, code: &str, file_id: FileId) -> Vec<Import>;
    fn find_variable_types<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)>;
    fn find_inherent_methods(&mut self, code: &str) -> Vec<(String, String, Range)>;

    // Documentation extraction
    fn extract_doc_comment(&self, node: &Node, code: &str) -> Option<String>;

    // Metadata
    fn language(&self) -> Language;
    fn as_any(&self) -> &dyn Any;
}
```

**Internal pattern**:
- `extract_symbols_from_node` - Recursive AST traversal
- `process_*` methods - Convert nodes to symbols
- `extract_*` helpers - Extract specific data
- `determine_*` helpers - Make heuristic decisions

See [Implementation Patterns](./language-patterns.md#parser-implementation-parserrs) for detailed patterns.

### 4. behavior.rs (Language Behaviors)

Implements `LanguageBehavior` and `StatefulBehavior` traits.

**Key responsibilities**:
- Format module paths
- Parse visibility from signatures
- Resolve imports
- Create resolution contexts
- Track language-specific state

**Core methods**:
```rust
pub trait LanguageBehavior: Send + Sync {
    // Module path formatting
    fn format_module_path(&self, base_path: &str, symbol_name: &str) -> String;
    fn module_separator(&self) -> &'static str;
    fn module_path_from_file(&self, file_path: &Path, project_root: &Path) -> Option<String>;

    // Visibility parsing
    fn parse_visibility(&self, signature: &str) -> Visibility;

    // Language capabilities
    fn supports_traits(&self) -> bool;
    fn supports_inherent_methods(&self) -> bool;
    fn get_language(&self) -> tree_sitter::Language;

    // Resolution context creation
    fn create_resolution_context(&self, file_id: FileId) -> Box<dyn ResolutionScope>;
    fn create_inheritance_resolver(&self) -> Box<dyn InheritanceResolver>;

    // Symbol configuration
    fn configure_symbol(&self, symbol: &mut Symbol, module_path: Option<&str>);

    // Import resolution
    fn resolve_import(&self, import: &Import, document_index: &DocumentIndex) -> Option<SymbolId>;
    fn build_resolution_context(&self, file_id: FileId, document_index: &DocumentIndex)
        -> IndexResult<Box<dyn ResolutionScope>>;

    // State management (via StatefulBehavior)
    fn add_import(&self, import: Import);
    fn register_file(&self, path: PathBuf, file_id: FileId, module_path: String);
    fn get_imports_for_file(&self, file_id: FileId) -> Vec<Import>;
}
```

**Module path examples**:
- Rust: `"crate::module::Symbol"`
- TypeScript: `"module/path"` (file-based)
- Python: `"package.module.Symbol"`
- PHP: `"\\Namespace\\Class"`
- Go: `"module/submodule"`

See [Implementation Patterns](./language-patterns.md#behavior-implementation-behaviorrs) for resolution patterns.

### 5. resolution.rs (Scoping & Resolution)

Implements `ResolutionScope` and `InheritanceResolver` traits.

**Key responsibilities**:
- Language-specific symbol resolution
- Scope management
- Inheritance chain resolution
- Relationship resolution

**ResolutionScope trait**:
```rust
pub trait ResolutionScope: Send {
    // Core resolution
    fn resolve(&self, name: &str) -> Option<SymbolId>;
    fn add_symbol(&mut self, name: String, symbol_id: SymbolId, scope_level: ScopeLevel);

    // Scope management
    fn enter_scope(&mut self, scope_type: ScopeType);
    fn exit_scope(&mut self);
    fn clear_local_scope(&mut self);

    // Relationship resolution
    fn resolve_relationship(
        &self,
        target_name: &str,
        context: &Symbol,
        relation_kind: RelationKind,
        document_index: &DocumentIndex,
    ) -> Option<SymbolId>;

    // Import handling
    fn populate_imports(&mut self, imports: &[Import]);
    fn register_import_binding(&mut self, binding: ImportBinding);
}
```

**Scope resolution order examples**:
- TypeScript: local → hoisted → imported → module → global
- Rust: local → imported → module → crate → global
- Python: Local → Enclosing → Global → Built-in (LEGB)

See [Implementation Patterns](./language-patterns.md#resolution-implementation-resolutionrs) for scoping patterns.

### 6. audit.rs (Coverage Tracking)

Provides ABI-15 node coverage reporting.

**Key features**:
- Discovers all nodes in grammar
- Tracks which nodes the parser handles
- Generates coverage reports
- Zero maintenance (automatic tracking via `NodeTracker`)

**Usage**:
```bash
cargo test audit_typescript -- --nocapture
```

**Output**: Coverage report showing which AST nodes are handled vs available.

---

## Implementation Workflow

### Step 1: ABI-15 Node Discovery (Critical)

Tree-sitter node names **differ from language keywords**. Always explore the AST before implementing.

**Example**: TypeScript uses `"abstract_class_declaration"` not `"class_declaration"` with a modifier.

**Tools**:
```bash
# Use tree-sitter CLI
./contributing/tree-sitter/scripts/setup.sh typescript
tree-sitter parse examples/typescript/comprehensive.ts

# Use our comparison script
./contributing/tree-sitter/scripts/compare-nodes.sh typescript

# Or create exploration test
cargo test explore_typescript_abi15 -- --nocapture
```

**What to discover**:
- Exact node type names (e.g., `"function_declaration"`, `"class_declaration"`)
- Field names for extraction (e.g., `"name"`, `"body"`, `"parameters"`)
- Node IDs for validation
- Parent-child relationships
- ABI version

**Document findings**: `contributing/parsers/{language}/NODE_MAPPING.md`

See [tree-sitter tools README](../tree-sitter/README.md) for details.

### Step 2: Create File Structure

```bash
mkdir -p src/parsing/{language}
touch src/parsing/{language}/{mod,definition,parser,behavior,resolution,audit}.rs
```

### Step 3: Implement Core Files

Follow this order:

1. **definition.rs** - Simple, no dependencies
2. **parser.rs** - Core symbol extraction (refer to NODE_MAPPING.md)
3. **behavior.rs** - Module paths and visibility
4. **resolution.rs** - Scoping rules
5. **audit.rs** - Copy from another language, adjust names
6. **mod.rs** - Export everything

**See**: [Implementation Patterns](./language-patterns.md) for detailed patterns, naming conventions, and examples.

### Step 4: Register Language

**In `src/parsing/registry.rs`**:
```rust
fn initialize_registry(registry: &mut LanguageRegistry) {
    super::rust::register(registry);
    super::typescript::register(registry);
    super::{language}::register(registry);  // Add here
}
```

**In `src/parsing/mod.rs`**:
```rust
pub mod {language};

pub use {language}::{Language}Behavior, {Language}Parser, {Language}Language};
```

**In `Cargo.toml`**:
```toml
tree-sitter-{language} = "0.x.x"
```

### Step 5: Test & Verify

```bash
# Unit tests
cargo test {language}

# Coverage audit
cargo test audit_{language} -- --nocapture

# Linting
cargo clippy --fix
cargo fmt
```

---

## Key Data Types

### Import

```rust
pub struct Import {
    pub path: String,           // Import path: "std::collections::HashMap"
    pub alias: Option<String>,  // Alias: "as HashMap"
    pub file_id: FileId,        // Source file
    pub is_glob: bool,          // Glob import: "use foo::*"
    pub is_type_only: bool,     // TypeScript: "import type"
}
```

### MethodCall

```rust
pub enum MethodCall {
    Simple {
        receiver: String,  // "obj"
        method: String,    // "method"
        range: Range
    },
    Chained {
        chain: Vec<String>,  // ["obj", "method1", "method2"]
        range: Range
    },
    Unknown {
        target: String,   // Unresolved call
        range: Range
    },
}
```

### Symbol

```rust
pub struct Symbol {
    pub id: SymbolId,
    pub name: Arc<str>,
    pub kind: SymbolKind,
    pub file_id: FileId,
    pub range: Range,
    pub signature: Option<Arc<str>>,
    pub doc_comment: Option<Arc<str>>,
    pub module_path: Option<Arc<str>>,
    pub visibility: Visibility,
    pub scope_context: Option<ScopeContext>,
}
```

---

## Implementation Checklist

### Phase 1: Preparation
- [ ] Install tree-sitter CLI: `./contributing/tree-sitter/scripts/setup.sh {language}`
- [ ] Create comprehensive test file in `examples/{language}/`
- [ ] Explore AST: `tree-sitter parse examples/{language}/comprehensive.*`
- [ ] Document nodes in `contributing/parsers/{language}/NODE_MAPPING.md`
- [ ] Add dependency to `Cargo.toml`

### Phase 2: Core Implementation
- [ ] Create directory: `src/parsing/{language}/`
- [ ] Implement `definition.rs` (LanguageDefinition trait)
- [ ] Implement `parser.rs` (LanguageParser trait)
  - [ ] Symbol extraction (`parse` method)
  - [ ] Relationship extraction (`find_*` methods)
  - [ ] Signature extraction
  - [ ] Visibility determination
- [ ] Implement `behavior.rs` (LanguageBehavior trait)
  - [ ] Module path formatting
  - [ ] Visibility parsing
  - [ ] Resolution context creation
- [ ] Implement `resolution.rs`
  - [ ] ResolutionScope for scoping rules
  - [ ] InheritanceResolver for type hierarchies
- [ ] Implement `audit.rs` (copy-paste template)
- [ ] Implement `mod.rs` (exports)

### Phase 3: Registration
- [ ] Register in `src/parsing/registry.rs:initialize_registry()`
- [ ] Export in `src/parsing/mod.rs`
- [ ] Add to settings generation in `src/config.rs:generate_language_defaults()`

### Phase 4: Testing
- [ ] Add unit tests in `parser.rs`
- [ ] Add integration tests in `tests/parsers/{language}/`
- [ ] Create gateway entry in `tests/parsers_tests.rs`
- [ ] Run audit: `cargo test audit_{language} -- --nocapture`
- [ ] Verify coverage >70%

### Phase 5: Polish
- [ ] Run `cargo clippy --fix`
- [ ] Run `cargo fmt`
- [ ] Add examples to `examples/{language}/`
- [ ] Document language-specific patterns
- [ ] Update this file with new language in supported list

---

## Performance Requirements

- **Target**: >10,000 symbols/second (varies by complexity)
- **Memory**: Use `&str` slices and `&code[node.byte_range()]` for zero-copy
- **IDs**: Use `SymbolCounter::next_id()`, not raw `u32`
- **Recursion**: Guard with `check_recursion_depth(depth, node)`

---

## Example Implementations

Reference implementations ordered by completeness:

1. **TypeScript** (`src/parsing/typescript/`)
   - 3186 lines parser.rs - Most comprehensive
   - Full type system support
   - TSX/JSX component tracking
   - Complex import resolution
   - Path alias support via tsconfig.json

2. **Rust** (`src/parsing/rust/`)
   - 2800+ lines parser.rs
   - Traits, generics, lifetimes
   - Macro support
   - Comprehensive signature extraction

3. **Python** (`src/parsing/python/`)
   - Class inheritance, decorators
   - Type hints support
   - LEGB scope resolution

4. **Go** (`src/parsing/go/`)
   - Interfaces, generics (1.18+)
   - Package-level visibility
   - Method sets

5. **PHP** (`src/parsing/php/`)
   - Namespaces, traits
   - Complete OOP support

All follow the same patterns documented in the [Implementation Patterns](./language-patterns.md).

---

## Common Patterns & Best Practices

### 1. Signature Extraction

Extract declaration without body:

```rust
fn extract_signature(&self, node: Node, code: &str) -> String {
    let start = node.start_byte();
    let mut end = node.end_byte();

    if let Some(body) = node.child_by_field_name("body") {
        end = body.start_byte();
    }

    code[start..end].trim().to_string()
}
```

### 2. Visibility Heuristics

Check multiple locations (tree-sitter grammars vary):

```rust
fn determine_visibility(&self, node: Node, code: &str) -> Visibility {
    // 1. Check ancestor nodes (export wrapper)
    // 2. Check sibling nodes
    // 3. Check source text for keywords
    // Default: Private
}
```

### 3. Scope Management

Always save and restore context:

```rust
// Save
let saved_function = self.context.current_function().map(|s| s.to_string());

// Set new
self.context.set_current_function(new_name);

// Process
self.extract_symbols_from_node(...);

// Exit scope FIRST
self.context.exit_scope();

// Then restore
self.context.set_current_function(saved_function);
```

### 4. ERROR Node Handling

Don't ignore ERROR nodes:

```rust
"ERROR" => {
    self.register_handled_node(node.kind(), node.kind_id());
    // Still try to extract from children
    for child in node.children(&mut node.walk()) {
        self.extract_symbols_from_node(child, ...);
    }
}
```

### 5. Zero-Copy Extraction

Use string slices for efficiency:

```rust
fn find_calls<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> {
    let caller = &code[caller_node.byte_range()];  // No allocation
    let callee = &code[callee_node.byte_range()];  // No allocation
    vec![(caller, callee, range)]
}
```

**For comprehensive patterns, naming conventions, and implementation strategies, see**:

📖 **[Language Implementation Patterns](./language-patterns.md)**

---

## Troubleshooting

### Parser Not Extracting Symbols

1. Check NODE_MAPPING.md - are you using correct node names?
2. Run audit - which nodes are missing?
3. Check recursion depth guard
4. Verify node registration for audit tracking

### Import Resolution Failing

1. Check module path calculation in `module_path_from_file`
2. Verify import normalization (relative → absolute)
3. Check scope resolution order
4. Add debug logging in `resolve_import`

### Visibility Incorrect

1. Check `determine_visibility` heuristics
2. Verify ancestor/sibling checks
3. Check source text window size
4. Compare with reference implementation (TypeScript)

### Performance Issues

1. Profile with `cargo flamegraph`
2. Check for unnecessary allocations
3. Verify zero-copy string slices
4. Review recursion patterns

---

## Additional Resources

- **Implementation Patterns**: [language-patterns.md](./language-patterns.md)
- **Architecture Design**: [language-architecture.md](./language-architecture.md)
- **Tree-sitter Tools**: [../tree-sitter/README.md](../tree-sitter/README.md)
- **Test Infrastructure**: [../../tests/CLAUDE.md](../../tests/CLAUDE.md)
- **Development Guidelines**: [guidelines.md](./guidelines.md)

---

## FAQ

**Q: How many lines of code per file?**
- definition.rs: 25-55 lines
- mod.rs: 10-20 lines
- parser.rs: 1000-3200 lines
- behavior.rs: 600-1200 lines
- resolution.rs: 600-1200 lines
- audit.rs: 200-400 lines

**Q: Must I implement all LanguageParser methods?**

Yes, but many have default implementations. At minimum:
- `parse()` - required
- `find_calls()` - required
- `find_imports()` - required
- `extract_doc_comment()` - required
- `as_any()` - required
- Others have defaults but should be overridden for accuracy

**Q: What if my language doesn't have traits/interfaces?**

Return `false` from `supports_traits()` and skip inheritance resolver implementation.

**Q: How do I handle language-specific features (macros, decorators, etc.)?**

Add specialized fields to your parser struct and process them in `extract_symbols_from_node`. See Rust macro handling for an example.

**Q: Can I reuse code between languages?**

Yes! Common helpers are in:
- `src/parsing/parser.rs` - `check_recursion_depth`
- `src/parsing/behavior_state.rs` - State management
- `src/parsing/resolution.rs` - Base resolution types

**Q: How do I test my implementation?**

1. Unit tests in parser.rs
2. Integration tests in `tests/parsers/{language}/`
3. Audit coverage: `cargo test audit_{language} -- --nocapture`
4. Real-world files in `examples/{language}/`
