import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scanRust, manifest } from "../src/plugins/rust.mjs";
import { serialize } from "../src/contract.mjs";

function source(path, contents) {
  return { path, contents, sha256: createHash("sha256").update(contents).digest("hex") };
}
function scan(code, others = []) {
  return scanRust({ root: "/nonexistent-must-not-read", files: [source("nested/src/lib.rs", code), ...others] });
}
const cargo = source("nested/Cargo.toml", '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n');
function named(result, name, kind) {
  return result.entities.find((entity) => entity.name === name && (!kind || entity.kind === kind));
}
function meta(result, entity) {
  return result.extensions.entityMetadata.find((record) => record.entityId === entity.id);
}

test("real Rust grammar: private native kinds, owners, signatures, impl endpoints and trait signatures", async () => {
  const result = await scan(`pub(crate) struct Engine { secret: u8 }
pub trait Run { type Output; fn run(&self) -> Self::Output; }
impl Run for Engine {
    type Output = u8;
    fn run(&self) -> u8 { self.secret }
}
enum State { Idle, Busy { value: u8 } }
type Alias = Engine;
mod inner { fn hidden() {} }
`, [cargo]);
  assert.equal(manifest.kind, "language");
  assert.equal(named(result, "Engine").kind, "struct");
  assert.equal(named(result, "Engine").exported, false);
  assert.equal(meta(result, named(result, "Engine")).visibility, "pub(crate)");
  assert.equal(named(result, "Run").exported, true);
  assert.equal(named(result, "Run").signatures[0], "pub trait Run");
  assert.equal(named(result, "Alias").kind, "type");
  assert.equal(named(result, "Busy").kind, "variant");
  assert.equal(named(result, "value").ownerId, named(result, "Busy").id);
  assert.equal(named(result, "hidden").ownerId, named(result, "inner").id);
  const methods = result.entities.filter((entity) => entity.kind === "method");
  assert.equal(methods.length, 2);
  assert.ok(methods.some((entity) => entity.signatures[0] === "fn run(&self) -> Self::Output;"));
  assert.equal(result.relationships.filter((edge) => edge.kind === "impl-for").length, 1);
  assert.equal(result.relationships.find((edge) => edge.kind === "impl-for").to, named(result, "Engine").id);
  assert.equal(result.relationships.find((edge) => edge.kind === "impl-trait").to, named(result, "Run").id);
  assert.equal(result.coverage.status, "partial");
  assert.ok(result.entities.every((entity) => entity.kind !== "class"));
  assert.doesNotThrow(() => serialize(result));
});

test("named descendants of impls, externs and nested blocks keep structural identities under trivia edits", async () => {
  const code = `pub struct Engine;
trait Read { fn snapshot(&self) -> u8; }
impl Engine { pub fn snapshot(&self) -> u8 { 1 } }
impl Engine { pub fn second(&self) -> u8 { 2 } }
impl Read for Engine { fn snapshot(&self) -> u8 { 3 } }
extern "C" { fn external_snapshot() -> u8; }
extern "C" { fn another_snapshot() -> u8; }
fn nested() { impl Engine { fn local(&self) {} } extern "C" { fn local_external(); } }
`;
  const before = await scan(code, [cargo]);
  const after = await scan(`// unrelated comment\n\n${code.replaceAll("impl Engine", "impl /* header comment */\nEngine").replaceAll('extern "C"', 'extern /* ABI comment */\n"C"')}`, [cargo]);
  const identity = (result) => result.entities.map(({ id, ownerId, qualifiedName }) => ({ id, ownerId, qualifiedName }));
  assert.deepEqual(identity(after), identity(before));
  assert.equal(new Set(before.entities.map((entity) => entity.qualifiedName)).size, before.entities.length);
  assert.equal(before.entities.filter((entity) => entity.name === "snapshot").length, 3);
  assert.ok(before.entities.some((entity) => entity.qualifiedName === "nested/src/lib.rs::impl Engine#0::snapshot"));
  assert.ok(before.entities.some((entity) => entity.qualifiedName === "nested/src/lib.rs::impl Engine#1::second"));
  assert.ok(before.entities.some((entity) => entity.qualifiedName === 'nested/src/lib.rs::extern "C"#0::external_snapshot'));
  assert.ok(before.entities.some((entity) => entity.qualifiedName === 'nested/src/lib.rs::extern "C"#1::another_snapshot'));
  assert.notDeepEqual(named(before, "snapshot", "method").location, named(after, "snapshot", "method").location);
  const ownership = (result) => result.relationships.filter((edge) => edge.kind === "owns").map(({ id, from, to }) => ({ id, from, to }));
  assert.deepEqual(ownership(after), ownership(before));
});

