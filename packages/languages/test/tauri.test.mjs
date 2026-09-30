import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { scanTauri } from "../src/plugins/tauri.mjs";
import { scanRust } from "../src/plugins/rust.mjs";
import { hash, sourceLocation } from "../src/contract.mjs";

const rust = {
  plugin: { id: "rust" }, entities: [],
  extensions: {
    tauriCommands: [
      { entityId: "rust:snapshot", commandName: "snapshot", rustPath: "crate::snapshot", crateId: "fixture-lib", conditions: [],
        location: sourceLocation("src/lib.rs", 1) },
      { entityId: "rust:review", commandName: "start_review", rustPath: "crate::review::start_review", crateId: "fixture-lib", conditions: [],
        location: sourceLocation("src/review.rs", 1) },
    ],
    tauriRegistrations: [{ location: sourceLocation("src/lib.rs", 3), modulePath: "crate", crateId: "fixture-lib", registrationKind: "app-builder",
      rustPaths: ["crate::snapshot", "crate::review::start_review"], conditions: [] }],
  },
};

async function analyze(contents, extra = []) {
  const files = [{ path: "src/main.ts", contents, sha256: hash(contents) }, ...extra];
  return scanTauri({ root: "/synthetic", files }, [rust]);
}

async function recordedAnalysis(code) {
  const invoked = [];
  runInNewContext(code, { invoke: (value) => invoked.push(value), args: [1, "different"], key: "run" });
  const contents = `import { invoke } from "@tauri-apps/api/core";\n${code}`;
  const files = [
    { path: "Cargo.toml", contents: '[package]\nname="fixture"\nversion="0.1.0"\n' },
    { path: "src/lib.rs", contents: "#[tauri::command] fn snapshot() {} fn setup() { tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]); }\n" },
    { path: "src/main.js", contents },
  ].map((file) => ({ ...file, sha256: hash(file.contents) }));
  const context = { root: "/synthetic", files };
  return {
    invoked: JSON.parse(JSON.stringify(invoked)),
    result: await scanTauri(context, [await scanRust(context)]),
  };
}

for (const { name, code, invoked, bindings } of [
  { name: "ordinary scalar parameter", code: 'function run(ignored, command) { invoke(command); } run(1, "snapshot");', invoked: ["snapshot"], bindings: ["snapshot"] },
  { name: "preceding literal spread", code: 'function run(ignored, command) { invoke(command); } run(...[1, "different"], "snapshot");', invoked: ["different"], bindings: [] },
  { name: "preceding unknown spread", code: 'function run(ignored, command) { invoke(command); } run(...globalThis.args, "snapshot");', invoked: ["different"], bindings: [] },
  { name: "spread at the selected position", code: 'function run(command) { invoke(command); } run(...["snapshot"]);', invoked: ["snapshot"], bindings: [] },
  { name: "spread after a scalar position", code: 'function run(command, ...other) { invoke(command); } run("snapshot", ...[1, 2]);', invoked: ["snapshot"], bindings: ["snapshot"] },
  { name: "rest parameter array", code: 'function run(...command) { invoke(command); } run("snapshot");', invoked: [["snapshot"]], bindings: [] },
  { name: "ordinary scalar array binding", code: 'for (const [command] of [["snapshot"]]) { invoke(command); }', invoked: ["snapshot"], bindings: ["snapshot"] },
  { name: "rest array binding", code: 'for (const [...command] of [["snapshot"]]) { invoke(command); }', invoked: [["snapshot"]], bindings: [] },
  { name: "preceding spread in destructured literal", code: 'for (const [ignored, command] of [[...[1, "different"], "snapshot"]]) { invoke(command); }', invoked: ["different"], bindings: [] },
  { name: "preceding unknown spread in destructuring", code: 'for (const [ignored, command] of [[...globalThis.args, "snapshot"]]) { invoke(command); }', invoked: ["different"], bindings: [] },
  { name: "spread after scalar array binding", code: 'for (const [command] of [["snapshot", ...["other"]]]) { invoke(command); }', invoked: ["snapshot"], bindings: ["snapshot"] },
]) {
  test(`parameter positions preserve runtime values: ${name}`, async () => {
    const actual = await recordedAnalysis(code);
    assert.deepEqual(actual.invoked, invoked);
    assert.deepEqual(actual.result.extensions.bindings.map((item) => item.commandName), bindings);
    if (!bindings.length) assert.ok(actual.result.unresolved.some((item) => item.kind === "tauri-invocation"));
  });
}

