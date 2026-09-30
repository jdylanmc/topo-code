import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const [topoTarball, rendererTarball, retainedDirectory] = process.argv.slice(2);
if (!topoTarball || !rendererTarball) throw new Error("Usage: node scripts/package-smoke.mjs topo.tgz renderer.tgz [new-evidence-directory]");
const root = retainedDirectory
  ? path.resolve(retainedDirectory)
  : await mkdtemp(path.join(tmpdir(), "topo-installed-consumer-"));
if (retainedDirectory) await mkdir(root);
const run = (command, args, extraEnv = {}) => execFileSync(command, args, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, NODE_PATH: "", GIT_CONFIG_NOSYSTEM: "1", ...extraEnv },
  shell: process.platform === "win32" && command.endsWith(".cmd"),
});
const git = (...args) => run("git", args);
const commit = (message) => {
  git("add", ".");
  git("-c", "user.name=Topo Package Test", "-c", "user.email=topo@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
};
const executable = path.join(root, "node_modules/@jdylanmc/topo-code/bin/topo.js");
const networkGuard = path.join(root, "node_modules/.topo-no-network.mjs");
const cli = (...args) => run(process.execPath, [executable, ...args], {
  NODE_OPTIONS: `--import=${pathToFileURL(networkGuard).href}`,
  ...(args[0] === "init" ? { TOPO_INIT_PROOF: "1" } : {}),
});
let server;
let noOptionalRoot;
async function startServer(repository = ".") {
  server = spawn(process.execPath, [executable, "serve", repository, "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Installed server did not become ready")), 10000);
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Topocode: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.on("error", (error) => { clearTimeout(timer); reject(error); });
    server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Installed server exited ${code}: ${output}`)); });
    server.stderr.on("data", (chunk) => { output += chunk; });
  });
}
async function stopServer() {
  const stopped = once(server, "exit");
  server.kill("SIGTERM");
  await stopped;
  server = undefined;
}
async function proveEmptySite(repository = ".") {
  const site = path.resolve(root, repository, ".topo/cache/site");
  assert.equal(JSON.parse(await readFile(path.join(site, "site-state.json"), "utf8")).kind, "unscanned");
  await assert.rejects(lstat(path.join(site, "data.json")), { code: "ENOENT" });
  const url = await startServer(repository);
  const html = await (await fetch(url)).text();
  assert.match(html, /Topocode home/);
  assert.match(html, /No diagrams yet/);
  assert.match(html, /Repository not scanned/);
  assert.equal((await fetch(`${url}/data.json`)).status, 404);
  for (const name of ["shell.js", "LICENSE.txt", "THIRD_PARTY_NOTICES.txt", "ARCHIFY_LICENSE.txt", "JETBRAINS_MONO_LICENSE.txt"]) {
    assert.equal((await fetch(`${url}/${name}`)).status, 200);
  }
  await stopServer();
}
try {
  await writeFile(path.join(root, "package.json"), '{"name":"unrelated-consumer","private":true,"type":"module"}\n');
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund",
    path.resolve(rendererTarball), path.resolve(topoTarball),
  ]);
  const installed = path.join(root, "node_modules/@jdylanmc/topo-code");
  await writeFile(networkGuard, `import http from "node:http"; import https from "node:https"; import net from "node:net";
import childProcess from "node:child_process"; import { register, syncBuiltinESMExports } from "node:module";
const denied = () => { throw new Error("Unexpected network access in installed Topocode"); };
globalThis.fetch = denied; http.request = denied; http.get = denied; https.request = denied; https.get = denied; net.connect = denied;
if (process.env.TOPO_INIT_PROOF === "1") {
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    childProcess[name] = () => { throw new Error("Init invoked a subprocess: " + name); };
  }
  register("data:text/javascript," + encodeURIComponent('export function resolve(specifier, context, next) { if (specifier === "@topo/scanner") throw new Error("Init loaded the scanner"); return next(specifier, context); }'), import.meta.url);
}
syncBuiltinESMExports();
`);
  const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.equal(manifest.name, "@jdylanmc/topo-code");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.dependencies["@jdylanmc/topo-archify"], "0.1.0");
  assert.equal(manifest.scripts, undefined);
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(root, "node_modules/@jdylanmc/topo-archify"))).isSymbolicLink(), false);
  assert.equal(manifest.bundleDependencies.length, 13);
  const publishFixture = path.join(root, "node_modules/.publish-check");
  const packageFile = `jdylanmc-topo-code-${manifest.version}.tgz`;
  await mkdir(path.join(publishFixture, "dist"), { recursive: true });
  await cp(path.resolve(topoTarball), path.join(publishFixture, "dist", packageFile));
  await writeFile(path.join(publishFixture, "package.json"), '{"private":true}\n');
  for (const file of [".npmrc", "user.npmrc", "global.npmrc"]) await writeFile(path.join(publishFixture, file), "");
  const publishEnv = Object.fromEntries(
    ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "TEMP", "TMP", "TMPDIR"]
      .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
  );
  Object.assign(publishEnv, {
    HOME: publishFixture, USERPROFILE: publishFixture, APPDATA: publishFixture, LOCALAPPDATA: publishFixture,
    npm_config_userconfig: path.join(publishFixture, "user.npmrc"),
    npm_config_globalconfig: path.join(publishFixture, "global.npmrc"),
    npm_config_cache: path.join(publishFixture, "cache"),
    npm_config_git: path.join(publishFixture, "git-disabled"),
  });
  const workflow = await readFile(new URL("../.github/workflows/publish-npm.yml", import.meta.url), "utf8");
  const publishArguments = [...workflow.matchAll(/npm publish "([^"]+)"/g)].map((match) =>
    match[1].replace("$PACKAGE_FILE", packageFile));
  assert.equal(publishArguments.length, 2);
  const integrity = `sha512-${createHash("sha512").update(await readFile(path.resolve(topoTarball))).digest("base64")}`;
  for (const argument of publishArguments) {
    const output = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
      "publish", argument, "--dry-run", "--json", "--ignore-scripts", "--provenance=false",
      "--offline", "--registry=http://127.0.0.1:9",
    ], {
      cwd: publishFixture, env: publishEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32",
    }));
    const published = Object.hasOwn(output, "name") ? output : output[manifest.name];
    assert.ok(published, "npm publish --dry-run must report the consumed package");
    assert.equal(published.name, manifest.name);
    assert.equal(published.version, manifest.version);
    assert.equal(published.integrity, integrity);
  }
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, file);
      if (entry.isDirectory()) await inspect(file);
      else if (/\.(?:js|mjs|json|md|txt)$/.test(entry.name)) {
        const text = await readFile(file, "utf8");
        assert.ok(!text.includes("workspace:*"), file);
        assert.ok(!text.includes(fileURLToPath(new URL("../", import.meta.url))), file);
        if (entry.name === "package.json") {
          const packedManifest = JSON.parse(text);
          assert.ok(Object.values(packedManifest.dependencies ?? {}).every((spec) => !spec.startsWith("file:")), file);
          async function checkTargets(value) {
            if (typeof value === "string") {
              assert.ok(value.startsWith("./"), `${file}: ${value}`);
              assert.ok((await lstat(path.join(directory, value))).isFile(), `${file}: ${value}`);
            } else {
              for (const nested of Object.values(value ?? {})) await checkTargets(nested);
            }
          }
          await checkTargets(packedManifest.exports);
        }
        assert.ok(!/^\/\/# sourceMappingURL=/m.test(text), file);
      }
    }
  }
  await inspect(installed);
  run(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    for (const name of ['package.json', 'story.schema.json', 'graph.schema.json']) {
      JSON.parse(readFileSync(new URL(import.meta.resolve('@jdylanmc/topo-code/' + name)), 'utf8'));
    }
  `]);
  assert.match(cli("--help"), /init \[repository\] \[--skills\]/);
  assert.match(run(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "--no", "--", "topo", "--help"]), /Topocode:/);
  git("init", "--quiet");
  git("remote", "add", "origin", "https://github.com/example/installed-consumer.git");
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n.topo/cache/\nsite-output/\nskills-only/\n");
  await writeFile(path.join(root, "AGENTS.md"), "# Existing owner instructions\nDo not replace.\n");
  await mkdir(path.join(root, ".github"), { recursive: true });
  await writeFile(path.join(root, ".github/copilot-instructions.md"), "Existing instructions.\n");
  await mkdir(path.join(root, ".agents/skills/unrelated"), { recursive: true });
  await writeFile(path.join(root, ".agents/skills/unrelated/SKILL.md"), "Existing skill.\n");
  cli("init", ".");
  await proveEmptySite();
  cli("bundle", ".", "--output", ".topo/cache/empty-bundle", "--base-path", "/empty/topo/");
  await mkdir(path.join(root, "skills-only"));
  git("init", "--quiet", "skills-only");
  cli("init", "skills-only", "--skills");
  await proveEmptySite("skills-only");
  await assert.rejects(lstat(path.join(root, ".agents/skills/topo")), { code: "ENOENT" });
  const config = await readFile(path.join(root, ".topo/config.json"), "utf8");
  cli("init", ".", "--skills");
  assert.match(cli("init", ".", "--skills"), /Installed 0/);
  assert.equal(await readFile(path.join(root, ".topo/config.json"), "utf8"), config);
  assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "# Existing owner instructions\nDo not replace.\n");
  assert.equal(await readFile(path.join(root, ".github/copilot-instructions.md"), "utf8"), "Existing instructions.\n");
  assert.equal(await readFile(path.join(root, ".agents/skills/unrelated/SKILL.md"), "utf8"), "Existing skill.\n");
  for (const name of ["topo", "topo-story-authoring", "topo-archify-maintenance"]) {
    assert.match(await readFile(path.join(root, ".agents/skills", name, "SKILL.md"), "utf8"), /^---\nname:/);
  }
  const contextPath = path.join(root, ".agents/skills/topo/SKILL.md");
  const context = await readFile(contextPath);
  await writeFile(contextPath, "User customization\n");
  assert.throws(() => cli("init", ".", "--skills"), /destination conflict/);
  assert.equal(await readFile(contextPath, "utf8"), "User customization\n");
  await writeFile(contextPath, context);

  const fixture = path.join(installed, "examples/story-authoring");
  await cp(path.join(fixture, "initial/src"), path.join(root, "src"), { recursive: true });
  commit("Initial unrelated project");
  await cp(path.join(fixture, "initial/stories"), path.join(root, "stories"), { recursive: true });
  const storyPath = path.join(root, "stories/checkout.topo.json");
  const before = JSON.parse(await readFile(storyPath, "utf8"));
  assert.match(cli("story", "validate", ".", "stories/checkout.topo.json"), /charge-order: src\/checkout.ts:10-12/);
  commit("Author source-grounded story");
  cli("story", "preview", ".", "stories/checkout.topo.json");
  await assert.rejects(lstat(path.join(root, ".topo/cache/site/data.json")), { code: "ENOENT" });
  assert.match(await readFile(path.join(root, ".topo/cache/site/stories/checkout/viewer.html"), "utf8"), /Charge payment/);
  assert.match(cli("scan", "."), /Scanned/);
  cli("story", "preview", ".", "stories/checkout.topo.json");

  await cp(path.join(fixture, "changed/src"), path.join(root, "src"), { recursive: true });
  assert.throws(() => cli("story", "validate", ".", "stories/checkout.topo.json"), /missing-pattern/);
  await cp(path.join(fixture, "changed/stories/checkout.topo.json"), storyPath);
  const after = JSON.parse(await readFile(storyPath, "utf8"));
  assert.equal(after.id, before.id);
  assert.equal(after.summary, before.summary);
  assert.deepEqual(after.anchors[2], before.anchors[2]);
  assert.deepEqual(after.sections[2], before.sections[2]);
  assert.deepEqual(after.connections, before.connections);
  assert.match(cli("story", "validate", ".", "stories/checkout.topo.json"), /charge-order: src\/payment.ts:3-5/);
  commit("Repair story after moving payment boundary");
  cli("scan", ".");
  cli("story", "preview", ".", "stories/checkout.topo.json");
  const viewer = await readFile(path.join(root, ".topo/cache/site/stories/checkout/viewer.html"), "utf8");
  assert.match(viewer, /Charge payment/);
  const url = await startServer();
  for (const resource of ["/", "/stories/checkout/", "/stories/checkout/viewer.html", "/LICENSE.txt", "/THIRD_PARTY_NOTICES.txt"]) {
    const response = await fetch(`${url}${resource}`);
    assert.equal(response.status, 200, resource);
    assert.ok((await response.text()).length > 10, resource);
  }
  await stopServer();
  cli("bundle", ".", "--output", "site-output", "--base-path", "/architecture/");
  const bundle = path.join(root, "site-output/architecture");
  assert.match(await readFile(path.join(bundle, "stories/checkout/viewer.html"), "utf8"), /Charge payment/);
  const notices = await readFile(path.join(bundle, "THIRD_PARTY_NOTICES.txt"), "utf8");
  assert.match(notices, /@jdylanmc\/topo-archify@0\.1\.0/);
  assert.match(notices, /SIL OPEN FONT LICENSE/i);
  assert.match(await readFile(path.join(bundle, "index.html"), "utf8"), /repository/i);
  assert.match(notices, /Graphviz 16\.0\.0/);
  assert.match(notices, /Eclipse Public License - v 2\.0/);
  assert.match(notices, /Source available at: https:\/\/gitlab\.com/);
  assert.match(await readFile(path.join(installed, "docs/rust-tauri.md"), "utf8"), /stale-source/);

  const mixedRoot = path.join(root, "node_modules/.mixed-source");
  const freshHome = path.join(root, "node_modules/.fresh-home");
  await mkdir(mixedRoot);
  await mkdir(freshHome);
  const mixedCli = (...args) => run(process.execPath, [executable, ...args], {
    HOME: freshHome, USERPROFILE: freshHome,
    NODE_OPTIONS: `--import=${pathToFileURL(networkGuard).href}`,
  });
  git("init", "--quiet", mixedRoot);
  git("-C", mixedRoot, "remote", "add", "origin", "https://github.com/example/synthetic-snapshot.git");
  mixedCli("init", mixedRoot, "--skills");
  await proveEmptySite(mixedRoot);
  const mixedFixture = path.join(installed, "examples/rust-tauri");
  for (const name of ["src", "src-tauri", "stories"]) {
    await cp(path.join(mixedFixture, name), path.join(mixedRoot, name), { recursive: true });
  }
  await cp(path.join(mixedFixture, "topo.config.json"), path.join(mixedRoot, ".topo/config.json"));
  await writeFile(path.join(mixedRoot, "package.json"), '{"name":"synthetic-snapshot","type":"module"}\n');
  const mixedCommit = (message) => {
    git("-C", mixedRoot, "add", ".");
    git("-C", mixedRoot, "-c", "user.name=Topo Package Test", "-c", "user.email=topo@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
  };
  mixedCommit("Persist mixed source and technical stories");
  const technicalPath = path.join(mixedRoot, "stories/snapshot.topo.json");
  const overviewPath = path.join(mixedRoot, "stories/snapshot-overview.topo.json");
  assert.match(mixedCli("story", "validate", mixedRoot, technicalPath), /command: src-tauri\/src\/lib.rs/);
  mixedCli("story", "preview", mixedRoot, technicalPath);
  const partial = () => assert.throws(() => mixedCli("scan", mixedRoot, "--allow-partial"), (error) =>
    error.status === 2 && /PARTIAL PREVIEW:/.test(error.stdout));
  partial();
  mixedCli("story", "preview", mixedRoot, overviewPath);
  mixedCli("bundle", mixedRoot, "--output", path.join(mixedRoot, ".topo/pre-repair-bundle"));
  const mixedSite = path.join(mixedRoot, ".topo/cache/site");
  const facts = JSON.parse(await readFile(path.join(mixedRoot, ".topo/graph/graph.json"), "utf8")).extensions["dev.topo.languages"];
  assert.deepEqual(facts.contributions.map((item) => item.plugin.id), ["typescript", "rust", "tauri"]);
  assert.equal(facts.contributions.find((item) => item.plugin.id === "tauri").relationships.filter((edge) =>
    edge.kind === "tauri-command-binding").length, 1);
  const initialIndex = JSON.parse(await readFile(path.join(mixedSite, "repository.json"), "utf8"));
  const methods = initialIndex.nodes.filter((node) => node.kind === "method");
  assert.equal(methods.length, 3);
  assert.deepEqual(methods.map((method) => initialIndex.nodes.find((node) => node.id === method.parentId).kind).sort(), ["impl", "impl", "trait"]);
  const ids = initialIndex.nodes.map((node) => node.id);
  const rustIdentity = (evidence) => {
    const rust = evidence.contributions.find((item) => item.plugin.id === "rust");
    return {
      declarations: rust.entities.map(({ id, qualifiedName, ownerId }) => ({ id, qualifiedName, ownerId })),
      ownership: rust.relationships.filter((edge) => edge.kind === "owns").map(({ id, from, to }) => ({ id, from, to })),
    };
  };
  const originalRustIdentity = rustIdentity(facts);
  const overviewBefore = JSON.parse(await readFile(overviewPath, "utf8"));
  const storyBefore = JSON.parse(await readFile(technicalPath, "utf8"));
  const rustPath = path.join(mixedRoot, "src-tauri/src/lib.rs");
  const sourceBefore = await readFile(rustPath, "utf8");
  await writeFile(rustPath, `// Unrelated comment; whole-file freshness still changes.\n${sourceBefore}`);
  assert.throws(() => mixedCli("story", "validate", mixedRoot, technicalPath), /stale-source/);
  assert.throws(() => mixedCli("story", "preview", mixedRoot, technicalPath), /stale-source/);
  for (const file of [technicalPath, overviewPath]) {
    const document = JSON.parse(await readFile(file, "utf8"));
    for (const anchor of document.anchors.filter((item) => item.path === "src-tauri/src/lib.rs")) {
      anchor.sha256 = createHash("sha256").update(await readFile(rustPath)).digest("hex");
    }
    await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  }
  const repaired = JSON.parse(await readFile(technicalPath, "utf8"));
  assert.equal(repaired.id, storyBefore.id);
  assert.deepEqual(repaired.sections, storyBefore.sections);
  assert.deepEqual(repaired.connections, storyBefore.connections);
  mixedCli("story", "validate", mixedRoot, technicalPath);
  assert.match(mixedCli("story", "validate", mixedRoot, overviewPath), /impl-ready: src-tauri\/src\/lib.rs/);
  const overviewAfter = JSON.parse(await readFile(overviewPath, "utf8"));
  assert.deepEqual(overviewAfter.anchors.map(({ id, path, symbol }) => ({ id, path, symbol })),
    overviewBefore.anchors.map(({ id, path, symbol }) => ({ id, path, symbol })));
  mixedCommit("Reconcile freshness after unrelated comment without changing intent");
  partial();
  const shiftedFacts = JSON.parse(await readFile(path.join(mixedRoot, ".topo/graph/graph.json"), "utf8")).extensions["dev.topo.languages"];
  assert.deepEqual(rustIdentity(shiftedFacts), originalRustIdentity);
  assert.deepEqual(JSON.parse(await readFile(path.join(mixedSite, "repository.json"), "utf8")).nodes.map((node) => node.id), ids);
  await rm(path.join(mixedRoot, ".topo/cache"), { recursive: true });
  partial();
  mixedCli("story", "preview", mixedRoot, technicalPath);
  assert.deepEqual(JSON.parse(await readFile(path.join(mixedSite, "repository.json"), "utf8")).nodes.map((node) => node.id), ids);
  const mixedUrl = await startServer(mixedRoot);
  for (const name of ["", "stories/snapshot/", "stories/snapshot/viewer.html", "stories/snapshot/evidence.json",
    "stories/snapshot/spec.dot", "stories/snapshot/validation.json", "stories/snapshot/renderer.json", "theme.js"]) {
    const response = await fetch(`${mixedUrl}/${name}`);
    assert.equal(response.status, 200, name);
    assert.ok((await response.text()).length > 20);
  }
  await stopServer();
  const mixedBundle = path.join(mixedRoot, ".topo/deploy");
  mixedCli("bundle", mixedRoot, "--output", mixedBundle, "--base-path", "/technical/");
  for (const name of ["evidence.json", "spec.dot", "validation.json", "renderer.json"]) {
    assert.ok((await readFile(path.join(mixedBundle, "technical/stories/snapshot", name))).length > 20);
  }
  const withoutRust = noOptionalRoot = await mkdtemp(path.join(tmpdir(), "topo-without-optional-"));
  await writeFile(path.join(withoutRust, "package.json"), '{"name":"without-rust","private":true,"type":"module"}\n');
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install", "--prefix", withoutRust, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund",
    path.resolve(rendererTarball), path.resolve(topoTarball),
  ]);
  await assert.rejects(lstat(path.join(withoutRust, "node_modules/@ast-grep/napi")), { code: "ENOENT" });
  const noRustCli = (...args) => run(process.execPath, [path.join(withoutRust, "node_modules/@jdylanmc/topo-code/bin/topo.js"), ...args], {
    NODE_OPTIONS: `--import=${pathToFileURL(networkGuard).href}`,
  });
  git("init", "--quiet", withoutRust);
  await writeFile(path.join(withoutRust, ".gitignore"), "node_modules/\n");
  await writeFile(path.join(withoutRust, "main.js"), "export function answer() { return 42; }\n");
  git("-C", withoutRust, "add", ".");
  git("-C", withoutRust, "-c", "user.name=Topo Package Test", "-c", "user.email=topo@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "JavaScript without optional Rust packages");
  noRustCli("init", withoutRust);
  assert.match(noRustCli("scan", withoutRust), /Scanned/);
  const noRustConfig = path.join(withoutRust, ".topo/config.json");
  const selectedRust = JSON.parse(await readFile(noRustConfig, "utf8"));
  selectedRust.analysis = { languages: ["rust"], frameworks: [] };
  await writeFile(noRustConfig, JSON.stringify(selectedRust));
  await writeFile(path.join(withoutRust, "lib.rs"), "pub fn answer() -> u8 { 42 }\n");
  assert.throws(() => noRustCli("scan", withoutRust, "--allow-partial"), /Rust adapter unavailable/);
  console.log(JSON.stringify({
    status: "passed", consumer: root, node: process.version,
    packages: { topocode: manifest.version, renderer: manifest.dependencies["@jdylanmc/topo-archify"] },
    evidence: ["clean npm install", "credential-free npm publish dry-run of both workflow file arguments", "bundled private modules and export targets", "plain and fresh skills init immediately served without scanner loading or subprocesses", "unborn empty static bundle", "portable skills and conflict preservation", "draft validate", "preview without scan", "source move failure and identity-preserving repair", "scan and preview with network forbidden", "live serve", "static bundle and notices", "fresh-home installed mixed JavaScript/TypeScript/Rust/Tauri fixture", "one conservative Tauri binding", "whole-file stale rejection and reviewed comment-only repair", "cache-only recreation with stable IDs", "technical evidence/spec/receipt bundle assets and EPL source availability", "actual omit-optional install: JS baseline works, explicit Rust fails diagnostically"],
  }, null, 2));
} finally {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  if (!retainedDirectory) await rm(root, { recursive: true, force: true });
  if (noOptionalRoot) await rm(noOptionalRoot, { recursive: true, force: true });
}