test("comments, strings and macro bodies do not fabricate declarations; UTF-16 locations stay exact", async () => {
  const result = await scan('// fn fake() {}\nconst NOTE: &str = "😀é fn fake2() {}"; fn r#type() {}\nmacro_rules! make { () => { fn fake3() {} } }\nmake!();\n', [cargo]);
  assert.deepEqual(result.entities.map((entity) => entity.name).sort(), ["NOTE", "make", "type"]);
  assert.deepEqual(named(result, "type").location, {
    path: "nested/src/lib.rs", startLine: 2, endLine: 2, startColumn: 41, endColumn: 55,
  });
  assert.equal(meta(result, named(result, "type")).rawName, "r#type");
  assert.ok(result.unresolved.some((ref) => ref.kind === "macro" && ref.text === "make!()"));
  assert.ok(result.unresolved.some((ref) => ref.kind === "macro-definition"));
});

test("Tauri rename changes command name, rename_all only records argument naming", async () => {
  const result = await scan(`#![cfg(unix)]
#[cfg(feature = "desktop")]
mod nested {
    #[tauri::command(rename_all = "camelCase")]
    fn do_work() {}
    #[tauri::command(rename = r#"run-now"#, rename_all = "snake_case")]
    fn r#type() {}
}
`, [cargo]);
  assert.deepEqual(result.extensions.tauriCommands.map((command) => command.commandName), ["do_work", "run-now"]);
  assert.deepEqual(result.extensions.tauriCommands[0].conditions, ["#![cfg(unix)]", '#[cfg(feature = "desktop")]']);
  assert.equal(result.extensions.tauriCommands[0].argumentRenameAll, "camelCase");
  assert.equal(result.extensions.tauriCommands[1].argumentRenameAll, "snake_case");
  assert.ok(result.unresolved.filter((ref) => ref.kind === "cfg").length >= 2);
});

test("handler tokens distinguish app/plugin/unknown without claiming reachability or scanning strings", async () => {
  const result = await scan(`fn registrations() {
  tauri::Builder::default().plugin(other()).invoke_handler(tauri::generate_handler![a::r#type, nested::work]);
  tauri::plugin::Builder::new("test").invoke_handler(tauri::generate_handler![one]);
  builder.invoke_handler(tauri::generate_handler![two, "fake::path"]);
  let fake = "tauri::generate_handler![not_real]";
}
`, [cargo]);
  const registrations = result.extensions.tauriRegistrations;
  assert.equal(registrations.length, 3);
  assert.deepEqual(registrations.map((item) => item.registrationKind), ["app-builder", "plugin-builder", "unknown"]);
  assert.deepEqual(registrations[0].rustPaths, ["a::r#type", "nested::work"]);
  assert.deepEqual(registrations[2].rustPaths, ["two"]);
  assert.deepEqual(registrations[2].rejectedTokens, ['"fake::path"']);
  assert.ok(registrations.every((item) => item.runtimeReachability === "unknown"));
  assert.equal(result.relationships.filter((edge) => edge.kind === "calls").length, 0);
  assert.ok(result.unresolved.some((ref) => ref.kind === "call" && ref.text === "other"));
});

test("duplicate cfg declarations remain distinct, diagnosed and not falsely resolved", async () => {
  const result = await scan(`#[cfg(a)] struct Service;
#[cfg(b)] struct Service;
trait Work {}
impl Work for Service {}
#[cfg(a)] fn go() {}
#[cfg(b)] fn go() {}
`, [cargo]);
  const services = result.entities.filter((entity) => entity.name === "Service");
  assert.equal(services.length, 2);
  assert.notEqual(services[0].id, services[1].id);
  assert.equal(result.diagnostics.filter((item) => item.code === "rust.ambiguous-identity").length, 2);
  assert.equal(result.relationships.filter((edge) => edge.kind === "impl-for").length, 0);
  assert.equal(result.unresolved.find((ref) => ref.kind === "impl-type").candidates.length, 2);
});

test("generic parameters cannot be falsely connected to same-spelled local structs", async () => {
  const result = await scan("struct T; trait Run {} impl<T> Run for T {} impl Run for foreign::T {}", [cargo]);
  assert.equal(result.relationships.filter((edge) => edge.kind === "impl-for").length, 0);
  assert.equal(result.unresolved.filter((ref) => ref.kind === "impl-type").length, 2);
});