for (const { name, mutation, resolved } of [
  { name: "unmodified method", mutation: "", resolved: true },
  { name: "unrelated literal key", mutation: 'obj["other"] = () => {};', resolved: true },
  { name: "dot assignment", mutation: "obj.run = () => {};", resolved: false },
  { name: "literal bracket assignment", mutation: 'obj["run"] = () => {};', resolved: false },
  { name: "constant key assignment", mutation: 'const key = "run"; obj[key] = () => {};', resolved: false },
  { name: "constant key chain", mutation: 'const original = "run"; const key = original; obj[key] = () => {};', resolved: false },
  { name: "unknown computed key", mutation: "obj[globalThis.key] = () => {};", resolved: false },
  { name: "unknown key through same receiver alias", mutation: "const alias = obj; alias[globalThis.key] = () => {};", resolved: false },
]) {
  test(`helper writes invalidate the actual member: ${name}`, async () => {
    const actual = await recordedAnalysis(`const obj = { run(command) { invoke(command); } }; ${mutation} obj.run("snapshot");`);
    assert.deepEqual(actual.invoked, resolved ? ["snapshot"] : []);
    assert.deepEqual(actual.result.extensions.bindings.map((item) => item.commandName), resolved ? ["snapshot"] : []);
    if (!resolved) assert.ok(actual.result.unresolved.some((item) => item.kind === "tauri-invocation"));
  });
}

test("unknown computed writes do not invalidate a different unmodified receiver", async () => {
  const actual = await recordedAnalysis(`
const obj = { run(command) { invoke(command); } };
const other = { run(command) { invoke(command); } };
obj[globalThis.key] = () => {};
obj.run("snapshot");
other.run("snapshot");
`);
  assert.deepEqual(actual.invoked, ["snapshot"]);
  assert.deepEqual(actual.result.extensions.bindings.map((item) => item.commandName), ["snapshot"]);
});

test("literal bracket calls share the same helper and write invalidation boundary", async () => {
  const control = await recordedAnalysis('const obj = { run(command) { invoke(command); } }; obj["run"]("snapshot");');
  assert.deepEqual(control.invoked, ["snapshot"]);
  assert.deepEqual(control.result.extensions.bindings.map((item) => item.commandName), ["snapshot"]);
  const changed = await recordedAnalysis('const obj = { run(command) { invoke(command); } }; obj["run"] = () => {}; obj["run"]("snapshot");');
  assert.deepEqual(changed.invoked, []);
  assert.deepEqual(changed.result.extensions.bindings, []);
});

test("deleting a helper member cannot revive its previous definition through an optional call", async () => {
  const actual = await recordedAnalysis('const obj = { run(command) { invoke(command); } }; delete obj["run"]; obj.run?.("snapshot");');
  assert.deepEqual(actual.invoked, []);
  assert.deepEqual(actual.result.extensions.bindings, []);
});

test("literal, constant, and imported alias invocation bindings retain evidence", async () => {
  const result = await analyze(`
import { invoke as call } from "@tauri-apps/api/core";
const COMMAND = "snapshot";
await call(COMMAND);
await call("start_review");
`);
  assert.deepEqual(result.extensions.bindings.map((b) => b.commandName).sort(), ["snapshot", "start_review"]);
  assert.equal(result.relationships.filter((r) => r.kind === "tauri-command-binding").length, 2);
  assert.equal(result.relationships.filter((r) => r.kind === "tauri-handler-entry").length, 2);
  assert.ok(result.relationships.every((r) => r.evidence.some((e) => e.path.endsWith(".rs"))));
  assert.ok(result.extensions.bindings.every((b) => b.runtimeReachability === "not-established"));
});

test("shadowed names and strings/comments are not Tauri invocations", async () => {
  const result = await analyze(`
import { invoke } from "@tauri-apps/api/core";
function other(invoke: (s:string)=>void) { invoke("snapshot"); }
const example = 'invoke("start_review")';
// invoke("snapshot");
`);
  assert.equal(result.extensions.invocationSites, 0);
  assert.equal(result.relationships.filter((r) => r.kind === "tauri-command-binding").length, 0);
});

