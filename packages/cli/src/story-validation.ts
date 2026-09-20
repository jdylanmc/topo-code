import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  parseStoryDocument,
  resolveStoryDocument,
  type ResolvedStoryDocument,
} from "@topo/story";
import {
  assertSourceSnapshot,
  captureSourceSnapshot,
} from "./source-snapshot.js";
import { repositoryState } from "./catalogue.js";

function repositoryStoryPath(root: string, documentInput: string): {
  documentAbsolute: string;
  documentPath: string;
} {
  const documentAbsolute = resolve(documentInput);
  const documentPath = relative(root, documentAbsolute);
  if (
    isAbsolute(documentPath) ||
    documentPath === ".." ||
    documentPath.startsWith(`..${sep}`) ||
    !documentPath.startsWith(`stories${sep}`) ||
    !documentPath.endsWith(".topo.json")
  ) {
    throw new Error(
      `Story document must be a stories/**/*.topo.json file inside the repository: ${documentInput}`,
    );
  }
  return {
    documentAbsolute,
    documentPath: documentPath.split(sep).join("/"),
  };
}

export async function validateStory(
  rootInput: string,
  documentInput: string,
): Promise<ResolvedStoryDocument> {
  const root = resolve(rootInput);
  const { documentAbsolute, documentPath } = repositoryStoryPath(
    root,
    documentInput,
  );
  const document = parseStoryDocument(
    await readFile(documentAbsolute, "utf8"),
    documentPath,
  );
  const source = await repositoryState(root);
  const snapshot = await captureSourceSnapshot(
    root,
    document.anchors.map((anchor) => anchor.path),
  );
  const resolved = await resolveStoryDocument(
    root,
    document,
    documentPath,
    { revision: source.revision, dirty: source.dirty },
    async (path) => snapshot.get(path),
  );
  await assertSourceSnapshot(root, snapshot);
  const finalSource = await repositoryState(root);
  if (
    finalSource.revision !== source.revision ||
    finalSource.dirty !== source.dirty ||
    finalSource.fingerprint !== source.fingerprint
  ) {
    throw new Error(
      `${documentPath}: repository changed while validating; retry`,
    );
  }
  return resolved;
}
