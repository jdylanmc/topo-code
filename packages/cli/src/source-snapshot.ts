import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SourceSnapshot = ReadonlyMap<string, string | undefined>;

async function readStableSource(
  root: string,
  repositoryPath: string,
): Promise<string | undefined> {
  const requested = resolve(root, repositoryPath);
  const rel = relative(root, requested);
  if (
    isAbsolute(repositoryPath) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw new Error(`Source path escapes the repository: ${repositoryPath}`);
  }
  let actual: string;
  try {
    actual = await realpath(requested);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (actual !== requested) {
    throw new Error(`Source path must not resolve through a symlink: ${repositoryPath}`);
  }
  const initial = await stat(requested);
  if (!initial.isFile()) {
    throw new Error(`Source path must be a regular file: ${repositoryPath}`);
  }
  const handle = await open(
    requested,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino
    ) {
      throw new Error(`Source changed before it was read: ${repositoryPath}`);
    }
    const contents = await handle.readFile("utf8");
    const openedAfter = await handle.stat();
    const currentActual = await realpath(requested);
    const current = await stat(requested);
    if (
      currentActual !== requested ||
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      openedAfter.size !== opened.size ||
      openedAfter.mtimeMs !== opened.mtimeMs ||
      openedAfter.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error(`Source changed while it was read: ${repositoryPath}`);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

export async function captureSourceSnapshot(
  rootInput: string,
  paths: Iterable<string>,
): Promise<SourceSnapshot> {
  const root = await realpath(rootInput);
  const unique = [...new Set(paths)].sort();
  return new Map(await Promise.all(unique.map(async (path) => [
    path,
    await readStableSource(root, path),
  ] as const)));
}

export async function assertSourceSnapshot(
  root: string,
  snapshot: SourceSnapshot,
): Promise<void> {
  const current = await captureSourceSnapshot(root, snapshot.keys());
  for (const [path, contents] of snapshot) {
    if (current.get(path) !== contents) {
      throw new Error(`Repository source changed while rendering: ${path}`);
    }
  }
}