test("known helper call sites are shown without claiming the caller set is complete", async () => {
  const result = await analyze(`
import { invoke } from "@tauri-apps/api/core";
async function run(command: string) { await invoke(command); }
await run("snapshot");
await run("start_review");
await run(globalThis.userCommand);
`);
  assert.deepEqual(result.extensions.bindings.map((b) => b.commandName).sort(), ["snapshot", "start_review"]);
  assert.ok(result.unresolved.some((u) => u.reason.includes("not closed")));
});

test("destructured const loop commands produce enumerable source bindings", async () => {
  const result = await analyze(`
import { invoke } from "@tauri-apps/api/core";
for (const [id, command] of [["a", "snapshot"], ["b", "start_review"]]) {
 document.getElementById(id)!.onclick = () => invoke(command);
}
`);
  assert.deepEqual(result.extensions.bindings.map((b) => b.commandName).sort(), ["snapshot", "start_review"]);
});

test("mutable and unknown names stay unresolved, not guessed from spelling", async () => {
  const result = await analyze(`
import { invoke } from "@tauri-apps/api/core";
let command = "snapshot";
await invoke(command);
await invoke("not_registered");
`);
  assert.equal(result.relationships.filter((r) => r.kind === "tauri-command-binding").length, 0);
  assert.equal(result.unresolved.length, 2);
});

test("a matching leaf name in the wrong Rust module does not establish registration", async () => {
  const other = structuredClone(rust);
  other.extensions.tauriRegistrations[0].rustPaths = ["wrong::snapshot"];
  const contents = 'import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");';
  const result = await scanTauri({ root: "/synthetic", files: [
    { path: "main.ts", contents, sha256: hash(contents) },
  ] }, [other]);
  assert.equal(result.relationships.length, 0);
  assert.equal(result.unresolved.filter((r) => r.kind === "tauri-invocation").length, 1);
});

test("handler scope and type-only frontend imports cannot invent root command bindings", async () => {
  const other = structuredClone(rust);
  other.extensions.tauriRegistrations[0].modulePath = "crate::other";
  other.extensions.tauriRegistrations[0].rustPaths = ["self::snapshot"];
  const contents = 'import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");';
  const result = await scanTauri({ root: "/synthetic", files: [
    { path: "main.ts", contents, sha256: hash(contents) },
  ] }, [other]);
  assert.equal(result.relationships.length, 0);
  const typeOnly = await analyze('import type { invoke } from "@tauri-apps/api/core"; invoke("snapshot");');
  assert.equal(typeOnly.relationships.filter((r) => r.kind === "tauri-command-binding").length, 0);
});

test("different crates and inline plugin namespaces cannot become app-command bindings", async () => {
  for (const mutation of [
    (registration) => { registration.crateId = "other-crate"; },
    (registration) => { registration.registrationKind = "plugin-builder"; registration.pluginNamespace = "other"; },
    (registration) => { registration.registrationKind = "unknown"; },
  ]) {
    const other = structuredClone(rust);
    mutation(other.extensions.tauriRegistrations[0]);
    const contents = 'import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");';
    const result = await scanTauri({ root: "/synthetic", files: [
      { path: "main.ts", contents, sha256: hash(contents) },
    ] }, [other]);
    assert.equal(result.relationships.filter((r) => r.kind === "tauri-command-binding").length, 0);
    assert.ok(result.unresolved.some((reference) => reference.kind === "tauri-invocation"));
  }
});

test("modified helper parameters cannot retain their original caller-argument binding", async () => {
  for (const mutation of [
    'command = "start_review";',
    'command += "_changed";',
    '[command] = ["start_review"];',
    '({ command } = { command: "start_review" });',
    'const update = () => { command = "start_review"; }; update();',
    '(command as string) = "start_review";',
    'command! = "start_review";',
    '[(command as string)] = ["start_review"];',
    '({ value: (command as string) } = { value: "start_review" });',
    'eval(\'command = "start_review"\');',
  ]) {
    const result = await analyze(`import { invoke } from "@tauri-apps/api/core";
function run(command: string) { ${mutation} return invoke(command); }
run("snapshot");
`);
    assert.equal(result.extensions.bindings.length, 0, mutation);
    assert.ok(result.unresolved.some((reference) => reference.kind === "tauri-invocation"));
  }
});

test("reassigned helper bindings cannot propagate arguments into their previous definition", async () => {
  const result = await analyze(`import { invoke } from "@tauri-apps/api/core";
function run(command: string) { return invoke(command); }
run = () => invoke("start_review");
run("snapshot");
`);
  assert.ok(!result.extensions.bindings.some(({ commandName }) => commandName === "snapshot"));
  assert.ok(result.unresolved.some(({ kind }) => kind === "tauri-invocation"));
});

