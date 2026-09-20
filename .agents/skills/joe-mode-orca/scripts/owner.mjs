import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const identityKeys = ["repo", "commonDir", "controlHost", "runtime", "coordinator", "run"];
const statuses = ["paused", "active", "stopped"];
const modes = ["session", "recurring"];
const outcomes = ["accepted", "failed", "not-issued"];

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) fail("invalid", `${label} is required`);
  return value;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function absolute(value, label) {
  text(value, label);
  if (!isAbsolute(value)) fail("invalid", `${label} must be absolute`);
  return resolve(value);
}

function location(input) {
  const commonDir = realpathSync(absolute(input.commonDir, "commonDir"));
  const requested = input.boardPath === undefined
    ? join(commonDir, "joe-owner.json") : absolute(input.boardPath, "boardPath");
  // Resolve directory aliases before choosing the shared lock; never follow a board symlink.
  const path = join(realpathSync(dirname(requested)), basename(requested));
  return { commonDir, path };
}

function identity(input, commonDir) {
  return Object.fromEntries(identityKeys.map(key =>
    [key, key === "commonDir" ? commonDir : text(input[key], key)]));
}

function human(input) {
  if (input.human !== true) fail("authority", "explicit human management required");
  text(input.authority, "human authority reference");
  text(input.observation, "current observation reference");
}

function json(value, label) {
  if (value === undefined) fail("invalid", `${label} is required`);
  return JSON.parse(JSON.stringify(value));
}

function validateOperation(operation, historical = false) {
  if (!object(operation)) fail("incompatible", "invalid operation record");
  for (const key of ["id", "intent"]) text(operation[key], `operation ${key}`);
  if (operation.token !== null) text(operation.token, "operation token");
  for (const key of ["task", "dispatch"]) {
    if (operation[key] !== null) text(operation[key], `operation ${key}`);
  }
  if (!(historical ? outcomes : ["pending", "unknown"]).includes(operation.status)) {
    fail("incompatible", "invalid operation status");
  }
  if (historical) text(operation.evidence, "settled outcome evidence");
}

function validate(board) {
  if (!object(board)) fail("incompatible", "owner board must be an object");
  if (!Object.hasOwn(board, "orca")) return board;
  const state = board.orca;
  if (!object(state) || state.version !== 1 || !statuses.includes(state.status) ||
      !modes.includes(state.mode) || !object(state.identity) ||
      !Number.isSafeInteger(state.generation) || state.generation < 0 ||
      !Array.isArray(state.history) || !object(state.facts)) {
    fail("incompatible", "invalid Orca owner state");
  }
  for (const key of identityKeys) text(state.identity[key], `saved ${key}`);
  text(state.authority, "saved authority reference");
  text(state.reconciliation, "saved reconciliation reference");
  if (!isAbsolute(state.identity.commonDir)) fail("incompatible", "invalid saved commonDir");
  if (state.jobBinding !== null) text(state.jobBinding, "saved job binding");
  if (state.pass !== null) {
    if (!object(state.pass) || state.pass.generation !== state.generation ||
        !isDeepStrictEqual(state.pass.owner, state.identity)) {
      fail("incompatible", "invalid saved pass");
    }
    text(state.pass.token, "saved pass token");
  }
  if (state.operation !== null) {
    validateOperation(state.operation);
    if (state.operation.token !== null && state.operation.token !== state.pass?.token) {
      fail("incompatible", "pending operation has no owning pass");
    }
    if (state.operation.token === null && (state.pass || state.status === "active")) {
      fail("incompatible", "management operation conflicts with active work");
    }
  }
  const ids = new Set();
  for (const event of state.history) {
    if (!object(event)) fail("incompatible", "invalid history");
    text(event.type, "history type");
    if (event.type === "operation") {
      validateOperation(event, true);
      if (ids.has(event.id) || state.operation?.id === event.id) {
        fail("incompatible", "duplicate operation identity");
      }
      ids.add(event.id);
    }
  }
  return board;
}

function readBoard(path) {
  let stat;
  try { stat = lstatSync(path); } catch (cause) {
    if (cause.code === "ENOENT") return {};
    throw cause;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    fail("unsafe", "owner board must be a regular, non-linked file; symlink refused");
  }
  let board;
  try { board = JSON.parse(readFileSync(path, "utf8")); } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    fail("corrupt", `corrupt owner board: ${cause.message}`);
  }
  return validate(board);
}