test("imports, aliased calls, cfg_attr and out-of-line modules explicitly remain unresolved", async () => {
  const result = await scan(`use other::{work as alias, Stuff};
mod outside;
#[cfg_attr(feature = "x", tauri::command)]
fn work<T: Work>(value: &dyn Work) { alias(); value.go(); T::go(); }
`, [cargo]);
  assert.deepEqual(result.unresolved.filter((ref) => ref.kind === "call").map((ref) => ref.text).sort(), ["T::go", "alias", "value.go"]);
  assert.equal(result.unresolved.filter((ref) => ref.kind === "use").length, 1);
  assert.equal(result.unresolved.filter((ref) => ref.kind === "module-source").length, 1);
  assert.equal(result.extensions.tauriCommands.length, 0);
  assert.ok(result.unresolved.some((ref) => ref.kind === "cfg" && ref.text.includes("cfg_attr")));
});

test("nested Cargo manifests preserve declared dependencies/features, not a resolved graph", async () => {
  const result = await scan("fn helper() {}", [
    source("Cargo.toml", '[workspace]\nmembers = ["nested"]\n'),
    source("nested/Cargo.toml", `[package]
name = "fixture"
version = "0.1.0"
edition = "2021"
[lib]
path = "src/lib.rs"
[dependencies]
serde = { version = "1", features = ["derive"] }
[target.'cfg(unix)'.dependencies]
libc = "0.2"
[build-dependencies]
codegen = "1"
[features]
default = ["desktop"]
desktop = ["serde/std"]
`),
  ]);
  assert.equal(result.extensions.crates.length, 2);
  const crate = result.extensions.crates.find((record) => record.package);
  assert.equal(crate.package.name, "fixture");
  assert.deepEqual(crate.dependencies.map((item) => [item.name, item.kind, item.target]), [
    ["serde", "dependencies", null], ["codegen", "build-dependencies", null], ["libc", "dependencies", "cfg(unix)"],
  ]);
  assert.deepEqual(crate.features.desktop, ["serde/std"]);
  assert.equal(crate.targets[0].sourcePath, "nested/src/lib.rs");
  assert.equal(crate.targets[0].sourcePresent, true);
  assert.equal(crate.evidenceKind, "declared-manifest-only");
  assert.equal(result.extensions.files[0].nearestManifestPath, "nested/Cargo.toml");
});

test("bad/missing manifests and Rust parse errors do not become success-shaped completeness", async () => {
  const result = await scan("fn broken( {", [source("nested/Cargo.toml", "[package\n")]);
  assert.equal(result.coverage.status, "partial");
  assert.ok(result.diagnostics.some((item) => item.code === "rust.invalid-cargo-manifest"));
  assert.ok(result.diagnostics.some((item) => item.code === "rust.syntax-error"));
  assert.equal(result.extensions.files[0].status, "recovered-with-errors");
  const missing = await scan("fn valid() {}");
  assert.ok(missing.diagnostics.some((item) => item.code === "rust.missing-cargo-manifest"));
  assert.ok(named(missing, "valid"));
});

test("canonical facts are deterministic, source-relative and independent of root or inventory order", async () => {
  const files = [source("src/lib.rs", "fn alpha() {}"), source("Cargo.toml", '[package]\nname="a"\nversion="0.1.0"\n')];
  const first = await scanRust({ root: "/host/one", files });
  const second = await scanRust({ root: "/host/two", files: files.toReversed() });
  assert.equal(serialize(first), serialize(second));
  assert.ok(!serialize(first).includes("/host/"));
  assert.equal(new Set(first.entities.map((item) => item.id)).size, first.entities.length);
  assert.deepEqual(files[0], source("src/lib.rs", "fn alpha() {}"));
});

test("ambiguous or corrupt source inventories are rejected before extraction", async () => {
  const file = source("src/lib.rs", "fn a() {}");
  await assert.rejects(scanRust({ root: ".", files: [file, file] }), /Duplicate captured inventory path/);
  await assert.rejects(scanRust({ root: ".", files: [{ ...file, contents: "fn b() {}" }] }), /sha256 mismatch/);
  await assert.rejects(scanRust({ root: ".", files: [source("../escape.rs", "")] }), /repository-relative/);
});

test("no Rust input means unsupported, not a complete empty program", async () => {
  const result = await scanRust({ root: ".", files: [source("a.ts", "export {}")] });
  assert.equal(result.coverage.status, "unsupported");
  assert.deepEqual(result.coverage.analyzedFiles, []);
});

