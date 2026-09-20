import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { renderStory } from "@topo/diagram-core";
import {
  parseStoryDocument,
  resolveStoryDocument,
  type StoryRenderer,
} from "@topo/story";
import { isMissing, workspacePath, writeGenerated } from "@topo/workspace";
import {
  assertSourceSnapshot,
  captureSourceSnapshot,
} from "./source-snapshot.js";

const execute = promisify(execFile);

export interface StoryPreviewResult {
  readonly storyId: string;
  readonly documentPath: string;
  readonly outputPath: string;
  readonly source: {
    readonly revision: string;
    readonly dirty: boolean;
  };
  readonly renderer: {
    readonly name: string;
    readonly pin: string;
  };
}

const diagramCoreRenderer: StoryRenderer = {
  render: renderStory,
};

async function sourceState(
  root: string,
): Promise<{ revision: string; dirty: boolean }> {
  const revision = (
    await execute("git", ["-C", root, "rev-parse", "HEAD"])
  ).stdout.trim();
  const status = (
    await execute("git", [
      "-C",
      root,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).topo",
    ])
  ).stdout;
  return { revision, dirty: status.length > 0 };
}

function repositoryRelativePath(root: string, path: string): string {
  const absolute = resolve(path);
  const rel = relative(root, absolute);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    rel.length === 0
  ) {
    throw new Error(`Story document must be inside the repository: ${path}`);
  }
  return rel.split(sep).join("/");
}

async function assertCommittedStory(root: string, documentPath: string): Promise<void> {
  try {
    await execute("git", [
      "-C",
      root,
      "ls-files",
      "--error-unmatch",
      "--",
      documentPath,
    ]);
    await execute("git", [
      "-C",
      root,
      "diff",
      "--quiet",
      "HEAD",
      "--",
      documentPath,
    ]);
  } catch {
    throw new Error(
      `${documentPath}: story document must be committed and unchanged relative to HEAD`,
    );
  }
}

async function readCommittedStory(
  root: string,
  documentPath: string,
): Promise<string> {
  return (
    await execute("git", ["-C", root, "show", `HEAD:${documentPath}`])
  ).stdout;
}

export async function previewStory(
  rootInput: string,
  documentInput: string,
  renderer: StoryRenderer | null = diagramCoreRenderer,
): Promise<StoryPreviewResult> {
  const root = resolve(rootInput);
  const documentAbsolute = resolve(documentInput);
  const documentPath = repositoryRelativePath(root, documentAbsolute);
  await assertCommittedStory(root, documentPath);
  const siteIndex = await workspacePath(root, "cache/site/index.html");
  try {
    if (!(await stat(siteIndex)).isFile()) {
      throw new Error("Site index is not a file; run topo scan again");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    throw new Error("Site is not built; run topo scan first");
  }
  const document = parseStoryDocument(
    await readCommittedStory(root, documentPath),
    documentPath,
  );
  const source = await sourceState(root);
  const snapshot = await captureSourceSnapshot(
    root,
    document.anchors.map((anchor) => anchor.path),
  );
  const resolved = await resolveStoryDocument(
    root,
    document,
    documentPath,
    source,
    async (path) => snapshot.get(path),
  );
  if (renderer === null) {
    throw new Error(
      `${documentPath}: story renderer is unavailable; install or restore @topo/diagram-core`,
    );
  }
  let artifact;
  try {
    artifact = await renderer.render(resolved);
  } catch (error) {
    throw new Error(
      `${documentPath}: renderer failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  await assertSourceSnapshot(root, snapshot);
  const finalSource = await sourceState(root);
  if (
    finalSource.revision !== source.revision ||
    finalSource.dirty !== source.dirty
  ) {
    throw new Error(
      `${documentPath}: repository source changed while rendering; retry`,
    );
  }
  if (artifact.kind !== "html" || artifact.mediaType !== "text/html") {
    throw new Error(
      `${documentPath}: renderer returned unsupported artifact ${artifact.kind} (${artifact.mediaType})`,
    );
  }
  const outputName = `cache/site/stories/${document.id}/index.html`;
  await writeGenerated(root, outputName, artifact.contents);
  return {
    storyId: document.id,
    documentPath,
    outputPath: await workspacePath(root, outputName),
    source,
    renderer: {
      name: artifact.renderer.name,
      pin: artifact.renderer.pin,
    },
  };
}