test("shared literal origins preserve each invocation site and its actual owner", async () => {
  const contents = 'import { invoke } from "@tauri-apps/api/core";\nconst COMMAND = "snapshot";\nfunction one() { return invoke(COMMAND); } function two() { return invoke(COMMAND); }\n';
  const line = contents.split("\n")[2];
  const two = line.indexOf("function two");
  const first = line.indexOf("function one");
  const contribution = {
    plugin: { id: "typescript" },
    entities: [
      { id: "typescript:one", location: sourceLocation("src/main.ts", 3, 3, first + 1, two) },
      { id: "typescript:two", location: sourceLocation("src/main.ts", 3, 3, two + 1, line.length + 1) },
      { id: "typescript:constant", location: sourceLocation("src/main.ts", 2, 2, 1, 28) },
    ],
  };
  const result = await scanTauri({ root: "/synthetic", files: [
    { path: "src/main.ts", contents, sha256: hash(contents) },
  ] }, [rust, contribution]);
  const bindings = result.relationships.filter((relation) => relation.kind === "tauri-command-binding");
  assert.equal(bindings.length, 2);
  assert.equal(new Set(bindings.map(({ id }) => id)).size, 2);
  assert.deepEqual(bindings.map(({ from }) => from).sort(), ["typescript:one", "typescript:two"]);
  assert.deepEqual(result.extensions.bindings.map(({ callSite }) => callSite.startLine), [3, 3]);
  for (const binding of result.extensions.bindings) {
    const relationship = bindings.find(({ id }) => id === binding.relationshipId);
    assert.ok(relationship.evidence.some((item) => item.path === binding.invokeSite.path &&
      item.startLine === binding.invokeSite.startLine && item.startColumn === binding.invokeSite.startColumn));
    assert.ok(relationship.evidence.some((item) => item.path === "src/main.ts" && item.startLine === 2));
  }
});

test("real Rust lexical shadows and use aliases do not bind the root command", async () => {
  for (const body of [
    '#[tauri::command] fn snapshot() {} tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);',
    'use crate::other::snapshot; tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);',
    'use crate::other::*; tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);',
    'let snapshot = 1; tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);',
  ]) {
    const code = `#[tauri::command] fn snapshot() {} fn setup() { ${body} }`;
    const files = [
      { path: "Cargo.toml", contents: '[package]\nname="fixture"\nversion="0.1.0"\n', sha256: hash('[package]\nname="fixture"\nversion="0.1.0"\n') },
      { path: "src/lib.rs", contents: code, sha256: hash(code) },
      { path: "src/ui.ts", contents: 'import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");',
        sha256: hash('import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");') },
    ];
    const rustFacts = await scanRust({ root: "/synthetic", files });
    const result = await scanTauri({ root: "/synthetic", files }, [rustFacts]);
    assert.equal(result.extensions.bindings.length, 0, body);
    assert.ok(result.unresolved.some(({ kind }) => kind === "tauri-handler-entry"));
  }
});

test("explicit crate paths and unrelated sibling bindings preserve valid source joins", async () => {
  for (const body of [
    '#[tauri::command] fn snapshot() {} tauri::Builder::default().invoke_handler(tauri::generate_handler![crate::snapshot]);',
    '{ let snapshot = 1; } tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]);',
    'tauri::Builder::default().invoke_handler(tauri::generate_handler![snapshot]); let snapshot = 1;',
  ]) {
    const code = `#[tauri::command] fn snapshot() {} fn setup() { ${body} }`;
    const files = [
      { path: "Cargo.toml", contents: '[package]\nname="fixture"\nversion="0.1.0"\n', sha256: hash('[package]\nname="fixture"\nversion="0.1.0"\n') },
      { path: "src/lib.rs", contents: code, sha256: hash(code) },
      { path: "src/ui.ts", contents: 'import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");',
        sha256: hash('import { invoke } from "@tauri-apps/api/core"; invoke("snapshot");') },
    ];
    const rustFacts = await scanRust({ root: "/synthetic", files });
    const result = await scanTauri({ root: "/synthetic", files }, [rustFacts]);
    assert.equal(result.extensions.bindings.length, 1, body);
  }
});