test("block-scoped declarations are not merged with unrelated enclosing names", async () => {
  const result = await scan(`struct Local;
fn outer() {
  { struct Local; impl Local {} }
  { struct Local; impl Local {} }
}
`, [cargo]);
  const locals = result.entities.filter((entity) => entity.name === "Local");
  assert.equal(locals.length, 3);
  assert.equal(new Set(locals.map((entity) => entity.qualifiedName)).size, 3);
  assert.equal(result.diagnostics.filter((item) => item.code === "rust.ambiguous-identity").length, 0);
  const edges = result.relationships.filter((edge) => edge.kind === "impl-for");
  assert.equal(edges.length, 2);
  assert.ok(edges.every((edge) => result.entities.find((entity) => entity.id === edge.to).location.startLine > 1));
});

test("invalid Cargo table shapes are diagnosed rather than treated as declared dependency evidence", async () => {
  const result = await scan("fn f() {}", [source("nested/Cargo.toml", 'package = "not-a-table"\ndependencies = "not-a-table"\n')]);
  assert.equal(result.extensions.crates[0].status, "invalid");
  assert.ok(result.diagnostics.some((item) => item.code === "rust.invalid-cargo-shape"));
});

test("CRLF, Unicode identifiers and multiline signatures retain original spelling and ranges", async () => {
  const result = await scan('struct Café;\r\npub fn café(\r\n    value: &str,\r\n) -> usize {\r\n    value.len()\r\n}\r\n', [cargo]);
  assert.equal(named(result, "café").signatures[0], "pub fn café(\r\n    value: &str,\r\n) -> usize");
  assert.deepEqual(named(result, "café").location, {
    path: "nested/src/lib.rs", startLine: 2, startColumn: 1, endLine: 6, endColumn: 2,
  });
  assert.equal(named(result, "Café").kind, "struct");
});

test("modern unsafe extern grammar recovery is explicit rather than rewritten source", async () => {
  const result = await scan('unsafe extern "C" {\n  fn external();\n}\n', [cargo]);
  assert.ok(result.diagnostics.some((item) => item.code === "rust.syntax-error"));
  assert.equal(result.extensions.files[0].status, "recovered-with-errors");
  assert.ok(result.extensions.entityMetadata.some((item) => item.fileSyntaxStatus === "recovered-with-errors"));
  assert.ok(result.coverage.limitations.some((item) => item.includes("unsafe extern")));
  assert.equal(result.coverage.status, "partial");
});

test("inherited visibility and inner attributes are recorded without false public/private semantics", async () => {
  const result = await scan('#![allow(dead_code)]\npub trait Public { fn visible(&self); }\npub enum Choice { Variant }\n', [cargo]);
  assert.equal(meta(result, named(result, "visible")).visibility, "inherited");
  assert.equal(meta(result, named(result, "Variant")).visibility, "inherited");
  assert.ok(result.extensions.attributeObservations.some((item) =>
    item.text === "#![allow(dead_code)]" && item.attachment === "inner" && item.location.startLine === 1));
});

test("failed or duplicate command renames do not invent a default command identity", async () => {
  const result = await scan('#[tauri::command(rename = "a", rename = "b")]\nfn command() {}\n', [cargo]);
  assert.deepEqual(result.extensions.tauriCommands, []);
  assert.ok(result.unresolved.some((item) => item.kind === "tauri-command-options"));
});

test("declared Rust paths follow Cargo roots, out-of-line/inline modules and module cfg, not proximity", async () => {
  const result = await scan(`#[cfg(feature = "desktop")]
mod copilot;
fn setup() { tauri::Builder::default().invoke_handler(tauri::generate_handler![copilot::state]); }
`, [cargo,
    source("nested/src/copilot.rs", 'mod host;\n#[tauri::command(rename = "frontend_state")]\nfn state() {}\n'),
    source("nested/src/copilot/host.rs", 'mod nested { #[tauri::command] fn r#type() {} }\n'),
    source("nested/src/not_declared.rs", '#[tauri::command] fn state() {}\n'),
  ]);
  const commands = result.extensions.tauriCommands;
  const state = commands.find((item) => item.commandName === "frontend_state");
  assert.equal(state.rustPathStatus, "established");
  assert.equal(state.rustPath, "crate::copilot::state");
  assert.deepEqual(state.conditions, ['#[cfg(feature = "desktop")]']);
  assert.equal(commands.find((item) => item.commandName === "type").rustPath, "crate::copilot::host::nested::r#type");
  const orphan = commands.find((item) => item.location.path.endsWith("not_declared.rs"));
  assert.equal(orphan.rustPathStatus, "unresolved");
  assert.equal(Object.hasOwn(orphan, "rustPath"), false);
  assert.ok(result.unresolved.some((item) => item.kind === "tauri-command-path" && item.ownerId === orphan.entityId));
  const registration = result.extensions.tauriRegistrations[0];
  assert.equal(registration.modulePath, "crate");
  assert.equal(registration.rustModulePath, "crate");
  assert.equal(registration.crateId, state.crateId);
  assert.equal(registration.pathResolution, "unresolved-token-paths");
});

