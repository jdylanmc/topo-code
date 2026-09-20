import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(directory, name), "utf8");
const skill = read("SKILL.md");
const runtime = read("RUNTIME.md");
const run = read("RUN.md");
const automations = read("AUTOMATIONS.md");
const state = read("STATE.md");
const normalized = (text) => text.replace(/\s+/g, " ");

const links = {
  "SKILL.md": [
    "RUNTIME.md",
    "RUN.md",
    "STATE.md",
    "../joe-mode/SKILL.md",
    "../joe-mode-paseo/TEAM.md",
    "../ship/WORKSPACE.md",
    "../squadron/LIFECYCLE.md",
    "../ship/DELIVERY.md",
    "../shepherd/OBSERVATION.md",
    "../shepherd/RECOVERY.md",
    "../joe-mode-paseo/MERGE.md",
    "../doctrine/APPLY.md",
  ],
  "RUN.md": [
    "SKILL.md",
    "RUNTIME.md",
    "STATE.md",
    "../joe-mode-paseo/TEAM.md",
    "../ship/WORKSPACE.md",
    "../squadron/LIFECYCLE.md",
    "../ship/DELIVERY.md",
    "../shepherd/OBSERVATION.md",
    "../shepherd/RECOVERY.md",
    "../joe-mode-paseo/MERGE.md",
    "../doctrine/APPLY.md",
    "../joe-mode/SKILL.md",
  ],
};

test("entrypoint permits matching machine continuation but guards activation", () => {
  assert.match(skill, /^name: joe-mode-orca$/m);
  assert.match(skill, /^disable-model-invocation: false$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /HUMAN-ONLY ACTIVATION|Human-only activation guard/i);
  assert.match(skill, /matching preauthorized wake loads.*RUN\.md.*never intake/i);
  assert.match(normalized(skill), /Installation.*never activates/i);
});

test("standalone entry and pass reach all authority contracts", () => {
  for (const [file, required] of Object.entries(links)) {
    const text = read(file);
    const targets = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map(match => match[1]);
    for (const link of required) {
      assert.ok(existsSync(join(directory, link)), `${link} must resolve`);
      assert.ok(targets.includes(link), `${file} must link ${link}`);
    }
  }
});

test("runtime loads native guides and resolves one executable safely", () => {
  for (const phrase of [
    "orca skills get orchestration --full",
    "orca skills get orca-cli --full",
    "references/automations.md",
    "ORCA_CLI_COMMAND",
    "ORCA_DEV_REPO_ROOT",
    "orca-dev",
    "orca-ide",
    "bare `orca`",
    "never a shell variable",
    "Missing guides",
    "do not install, start, or silently substitute",
  ]) assert.match(normalized(runtime), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("activation and serialization fail closed without native ownership proof", () => {
  for (const phrase of [
    "actual exclusion",
    "initialize paused",
    "complete the first pass immediately",
    "run-use.*not exclusive ownership",
    "owner JSON file alone is not a lock",
    "age-based lease stealing",
    "recurring mutations remain disabled",
    "release it on every normal exit",
  ]) assert.match(normalized(runtime), new RegExp(phrase, "i"));
});

test("scheduled passes inspect and reuse custody without initializing or resuming", () => {
  const pass = normalized(run);
  assert.match(pass, /scheduled pass never calls `init`, `resume`, `recover` or `bind`/);
  assert.match(pass, /inspect` with canonical `commonDir` and that recorded `boardPath` before any claim/);
  assert.match(pass, /Carry the returned canonical absolute `boardPath` into \*\*every\*\* subsequent helper call/);
  assert.match(pass, /absent default board does not prove there is no alternate/);
  assert.ok(pass.indexOf("owner.mjs inspect") < pass.indexOf("owner.mjs claim"));
});

test("bounded pass covers parallel budget, waits, source gates, and worker outcomes", () => {
  for (const phrase of [
    "all FIFO Delivery messages",
    "every human wait",
    "six-slot budget",
    "independent work",
    "publication is unresolved",
    "missing Discovery role does not block",
    "worker_done",
    "request-show",
    "retry-request",
    "permission denial",
    "Human merge remains default",
  ]) assert.match(normalized(`${runtime}\n${run}`), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("pause preserves workers/history and resume is human-only", () => {
  for (const phrase of [
    "new-dispatch gate",
    "does not blanket-stop",
    "Human-only resume",
    "Stop disables and preserves history",
    "removal is separate explicit cleanup authorization",
  ]) {
    assert.match(normalized(`${run}\n${automations}`), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.ok(run.indexOf("new-dispatch gate") < run.indexOf("disables exact owned automations"));
});

test("recurrence handshake rejects unexpected sessions and distinguishes states", () => {
  for (const phrase of [
    "disabled/manual first-run probe",
    "must not dispatch",
    "fresh unexpected identity fails closed",
    "no new Run",
    "configured, initially observed, and recurring-verified",
    "wake provenance",
    "return channel",
    "no per-developer/reviewer/coordinator timers",
  ]) assert.match(normalized(automations), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("permissions and merge coordinator remain explicit gates", () => {
  assert.match(normalized(runtime), /human-selected modes\/features.*read back/i);
  assert.match(normalized(runtime), /Unknown cross-provider equivalence blocks launch/i);
  assert.match(skill, /MERGE/);
  assert.match(normalized(run), /Roast, CI, lint, rubber-duck, expected-head\/base/);
  assert.match(normalized(run), /Unknown gates require human clarification/);
});

test("workflow names the concrete local owner helper and its boundary", () => {
  assert.ok(existsSync(join(directory, "scripts/owner.mjs")));
  for (const text of [skill, runtime, run, automations]) {
    assert.match(text, /STATE\.md/);
  }
  assert.match(state, /scripts\/owner\.mjs/);
  assert.match(normalized(state), /one control host/);
  assert.match(normalized(state), /A local token never cancels an external process/);
});
