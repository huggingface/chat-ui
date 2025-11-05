---
name: add-language
description: Guide for implementing a new language parser in Codanna. Use when adding language support, implementing parsers, or extending language capabilities. Covers the six-file architecture (mod.rs, definition.rs, parser.rs, behavior.rs, resolution.rs, audit.rs), trait implementation patterns, resolution scope design, and integration workflow. Triggers on requests to add language support, implement new parser, extend language capabilities, or create language implementation.
---

# Add Language Implementation Skill

This skill guides you through implementing a new language parser in Codanna following the established six-layer architecture.

## When to Use This Skill

- User asks to "add support for [language]"
- User wants to "implement [language] parser"
- User says "create new language implementation"
- User mentions "extend language support"
- User asks about "adding a new programming language"

## Prerequisites

Before starting, ensure you have:

1. **Tree-sitter grammar** for the target language
2. **Understanding of language's scoping rules** (local, module, global, etc.)
3. **Example code files** in `examples/[language]/` for testing
4. **Documentation references** (see below)

## Core Documentation References

This skill references three comprehensive documentation files:

- **[language-architecture.md](language-architecture.md)** - Design principles (WHY)
- **[language-support.md](language-support.md)** - API contracts (WHAT)
- **[language-patterns.md](language-patterns.md)** - Implementation patterns (HOW)

## Quick Start Workflow

### Step 1: Setup Tree-sitter Grammar

```bash
# Install the grammar for exploration
./contributing/tree-sitter/scripts/setup.sh [language]

# Test parsing example files
tree-sitter parse examples/[language]/comprehensive.[ext]
```

### Step 2: Create Language Directory Structure

```bash
# Create the six-file structure
mkdir -p src/parsing/[language]
cd src/parsing/[language]

# Create required files
touch mod.rs definition.rs parser.rs behavior.rs resolution.rs audit.rs
```

### Step 3: Implement Core Traits

Follow this order (dependencies flow downward):

```
1. definition.rs  → LanguageDefinition trait
2. parser.rs      → LanguageParser trait (depends on definition)
3. behavior.rs    → LanguageBehavior trait (depends on parser)
4. resolution.rs  → Custom ResolutionContext (depends on behavior)
5. audit.rs       → NodeTrackingState (optional but recommended)
6. mod.rs         → Public API and registration
```

### Step 4: Define Language Metadata (definition.rs)

```rust
use crate::parsing::language_definition::LanguageDefinition;
use tree_sitter::Language;

pub struct [Language]Definition;

impl LanguageDefinition for [Language]Definition {
    fn language(&self) -> Language {
        tree_sitter_[language]::LANGUAGE.into()
    }

    fn name(&self) -> &'static str {
        "[language]"
    }

    fn file_extensions(&self) -> &[&str] {
        &["ext1", "ext2"]  // e.g., ["ts", "tsx"] for TypeScript
    }

    fn comment_types(&self) -> &[&str] {
        &["comment", "line_comment", "block_comment"]
    }
}
```

**Key decisions**:
- List ALL file extensions (e.g., `.ts` AND `.tsx`)
- Include all comment node types from tree-sitter grammar
- Use exact language name from tree-sitter (lowercase)

### Step 5: Implement Parser (parser.rs)

**CRITICAL PATTERN - Scope Management**:

Always follow: **Save → Enter → Process → Exit → Restore**

```rust
"function_declaration" => {
    // 1. SAVE parent context
    let saved_function = self.context.current_function().map(|s| s.to_string());

    // 2. ENTER new scope
    self.context.enter_scope(ScopeType::Function {
        hoisting: false  // Language-specific
    });

    // 3. SET current context
    self.context.set_current_function(Some(function_name));

    // 4. PROCESS children
    self.extract_symbols_from_node(body, code, file_id, counter, symbols, module_path, depth + 1);

    // 5. EXIT scope FIRST
    self.context.exit_scope();

    // 6. RESTORE parent context AFTER
    self.context.set_current_function(saved_function);
}
```