test("custom paths, cfg_attr module routing and two matching files remain explicitly unresolved", async () => {
  const result = await scan(`#[path = "alternate.rs"] mod custom;
#[cfg_attr(unix, path = "other.rs")] mod platform;
mod ambiguous;
`, [cargo,
    source("nested/src/custom.rs", "#[tauri::command] fn custom() {}"),
    source("nested/src/platform.rs", "#[tauri::command] fn platform() {}"),
    source("nested/src/ambiguous.rs", "#[tauri::command] fn one() {}"),
    source("nested/src/ambiguous/mod.rs", "#[tauri::command] fn two() {}"),
  ]);
  assert.ok(result.extensions.tauriCommands.every((item) => item.rustPathStatus === "unresolved" && !Object.hasOwn(item, "rustPath")));
  assert.ok(result.extensions.moduleMappings.some((item) => item.status === "ambiguous" && item.candidates.length === 2));
  assert.ok(result.extensions.moduleMappings.filter((item) => item.reason?.includes("path/cfg_attr")).length === 2);
});

test("multiple crate roots cannot yield one guessed command crate identity", async () => {
  const result = await scan("mod shared;", [
    cargo, source("nested/src/main.rs", "mod shared;"),
    source("nested/src/shared.rs", "#[tauri::command] fn shared_command() {}"),
  ]);
  const command = result.extensions.tauriCommands[0];
  assert.equal(command.rustPathStatus, "ambiguous");
  assert.equal(Object.hasOwn(command, "rustPath"), false);
  assert.equal(command.rustPathCandidates.length, 2);
  assert.deepEqual(command.rustPathCandidates.map((item) => item.rustPath), ["crate::shared::shared_command", "crate::shared::shared_command"]);
  assert.equal(new Set(command.rustPathCandidates.map((item) => item.crateId)).size, 2);
});

test("inline plugin registration records only a parsed literal namespace and module context", async () => {
  const result = await scan(`mod plugin {
  #[tauri::command] fn command() {}
  fn setup(name: &str) {
    tauri::plugin::Builder::new("native-tools").invoke_handler(tauri::generate_handler![command]);
    tauri::plugin::Builder::new(name).invoke_handler(tauri::generate_handler![command]);
  }
}
`, [cargo]);
  const [literal, dynamic] = result.extensions.tauriRegistrations;
  assert.equal(literal.registrationKind, "plugin-builder");
  assert.equal(literal.pluginNamespace, "native-tools");
  assert.equal(literal.pluginNamespaceStatus, "literal");
  assert.equal(literal.rustModulePath, "crate::plugin");
  assert.equal(literal.modulePath, "crate::plugin");
  assert.equal(dynamic.pluginNamespaceStatus, "unresolved");
  assert.equal(Object.hasOwn(dynamic, "pluginNamespace"), false);
  assert.equal(dynamic.runtimeReachability, "unknown");
  assert.equal(result.extensions.tauriCommands[0].rustPath, "crate::plugin::command");
});

test("nested function commands and use aliases never become crate-qualified declarations", async () => {
  const result = await scan(`mod actual { #[tauri::command] fn command() {} }
use actual::command as renamed;
fn outer() { #[tauri::command] fn command() {} }
fn setup() { tauri::Builder::default().invoke_handler(tauri::generate_handler![renamed]); }
`, [cargo]);
  assert.equal(result.extensions.tauriCommands.filter((item) => item.rustPathStatus === "established").length, 1);
  assert.equal(result.extensions.tauriCommands.find((item) => item.rustPathStatus === "established").rustPath, "crate::actual::command");
  assert.equal(result.extensions.tauriCommands.filter((item) => item.rustPathStatus === "unresolved").length, 1);
  assert.deepEqual(result.extensions.tauriRegistrations[0].rustPaths, ["renamed"]);
  assert.ok(result.unresolved.some((item) => item.kind === "use" && item.text.includes("renamed")));
  assert.equal(result.relationships.filter((item) => item.kind.includes("tauri")).length, 0);
});

