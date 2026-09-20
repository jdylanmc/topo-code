import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
