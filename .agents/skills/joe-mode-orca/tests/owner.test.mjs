import assert from "node:assert/strict";
import {
  copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import * as owner from "../scripts/owner.mjs";

const script = fileURLToPath(new URL("../scripts/owner.mjs", import.meta.url));
const roots = [];
const decision = { human: true, authority: "human-decision-1", observation: "live-observation-1" };

function fixture(mode = "session") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "joe-orca-owner-")));
  roots.push(root);
  const commonDir = join(root, "common");
  mkdirSync(commonDir);
  return {
    ...decision, reconciliation: "controllers-released",
    repo: "github:example/repo", commonDir, controlHost: "host-a", runtime: "runtime-a",
    coordinator: "pm-a", run: "run-a", mode,
  };
}

function active(input = fixture()) {
  owner.init(input);
  owner.resume(input);
  return input;
}

function boardPath(input) { return input.boardPath ?? join(input.commonDir, "joe-owner.json"); }
function saved(input) { return JSON.parse(readFileSync(boardPath(input), "utf8")); }
function cli(operation, input) {
  return spawnSync(process.execPath, [script, operation, JSON.stringify(input)], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("inspect discovers ownership without identity and creates nothing", () => {
  const input = fixture();
  assert.equal(owner.inspect({ commonDir: input.commonDir }).status, "uninitialized");
  assert.equal(existsSync(boardPath(input)), false);
  owner.init(input);
  assert.equal(owner.inspect({ commonDir: input.commonDir }).board.orca.identity.coordinator, "pm-a");
});

test("initialization preserves unrelated fields and exact replay; conflicts do not reset", () => {
  const input = fixture();
  writeFileSync(boardPath(input), JSON.stringify({ unrelated: { preserved: true } }));
  owner.init(input);
  const before = readFileSync(boardPath(input), "utf8");
  assert.equal(owner.init(input).status, "already_initialized");
  assert.equal(readFileSync(boardPath(input), "utf8"), before);
  assert.throws(() => owner.init({ ...input, coordinator: "other" }), /identity mismatch/);
  assert.deepEqual(saved(input).unrelated, { preserved: true });
});

test("all control operations need explicit decision and current observation references", () => {
  const input = fixture();
  assert.throws(() => owner.init({ ...input, human: false }), /human/);
  owner.init(input);
  assert.throws(() => owner.resume({ ...input, observation: "" }), /observation/);
  assert.throws(() => owner.resume({ ...input, authority: "" }), /authority/);
  owner.resume(input);
  assert.throws(() => owner.pause({ ...input, human: false, reason: "pause" }), /human/);
  assert.throws(() => owner.stop({ ...input, human: false, reason: "stop" }), /human/);
  assert.equal(saved(input).orca.status, "active");
});

test("explicit existing board outside commonDir is reused; relative locators fail", () => {
  const input = fixture();
  input.boardPath = join(roots.at(-1), "existing-owner.json");
  owner.init(input);
  assert.equal(existsSync(join(input.commonDir, "joe-owner.json")), false);
  assert.equal(owner.inspect(input).status, "initialized");
  assert.throws(() => owner.inspect({ ...input, boardPath: "relative.json" }), /absolute/);
  assert.throws(() => owner.inspect({ ...input, commonDir: "." }), /absolute/);
});

test("two real Git worktrees reuse the recorded alternate board without creating a default", () => {
  const input = fixture();
  const root = roots.at(-1);
  const primary = join(root, "repository");
  const secondary = join(root, "second-worktree");
  mkdirSync(primary);
  const git = (...args) => execFileSync("git", [
    "-c", `core.hooksPath=${join(root, "unused-hooks")}`,
    "-c", "commit.gpgsign=false", "-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid", "-C", primary, ...args,
  ], { encoding: "utf8", stdio: "pipe" });
  git("init", "--quiet");
  git("commit", "--quiet", "--allow-empty", "-m", "fixture");
  git("worktree", "add", "--quiet", "--detach", secondary, "HEAD");
  input.commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir").trim();
  input.boardPath = join(root, "established-owner.json");
  active(input);
  for (const cwd of [primary, secondary]) {
    const inspected = spawnSync(process.execPath, [script, "inspect",
      JSON.stringify({ commonDir: input.commonDir, boardPath: input.boardPath })],
    { cwd, encoding: "utf8" });
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).path, input.boardPath);
  }
  const first = spawnSync(process.execPath, [script, "claim", JSON.stringify(input)],
    { cwd: primary, encoding: "utf8" });
  const second = spawnSync(process.execPath, [script, "claim", JSON.stringify(input)],
    { cwd: secondary, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /busy/);
  assert.equal(existsSync(join(input.commonDir, "joe-owner.json")), false);
});

test("directory aliases converge on one board and the CLI works from paths containing spaces", () => {
  const input = active();
  const alias = join(roots.at(-1), "common-alias");
  symlinkSync(input.commonDir, alias, "dir");
  const { token } = owner.claim({ ...input, commonDir: alias });
  assert.equal(owner.assert({ ...input, token }).status, "authorized");
  const tools = join(roots.at(-1), "tools with spaces");
  mkdirSync(tools);
  const installed = join(tools, "owner.mjs");
  copyFileSync(script, installed);
  const probe = spawnSync(process.execPath, [installed, "inspect",
    JSON.stringify({ commonDir: input.commonDir })], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout).status, "initialized");
});