function writeBoard(path, board) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, `${JSON.stringify(validate(board), null, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
    }
  }
}

function transaction(input, apply) {
  const { commonDir, path } = location(input);
  const actor = identity(input, commonDir);
  const lock = `${path}.write-lock`;
  try { mkdirSync(lock, { mode: 0o700 }); } catch (cause) {
    if (cause.code === "EEXIST") fail("busy", `owner board busy: ${lock}`);
    throw cause;
  }
  try {
    const board = readBoard(path);
    const before = JSON.stringify(board);
    // Every identity, status and foreign-owner check uses the locked snapshot.
    const result = apply(board, actor);
    if (JSON.stringify(board) !== before) writeBoard(path, board);
    return { ...result, path };
  } finally { rmdirSync(lock); }
}

function bound(board, actor, allowed = statuses) {
  const state = board.orca;
  if (!state) fail("missing", "Orca owner subsection is uninitialized");
  if (!isDeepStrictEqual(state.identity, actor)) fail("conflict", "owner identity mismatch");
  if (!allowed.includes(state.status)) fail("state", `operation requires status: ${allowed.join(", ")}`);
  return state;
}

function noForeign(board) {
  if (board.pm?.mode === "enabled" || board.pm?.lease) {
    fail("conflict", "another Joe adapter is active on this owner board");
  }
}

function token(state, input) {
  if (state.pass?.token !== text(input.token, "token")) fail("stale", "stale pass token");
}

function guard(board, actor, input) {
  noForeign(board);
  const state = bound(board, actor, ["active"]);
  token(state, input);
  return state;
}

export function inspect(input) {
  const { path } = location(input);
  const board = readBoard(path);
  return { status: board.orca ? "initialized" : "uninitialized", path, board };
}

export function init(input) {
  return transaction(input, (board, actor) => {
    human(input);
    text(input.reconciliation, "existing-controller reconciliation");
    noForeign(board);
    const mode = input.mode ?? "session";
    if (!modes.includes(mode)) fail("invalid", "mode must be session or recurring");
    if (board.orca) {
      const state = bound(board, actor);
      if (state.mode !== mode) fail("conflict", "init conflicts with existing configuration");
      return { status: "already_initialized" };
    }
    board.orca = {
      version: 1, status: "paused", mode, identity: actor, generation: 0,
      authority: input.authority, reconciliation: input.reconciliation,
      jobBinding: null, pass: null, operation: null, history: [], facts: {},
    };
    return { status: "initialized" };
  });
}

export function bindJob(input) {
  return transaction(input, (board, actor) => {
    human(input);
    noForeign(board);
    const state = bound(board, actor, ["paused", "stopped"]);
    if (state.mode !== "recurring" || state.pass || state.operation) fail("blocked", "binding requires settled recurring owner");
    state.jobBinding = text(input.jobBinding, "verified exact job binding reference");
    state.history.push({ type: "bound", binding: state.jobBinding, authority: input.authority, observation: input.observation });
    return { status: "bound" };
  });
}

export function resume(input) {
  return transaction(input, (board, actor) => {
    human(input);
    noForeign(board);
    const state = bound(board, actor, ["paused", "stopped"]);
    if (state.pass || state.operation) fail("blocked", "active pass or unresolved operation");
    if (state.mode === "recurring" && (!state.jobBinding || input.jobBinding !== state.jobBinding)) {
      fail("blocked", "recurring job binding is not verified");
    }
    state.status = "active";
    state.history.push({ type: "resumed", authority: input.authority, observation: input.observation });
    return { status: "resumed" };
  });
}

export function claim(input) {
  return transaction(input, (board, actor) => {
    noForeign(board);
    const state = bound(board, actor, ["active"]);
    if (state.pass) fail("busy", "an active pass already exists");
    if (state.operation) fail("blocked", "unresolved operation blocks claim");
    state.generation += 1;
    state.pass = { token: randomUUID(), generation: state.generation, owner: actor };
    return { status: "claimed", token: state.pass.token, generation: state.generation };
  });
}

export function assertPass(input) {
  const { commonDir, path } = location(input);
  const state = guard(readBoard(path), identity(input, commonDir), input);
  return { status: "authorized", path, generation: state.generation };
}

function operationIntent(input) {
  return {
    id: text(input.operationId, "operationId"), intent: text(input.intent, "intent"),
    task: input.task === undefined ? null : text(input.task, "task"),
    dispatch: input.dispatch === undefined ? null : text(input.dispatch, "dispatch"),
    details: input.details === undefined ? null : json(input.details, "details"),
  };
}

export function recordOperation(input) {
  return transaction(input, (board, actor) => {
    noForeign(board);
    const state = bound(board, actor);
    if (input.management === true) {
      human(input);
      if (state.status === "active" || state.pass) fail("blocked", "management requires a settled paused/stopped owner");
    } else guard(board, actor, input);
    const intent = operationIntent(input);
    const prior = state.operation?.id === intent.id ? state.operation
      : state.history.find(event => event.type === "operation" && event.id === intent.id);
    if (prior) {
      if (!Object.keys(intent).every(key => isDeepStrictEqual(intent[key], prior[key]))) {
        fail("conflict", "operation identity or intent changed");
      }
      return { status: prior === state.operation ? "already_recorded" : "already_reconciled", operation: prior };
    }
    if (state.operation) fail("blocked", "another operation is pending");
    state.operation = { ...intent, token: input.management === true ? null : state.pass.token, status: "pending" };
    return { status: "recorded", operation: state.operation };
  });
}

export function reconcileOperation(input) {
  return transaction(input, (board, actor) => {
    const state = bound(board, actor);
    const id = text(input.operationId, "operationId");
    const evidence = text(input.evidence, "outcome evidence");
    if (![...outcomes, "unknown"].includes(input.status)) fail("invalid", "invalid outcome status");
    if (input.human === true) {
      human(input);
      if (state.status === "active") fail("blocked", "human reconciliation requires pause/stop");
    } else token(state, input);
    const prior = state.history.find(event => event.type === "operation" && event.id === id);
    if (prior) {
      if (prior.status !== input.status || prior.evidence !== evidence) fail("conflict", "accepted outcome is immutable");
      return { status: "already_reconciled", operation: prior };
    }
    if (state.operation?.id !== id) fail("missing", "operation is not pending");
    if (input.human !== true && state.operation.token !== input.token) fail("stale", "operation belongs to another pass");
    if (input.status === "unknown") {
      state.operation.status = "unknown";
      state.operation.evidence = evidence;
      return { status: "unresolved", operation: state.operation };
    }
    const settled = { ...state.operation, type: "operation", status: input.status, evidence,
      result: input.result === undefined ? null : json(input.result, "result") };
    state.history.push(settled);
    state.operation = null;
    return { status: "reconciled", operation: settled };
  });
}

export function note(input) {
  return transaction(input, (board, actor) => {
    let state;
    if (input.management === true) {
      human(input);
      state = bound(board, actor, ["paused", "stopped"]);
    } else state = guard(board, actor, input);
    state.facts = { ...state.facts, [text(input.key, "fact key")]: json(input.value, "fact value") };
    return { status: "noted" };
  });
}

export function release(input) {
  return transaction(input, (board, actor) => {
    const state = bound(board, actor);
    token(state, input);
    if (state.operation) fail("blocked", "unresolved operation blocks release");
    state.history.push({ type: "released", token: state.pass.token });
    state.pass = null;
    return { status: "released" };
  });
}

function close(input, status) {
  return transaction(input, (board, actor) => {
    human(input);
    const state = bound(board, actor);
    state.status = status;
    state.history.push({ type: status, reason: text(input.reason, "reason"),
      authority: input.authority, observation: input.observation });
    return { status };
  });
}

export function recover(input) {
  return transaction({ ...input, coordinator: input.previousCoordinator }, (board, actor) => {
    human(input);
    noForeign(board);
    const state = bound(board, actor, ["paused", "stopped"]);
    if (input.reconciled !== true || input.previousReleased !== true || state.operation) {
      fail("blocked", "positive previous release and reconciled effects required");
    }
    text(input.releaseEvidence, "previous actor release/exit evidence");
    const coordinator = text(input.newCoordinator, "newCoordinator");
    state.history.push({ type: "recovered", previous: state.identity, pass: state.pass,
      authority: input.authority, observation: input.observation, releaseEvidence: input.releaseEvidence });
    state.pass = null;
    state.generation += 1;
    state.identity = { ...state.identity, coordinator, runtime: input.newRuntime ?? state.identity.runtime };
    return { status: "recovered", identity: state.identity };
  });
}

export const pause = input => close(input, "paused");
export const stop = input => close(input, "stopped");
export const assert = assertPass;
export const record = recordOperation;
export const reconcile = reconcileOperation;
export const bind = bindJob;
export const operations = { inspect, init, bind, resume, claim, assert, record, reconcile, note, release, pause, stop, recover };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [name, raw] = process.argv.slice(2);
    if (!Object.hasOwn(operations, name)) fail("invalid", `unknown operation: ${name}`);
    process.stdout.write(`${JSON.stringify(operations[name](JSON.parse(raw ?? "{}")))}\n`);
  } catch (cause) {
    process.stderr.write(`${cause.code ?? "error"}: ${cause.message}\n`);
    process.exitCode = 1;
  }
}
