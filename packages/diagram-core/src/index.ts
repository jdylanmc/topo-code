import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedStoryDocument, StoryArtifact } from "@topo/story";
import { verifyVendoredArchifyIntegrity } from "./integrity.js";

export {
  verifyVendoredArchifyIntegrity,
  type VendoredArchifyIntegrity,
} from "./integrity.js";

interface ArchifySource {
  readonly path: string;
  readonly line?: number;
  readonly end_line?: number;
}

interface ArchifyComponent {
  readonly id: string;
  readonly type: "backend" | "frontend";
  readonly label: string;
  readonly sublabel: string;
  readonly pos: readonly [number, number];
  readonly size: readonly [number, number];
  readonly sources: readonly ArchifySource[];
}

interface ArchifyArchitecture {
  readonly schema_version: 1;
  readonly diagram_type: "architecture";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "showcase";
    readonly locale: "en";
    readonly viewBox: readonly [number, number];
    readonly repository: {
      readonly url: string;
      readonly revision: string;
      readonly link_mode?: "local-only";
    };
  };
  readonly components: readonly ArchifyComponent[];
  readonly connections: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly fromSide: "right";
    readonly toSide: "right";
    readonly via: readonly (readonly [number, number])[];
  }[];
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const archifyCli = path.join(
  packageRoot,
  "vendor",
  "archify",
  "bin",
  "archify.mjs",
);

function stableId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

function componentId(sectionId: string): string {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(sectionId)
    ? sectionId
    : stableId("component", sectionId);
}

function repositoryMetadata(repositoryRoot: string): {
  readonly url: string;
  readonly link_mode?: "local-only";
} {
  try {
    const url = execFileSync(
      "git",
      ["-C", repositoryRoot, "remote", "get-url", "origin"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (url) return { url };
  } catch {
    // Let Archify report its repository-evidence requirement consistently.
  }
  return {
    url: "https://localhost.invalid/repository",
    link_mode: "local-only",
  };
}

function archifySpec(story: ResolvedStoryDocument): ArchifyArchitecture {
  const anchors = new Map(story.anchors.map((anchor) => [anchor.id, anchor]));
  const componentIds = new Map(
    story.document.sections.map((section) => [
      section.id,
      componentId(section.id),
    ]),
  );
  const components = story.document.sections.map((section, index) => {
    const anchorId = section.anchorIds[0];
    const anchor = anchorId === undefined ? undefined : anchors.get(anchorId);
    if (anchor === undefined) {
      throw new Error(
        `Resolved story is missing a source anchor for section "${section.id}"`,
      );
    }
    const width = Math.max(280, section.title.length * 11 + 80);
    return {
      id: componentIds.get(section.id)!,
      type: index === story.document.sections.length - 1
        ? "frontend" as const
        : "backend" as const,
      label: section.title,
      sublabel: section.body,
      pos: [80, 80 + index * 190] as const,
      size: [width, 110] as const,
      sources: [{
        path: anchor.path,
        line: anchor.location.startLine,
        end_line: anchor.location.endLine,
      }],
    };
  });
  const rightEdge = Math.max(
    ...components.map((component) => component.pos[0] + component.size[0]),
  );
  const viewBoxWidth = Math.max(
    800,
    rightEdge + 180 + story.document.connections.length * 32,
  );
  const viewBoxHeight = Math.max(
    500,
    ...components.map((component) => component.pos[1] + component.size[1] + 80),
  );
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: story.document.title,
      quality_profile: "showcase",
      locale: "en",
      viewBox: [viewBoxWidth, viewBoxHeight],
      repository: {
        ...repositoryMetadata(story.repositoryRoot),
        revision: story.source.revision,
      },
    },
    components,
    connections: story.document.connections.map((connection, index) => {
      const fromIndex = story.document.sections.findIndex(
        (section) => section.id === connection.from,
      );
      const toIndex = story.document.sections.findIndex(
        (section) => section.id === connection.to,
      );
      const lane = rightEdge + 80 + index * 32;
      const fromY = components[fromIndex]!.pos[1] + 55;
      const toY = components[toIndex]!.pos[1] + 55;
      return {
        id: stableId(
          "connection",
          `${index}\0${connection.from}\0${connection.to}`,
        ),
        from: componentIds.get(connection.from)!,
        to: componentIds.get(connection.to)!,
        fromSide: "right",
        toSide: "right",
        via: fromIndex === toIndex
          ? [[lane, fromY], [lane, fromY + 80], [rightEdge, fromY + 80]]
          : [[lane, fromY], [lane, toY]],
      };
    }),
  };
}

function commandError(error: unknown): Error {
  if (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    "stderr" in error
  ) {
    const stdout = String(error.stdout ?? "").trim();
    const stderr = String(error.stderr ?? "").trim();
    return new Error(
      ["Archify rendering failed", stderr, stdout].filter(Boolean).join(": "),
      { cause: error },
    );
  }
  return error instanceof Error
    ? error
    : new Error(`Archify rendering failed: ${String(error)}`);
}

export function renderStory(story: ResolvedStoryDocument): StoryArtifact {
  const integrity = verifyVendoredArchifyIntegrity();
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "topo-archify-render-"),
  );
  const inputPath = path.join(temporaryDirectory, "story.json");
  const outputPath = path.join(temporaryDirectory, "story.html");
  try {
    writeFileSync(inputPath, `${JSON.stringify(archifySpec(story), null, 2)}\n`);
    execFileSync(process.execPath, [
      archifyCli,
      "deliver",
      "architecture",
      inputPath,
      outputPath,
      "--repo-root",
      story.repositoryRoot,
      "--quality",
      "showcase",
      "--json",
    ], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      kind: "html",
      mediaType: "text/html",
      contents: readFileSync(outputPath, "utf8"),
      renderer: {
        name: "archify",
        pin: integrity.version,
        sha256: integrity.archiveSha256,
      },
    };
  } catch (error) {
    throw commandError(error);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
