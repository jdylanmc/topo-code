import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async function preflight(path) {
  let current = dirname(path);
  const ancestors = [];
  while (current !== dirname(current)) {
    ancestors.push(current);
    current = dirname(current);
  }
  for (const ancestor of ancestors.reverse()) {
    try {
      const information = await lstat(ancestor);
      if (!information.isDirectory() || information.isSymbolicLink()) throw new Error(`Unsafe output ancestor: ${ancestor}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const information = await lstat(path);
    if (!information.isFile() || information.isSymbolicLink()) throw new Error(`Unsafe artifact destination: ${path}`);
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

export async function writeArtifactSet(artifacts, options = {}) {
  if (!artifacts.length) throw new Error("Artifact publication set is empty");
  const files = artifacts.map(({ path, contents }) => ({
    path: resolve(path), contents: Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8"),
  }));
  if (new Set(files.map(({ path }) => path)).size !== files.length) throw new Error("Duplicate artifact destination");
  const id = randomUUID();
  const renameFile = options.renameFile ?? rename;
  const lockHash = createHash("sha256").update(files.map(({ path }) => path).sort().join("\0")).digest("hex").slice(0, 24);
  const lock = resolve(dirname(files[0].path), `.topo-publication-${lockHash}.lock`);
  for (const file of files) await preflight(file.path);
  for (const file of files) await mkdir(dirname(file.path), { recursive: true });
  await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" }).catch((error) => {
    if (error.code === "EEXIST") throw new Error(`Artifact publication is already locked: ${lock}`);
    throw error;
  });
  const temporary = [];
  const prepared = [];
  const committed = [];
  let failure;
  try {
    for (const file of files) {
      const previous = await preflight(file.path);
      const staged = `${file.path}.${id}.stage`;
      const backup = previous === undefined ? undefined : `${file.path}.${id}.rollback`;
      temporary.push(staged);
      await writeFile(staged, file.contents, { flag: "wx" });
      if (backup) {
        temporary.push(backup);
        await writeFile(backup, previous, { flag: "wx" });
      }
      prepared.push({ ...file, previous, staged, backup });
    }
    for (const file of prepared) {
      const current = await preflight(file.path);
      if (current === undefined ? file.previous !== undefined : file.previous === undefined || !current.equals(file.previous)) {
        throw new Error(`Artifact changed during staging: ${file.path}`);
      }
    }
    for (const file of prepared) {
      await renameFile(file.staged, file.path);
      committed.push(file);
    }
  } catch (error) {
    const errors = [error];
    for (const file of committed.reverse()) {
      try {
        if (file.backup) await rename(file.backup, file.path);
        else await unlink(file.path);
      } catch (rollbackError) {
        errors.push(new Error(`Could not restore previous artifact ${file.path}: ${rollbackError.message}`, { cause: rollbackError }));
      }
    }
    failure = errors.length === 1 ? error : new AggregateError(errors, "Artifact publication failed and rollback was incomplete");
  } finally {
    const cleanupErrors = [];
    for (const path of [...temporary, lock]) {
      try { await unlink(path); }
      catch (error) { if (error.code !== "ENOENT") cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "Artifact publication cleanup failed");
    }
  }
  if (failure) throw failure;
  return files.map(({ path }) => path);
}

export async function writeArtifact(path, contents) {
  return (await writeArtifactSet([{ path, contents }]))[0];
}