test("explicit Cargo library roots honor source path, conventional autodiscovery disablement and mod.rs", async () => {
  const result = await scan("#[tauri::command] fn not_a_root() {}", [
    source("nested/Cargo.toml", '[package]\nname="fixture"\nversion="0.1.0"\nautolib=false\nautobins=false\n[lib]\npath="native/entry.rs"\n'),
    source("nested/native/entry.rs", "mod api;"),
    source("nested/native/api/mod.rs", 'mod child;\n'),
    source("nested/native/api/child.rs", '#[tauri::command] fn command() {}'),
    source("nested/src/main.rs", '#[tauri::command] fn not_a_bin() {}'),
  ]);
  const command = result.extensions.tauriCommands.find((item) => item.commandName === "command");
  assert.equal(command.rustPath, "crate::api::child::command");
  assert.ok(result.extensions.tauriCommands.filter((item) => item.commandName.startsWith("not_a_"))
    .every((item) => item.rustPathStatus === "unresolved"));
  assert.equal(result.extensions.crates[0].moduleRoots.length, 1);
});

test("cfg-alternative command declarations do not produce one guessed Rust endpoint", async () => {
  const result = await scan('#[cfg(a)] #[tauri::command] fn command() {}\n#[cfg(b)] #[tauri::command] fn command() {}\n', [cargo]);
  assert.equal(result.extensions.tauriCommands.length, 2);
  for (const command of result.extensions.tauriCommands) {
    assert.equal(command.rustPathStatus, "ambiguous");
    assert.equal(Object.hasOwn(command, "rustPath"), false);
    assert.equal(command.rustPathCandidates.length, 2);
    assert.ok(command.rustPathCandidates.every((candidate) => candidate.rustPath === "crate::command"));
    assert.equal(new Set(command.rustPathCandidates.map((candidate) => candidate.entityId)).size, 2);
  }
});

test("Tauri source locations after emoji use one-based UTF-16, not byte columns", async () => {
  const result = await scan('const S: &str = "🦀"; #[tauri::command] fn crab() {}\nfn setup() {\n    let _ = "🦀"; tauri::generate_handler![crab];\n}\n', [cargo]);
  assert.equal(result.extensions.tauriCommands[0].location.startColumn, 41);
  assert.equal(result.extensions.tauriCommands[0].location.startLine, 1);
  assert.equal(result.extensions.tauriRegistrations[0].location.startColumn, 19);
  assert.equal(result.extensions.tauriRegistrations[0].location.startLine, 3);
  assert.equal(result.extensions.parser.rangeEncoding, "utf-16");
});

test("nested registration modulePath preserves self/super scope and is null without a proved module chain", async () => {
  const result = await scan(`#[tauri::command] fn same() {}
mod review {
  #[tauri::command] fn same() {}
  fn setup() { tauri::generate_handler![self::same, super::same]; }
}
`, [cargo]);
  const registration = result.extensions.tauriRegistrations[0];
  assert.equal(registration.modulePath, "crate::review");
  assert.equal(registration.moduleContextStatus, "established");
  assert.deepEqual(registration.rustPaths, ["self::same", "super::same"]);
  assert.ok(registration.moduleContextEvidence.some((location) => location.startLine === 2));
  assert.deepEqual(result.extensions.tauriCommands.map((command) => command.rustPath), ["crate::same", "crate::review::same"]);
  const unlinked = await scan("fn setup() { tauri::generate_handler![self::same]; }");
  assert.equal(unlinked.extensions.tauriRegistrations[0].modulePath, null);
  assert.equal(unlinked.extensions.tauriRegistrations[0].moduleContextStatus, "unresolved");
});

function lexicalAncestors(result, scope) {
  const ancestors = [];
  const scopes = new Map(result.extensions.lexicalScopes.map((item) => [item.lexicalScope, item]));
  while (scope !== null) {
    assert.ok(!ancestors.includes(scope), "Lexical scope ancestry must not cycle");
    ancestors.push(scope);
    assert.ok(scopes.has(scope), `Scope must have an explicit parent record: ${scope}`);
    scope = scopes.get(scope).parentScope;
  }
  return ancestors;
}

