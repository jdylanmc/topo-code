import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { compare, hash, repositoryPath, serialize } from "./contract.mjs";

const execute = promisify(execFile);
const LANGUAGES = new Map([
  [".ts", "typescript"], [".tsx", "typescript"], [".mts", "typescript"], [".cts", "typescript"],
  [".js", "javascript"], [".jsx", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".rs", "rust"], [".py", "python"], [".swift", "swift"], [".go", "go"], [".cs", "csharp"],
  [".java", "java"], [".kt", "kotlin"], [".rb", "ruby"], [".c", "c"], [".cpp", "cpp"],
  [".h", "c-header"], [".sh", "shell"], [".html", "html"], [".css", "css"], [".svg", "svg"],
]);

export function languageOf(path) {
  return LANGUAGES.get(extname(path).toLowerCase()) ?? "configuration";
}

function relevant(path) {
  if (path.split("/").some((part) => [".git", "node_modules", ".topo", ".skill-log"].includes(part))) return false;
  const name = basename(path);
  return LANGUAGES.has(extname(path).toLowerCase()) ||
    ["Cargo.toml", "Cargo.lock", "package.json", "package-lock.json", "rust-toolchain.toml",
      "rust-toolchain", "tauri.conf.json"].includes(name) ||
    /^tsconfig(?:\.[^.]+)*\.json$/.test(name) || /(?:^|\/)\.cargo\/config(?:\.toml)?$/.test(path);
}

export async function stableRead(root, path) {
  repositoryPath(path);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") throw new Error(`Source escapes repository: ${path}`);
  const actual = await realpath(target);
  const info = await lstat(target);
  if (actual !== target || !info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Source must be a regular, non-symlinked repository file: ${path}`);
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (before.dev !== info.dev || before.ino !== info.ino) throw new Error(`Source changed before reading: ${path}`);
    const bytes = await handle.readFile();
    const contents = bytes.toString("utf8");
    if (!Buffer.from(contents, "utf8").equals(bytes)) throw new Error(`Source is not valid UTF-8: ${path}`);
    const after = await handle.stat();
    const current = await lstat(target);
    if (before.dev !== current.dev || before.ino !== current.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || await realpath(target) !== target) {
      throw new Error(`Source changed while reading: ${path}`);
    }
    return { path, contents, sha256: hash(bytes), language: languageOf(path) };
  } finally {
    await handle.close();
  }
}

export async function captureInventory(rootInput) {
  const root = await realpath(resolve(rootInput));
  const options = { maxBuffer: 64 * 1024 * 1024 };
  const [listing, revision] = await Promise.all([
    execute("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], options),
    execute("git", ["-C", root, "rev-parse", "HEAD"], options),
  ]);
  const paths = [...new Set(listing.stdout.split("\0").filter(Boolean).filter(relevant))].sort(compare);
  const files = [];
  for (const path of paths) {
    try {
      files.push(await stableRead(root, path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const selected = files.map(({ path, sha256, language }) => ({ path, sha256, language }));
  const status = await execute("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--",
    ...files.map(({ path }) => path)], options);
  return {
    root,
    repository: { id: basename(root), revision: revision.stdout.trim(), dirty: status.stdout.length > 0 },
    files,
    snapshot: { sha256: hash(serialize(selected)), files: selected },
  };
}

export async function assertInventoryCurrent(captured) {
  const current = await captureInventory(captured.root);
  if (current.repository.revision !== captured.repository.revision ||
      current.snapshot.sha256 !== captured.snapshot.sha256) {
    throw new Error("Source inventory changed during analysis; no baseline was published");
  }
}

export async function assertBaselineCurrent(root, baseline) {
  const current = await captureInventory(root);
  if (current.repository.revision !== baseline.repository.revision ||
      current.snapshot.sha256 !== baseline.source.sha256) {
    throw new Error("Baseline is stale for this source snapshot; scan again and deliberately reconcile the authored view");
  }
  return current;
}