test("corrupt or structurally invalid state cannot become a successful observation", () => {
  const input = fixture();
  for (const malformed of ["{", "[]", '{"orca":null}', '{"orca":{"version":1}}']) {
    writeFileSync(boardPath(input), malformed);
    assert.throws(() => owner.inspect(input), /corrupt|invalid|object/);
  }
});

test("board symlinks, dangling symlinks and hard-link aliases are refused", () => {
  const input = fixture();
  const target = join(input.commonDir, "target.json");
  symlinkSync(target, boardPath(input));
  assert.throws(() => owner.inspect(input), /symlink/);
  writeFileSync(target, "{}");
  assert.throws(() => owner.init(input), /symlink/);
  rmSync(boardPath(input));
  linkSync(target, boardPath(input));
  assert.throws(() => owner.init(input), /non-linked/);
});

test("write-lock directory is interoperable, never stolen, and owned failures clean up", () => {
  const input = fixture();
  const lock = `${boardPath(input)}.write-lock`;
  mkdirSync(lock);
  assert.throws(() => owner.init(input), /busy/);
  assert.equal(statSync(lock).isDirectory(), true);
  rmSync(lock, { recursive: true });
  assert.throws(() => owner.init({ ...input, mode: "unsupported" }), /mode/);
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(boardPath(input)), false);
});

test("two real CLI processes cannot both acquire the same pass", async () => {
  const input = active();
  const results = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "claim", JSON.stringify(input)]);
    let out = ""; let err = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.on("data", chunk => { err += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, out, err }));
  })));
  assert.equal(results.filter(result => result.code === 0).length, 1);
  assert.equal(results.filter(result => result.code !== 0 && result.err.includes("busy")).length, 1);
  const winner = JSON.parse(results.find(result => result.code === 0).out);
  assert.equal(saved(input).orca.pass.token, winner.token);
});

test("pause preserves the live pass and blocks resume until its explicit release", () => {
  const input = active();
  const { token } = owner.claim(input);
  owner.pause({ ...input, reason: "human pause" });
  assert.equal(saved(input).orca.pass.token, token);
  assert.throws(() => owner.assert({ ...input, token }), /active/);
  assert.throws(() => owner.claim(input), /active/);
  assert.throws(() => owner.resume(input), /active pass/);
  owner.release({ ...input, token });
  owner.resume(input);
  assert.throws(() => owner.assert({ ...input, token }), /stale/);
  assert.notEqual(owner.claim(input).token, token);
});

test("unknown effects remain blocking across pause and a separate process", () => {
  const input = active();
  const { token } = owner.claim(input);
  owner.record({ ...input, token, operationId: "op-1", intent: "worker-start" });
  owner.pause({ ...input, reason: "pause" });
  owner.note({ ...input, management: true, key: "wakeup-close",
    value: { job: "job-1", state: "disabled", evidence: "disabled-readback" } });
  assert.equal(saved(input).orca.pass.token, token);
  owner.reconcile({ ...input, human: false, token, operationId: "op-1", status: "unknown", evidence: "lost-response" });
  assert.equal(saved(input).orca.operation.status, "unknown");
  assert.throws(() => owner.release({ ...input, token }), /unresolved/);
  assert.notEqual(cli("resume", input).status, 0);
  assert.throws(() => owner.recover({ ...input, previousCoordinator: "pm-a", newCoordinator: "pm-b",
    previousReleased: true, reconciled: true, releaseEvidence: "exit-receipt" }), /reconciled effects/);
});