test("root-versus-local command shadow is observable without resolving handler targets", async () => {
  const result = await scan(`#[tauri::command] fn snapshot() {}
fn setup() {
  #[tauri::command] fn snapshot() {}
  tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);
}
`, [cargo]);
  const registration = result.extensions.tauriRegistrations[0];
  assert.equal(registration.moduleLexicalScope, "nested/src/lib.rs");
  const local = result.extensions.tauriCommands.find((item) => item.rustPathStatus === "unresolved");
  const root = result.extensions.tauriCommands.find((item) => item.rustPath === "crate::snapshot");
  const localBinding = result.extensions.lexicalBindings.find((item) => item.entityId === local.entityId);
  const rootBinding = result.extensions.lexicalBindings.find((item) => item.entityId === root.entityId);
  assert.equal(localBinding.name, "snapshot");
  assert.equal(localBinding.kind, "function");
  assert.equal(localBinding.lexicalScope, registration.lexicalScope);
  assert.equal(localBinding.availability, "whole-scope");
  assert.equal(rootBinding.lexicalScope, registration.moduleLexicalScope);
  assert.notEqual(rootBinding.lexicalScope, localBinding.lexicalScope);
  assert.ok(lexicalAncestors(result, registration.lexicalScope).includes(registration.moduleLexicalScope));
  assert.deepEqual(registration.rustPaths, ["snapshot"]);
  assert.equal(result.relationships.filter((item) => item.kind.includes("tauri")).length, 0);
});

test("function parameter and nested let-pattern names are distinct from constructor/field labels", async () => {
  const result = await scan(`fn setup(snapshot: i32, Pair { left: renamed, right }: Pair) {
  let (local, Some(inner), Pair { ref field, other: shadow, .. }, [head, tail @ ..]) = value;
  { tauri::generate_handler![snapshot, renamed, local, inner, field, shadow, head, tail]; }
}
`, [cargo]);
  const parameters = result.extensions.lexicalBindings.filter((item) => item.kind === "parameter");
  assert.deepEqual(parameters.map((item) => item.name).sort(), ["renamed", "right", "snapshot"]);
  const lets = result.extensions.lexicalBindings.filter((item) => item.kind === "let-pattern");
  assert.deepEqual(lets.map((item) => item.name).sort(), ["field", "head", "inner", "local", "shadow", "tail"]);
  const registration = result.extensions.tauriRegistrations[0];
  const ancestors = lexicalAncestors(result, registration.lexicalScope);
  assert.ok([...parameters, ...lets].every((item) => ancestors.includes(item.lexicalScope)));
  assert.ok(lets.every((item) => item.availability === "after-statement" && item.visibleAfter.startLine === 2));
  assert.ok([...parameters, ...lets].every((item) => item.bindingStatus === "syntactic-candidate"));
});

test("let visibility begins after the statement while item declarations are whole-scope", async () => {
  const result = await scan(`fn setup() {
  let snapshot = tauri::generate_handler![snapshot];
  tauri::generate_handler![snapshot];
  fn later() {}
}
`, [cargo]);
  const binding = result.extensions.lexicalBindings.find((item) => item.kind === "let-pattern" && item.name === "snapshot");
  const [initializer, after] = result.extensions.tauriRegistrations;
  assert.equal(binding.lexicalScope, initializer.lexicalScope);
  assert.equal(binding.visibleAfter.startLine, 2);
  assert.ok(binding.visibleAfter.startColumn > initializer.location.endColumn);
  assert.ok(binding.visibleAfter.startLine < after.location.startLine);
  assert.equal(result.extensions.lexicalBindings.find((item) => item.name === "later").availability, "whole-scope");
});

test("root/module/block use trees expose aliases, imported leaves, self imports and globs with exact scopes", async () => {
  const result = await scan(`use crate::api::{self, snapshot as root_alias, nested::{self as module_alias, leaf}, *};
mod review {
  use crate::api::snapshot as module_snapshot;
  fn setup() {
    use crate::api::{snapshot as local_snapshot, other::*};
    tauri::generate_handler![local_snapshot, module_snapshot, root_alias];
  }
}
`, [cargo]);
  const uses = result.extensions.lexicalBindings.filter((item) => item.kind.startsWith("use"));
  const registration = result.extensions.tauriRegistrations[0];
  assert.equal(uses.find((item) => item.name === "root_alias").lexicalScope, "nested/src/lib.rs");
  assert.equal(uses.find((item) => item.name === "api").kind, "use-self");
  assert.equal(uses.find((item) => item.name === "module_alias").kind, "use-alias");
  assert.equal(uses.find((item) => item.name === "leaf").kind, "use");
  assert.equal(uses.find((item) => item.name === "module_snapshot").lexicalScope, registration.moduleLexicalScope);
  assert.equal(uses.find((item) => item.name === "local_snapshot").lexicalScope, registration.lexicalScope);
  const globs = uses.filter((item) => item.wildcard === true);
  assert.equal(globs.length, 2);
  assert.deepEqual(globs.map((item) => item.lexicalScope).sort(), ["nested/src/lib.rs", registration.lexicalScope].sort());
  assert.ok(globs.every((item) => item.bindingStatus === "unresolved-import"));
  const useDeclarations = new Map(result.extensions.useDeclarations.map((item) => [item.id, item]));
  assert.equal(useDeclarations.size, 3);
  assert.ok(uses.every((item) => useDeclarations.get(item.useDeclarationId)?.lexicalScope === item.lexicalScope));
  assert.equal(registration.modulePath, "crate::review");
});

