import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MIXED_FILES } from "../test/helpers.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  "local-topocode": { type: "string" }, "local-renderer": { type: "string" },
  registry: { type: "string", default: "https://registry.npmjs.org" },
  report: { type: "string" },
} });
if (Boolean(values["local-topocode"]) !== Boolean(values["local-renderer"])) {
  throw new Error("Local bootstrap requires both --local-topocode and --local-renderer.");
}
const directory = await mkdtemp(join(tmpdir(), "topo-spike-packed-smoke-"));
const consumer = join(directory, "consumer");
const home = join(directory, "home");
await mkdir(consumer);
await mkdir(home);
const env = {
  PATH: process.env.PATH, HOME: home, TMPDIR: directory,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  npm_config_cache: join(directory, "npm-cache"),
  npm_config_userconfig: join(directory, "empty.npmrc"),
  npm_config_globalconfig: join(directory, "empty-global.npmrc"),
  npm_config_registry: values.registry,
};
await writeFile(env.npm_config_userconfig, "");
await writeFile(env.npm_config_globalconfig, "");
const receipt = { status: "running", node: process.version,
  dependencySource: values["local-topocode"] ? "explicit-local-release-tarballs" : "published-npm-packages",
  steps: [], humanAcceptance: "not-claimed" };
async function run(command, args, expectedCode = 0, cwd = consumer) {
  let result;
  try {
    result = { ...(await execute(command, args, { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })), code: 0 };
  } catch (error) {
    if (error.killed || error.code !== expectedCode) throw error;
    result = error;
  }
  assert.equal(result.code, expectedCode, `${command} ${args[0]} exit code`);
  return result.stdout;
}
try {
  const localPackages = [];
  for (const [flag, expectedName, expectedHash] of [
    ["local-topocode", "@jdylanmc/topo-code", "f2248386c8aa9cf3c141a32eafffdce3117a2ab56aa91595c36cf164ffc40f64"],
    ["local-renderer", "@jdylanmc/topo-archify", "d32492b080b1fbc8126506d83678d3bdbf321ab935d0b74e89586576b58c4d27"],
  ]) {
    if (!values[flag]) continue;
    const path = resolve(values[flag]);
    assert.equal((await lstat(path)).isFile(), true);
    assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), expectedHash,
      `Expected preserved exact ${expectedName}@0.1.0 release tarball, not a rebuilt substitute`);
    const metadata = JSON.parse(await run("tar", ["-xOf", path, "package/package.json"]));
    assert.equal(metadata.name, expectedName);
    assert.equal(metadata.version, "0.1.0");
    localPackages.push(path);
  }
  const pack = JSON.parse(await run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], 0, root))[0];
  assert.equal(pack.name, "topocode-plugin-spike");
  assert.ok(pack.unpackedSize < 512 * 1024, "Retained experiment package must remain bounded");
  assert.ok(pack.files.length < 60, "No generated artifacts should enter the package");
  for (const file of pack.files) {
    assert.match(file.path, /^(?:package\.json|LICENSE|README\.md|REPORT\.md|(?:bin|src|skills|evidence)\/)/);
    assert.ok(!/(?:node_modules|artifacts|\.tgz|\.png|\.log|package-lock)/.test(file.path));
  }
  receipt.package = { name: pack.name, version: pack.version, integrity: pack.integrity,
    files: pack.files.map(({ path }) => path), unpackedSize: pack.unpackedSize };
  receipt.steps.push("actual npm pack with bounded inventory");
  for (const [path, text] of Object.entries(MIXED_FILES)) {
    await mkdir(dirname(join(consumer, path)), { recursive: true });
    await writeFile(join(consumer, path), text);
  }
  await writeFile(join(consumer, ".gitignore"), "node_modules/\n.topo/cache/\n");
  await writeFile(join(consumer, "AGENTS.md"), "Keep this synthetic consumer guidance unchanged.\n");
  await run("npm", ["install", "--save-dev", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund",
    "--registry", values.registry, join(directory, pack.filename), ...localPackages]);
  receipt.steps.push("fresh packed-consumer npm install --ignore-scripts");
  const installed = join(consumer, "node_modules/topocode-plugin-spike");
  assert.equal((await lstat(installed)).isSymbolicLink(), false, "Consumer must not link a source checkout");
  assert.equal((await lstat(join(consumer, "node_modules/@jdylanmc/topo-code"))).isSymbolicLink(), false);
  await run("git", ["init", "-q", "-b", "main"]);
  const help = await run("npm", ["exec", "--no", "--", "topo-spike", "--help"]);
  assert.match(help, /EXPERIMENTAL/);
  await run("npm", ["exec", "--no", "--", "topo-spike", "init", "."]);
  assert.match(await readFile(join(consumer, ".agents/skills/topo-plugin-spike/SKILL.md"), "utf8"), /experimental|technical spike/i);
  assert.equal(await readFile(join(consumer, "AGENTS.md"), "utf8"), "Keep this synthetic consumer guidance unchanged.\n");
  await run("git", ["add", "package.json", "package-lock.json", ".gitignore", "AGENTS.md", "src", "src-tauri", ".agents", ".github", ".topo/config.json"]);
  await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Topocode synthetic fixture",
    "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  const preserved = new Map(await Promise.all(["src/main.ts", "src-tauri/Cargo.toml", "src-tauri/src/lib.rs", "AGENTS.md"]
    .map(async (path) => [path, await readFile(join(consumer, path))])));
  const baselinePath = ".topo/cache/plugin-spike/baseline.json";
  await run("npm", ["exec", "--no", "--", "topo-spike", "scan", ".", "--allow-partial"], 2);
  const baseline = JSON.parse(await readFile(join(consumer, baselinePath), "utf8"));
  assert.equal(baseline.coverage.status, "partial");
  const edge = baseline.relationships.find((item) => item.kind === "tauri-command-binding");
  assert.ok(edge, "Actual installed mixed-language scan must produce the supported source binding");
  receipt.steps.push("installed npm-bin init and partial scan (exit 2), source Tauri binding");
  const view = {
    schemaVersion: "0.1.0-spike.1", id: "packed-smoke", title: "Packed command binding",
    summary: "A synthetic TypeScript call binds to a source-declared Rust command; runtime execution is unknown.",
    baselineId: baseline.id,
    sections: [
      { id: "frontend", title: "Frontend", body: "Captured invocation.", entityIds: [edge.from] },
      { id: "rust", title: "Rust command", body: "Captured command declaration.", entityIds: [edge.to] },
    ],
    connections: [{ from: "frontend", to: "rust", label: "snapshot",
      classification: "source-derived", relationshipIds: [edge.id] }],
  };
  const viewPath = "stories/packed-smoke.topo-view.json";
  await mkdir(join(consumer, "stories"));
  await writeFile(join(consumer, viewPath), JSON.stringify(view, null, 2));
  await run("npm", ["exec", "--no", "--", "topo-spike", "validate", ".", baselinePath, viewPath]);
  for (const renderer of ["archify", "graphviz"]) {
    const output = `.topo/cache/plugin-spike/${renderer}.html`;
    const rendered = JSON.parse(await run("npm", ["exec", "--no", "--", "topo-spike", "render",
      ".", baselinePath, viewPath, "--renderer", renderer, "--output", output]));
    assert.match(await readFile(join(consumer, output), "utf8"), /<iframe\b/);
    assert.match(await readFile(join(consumer, `${output}.native.html`), "utf8"), /<svg\b/);
    assert.equal(rendered.renderer.name, renderer);
    if (renderer === "archify") assert.equal(rendered.nativeValidation.checksPassed, 9);
    else assert.equal(rendered.nativeValidation.status, "pass");
    receipt.steps.push(`installed CLI validate/render with ${renderer}; engine-specific receipt checked`);
  }
  for (const [path, bytes] of preserved) assert.ok((await readFile(join(consumer, path))).equals(bytes), path);
  receipt.steps.push("synthetic source and existing guidance unchanged");
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = (error.stderr || error.message).replaceAll(directory, "<owned-smoke-directory>");
  throw error;
} finally {
  if (values.report) {
    const reportPath = resolve(values.report);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(receipt, null, 2) + "\n");
  }
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify(receipt, null, 2));
