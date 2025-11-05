# Language Implementation Guide: Internal Patterns & Best Practices

This guide documents the **internal implementation patterns** extracted from TypeScript and Rust parsers. Follow these patterns for consistency, easier debugging, and maintainability.

## Table of Contents

1. [File Structure & Organization](#file-structure--organization)
2. [Parser Implementation (parser.rs)](#parser-implementation-parserrs)
3. [Behavior Implementation (behavior.rs)](#behavior-implementation-behaviorrs)
4. [Resolution Implementation (resolution.rs)](#resolution-implementation-resolutionrs)
5. [Definition & Registration (definition.rs)](#definition--registration-definitionrs)
6. [Module Exports (mod.rs)](#module-exports-modrs)
7. [Audit System (audit.rs)](#audit-system-auditrs)
8. [Naming Conventions Reference](#naming-conventions-reference)
9. [Common Patterns & Heuristics](#common-patterns--heuristics)

---

## File Structure & Organization

```
src/parsing/{language}/
├── mod.rs         # Public API exports
├── definition.rs  # Registry integration (25-55 lines)
├── parser.rs      # Symbol extraction (1000-3200 lines)
├── behavior.rs    # Language behaviors (600-1200 lines)
├── resolution.rs  # Scoping & resolution (600-1200 lines)
└── audit.rs       # ABI-15 coverage (200-400 lines)
```

**Key Principle**: Each file has a single, focused responsibility.

---

## Parser Implementation (parser.rs)

### Struct Definition Pattern

```rust
pub struct {Language}Parser {
    parser: Parser,                    // tree-sitter Parser
    context: ParserContext,            // Scope tracking (module-level, class, function)
    node_tracker: NodeTrackingState,   // ABI-15 audit tracking

    // Language-specific state (if needed)
    default_exported_symbols: HashSet<String>,  // TypeScript: default exports
    component_usages: Vec<(String, String)>,    // TypeScript: JSX tracking
}
```

**Guidelines**:
- Use `ParserContext` for scope tracking (current class, function, module)
- Use `NodeTrackingState` for automatic audit tracking
- Add language-specific collections only when needed
- Document all state fields with inline comments

### Method Organization & Naming

#### 1. **Core Public API** (Required by LanguageParser trait)

```rust
impl {Language}Parser {
    // Constructor
    pub fn new() -> Result<Self, String> { }

    // Main entry point - implements LanguageParser::parse()
    pub fn parse(&mut self, code: &str, file_id: FileId, counter: &mut SymbolCounter) -> Vec<Symbol> { }
}
```

#### 2. **Primary Internal Methods** (Private, core logic)

**Pattern**: Use descriptive prefixes to indicate method purpose

```rust
// Symbol extraction router (recursive)
fn extract_symbols_from_node(
    &mut self,
    node: Node,
    code: &str,
    file_id: FileId,
    counter: &mut SymbolCounter,
    symbols: &mut Vec<Symbol>,
    module_path: &str,
    depth: usize,
) { }

// Symbol processors - one per major symbol type
fn process_function(...) -> Option<Symbol> { }
fn process_class(...) -> Option<Symbol> { }
fn process_interface(...) -> Option<Symbol> { }
fn process_type_alias(...) -> Option<Symbol> { }
fn process_enum(...) -> Option<Symbol> { }
fn process_method(...) -> Option<Symbol> { }
fn process_property(...) -> Option<Symbol> { }
fn process_variable_declaration(...) { }

// Specialized extractors for complex structures
fn extract_class_members(...) { }
fn extract_imports_from_node(...) { }
```

**Naming Convention**:
- `extract_*` → Recursive traversal that populates a collection
- `process_*` → Converts a single node to a Symbol (returns Option<Symbol>)
- `find_*` → Public trait methods that search for relationships

#### 3. **Helper Methods** (Utilities)

```rust
// Symbol creation helper (reduces boilerplate)
fn create_symbol(
    &self,
    id: SymbolId,
    name: String,
    kind: SymbolKind,
    file_id: FileId,
    range: Range,
    signature: Option<String>,
    doc_comment: Option<String>,
    module_path: &str,
    visibility: Visibility,
) -> Symbol { }

// Signature extraction (exclude body)
fn extract_signature(&self, node: Node, code: &str) -> String { }
fn extract_class_signature(&self, node: Node, code: &str) -> String { }
fn extract_interface_signature(&self, node: Node, code: &str) -> String { }

// Visibility determination
fn determine_visibility(&self, node: Node, code: &str) -> Visibility { }
fn determine_method_visibility(&self, node: Node, code: &str) -> Visibility { }

// Type extraction helpers
fn extract_type_name<'a>(&self, node: Node, code: &'a str) -> Option<&'a str> { }
fn extract_simple_type_name<'a>(&self, node: Node, code: &'a str) -> Option<&'a str> { }
```

**Pattern**: Helper methods follow consistent naming:
- `extract_{noun}` → Extracts a specific piece of data
- `determine_{noun}` → Makes a decision based on heuristics
- `create_{noun}` → Factory method for construction

#### 4. **Relationship Extraction** (Recursive traversal)

```rust
// Find relationships - implements LanguageParser trait methods
fn find_calls<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> { }
fn find_method_calls(&mut self, code: &str) -> Vec<MethodCall> { }
fn find_implementations<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> { }
fn find_extends<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> { }
fn find_uses<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> { }
fn find_defines<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> { }
fn find_imports(&mut self, code: &str, file_id: FileId) -> Vec<Import> { }

// Internal recursive helpers
fn extract_calls_recursive<'a>(...) { }
fn extract_method_calls_recursive(...) { }
fn extract_type_uses_recursive<'a>(...) { }
fn extract_method_defines_recursive<'a>(...) { }
```

**Pattern**:
- Public `find_*` methods call private `extract_*_recursive` helpers
- Use lifetime `'a` for zero-copy string slices from source code
- Return tuples for simple relationships, structured types for complex ones

#### 5. **Node Tracking** (ABI-15 audit support)

```rust
// Register node for audit tracking
fn register_node_recursively(&mut self, node: Node) {
    self.register_handled_node(node.kind(), node.kind_id());
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        self.register_node_recursively(child);
    }
}
```

**When to use**:
- Call `register_node_recursively(node)` for major symbols (functions, classes)
- Call `register_handled_node(kind, id)` for individual nodes in switch cases

### Implementation Pattern: `extract_symbols_from_node`

This is the **heart of every parser**. It's a recursive switch statement that routes nodes to their processors.

```rust
fn extract_symbols_from_node(
    &mut self,
    node: Node,
    code: &str,
    file_id: FileId,
    counter: &mut SymbolCounter,
    symbols: &mut Vec<Symbol>,
    module_path: &str,
    depth: usize,
) {
    // ALWAYS guard against stack overflow
    if !check_recursion_depth(depth, node) {
        return;
    }

    match node.kind() {
        // Major symbol types - register ALL children, then process
        "function_declaration" | "generator_function_declaration" => {
            self.register_node_recursively(node);

            // Extract name for parent tracking
            let func_name = node.child_by_field_name("name")
                .map(|n| code[n.byte_range()].to_string());

            // Process and add symbol
            if let Some(symbol) = self.process_function(node, code, file_id, counter, module_path) {
                symbols.push(symbol);
            }

            // Enter scope and set parent context
            self.context.enter_scope(ScopeType::hoisting_function());
            let saved_function = self.context.current_function().map(|s| s.to_string());
            let saved_class = self.context.current_class().map(|s| s.to_string());
            self.context.set_current_function(func_name.clone());

            // Process body for nested symbols
            if let Some(body) = node.child_by_field_name("body") {
                self.register_handled_node(body.kind(), body.kind_id());
                self.extract_symbols_from_node(body, code, file_id, counter, symbols, module_path, depth + 1);
            }

            // Exit scope, then restore parent context
            self.context.exit_scope();
            self.context.set_current_function(saved_function);
            self.context.set_current_class(saved_class);
        }

        "class_declaration" | "abstract_class_declaration" => {
            self.register_node_recursively(node);

            let class_name = node.children(&mut node.walk())
                .find(|n| n.kind() == "type_identifier")
                .map(|n| code[n.byte_range()].to_string());

            if let Some(symbol) = self.process_class(node, code, file_id, counter, module_path) {
                symbols.push(symbol);
                self.context.enter_scope(ScopeType::Class);

                let saved_function = self.context.current_function().map(|s| s.to_string());
                let saved_class = self.context.current_class().map(|s| s.to_string());
                self.context.set_current_class(class_name.clone());

                // Extract members in class scope
                self.extract_class_members(node, code, file_id, counter, symbols, module_path, depth + 1);

                self.context.exit_scope();
                self.context.set_current_function(saved_function);
                self.context.set_current_class(saved_class);
            }
        }

        // Simple symbol types - register and process
        "interface_declaration" => {
            self.register_node_recursively(node);
            if let Some(symbol) = self.process_interface(node, code, file_id, counter, module_path) {
                symbols.push(symbol);
            }
        }

        // Structural nodes - register and recurse
        "export_statement" => {
            self.register_handled_node(node.kind(), node.kind_id());

            // Language-specific export handling (e.g., default exports in TypeScript)
            // ... custom logic ...

            // Recurse to children
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.extract_symbols_from_node(child, code, file_id, counter, symbols, module_path, depth + 1);
            }
        }

        // ERROR nodes - special handling for parser recovery
        "ERROR" => {
            self.register_handled_node(node.kind(), node.kind_id());

            // Attempt to extract symbols from ERROR node children
            // This handles partial parses (e.g., "use client" directive in React)
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.extract_symbols_from_node(child, code, file_id, counter, symbols, module_path, depth + 1);
            }
        }

        // Default case - track and recurse
        _ => {
            self.register_handled_node(node.kind(), node.kind_id());
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                self.extract_symbols_from_node(child, code, file_id, counter, symbols, module_path, depth + 1);
            }
        }
    }
}
```

**Critical Patterns**:
1. **Always** check recursion depth first
2. **Always** register nodes for audit tracking
3. **Save and restore** parent context when entering/exiting scopes
4. **Exit scope BEFORE restoring** parent context
5. **Recurse to children** for unhandled node types

### Implementation Pattern: `process_*` Methods

These methods convert a single AST node into a Symbol. They follow a consistent structure:

```rust
fn process_function(
    &mut self,
    node: Node,
    code: &str,
    file_id: FileId,
    counter: &mut SymbolCounter,
    module_path: &str,
) -> Option<Symbol> {
    // 1. Extract name (early return if not found)
    let name_node = node.child_by_field_name("name")?;
    let name = &code[name_node.byte_range()];

    // 2. Extract metadata
    let signature = self.extract_signature(node, code);
    let doc_comment = self.extract_doc_comment(&node, code);
    let visibility = self.determine_visibility(node, code);

    // 3. Create and return symbol
    Some(self.create_symbol(
        counter.next_id(),
        name.to_string(),
        SymbolKind::Function,
        file_id,
        Range::new(
            node.start_position().row as u32,
            node.start_position().column as u16,
            node.end_position().row as u32,
            node.end_position().column as u16,
        ),
        Some(signature),
        doc_comment,
        module_path,
        visibility,
    ))
}
```

**Pattern**:
1. Extract name (use `?` for early return)
2. Extract signature, doc, visibility
3. Call `create_symbol` helper
4. Return `Option<Symbol>`

### Signature Extraction Pattern

**Goal**: Extract declaration without the body

```rust
fn extract_signature(&self, node: Node, code: &str) -> String {
    let start = node.start_byte();
    let mut end = node.end_byte();

    // Exclude body if present
    if let Some(body) = node.child_by_field_name("body") {
        end = body.start_byte();
    }

    code[start..end].trim().to_string()
}
```

**Specialized versions**: Create separate methods for complex signatures
- `extract_class_signature` - Include extends/implements
- `extract_interface_signature` - Include generic constraints
- `extract_method_signature` - Include parameters only

### Visibility Determination Pattern

**Heuristic-based**: Check multiple locations for visibility modifiers

```rust
fn determine_visibility(&self, node: Node, code: &str) -> Visibility {
    // 1. Ancestor check (wrapper nodes)
    let mut anc = node.parent();
    for _ in 0..3 {  // Check up to 3 levels
        if let Some(a) = anc {
            if a.kind() == "export_statement" {
                return Visibility::Public;
            }
            anc = a.parent();
        } else {
            break;
        }
    }

    // 2. Sibling check
    if let Some(prev) = node.prev_sibling() {
        if prev.kind() == "export_statement" {
            return Visibility::Public;
        }
    }

    // 3. Token check (inline modifiers)
    let start = node.start_byte();
    let prefix = safe_substring_window(code, start, 10);
    if prefix.contains("export ") || prefix.contains("export\n") {
        return Visibility::Public;
    }

    // Default
    Visibility::Private
}
```

**Pattern**: Check multiple locations because tree-sitter grammars vary
1. Ancestor nodes (most common)
2. Sibling nodes (rare)
3. Source text tokens (fallback)

---

## Behavior Implementation (behavior.rs)

### Struct Definition Pattern

```rust
#[derive(Clone)]
pub struct {Language}Behavior {
    state: BehaviorState,  // Thread-safe state from base module
}

impl {Language}Behavior {
    pub fn new() -> Self {
        Self {
            state: BehaviorState::new(),
        }
    }
}

impl Default for {Language}Behavior {
    fn default() -> Self {
        Self::new()
    }
}

impl StatefulBehavior for {Language}Behavior {
    fn state(&self) -> &BehaviorState {
        &self.state
    }
}
```

**Always**:
- Implement `Clone`, `Default`
- Implement `StatefulBehavior` to access shared state
- Use `BehaviorState` for imports, files, trait impls tracking

### Required LanguageBehavior Methods

#### 1. **Module Path Formatting**

```rust
fn format_module_path(&self, base_path: &str, symbol_name: &str) -> String {
    // Language conventions:
    // Rust: "crate::module::Symbol"
    // TypeScript: "module/path" (file-based, no symbol name)
    // Python: "package.module.Symbol"
    // Go: "module/submodule"
}

fn module_separator(&self) -> &'static str {
    // Rust: "::"
    // TypeScript/Python: "."
    // PHP: "\\"
    // Go: "/"
}

fn module_path_from_file(&self, file_path: &Path, project_root: &Path) -> Option<String> {
    // Convert file path to module path
    // Remove common prefixes (src/, lib/)
    // Remove file extensions
    // Replace path separators with module separators
}
```

#### 2. **Visibility Parsing**

```rust
fn parse_visibility(&self, signature: &str) -> Visibility {
    // Check signature for visibility keywords
    // Language-specific rules:
    // - Rust: pub, pub(crate), pub(super), (none)
    // - TypeScript: export, private, protected, (none)
    // - Python: (none), _private, __very_private
    // - Go: Uppercase = public, lowercase = private
}
```

#### 3. **Language Capabilities**

```rust
fn supports_traits(&self) -> bool {
    // Rust: true (trait system)
    // TypeScript: true (interfaces)
    // Python: false (duck typing)
    // Go: true (interfaces)
}

fn supports_inherent_methods(&self) -> bool {
    // Rust: true (impl Block)
    // TypeScript: false (methods defined in class)
    // Python: true (methods in class body)
}

fn get_language(&self) -> Language {
    tree_sitter_{language}::LANGUAGE_{LANGUAGE}.into()
}
```

#### 4. **Resolution Context Creation**

```rust
fn create_resolution_context(&self, file_id: FileId) -> Box<dyn ResolutionScope> {
    Box::new({Language}ResolutionContext::new(file_id))
}

fn create_inheritance_resolver(&self) -> Box<dyn InheritanceResolver> {
    Box::new({Language}InheritanceResolver::new())
}
```

### Advanced Resolution Methods

#### Import Resolution

```rust
fn resolve_import(
    &self,
    import: &Import,
    document_index: &DocumentIndex,
) -> Option<SymbolId> {
    // 1. Get importing file's module path
    let importing_mod = self.get_module_path_for_file(import.file_id)?;

    // 2. Normalize import path (relative -> absolute)
    let normalized = normalize_import_path(&import.path, &importing_mod);

    // 3. Search for matching symbols
    let candidates = document_index.find_symbols_by_name(&import.path, None).ok()?;

    // 4. Filter by module path match
    for candidate in candidates {
        if self.import_matches_symbol(&normalized, &candidate) {
            return Some(candidate.id);
        }
    }

    None
}

fn import_matches_symbol(&self, import_path: &str, candidate: &Symbol) -> bool {
    // Language-specific matching rules
    // - Handle relative paths
    // - Handle aliases
    // - Handle index files
    // - Handle extensions
}
```

**Heuristics**: This is where you encode language-specific import semantics

#### External Call Resolution

```rust
fn resolve_external_call_target(
    &self,
    call_target: &str,
    context_symbol: &Symbol,
    document_index: &DocumentIndex,
) -> Option<SymbolId> {
    // Pattern: Try multiple resolution strategies

    // 1. Check if it's a qualified name (e.g., "Namespace.function")
    if let Some(symbol_id) = self.resolve_qualified_name(call_target, context_symbol, document_index) {
        return Some(symbol_id);
    }

    // 2. Check imports in caller's file
    let imports = self.state.get_imports_for_file(context_symbol.file_id);
    for import in imports {
        if import.alias.as_deref() == Some(call_target) || import.path.ends_with(call_target) {
            return self.resolve_import(&import, document_index);
        }
    }

    // 3. Check parent modules (for relative imports)
    if let Some(symbol_id) = self.resolve_in_parent_modules(call_target, context_symbol, document_index) {
        return Some(symbol_id);
    }

    None
}
```

**Pattern**: Try multiple strategies, return first match

### State Management Methods

```rust
// StatefulBehavior provides these through BehaviorState:

fn add_import(&self, import: Import) {
    self.state.add_import(import);
}

fn register_file(&self, path: PathBuf, file_id: FileId, module_path: String) {
    self.state.register_file(path, file_id, module_path);
}

fn add_trait_impl(&self, type_name: String, trait_name: String, file_id: FileId) {
    self.state.add_trait_impl(type_name, trait_name, file_id);
}

fn get_imports_for_file(&self, file_id: FileId) -> Vec<Import> {
    self.state.get_imports_for_file(file_id)
}

fn get_module_path_for_file(&self, file_id: FileId) -> Option<String> {
    self.state.get_file_info(file_id).map(|info| info.module_path.clone())
}
```

**Don't reinvent**: Use `BehaviorState` for standard tracking

---

## Resolution Implementation (resolution.rs)

### Struct Definition Pattern

```rust
pub struct {Language}ResolutionContext {
    file_id: FileId,

    // Scoped symbol maps (from inner to outer)
    local_scope: HashMap<String, SymbolId>,
    module_symbols: HashMap<String, SymbolId>,
    imported_symbols: HashMap<String, SymbolId>,
    global_symbols: HashMap<String, SymbolId>,

    // Scope stack for tracking nesting
    scope_stack: Vec<ScopeType>,

    // Import tracking
    imports: Vec<(String, Option<String>)>,
    import_bindings: HashMap<String, ImportBinding>,

    // Language-specific state
    // TypeScript: hoisted_scope, type_space, qualified_names, namespace_aliases
    // Rust: crate_scope, use_statements, trait_impls
    // Python: LEGB scopes, __all__ tracking
}
```

**Guidelines**:
- Organize scopes from innermost to outermost
- Use `HashMap<String, SymbolId>` for symbol lookups
- Track imports separately from symbols
- Add language-specific maps as needed

### Required ResolutionScope Methods

#### Symbol Resolution (Core)

```rust
fn resolve(&self, name: &str) -> Option<SymbolId> {
    // Language-specific resolution order
    // TypeScript: local -> hoisted -> imported -> module -> global
    // Rust: local -> imported -> module -> crate -> global
    // Python: Local -> Enclosing -> Global -> Built-in (LEGB)

    // 1. Check local scope
    if let Some(id) = self.local_scope.get(name) {
        return Some(*id);
    }

    // 2. Check hoisted scope (TypeScript, JavaScript)
    if let Some(id) = self.hoisted_scope.get(name) {
        return Some(*id);
    }

    // 3. Check imports
    if let Some(id) = self.imported_symbols.get(name) {
        return Some(*id);
    }

    // 4. Check module scope
    if let Some(id) = self.module_symbols.get(name) {
        return Some(*id);
    }

    // 5. Check global scope
    self.global_symbols.get(name).copied()
}
```

**Pattern**: Implement language-specific scope precedence

#### Symbol Addition

```rust
fn add_symbol(&mut self, name: String, symbol_id: SymbolId, scope_level: ScopeLevel) {
    match scope_level {
        ScopeLevel::Local => {
            self.local_scope.insert(name, symbol_id);
        }
        ScopeLevel::Module => {
            self.module_symbols.insert(name, symbol_id);
        }
        ScopeLevel::Imported => {
            self.imported_symbols.insert(name, symbol_id);
        }
        ScopeLevel::Global => {
            self.global_symbols.insert(name, symbol_id);
        }
    }
}
```

#### Scope Management

**Basic scope operations:**

```rust
fn enter_scope(&mut self, scope_type: ScopeType) {
    self.scope_stack.push(scope_type);
}

fn exit_scope(&mut self) {
    if self.scope_stack.pop().is_some() {
        // Clear local scope on exit
        self.local_scope.clear();
    }
}

fn clear_local_scope(&mut self) {
    self.local_scope.clear();
}
```

**CRITICAL PATTERN: Save → Enter → Process → Exit → Restore**

This is the **most important pattern** for correct scoping. Always save parent context before entering a new scope:

```rust
// In extract_symbols_from_node, when processing a function:

"function_declaration" => {
    // 1. SAVE current parent context
    let saved_function = self.context.current_function().map(|s| s.to_string());
    let saved_class = self.context.current_class().map(|s| s.to_string());

    // 2. ENTER new scope
    self.context.enter_scope(ScopeType::Function { hoisting: true });

    // 3. SET new parent context (for symbols inside this function)
    self.context.set_current_function(Some(function_name));

    // 4. PROCESS child symbols
    if let Some(body) = node.child_by_field_name("body") {
        self.extract_symbols_from_node(body, code, file_id, counter, symbols, module_path, depth + 1);
    }

    // 5. EXIT scope FIRST (this clears local_scope)
    self.context.exit_scope();

    // 6. RESTORE parent context AFTER exit
    self.context.set_current_function(saved_function);
    self.context.set_current_class(saved_class);
}
```

**Why this order matters:**

1. **Save first**: Captures current context before modification
2. **Enter scope**: Pushes new scope onto stack
3. **Set context**: Updates current_function/current_class for children
4. **Process**: Child symbols get correct parent_function/parent_class
5. **Exit BEFORE restore**: Clears scope data structures
6. **Restore AFTER exit**: Returns to previous context

**Common mistake:**
```rust
// WRONG - restoring before exit
self.context.set_current_function(saved_function);  // Restores first
self.context.exit_scope();                           // Then exits - BAD!
```

This causes the restored context to be cleared by `exit_scope()`!

#### Relationship Resolution

```rust
fn resolve_relationship(
    &self,
    target_name: &str,
    context: &Symbol,
    relation_kind: RelationKind,
    document_index: &DocumentIndex,
) -> Option<SymbolId> {
    match relation_kind {
        RelationKind::Calls => {
            // Try local resolution first
            if let Some(id) = self.resolve(target_name) {
                return Some(id);
            }

            // Fall back to document index
            self.resolve_external_call(target_name, context, document_index)
        }
        RelationKind::Implements | RelationKind::Extends => {
            // Type names are usually qualified
            self.resolve_type_name(target_name, document_index)
        }
        RelationKind::Uses => {
            // Types used in parameters, fields, returns
            self.resolve_type_name(target_name, document_index)
        }
        _ => None,
    }
}
```

### Inheritance Resolver Pattern

```rust
pub struct {Language}InheritanceResolver {
    // Track inheritance relationships
    inheritance_map: HashMap<String, Vec<String>>,  // child -> parents

    // Track methods defined by types
    type_methods: HashMap<String, Vec<String>>,

    // Language-specific data
    // TypeScript: interface_map, class_extends, class_implements
    // Rust: trait_impls, inherent_impls
}

impl InheritanceResolver for {Language}InheritanceResolver {
    fn is_interface(&self, type_name: &str) -> bool {
        // Language-specific interface detection
    }

    fn add_inheritance(&mut self, child: String, parent: String, kind: &str) {
        // Track inheritance (extends vs implements)
    }

    fn resolve_method(&self, type_name: &str, method_name: &str) -> Option<String> {
        // Walk inheritance chain to find method provider
        let chain = self.get_inheritance_chain(type_name);
        for ancestor in chain {
            if self.type_has_method(&ancestor, method_name) {
                return Some(ancestor);
            }
        }
        None
    }

    fn get_inheritance_chain(&self, type_name: &str) -> Vec<String> {
        // BFS or DFS traversal of inheritance graph
    }

    fn is_subtype(&self, child: &str, parent: &str) -> bool {
        // Check if child inherits from parent
    }
}
```

---

## Definition & Registration (definition.rs)

**Simplest file** - just implements the trait and provides registration.

```rust
//! {Language} language definition and registration

use crate::parsing::{
    LanguageBehavior, LanguageDefinition, LanguageId, LanguageParser, LanguageRegistry,
};
use crate::{IndexError, IndexResult, Settings};
use std::sync::Arc;

use super::{Language}Behavior, {Language}Parser};

/// {Language} language definition
pub struct {Language}Language;

impl LanguageDefinition for {Language}Language {
    fn id(&self) -> LanguageId {
        LanguageId::new("{language}")  // lowercase
    }

    fn name(&self) -> &'static str {
        "{Language}"  // proper case
    }

    fn extensions(&self) -> &'static [&'static str] {
        // TypeScript: &["ts", "tsx", "mts", "cts"]
        // Rust: &["rs"]
        // Python: &["py", "pyi"]
        // Go: &["go"]
        &["ext1", "ext2"]
    }

    fn create_parser(&self, _settings: &Settings) -> IndexResult<Box<dyn LanguageParser>> {
        let parser = {Language}Parser::new()
            .map_err(|e| IndexError::General(e.to_string()))?;
        Ok(Box::new(parser))
    }

    fn create_behavior(&self) -> Box<dyn LanguageBehavior> {
        Box::new({Language}Behavior::new())
    }

    fn default_enabled(&self) -> bool {
        true  // or false for less common languages
    }

    fn is_enabled(&self, settings: &Settings) -> bool {
        settings
            .languages
            .get("{language}")
            .map(|config| config.enabled)
            .unwrap_or(self.default_enabled())
    }
}

/// Register {Language} language with the registry
pub(crate) fn register(registry: &mut LanguageRegistry) {
    registry.register(Arc::new({Language}Language));
}
```

**Then register in `src/parsing/registry.rs:initialize_registry()`**:

```rust
fn initialize_registry(registry: &mut LanguageRegistry) {
    super::rust::register(registry);
    super::typescript::register(registry);
    super::{language}::register(registry);  // Add your language
}
```

---

## Module Exports (mod.rs)

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

**Then update `src/parsing/mod.rs`**:

```rust
pub mod {language};

pub use {language}::{Language}Behavior, {Language}Parser, {Language}Language};
```

---

## Audit System (audit.rs)

**Copy-paste template** - minimal customization needed.

```rust
//! {Language} parser audit module

use super::{Language}Parser;
use crate::io::format::format_utc_timestamp;
use crate::parsing::NodeTracker;
use crate::types::FileId;
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use tree_sitter::{Node, Parser};

#[derive(Error, Debug)]
pub enum AuditError {
    #[error("Failed to read file: {0}")]
    FileRead(#[from] std::io::Error),

    #[error("Failed to set language: {0}")]
    LanguageSetup(String),

    #[error("Failed to parse code")]
    ParseFailure,

    #[error("Failed to create parser: {0}")]
    ParserCreation(String),
}

pub struct {Language}ParserAudit {
    pub grammar_nodes: HashMap<String, u16>,
    pub implemented_nodes: HashSet<String>,
    pub extracted_symbol_kinds: HashSet<String>,
}

impl {Language}ParserAudit {
    pub fn audit_file(file_path: &str) -> Result<Self, AuditError> {
        let code = std::fs::read_to_string(file_path)?;
        Self::audit_code(&code)
    }

    pub fn audit_code(code: &str) -> Result<Self, AuditError> {
        // Parse with tree-sitter to discover all nodes
        let mut parser = Parser::new();
        let language = tree_sitter_{language}::LANGUAGE_{LANGUAGE}.into();
        parser.set_language(&language)
            .map_err(|e| AuditError::LanguageSetup(e.to_string()))?;

        let tree = parser.parse(code, None).ok_or(AuditError::ParseFailure)?;

        let mut grammar_nodes = HashMap::new();
        discover_nodes(tree.root_node(), &mut grammar_nodes);

        // Parse with our parser to see what symbols get extracted
        let mut lang_parser = {Language}Parser::new()
            .map_err(|e| AuditError::ParserCreation(e.to_string()))?;
        let file_id = FileId(1);
        let mut symbol_counter = crate::types::SymbolCounter::new();
        let symbols = lang_parser.parse(code, file_id, &mut symbol_counter);

        let mut extracted_symbol_kinds = HashSet::new();
        for symbol in &symbols {
            extracted_symbol_kinds.insert(format!("{:?}", symbol.kind));
        }

        let implemented_nodes: HashSet<String> = lang_parser
            .get_handled_nodes()
            .iter()
            .map(|handled_node| handled_node.name.clone())
            .collect();

        Ok(Self {
            grammar_nodes,
            implemented_nodes,
            extracted_symbol_kinds,
        })
    }

    pub fn generate_report(&self) -> String {
        let mut report = String::new();

        report.push_str("# {Language} Parser Coverage Report\n\n");
        report.push_str(&format!("*Generated: {}*\n\n", format_utc_timestamp()));

        // Summary
        report.push_str("## Summary\n");
        report.push_str(&format!("- Nodes in file: {}\n", self.grammar_nodes.len()));
        report.push_str(&format!("- Nodes handled: {}\n", self.implemented_nodes.len()));

        let coverage = if self.grammar_nodes.is_empty() {
            0.0
        } else {
            (self.implemented_nodes.len() as f64 / self.grammar_nodes.len() as f64) * 100.0
        };
        report.push_str(&format!("- Coverage: {:.1}%\n\n", coverage));

        // ... more reporting ...

        report
    }
}

fn discover_nodes(node: Node, nodes: &mut HashMap<String, u16>) {
    nodes.insert(node.kind().to_string(), node.kind_id());
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        discover_nodes(child, nodes);
    }
}
```

---

## Naming Conventions Reference

### Method Prefixes

| Prefix | Purpose | Returns | Example |
|--------|---------|---------|---------|
| `extract_*` | Recursive traversal, populates collection | `void` or collection | `extract_symbols_from_node`, `extract_calls_recursive` |
| `process_*` | Convert single node to symbol | `Option<Symbol>` | `process_function`, `process_class` |
| `find_*` | Public API for relationship search | `Vec<T>` | `find_calls`, `find_implementations` |
| `determine_*` | Heuristic-based decision | Enum value | `determine_visibility`, `determine_method_visibility` |
| `resolve_*` | Symbol/path resolution | `Option<SymbolId>` | `resolve_import`, `resolve_external_call` |
| `register_*` | Track state or metadata | `void` | `register_node_recursively`, `register_file` |
| `create_*` | Factory method | Constructed type | `create_symbol`, `create_resolution_context` |

### Struct Field Patterns

| Field | Type | Purpose |
|-------|------|---------|
| `parser` | `Parser` | tree-sitter parser instance |
| `context` | `ParserContext` | Scope tracking (function, class, module) |
| `node_tracker` | `NodeTrackingState` | ABI-15 audit tracking |
| `state` | `BehaviorState` | Shared state (imports, files, traits) |
| `{scope}_scope` | `HashMap<String, SymbolId>` | Symbol lookup by scope level |
| `scope_stack` | `Vec<ScopeType>` | Nested scope tracking |
| `imports` | `Vec<Import>` or `Vec<(String, Option<String>)>` | Import statements |
| `import_bindings` | `HashMap<String, ImportBinding>` | Resolved import metadata |

---

## Common Patterns & Heuristics

### 1. Recursion Guard

**Always** protect against stack overflow in recursive methods:

```rust
fn extract_symbols_from_node(..., depth: usize) {
    if !check_recursion_depth(depth, node) {
        return;
    }
    // ... rest of method ...
    self.extract_symbols_from_node(..., depth + 1);
}
```

### 2. Parent Context Tracking

**Pattern**: Save, set, restore parent context when entering nested scopes

```rust
// Save current context
let saved_function = self.context.current_function().map(|s| s.to_string());
let saved_class = self.context.current_class().map(|s| s.to_string());

// Set new context
self.context.set_current_function(new_function_name);
self.context.set_current_class(new_class_name);

// Process children
self.extract_symbols_from_node(...);

// Exit scope FIRST
self.context.exit_scope();

// Then restore context
self.context.set_current_function(saved_function);
self.context.set_current_class(saved_class);
```

**Order matters**: Exit scope before restoring context.

### 3. ERROR Node Handling

Tree-sitter produces ERROR nodes when it can't parse something. Don't ignore them:

```rust
"ERROR" => {
    self.register_handled_node(node.kind(), node.kind_id());

    // Try to extract symbols from children anyway
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        self.extract_symbols_from_node(child, ...);
    }
}
```

**Example**: React's `"use client"` directive causes ERROR nodes, but we still extract components.

### 4. Multi-Strategy Resolution

When resolving imports or calls, try multiple strategies:

```rust
fn resolve_external_call(...) -> Option<SymbolId> {
    // 1. Try qualified name resolution
    if let Some(id) = self.resolve_qualified_name(...) {
        return Some(id);
    }

    // 2. Try import resolution
    if let Some(id) = self.resolve_via_imports(...) {
        return Some(id);
    }

    // 3. Try parent module resolution
    if let Some(id) = self.resolve_in_parent_modules(...) {
        return Some(id);
    }

    // 4. Give up
    None
}
```

### 5. Visibility Heuristics

Check multiple locations because tree-sitter grammars differ:

```rust
fn determine_visibility(...) -> Visibility {
    // 1. Ancestor check (export_statement wrapper)
    // 2. Sibling check (adjacent export token)
    // 3. Source text check (inline 'export' keyword)
    // Default: Private
}
```

### 6. Scope Precedence

Implement language-specific scope resolution order:

```rust
// TypeScript: local -> hoisted -> imported -> module -> global
// Rust: local -> imported -> module -> crate -> global
// Python: Local -> Enclosing -> Global -> Built-in (LEGB)

fn resolve(&self, name: &str) -> Option<SymbolId> {
    self.local_scope.get(name)
        .or_else(|| self.hoisted_scope.get(name))   // TypeScript only
        .or_else(|| self.imported_symbols.get(name))
        .or_else(|| self.module_symbols.get(name))
        .or_else(|| self.global_symbols.get(name))
        .copied()
}
```

### 7. Import Path Normalization

Convert relative imports to absolute before matching:

```rust
fn normalize_import_path(import_path: &str, importing_module: &str) -> String {
    if import_path.starts_with("./") || import_path.starts_with("../") {
        // Resolve relative to importing module
        resolve_relative_path(import_path, importing_module)
    } else {
        // Already absolute
        import_path.to_string()
    }
}

fn resolve_relative_path(import: &str, base: &str) -> String {
    let base_parts: Vec<&str> = base.split('.').collect();
    let mut result = base_parts[..base_parts.len()-1].to_vec();

    for segment in import.split('.') {
        if segment == ".." {
            result.pop();
        } else if segment != "." {
            result.push(segment);
        }
    }

    result.join(".")
}
```

### 8. Zero-Copy String Slices

Use lifetimes for efficient string extraction:

```rust
fn find_calls<'a>(&mut self, code: &'a str) -> Vec<(&'a str, &'a str, Range)> {
    let mut calls = Vec::new();
    self.extract_calls_recursive(tree.root_node(), code, &mut calls);
    calls
}

fn extract_calls_recursive<'a>(
    &self,
    node: Node,
    code: &'a str,
    calls: &mut Vec<(&'a str, &'a str, Range)>,
) {
    // Extract string slices without copying
    let caller = &code[caller_node.byte_range()];
    let callee = &code[callee_node.byte_range()];
    calls.push((caller, callee, range));
}
```

**Benefit**: No string allocations, just pointers into source.

### 9. Node Registration for Auditing

Register nodes as you encounter them:

```rust
// Major symbols - register entire subtree
"function_declaration" => {
    self.register_node_recursively(node);
    // ... process function ...
}

// Individual nodes - register once
"export_statement" => {
    self.register_handled_node(node.kind(), node.kind_id());
    // ... process exports ...
}

// Default case - track all nodes
_ => {
    self.register_handled_node(node.kind(), node.kind_id());
    // ... recurse to children ...
}
```

**Result**: Automatic coverage tracking, no manual maintenance.

### 10. Signature Without Body

Extract declaration, exclude implementation:

```rust
fn extract_signature(&self, node: Node, code: &str) -> String {
    let start = node.start_byte();
    let mut end = node.end_byte();

    // Find body node and exclude it
    if let Some(body) = node.child_by_field_name("body") {
        end = body.start_byte();
    }

    code[start..end].trim().to_string()
}
```

**Examples**:
- Function: `function foo(x: number): string` (exclude `{ ... }`)
- Class: `class Foo extends Bar implements Baz` (exclude `{ ... }`)
- Interface: `interface IFoo extends IBar` (exclude `{ ... }`)

---

## Step-by-Step Implementation Checklist

### Phase 1: Setup & ABI-15 Exploration

- [ ] Create language directory: `src/parsing/{language}/`
- [ ] Add dependency to `Cargo.toml`: `tree-sitter-{language} = "0.x"`
- [ ] Create comprehensive test in `tests/abi15_exploration.rs`
- [ ] Document ABI-15 findings in `contributing/parsers/{language}/NODE_MAPPING.md`

### Phase 2: Core Files

- [ ] Create `mod.rs` with public exports
- [ ] Create `definition.rs` and implement `LanguageDefinition`
- [ ] Create `parser.rs` with struct and `new()` method
- [ ] Create `behavior.rs` with struct and `new()` method
- [ ] Create `resolution.rs` with context and inheritance structs
- [ ] Create `audit.rs` (copy from TypeScript, adjust language name)

### Phase 3: Parser Implementation

- [ ] Implement `extract_symbols_from_node` switch statement
- [ ] Implement `process_*` methods for each symbol type
- [ ] Implement `extract_signature` methods
- [ ] Implement `determine_visibility` methods
- [ ] Implement `find_calls`, `find_imports`, etc. (LanguageParser trait)
- [ ] Add tests for each major feature

### Phase 4: Behavior Implementation

- [ ] Implement `format_module_path` and `module_separator`
- [ ] Implement `module_path_from_file`
- [ ] Implement `parse_visibility`
- [ ] Implement `create_resolution_context` and `create_inheritance_resolver`
- [ ] Implement `resolve_import` (if needed)
- [ ] Add tests for resolution

### Phase 5: Resolution Implementation

- [ ] Implement `resolve` method with language-specific scope order
- [ ] Implement `add_symbol` with scope levels
- [ ] Implement `resolve_relationship` for different relation kinds
- [ ] Implement inheritance resolver methods
- [ ] Add tests for scoping rules

### Phase 6: Registration & Integration

- [ ] Register in `src/parsing/registry.rs:initialize_registry()`
- [ ] Export in `src/parsing/mod.rs`
- [ ] Add to `.codanna/settings.toml` default generation
- [ ] Run full test suite: `cargo test`
- [ ] Run audit: `cargo test audit_{language} -- --nocapture`

### Phase 7: Documentation & Polish

- [ ] Document language-specific heuristics
- [ ] Add examples to `examples/{language}/`
- [ ] Update `contributing/development/language-support.md`
- [ ] Run `cargo clippy` and fix warnings
- [ ] Run `cargo fmt`

---

## Example Workflow: Adding a New Language

Let's say you're adding **Java** support.

### 1. Setup

```bash
# Add dependency
echo 'tree-sitter-java = "0.21"' >> Cargo.toml

# Create directory
mkdir -p src/parsing/java

# Create ABI-15 exploration test
cargo test explore_java_abi15_comprehensive -- --nocapture > contributing/parsers/java/node_discovery.txt
```

### 2. Create Files

```bash
touch src/parsing/java/{mod,definition,parser,behavior,resolution,audit}.rs
```

### 3. Implement `parser.rs`

```rust
use tree_sitter::{Language, Node, Parser};

pub struct JavaParser {
    parser: Parser,
    context: ParserContext,
    node_tracker: NodeTrackingState,
}

impl JavaParser {
    pub fn new() -> Result<Self, String> {
        let mut parser = Parser::new();
        let language: Language = tree_sitter_java::LANGUAGE.into();
        parser.set_language(&language)
            .map_err(|e| format!("Failed to set Java language: {e}"))?;

        Ok(Self {
            parser,
            context: ParserContext::new(),
            node_tracker: NodeTrackingState::new(),
        })
    }

    fn extract_symbols_from_node(...) {
        if !check_recursion_depth(depth, node) {
            return;
        }

        match node.kind() {
            "class_declaration" => {
                self.register_node_recursively(node);
                if let Some(symbol) = self.process_class(node, code, file_id, counter, module_path) {
                    symbols.push(symbol);
                }
            }
            "method_declaration" => {
                self.register_node_recursively(node);
                if let Some(symbol) = self.process_method(node, code, file_id, counter, module_path) {
                    symbols.push(symbol);
                }
            }
            // ... more cases from NODE_MAPPING.md
            _ => {
                self.register_handled_node(node.kind(), node.kind_id());
                for child in node.children(&mut node.walk()) {
                    self.extract_symbols_from_node(child, ...);
                }
            }
        }
    }

    fn process_class(...) -> Option<Symbol> {
        let name_node = node.child_by_field_name("name")?;
        let name = &code[name_node.byte_range()];

        let signature = self.extract_signature(node, code);
        let doc = self.extract_doc_comment(&node, code);
        let visibility = self.determine_visibility(node, code);

        Some(self.create_symbol(
            counter.next_id(),
            name.to_string(),
            SymbolKind::Class,
            file_id,
            Range::new(/* ... */),
            Some(signature),
            doc,
            module_path,
            visibility,
        ))
    }
}
```

### 4. Implement `behavior.rs`

```rust
pub struct JavaBehavior {
    state: BehaviorState,
}

impl JavaBehavior {
    pub fn new() -> Self {
        Self {
            state: BehaviorState::new(),
        }
    }
}

impl LanguageBehavior for JavaBehavior {
    fn format_module_path(&self, base_path: &str, symbol_name: &str) -> String {
        // Java: com.example.package.ClassName
        format!("{}.{}", base_path, symbol_name)
    }

    fn module_separator(&self) -> &'static str {
        "."  // Java uses dot separation
    }

    fn parse_visibility(&self, signature: &str) -> Visibility {
        if signature.contains("public ") {
            Visibility::Public
        } else if signature.contains("private ") {
            Visibility::Private
        } else if signature.contains("protected ") {
            Visibility::Module  // Map to Module
        } else {
            Visibility::Module  // Package-private (default)
        }
    }

    fn supports_traits(&self) -> bool {
        true  // Java has interfaces
    }

    fn get_language(&self) -> Language {
        tree_sitter_java::LANGUAGE.into()
    }
}
```

### 5. Implement `resolution.rs`

```rust
pub struct JavaResolutionContext {
    file_id: FileId,
    local_scope: HashMap<String, SymbolId>,
    class_scope: HashMap<String, SymbolId>,
    imported_symbols: HashMap<String, SymbolId>,
    package_scope: HashMap<String, SymbolId>,
    scope_stack: Vec<ScopeType>,
}

impl ResolutionScope for JavaResolutionContext {
    fn resolve(&self, name: &str) -> Option<SymbolId> {
        // Java resolution order: local -> class -> imported -> package
        self.local_scope.get(name)
            .or_else(|| self.class_scope.get(name))
            .or_else(|| self.imported_symbols.get(name))
            .or_else(|| self.package_scope.get(name))
            .copied()
    }

    // ... implement other required methods
}
```

### 6. Register

```rust
// src/parsing/registry.rs
fn initialize_registry(registry: &mut LanguageRegistry) {
    super::rust::register(registry);
    super::typescript::register(registry);
    super::java::register(registry);  // Add this
}
```

### 7. Test

```bash
cargo test java
cargo test audit_java -- --nocapture
cargo clippy --fix
cargo fmt
```

Done!

---

## Summary

This guide provides the **internal patterns and conventions** used across all language implementations:

1. **File Organization**: 6 files, each with a focused responsibility
2. **Method Naming**: Consistent prefixes indicate purpose (`extract_`, `process_`, `find_`, `determine_`, `resolve_`)
3. **Implementation Patterns**:
   - `extract_symbols_from_node` - recursive router
   - `process_*` - symbol constructors
   - `determine_visibility` - multi-location heuristics
   - `resolve` - scope precedence
4. **State Management**: Use `ParserContext`, `BehaviorState`, resolution contexts
5. **Best Practices**:
   - Recursion guards
   - Parent context tracking
   - ERROR node handling
   - Zero-copy string slices
   - Node registration for auditing

Follow these patterns for **consistency**, **easier debugging**, and **maintainability** across all language implementations.