test("sibling-block bindings are not registration ancestors and anonymous imports introduce no named binding", async () => {
  const result = await scan(`fn setup() {
  { use crate::api::snapshot; let hidden = 1; }
  { use crate::Trait as _; tauri::generate_handler![snapshot]; }
}
`, [cargo]);
  const registration = result.extensions.tauriRegistrations[0];
  const ancestors = lexicalAncestors(result, registration.lexicalScope);
  const sibling = result.extensions.lexicalBindings.filter((item) => ["snapshot", "hidden"].includes(item.name));
  assert.equal(sibling.length, 2);
  assert.ok(sibling.every((item) => !ancestors.includes(item.lexicalScope)));
  assert.ok(!result.extensions.lexicalBindings.some((item) => item.name === "_"));
  assert.ok(result.unresolved.some((item) => item.kind === "use" && item.text.endsWith("as _;")));
  const anonymous = result.extensions.useDeclarations.find((item) => item.text.endsWith("as _;"));
  assert.equal(anonymous.lexicalScope, registration.lexicalScope);
  assert.equal(anonymous.moduleLexicalScope, registration.moduleLexicalScope);
});

test("closure parameters, for-patterns and match-arm bindings have bounded lexical scopes", async () => {
  const result = await scan(`fn setup() {
  let callback = |snapshot, (a, b)| { tauri::generate_handler![snapshot, a]; };
  for snapshot in items { tauri::generate_handler![snapshot]; }
  match value { Some(snapshot) => { tauri::generate_handler![snapshot]; }, _ => () }
  tauri::generate_handler![snapshot];
}
`, [cargo]);
  const registrations = result.extensions.tauriRegistrations;
  assert.equal(registrations.length, 4);
  for (const [index, kind] of ["closure-parameter", "for-pattern", "match-pattern"].entries()) {
    const binding = result.extensions.lexicalBindings.find((item) => item.name === "snapshot" && item.kind === kind);
    assert.ok(binding, kind);
    assert.ok(lexicalAncestors(result, registrations[index].lexicalScope).includes(binding.lexicalScope));
    assert.ok(!lexicalAncestors(result, registrations[3].lexicalScope).includes(binding.lexicalScope));
  }
});

test("unsupported patterns and conditional binding scopes are explicit wildcard blockers, not guessed names", async () => {
  const result = await scan(`fn setup() {
  if let Some(snapshot) = value { tauri::generate_handler![snapshot]; }
  match value { A(snapshot) | B(other) => { tauri::generate_handler![snapshot]; }, _ => () }
  tauri::generate_handler![root_command];
}
`, [cargo]);
  const unknown = result.extensions.lexicalBindings.filter((item) => item.wildcard && item.bindingStatus === "unsupported");
  assert.ok(unknown.some((item) => item.reason.includes("conditional")));
  assert.ok(unknown.some((item) => item.reason.includes("or_pattern")));
  assert.ok(unknown.every((item) => !Object.hasOwn(item, "name")));
  const outer = result.extensions.tauriRegistrations.at(-1);
  assert.ok(unknown.every((item) => !lexicalAncestors(result, outer.lexicalScope).includes(item.lexicalScope)));
  assert.ok(result.unresolved.some((item) => item.kind === "lexical-binding"));
});

test("opaque statement/item macros expose possible generated bindings without expanding tokens", async () => {
  const result = await scan(`fn setup() {
  make_local!();
  tauri::generate_handler![snapshot];
}
`, [cargo]);
  const registration = result.extensions.tauriRegistrations[0];
  const opaque = result.extensions.lexicalBindings.find((item) => item.kind === "unexpanded-macro-bindings");
  assert.equal(opaque.wildcard, true);
  assert.equal(opaque.lexicalScope, registration.lexicalScope);
  assert.equal(opaque.bindingStatus, "unsupported");
  assert.ok(!result.extensions.lexicalBindings.some((item) => item.kind === "unexpanded-macro-bindings" && item.location.startLine === 3));
});
