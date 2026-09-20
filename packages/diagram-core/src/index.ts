import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResolvedStoryDocument, StoryArtifact } from "@topo/story";
import { verifyPinnedArtifactIntegrity } from "./integrity.js";
import type { Artifact, RenderInput } from "./types.js";

export {
  verifyPinnedArtifactIntegrity,
  type PinnedArtifactIntegrity,
} from "./integrity.js";
export type { Artifact, DiagramValue, RenderInput } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function render(input: RenderInput): Artifact {
  if (!input.title.trim()) {
    throw new Error("Diagram title must be nonempty");
  }

  const integrity = verifyPinnedArtifactIntegrity();
  const fixturePath = fileURLToPath(
    new URL(`../${integrity.artifact}`, import.meta.url),
  );
  const template = readFileSync(fixturePath, "utf8");
  const document = JSON.stringify(input.document).replaceAll("<", "\\u003c");
  const title = escapeHtml(input.title);

  return {
    kind: "html",
    mediaType: "text/html",
    contents: template
      .replaceAll("{{TITLE}}", () => title)
      .replaceAll("{{DOCUMENT}}", () => document),
    renderer: {
      name: "@topo/diagram-core-placeholder",
      pin: "stub",
      sha256: integrity.sha256,
    },
  };
}

export function renderStory(story: ResolvedStoryDocument): StoryArtifact {
  const anchors = new Map(story.anchors.map((anchor) => [anchor.id, anchor]));
  return render({
    title: story.document.title,
    document: {
      schemaVersion: story.document.schemaVersion,
      id: story.document.id,
      summary: story.document.summary,
      source: {
        revision: story.source.revision,
        dirty: story.source.dirty,
      },
      nodes: story.document.sections.map((section) => ({
        id: section.id,
        title: section.title,
        body: section.body,
        anchors: section.anchorIds.map((anchorId) => {
          const anchor = anchors.get(anchorId);
          if (anchor === undefined) {
            throw new Error(
              `Resolved story is missing anchor "${anchorId}" for section "${section.id}"`,
            );
          }
          return {
            id: anchor.id,
            path: anchor.path,
            symbol: anchor.symbol ?? null,
            pattern: anchor.pattern ?? null,
            location: {
              startLine: anchor.location.startLine,
              endLine: anchor.location.endLine,
            },
            excerpt: anchor.excerpt,
          };
        }),
      })),
      edges: story.document.connections.map((connection) => ({
        from: connection.from,
        to: connection.to,
        label: connection.label ?? null,
      })),
    },
  });
}
