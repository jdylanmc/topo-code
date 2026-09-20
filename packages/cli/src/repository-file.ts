import { readFile, realpath, stat } from "node:fs/promises";
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
  if (!(await stat(actual)).isFile()) {
    throw new Error(`${repositoryPath}: ${label} must be a regular file`);
  }
  return readFile(actual, "utf8");
}
