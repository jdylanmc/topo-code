import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export async function readRepositoryRegularFile(
  rootInput: string,
  repositoryPath: string,
  label: string,
): Promise<string> {
  const root = await realpath(rootInput);
  const requested = resolve(root, repositoryPath);
  const actual = await realpath(requested);
  const rel = relative(root, actual);
  if (
    actual !== requested ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw new Error(
      `${repositoryPath}: ${label} must not resolve through a symlink or outside the repository`,
    );
  }
  const handle = await open(
    requested,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new Error(`${repositoryPath}: ${label} must be a regular file`);
    }
    const contents = await handle.readFile("utf8");
    const currentActual = await realpath(requested);
    const current = await stat(requested);
    if (
      currentActual !== requested ||
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    ) {
      throw new Error(
        `${repositoryPath}: ${label} changed while it was being read`,
      );
    }
    return contents;
  } finally {
    await handle.close();
  }
}