**Why this order matters**: `exit_scope()` clears local scope. If you restore context before exiting, the restored context gets cleared.

**Method naming conventions**:

```rust
// Recursive traversal (populates Vec<Symbol>)
fn extract_symbols_from_node(...) { }

// Converts single node to Symbol
fn process_function(...) -> Option<Symbol> { }
fn process_class(...) -> Option<Symbol> { }

// Relationship extraction (public trait methods)
fn find_calls(&self, ...) -> Vec<Reference> { }
fn find_implementations(&self, ...) -> Vec<Reference> { }
```

See @contributing/development/language-patterns.md § Method Organization for full reference.

### Step 6: Implement Behavior (behavior.rs)

```rust
use crate::parsing::language_behavior::LanguageBehavior;
use crate::types::{Symbol, SymbolKind, Visibility};
use std::path::Path;

pub struct [Language]Behavior {
    state: Arc<BehaviorState>,
}

impl [Language]Behavior {
    pub fn new() -> Self {
        Self {
            state: Arc::new(BehaviorState::new()),
        }
    }
}

impl LanguageBehavior for [Language]Behavior {
    fn format_module_path(&self, file_path: &Path, root: &Path) -> String {
        // Language-specific module path format
        // Examples:
        // - Rust: crate::module::submodule
        // - Python: package.module.submodule
        // - TypeScript: @app/module/submodule
    }

    fn determine_visibility(&self, node: Node, code: &str) -> Visibility {
        // Language-specific visibility rules
        // Check for public/private/protected keywords
    }

    fn configure_symbol(&self, symbol: &mut Symbol, module_path: &str) {
        // Apply module path and track in state
        symbol.module_path = Some(module_path.to_string());

        // Track in behavior state if needed
        self.state.add_file_module(symbol.file_id, module_path);
    }
}
```

**Key methods to implement**:
- `format_module_path()` - Convert file path to language's module naming
- `determine_visibility()` - Parse visibility modifiers
- `configure_symbol()` - Post-process extracted symbols
- `resolve_import()` - Language-specific import resolution

### Step 7: Design Resolution Context (resolution.rs)

**CRITICAL**: Every language needs a custom ResolutionContext. No generic fallback.

**Define your language's scope order**:

```rust
// Example: TypeScript
// Order: local → hoisted → imported → module → global

pub struct TypeScriptResolutionContext {
    local_scope: HashMap<String, Symbol>,
    hoisted_scope: HashMap<String, Symbol>,  // Functions, var
    imported_symbols: HashMap<String, Symbol>,
    module_scope: HashMap<String, Symbol>,
    global_scope: HashMap<String, Symbol>,
    type_space: HashMap<String, Symbol>,  // Language-specific
}

impl ResolutionScope for TypeScriptResolutionContext {
    fn resolve(&self, name: &str, _kind: Option<SymbolKind>) -> Option<Symbol> {
        // 1. Check local scope (let, const, parameters)
        if let Some(symbol) = self.local_scope.get(name) {
            return Some(symbol.clone());
        }

        // 2. Check hoisted scope (function declarations, var)
        if let Some(symbol) = self.hoisted_scope.get(name) {
            return Some(symbol.clone());
        }

        // 3. Check imported symbols
        if let Some(symbol) = self.imported_symbols.get(name) {
            return Some(symbol.clone());
        }

        // 4. Check module scope (same file)
        if let Some(symbol) = self.module_scope.get(name) {
            return Some(symbol.clone());
        }

        // 5. Check global scope
        self.global_scope.get(name).cloned()
    }
}
```

**Language-specific resolution orders**:

```
TypeScript:  [local] → [hoisted] → [imported] → [module] → [global]
Rust:        [local] → [imported] → [module] → [crate]
Python:      [local] → [enclosing] → [global] → [builtins] (LEGB)
Go:          [local] → [package] → [imported] → [qualified]
PHP:         [local] → [namespace] → [imported] → [global]
C/C++:       [local] → [using] → [module] → [imported] → [global]
```

See @contributing/development/language-architecture.md § Resolution Architecture for detailed design rationale.

### Step 8: Add Node Tracking (audit.rs)

```rust
use crate::parsing::audit::NodeTrackingState;
use tree_sitter::Node;

impl [Language]Parser {
    fn register_handled_node(&mut self, node: &Node) {
        if let Some(tracking) = &mut self.node_tracking {
            tracking.register_handled_node(node.kind());
        }
    }
}
```

**Why track nodes**: ABI-15 audit reports show which tree-sitter nodes are handled vs ignored, helping identify coverage gaps.

### Step 9: Register Language (mod.rs)

```rust
mod definition;
mod parser;
mod behavior;
mod resolution;
mod audit;

pub use definition::[Language]Definition;
pub use parser::[Language]Parser;
pub use behavior::[Language]Behavior;

use crate::parsing::registry::LanguageRegistry;

pub fn register(registry: &mut LanguageRegistry) {
    registry.register(
        Box::new([Language]Definition),
        |_def| Box::new([Language]Parser::new().expect("Failed to create parser")),
        |_def| Box::new([Language]Behavior::new()),
    );
}
```

Then add to `src/parsing/registry.rs`:

```rust
fn initialize_registry(registry: &mut LanguageRegistry) {
    super::rust::register(registry);
    super::typescript::register(registry);
    super::[language]::register(registry);  // ADD THIS
    // ...
}
```

### Step 10: Create Test Files

```bash
# Create example files
mkdir -p examples/[language]
touch examples/[language]/comprehensive.[ext]

# Create test file
mkdir -p tests/parsers/[language]
touch tests/parsers/[language]/test_basic.rs

# Register in gateway
# Edit tests/parsers_tests.rs to add:
# #[path = "parsers/[language]/test_basic.rs"]
# mod test_[language]_basic;
```

### Step 11: Test Implementation

```bash
# Parse example file
cargo run -- parse examples/[language]/comprehensive.[ext]

# Compare with tree-sitter
./contributing/tree-sitter/scripts/compare-nodes.sh [language]

# Run tests
cargo test test_[language]
```

## Common Patterns Reference

### Import Tracking

All languages track imports via BehaviorState:

```rust
impl LanguageBehavior for [Language]Behavior {
    fn resolve_import(&self, import: &Import, current_file: &Path) -> Option<PathBuf> {
        // Parse import statement
        let target_path = self.resolve_import_path(&import.path, current_file)?;

        // Track in state
        self.state.add_import(import.file_id, import.clone());

        Some(target_path)
    }
}
```

### Relationship Extraction

```rust
impl LanguageParser for [Language]Parser {
    fn find_calls(&self, code: &str, file_id: FileId) -> Vec<Reference> {
        let mut calls = Vec::new();
        let tree = self.parser.parse(code, None).unwrap();

        // Walk AST looking for call expressions
        self.find_calls_recursive(tree.root_node(), code, file_id, &mut calls);

        calls
    }
}
```

### Visibility Detection

```rust
fn determine_visibility(&self, node: Node, code: &str) -> Visibility {
    // Check for visibility keyword
    if let Some(modifier) = node.child_by_field_name("visibility") {
        let text = &code[modifier.byte_range()];
        return match text {
            "public" => Visibility::Public,
            "private" => Visibility::Private,
            "protected" => Visibility::Protected,
            _ => Visibility::Public,
        };
    }

    // Language-specific default
    Visibility::Public
}
```

## Checklist

Use this checklist when implementing a new language:

- [ ] Tree-sitter grammar installed and tested
- [ ] Example files created in `examples/[language]/`
- [ ] Example audit file created in `examples/[language]/comprehensive.[ext]`
- [ ] Six files created (mod.rs, definition.rs, parser.rs, behavior.rs, resolution.rs, audit.rs)
- [ ] LanguageDefinition implemented (file extensions, comment types)
- [ ] LanguageParser implemented (extract_symbols_from_node, process_* methods)
- [ ] Custom ResolutionContext designed with language-specific scope order
- [ ] LanguageBehavior implemented (format_module_path, determine_visibility)
- [ ] Import tracking via BehaviorState
- [ ] Relationship extraction (find_calls, find_implementations)
- [ ] Node tracking for audit reports
- [ ] Language registered in registry.rs
- [ ] Tests created in tests/parsers/[language]/
- [ ] Gateway file updated (tests/parsers_tests.rs)
- [ ] Documentation comments added to public methods
- [ ] Clippy warnings fixed (`cargo clippy`)
- [ ] Tests passing (`cargo test test_[language]`)

## Common Mistakes to Avoid

1. **Wrong scope management order**: Always Exit → Restore (not Restore → Exit)
2. **Missing node tracking**: Register ALL handled nodes for audit coverage
3. **Generic resolution context**: NEVER use generic - always create custom context
4. **Incorrect module paths**: Test module path format matches language conventions
5. **Missing import tracking**: Always call `state.add_import()` when resolving imports
6. **Incomplete file extensions**: List ALL extensions (e.g., `.ts` AND `.tsx`)
7. **Ignoring visibility defaults**: Each language has different default visibility
8. **Shallow tree-sitter exploration**: Use `tree-sitter parse` to understand AST structure
9. **Forgetting to register**: Must call language's `register()` in `initialize_registry()`
10. **Skipping tests**: Create comprehensive test files before claiming completion

## Performance Targets

- **Symbol extraction**: >10,000 symbols/second per core
- **Memory per symbol**: ~100 bytes average
- **Index rebuild**: <5 minutes for 1M symbols

## Reference Implementations

Study these as examples (in order of complexity):

1. **GDScript** (`src/parsing/gdscript/`) - Simplest, good starting point
2. **Go** (`src/parsing/go/`) - Package-level scoping
3. **Python** (`src/parsing/python/`) - LEGB resolution
4. **Rust** (`src/parsing/rust/`) - Module hierarchy with crate scope
5. **TypeScript** (`src/parsing/typescript/`) - Most complex (3186 lines, hoisting, type space)

## Troubleshooting

### "Symbol not found" in resolution

Check resolution order in your ResolutionContext. Verify scopes are populated correctly.

### Clippy warnings about unused imports

Remove imports or use `#[allow(unused_imports)]` with justification.

### Tests failing with "ERROR node" in AST

Tree-sitter couldn't parse the file. Check grammar compatibility and syntax errors.

### "Failed to create parser" error

Verify tree-sitter grammar is in Cargo.toml dependencies:
```toml
tree-sitter-[language] = "x.y.z"
```

## Next Steps After Implementation

1. **Add to settings.toml** if language needs config files (like tsconfig.json)
2. **Update language-support.md** with implementation status
3. **Create comprehensive test suite** with real-world code examples
4. **Document language-specific quirks** in parser.rs comments
5. **Run full test suite**: `cargo test`
6. **Run clippy**: `./contributing/scripts/auto-fix.sh`
7. **Create PR** with detailed description of language features supported

## Additional Resources

- **Tree-sitter docs**: https://tree-sitter.github.io/tree-sitter/
- **AST exploration**: `./contributing/tree-sitter/scripts/explore-ast.sh`
- **Node comparison**: `./contributing/tree-sitter/scripts/compare-nodes.sh`
- **Development guidelines**: @contributing/development/guidelines.md

---

**Remember**: Language implementation is iterative. Start with basic symbol extraction, then add relationships, then optimize resolution. Test frequently.