test("reconciliation requires exact pass or explicit paused human recovery", () => {
  const input = active();
  const { token } = owner.claim(input);
  owner.record({ ...input, token, operationId: "op-1", intent: "worker-start" });
  const outcome = { ...input, human: false, token, operationId: "op-1", status: "accepted", evidence: "runtime-readback" };
  assert.throws(() => owner.reconcile({ ...outcome, token: "old" }), /stale/);
  assert.throws(() => owner.reconcile({ ...outcome, status: "whatever" }), /invalid outcome/);
  owner.reconcile(outcome);
  owner.release({ ...input, token });
  assert.equal(saved(input).orca.operation, null);
});

test("operation replay cannot change identity or reissue a settled effect", () => {
  const input = active();
  const { token } = owner.claim(input);
  const operation = { ...input, token, operationId: "op-1", intent: "worker-start", task: "task-1" };
  owner.record(operation);
  assert.equal(owner.record(operation).status, "already_recorded");
  assert.throws(() => owner.record({ ...operation, task: "task-2" }), /changed/);
  const outcome = { ...input, human: false, token, operationId: "op-1", status: "accepted", evidence: "receipt-1" };
  owner.reconcile(outcome);
  assert.equal(owner.record(operation).status, "already_reconciled");
  assert.equal(saved(input).orca.operation, null);
  assert.equal(owner.reconcile(outcome).status, "already_reconciled");
  assert.throws(() => owner.reconcile({ ...outcome, status: "failed" }), /immutable/);
  assert.throws(() => owner.record({ ...operation, intent: "different" }), /changed/);
});

test("recovery is paused, positively released, same-host and same-Run", () => {
  const input = active();
  const { token } = owner.claim(input);
  const recovery = { ...input, previousCoordinator: "pm-a", newCoordinator: "pm-b",
    previousReleased: true, reconciled: true, releaseEvidence: "actor-exit" };
  assert.throws(() => owner.recover(recovery), /paused/);
  owner.stop({ ...input, reason: "stop" });
  assert.throws(() => owner.recover({ ...recovery, previousReleased: "false" }), /positive/);
  assert.throws(() => owner.recover({ ...recovery, controlHost: "host-b" }), /identity/);
  assert.throws(() => owner.recover({ ...recovery, run: "other-run" }), /identity/);
  owner.recover(recovery);
  const replacement = { ...input, coordinator: "pm-b" };
  assert.equal(saved(input).orca.status, "stopped");
  owner.resume(replacement);
  assert.throws(() => owner.assert({ ...replacement, token }), /stale/);
  assert.throws(() => owner.claim(input), /identity/);
});

test("a foreign controller appearing after init blocks resume, claim and mutation guards", () => {
  const input = active();
  const { token } = owner.claim(input);
  const board = saved(input);
  board.pm = { mode: "enabled", lease: null };
  writeFileSync(boardPath(input), JSON.stringify(board));
  assert.equal(owner.inspect(input).board.pm.mode, "enabled");
  assert.throws(() => owner.claim(input), /another Joe adapter/);
  assert.throws(() => owner.assert({ ...input, token }), /another Joe adapter/);
  owner.pause({ ...input, reason: "conflicting controller" });
  owner.release({ ...input, token });
  assert.throws(() => owner.resume(input), /another Joe adapter/);
});

test("recurring initialization, management intent, binding and resume form a usable staged path", () => {
  const input = fixture("recurring");
  owner.init(input);
  assert.throws(() => owner.resume(input), /binding/);
  owner.record({ ...input, management: true, operationId: "create-job", intent: "create disabled automation" });
  assert.throws(() => owner.bind({ ...input, jobBinding: "verified-job-1" }), /settled/);
  owner.reconcile({ ...input, operationId: "create-job", status: "accepted", evidence: "disabled-job-readback" });
  owner.bind({ ...input, jobBinding: "verified-job-1" });
  assert.throws(() => owner.resume({ ...input, jobBinding: "other-job" }), /binding/);
  owner.resume({ ...input, jobBinding: "verified-job-1" });
  assert.throws(() => owner.record({ ...input, management: true, operationId: "other", intent: "other" }), /management/);
});

test("policy facts persist under the active token and rejected writes preserve board bytes", () => {
  const input = active();
  const { token } = owner.claim(input);
  owner.note({ ...input, token, key: "reservations", value: [{ group: "feature-1", slots: 2 }] });
  const before = readFileSync(boardPath(input), "utf8");
  assert.throws(() => owner.note({ ...input, token: "stale", key: "reservations", value: [] }), /stale/);
  assert.equal(readFileSync(boardPath(input), "utf8"), before);
  assert.deepEqual(saved(input).orca.facts.reservations, [{ group: "feature-1", slots: 2 }]);
});
