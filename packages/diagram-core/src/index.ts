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
import type {
  ResolvedStoryDocument,
  StoryArtifact,
  StoryConnection,
} from "@topo/story";
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
  readonly sources?: readonly ArchifySource[];
}

interface ArchifyArchitecture {
  readonly schema_version: 1;
  readonly diagram_type: "architecture";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
    readonly viewBox: readonly [number, number];
    readonly repository?: {
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
    readonly label?: string;
    readonly labelDy?: number;
    readonly fromSide?: "left" | "right" | "top" | "bottom";
    readonly toSide?: "left" | "right" | "top" | "bottom";
    readonly via?: readonly (readonly [number, number])[];
  }[];
}

interface ArchifyWorkflow {
  readonly schema_version: 2;
  readonly diagram_type: "workflow";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
  };
  readonly lanes: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly lane: string;
    readonly col: number;
    readonly type: "backend" | "frontend";
    readonly label: string;
    readonly sublabel: string;
    readonly width: number;
    readonly height: number;
    readonly yOffset: number;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label?: string;
    readonly role: "main";
  }[];
}

interface ArchifySequence {
  readonly schema_version: 1;
  readonly diagram_type: "sequence";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
    readonly column_fit: "spread";
  };
  readonly participants: readonly {
    readonly id: string;
    readonly type: "backend" | "frontend";
    readonly label: string;
    readonly sublabel: string;
  }[];
  readonly messages: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly y: number;
    readonly label: string;
  }[];
}

interface ArchifyDataflow {
  readonly schema_version: 1;
  readonly diagram_type: "dataflow";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
  };
  readonly stages: readonly {
    readonly label: string;
  }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly type: "backend" | "frontend";
    readonly label: string;
    readonly sublabel: string;
    readonly stage: number;
    readonly row: number;
  }[];
  readonly flows: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label: string;
  }[];
}

interface ArchifyLifecycle {
  readonly schema_version: 1;
  readonly diagram_type: "lifecycle";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
  };
  readonly lanes: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly states: readonly {
    readonly id: string;
    readonly type: "start" | "active" | "success";
    readonly label: string;
    readonly lane: "main" | "event" | "terminal";
    readonly col: number;
    readonly width: number;
  }[];
  readonly transitions: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label?: string;
    readonly labelDy?: number;
    readonly route?: "right-channel";
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
  const sections = story.document.sections;
  const resolved = sections.map((section) => {
    const sectionAnchors = section.anchorIds
      .map((anchorId) => anchors.get(anchorId))
      .filter((anchor): anchor is NonNullable<typeof anchor> => anchor !== undefined);
    const primary = sectionAnchors[0];
    // Short, legible sublabel (a code reference), never the full narrative body:
    // Archify enforces a per-component minimum-legibility width.
    const sublabel = primary === undefined
      ? ""
      : primary.symbol ?? primary.path.split("/").pop() ?? primary.path;
    const width = Math.max(
      280,
      section.title.length * 11 + 80,
      sublabel.length * 9 + 80,
    );
    return { section, sectionAnchors, sublabel, width };
  });
  // Lay components out in a snake grid (rows of 3-4, left-to-right then
  // right-to-left) so consecutive sections stay adjacent and connections read
  // as a clean flow without a tall vertical column.
  const perRow = sections.length <= 4
    ? Math.max(1, sections.length)
    : Math.min(4, Math.ceil(sections.length / 2));
  const boxWidth = Math.max(280, ...resolved.map((entry) => entry.width));
  const boxHeight = 130;
  const columnGap = 90;
  const rowGap = 150;
  const margin = 80;
  const cellOf = (index: number) => {
    const row = Math.floor(index / perRow);
    const positionInRow = index % perRow;
    // Reverse odd rows so the sequence snakes and stays adjacent at the wrap.
    const column = row % 2 === 0 ? positionInRow : perRow - 1 - positionInRow;
    return { row, column };
  };
  const components = resolved.map(({ section, sectionAnchors, sublabel }, index) => {
    const { row, column } = cellOf(index);
    return {
      id: componentIds.get(section.id)!,
      type: index === sections.length - 1
        ? "frontend" as const
        : "backend" as const,
      label: section.title,
      sublabel,
      pos: [
        margin + column * (boxWidth + columnGap),
        margin + row * (boxHeight + rowGap),
      ] as const,
      size: [boxWidth, boxHeight] as const,
      ...(sectionAnchors.length === 0
        ? {}
        : {
            sources: sectionAnchors.map((anchor) => ({
              path: anchor.path,
              line: anchor.location.startLine,
              end_line: anchor.location.endLine,
            })),
          }),
    };
  });
  const rowCount = Math.max(1, Math.ceil(sections.length / perRow));
  const gridBottom = margin + rowCount * boxHeight + (rowCount - 1) * rowGap;
  const laneBase = gridBottom + 60;
  const laneGap = 40;
  const viewBoxWidth = Math.max(
    800,
    margin * 2 + perRow * boxWidth + (perRow - 1) * columnGap,
  );
  const viewBoxHeight = Math.max(
    500,
    gridBottom + margin,
    laneBase + story.document.connections.length * laneGap + margin,
  );
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
      viewBox: [viewBoxWidth, viewBoxHeight],
      ...(story.document.classification === "capability-demo"
        ? {}
        : {
            repository: {
              ...repositoryMetadata(story.repositoryRoot),
              revision: story.source.revision,
            },
          }),
    },
    components,
    // Adjacent grid cells route directly; non-adjacent endpoints detour through
    // a dedicated lane below the grid so an edge never crosses another node.
    connections: story.document.connections.map((connection, index) => {
      const fromIndex = sections.findIndex((s) => s.id === connection.from);
      const toIndex = sections.findIndex((s) => s.id === connection.to);
      const from = cellOf(fromIndex);
      const to = cellOf(toIndex);
      const deltaRow = to.row - from.row;
      const deltaColumn = to.column - from.column;
      const base = {
        id: stableId(
          "connection",
          `${index}\0${connection.from}\0${connection.to}`,
        ),
        from: componentIds.get(connection.from)!,
        to: componentIds.get(connection.to)!,
        ...(connection.label === undefined ? {} : { label: connection.label }),
      };
      const adjacent = Math.abs(deltaRow) + Math.abs(deltaColumn) === 1;
      if (adjacent) {
        const vertical = deltaRow !== 0;
        return {
          ...base,
          labelDy: 24,
          fromSide: vertical
            ? (deltaRow > 0 ? "bottom" as const : "top" as const)
            : (deltaColumn > 0 ? "right" as const : "left" as const),
          toSide: vertical
            ? (deltaRow > 0 ? "top" as const : "bottom" as const)
            : (deltaColumn > 0 ? "left" as const : "right" as const),
        };
      }
      const fromX = components[fromIndex]!.pos[0] + boxWidth / 2;
      const toX = components[toIndex]!.pos[0] + boxWidth / 2;
      const lane = laneBase + index * laneGap;
      return {
        ...base,
        fromSide: "bottom" as const,
        toSide: "bottom" as const,
        via: [[fromX, lane], [toX, lane]] as const,
      };
    }),
  };
}

function workflowSpec(story: ResolvedStoryDocument): ArchifyWorkflow {
  const laneId = "story-flow";
  const columns = 2;
  const rows = Math.ceil(story.document.sections.length / columns);
  const nodeIds = new Map(
    story.document.sections.map((section) => [
      section.id,
      componentId(section.id),
    ]),
  );
  return {
    schema_version: 2,
    diagram_type: "workflow",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
    },
    lanes: [{ id: laneId, label: story.document.title }],
    nodes: story.document.sections.map((section, index) => {
      const row = Math.floor(index / columns);
      const position = index % columns;
      return {
        id: nodeIds.get(section.id)!,
        lane: laneId,
        col: row % 2 === 0 ? position : columns - 1 - position,
        type: index === story.document.sections.length - 1
          ? "frontend"
          : "backend",
        label: section.title,
        sublabel: "",
        width: Math.max(
          128,
          section.title.length * 7 + 24,
        ),
        height: 96,
        yOffset: (row - (rows - 1) / 2) * 120,
      };
    }),
    edges: story.document.connections.map((connection, index) => ({
      id: stableId(
        "edge",
        `${index}\0${connection.from}\0${connection.to}`,
      ),
      from: nodeIds.get(connection.from)!,
      to: nodeIds.get(connection.to)!,
      ...(connection.label === undefined ? {} : { label: connection.label }),
      role: "main",
    })),
  };
}

function requiredConnectionLabel(
  connection: StoryConnection,
  family: "sequence" | "dataflow",
): string {
  if (connection.label === undefined) {
    throw new Error(`${family} connections require a nonempty label`);
  }
  return connection.label;
}

function sequenceSpec(story: ResolvedStoryDocument): ArchifySequence {
  const participantIds = new Map(
    story.document.sections.map((section) => [
      section.id,
      componentId(section.id),
    ]),
  );
  return {
    schema_version: 1,
    diagram_type: "sequence",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
      column_fit: "spread",
    },
    participants: story.document.sections.map((section, index) => ({
      id: participantIds.get(section.id)!,
      type: index === story.document.sections.length - 1
        ? "frontend"
        : "backend",
      label: section.title,
      sublabel: section.body,
    })),
    messages: story.document.connections.map((connection, index) => ({
      id: stableId(
        "message",
        `${index}\0${connection.from}\0${connection.to}`,
      ),
      from: participantIds.get(connection.from)!,
      to: participantIds.get(connection.to)!,
      y: 180 + index * 100,
      label: requiredConnectionLabel(connection, "sequence"),
    })),
  };
}

function dataflowSpec(story: ResolvedStoryDocument): ArchifyDataflow {
  const nodeIds = new Map(
    story.document.sections.map((section) => [
      section.id,
      componentId(section.id),
    ]),
  );
  return {
    schema_version: 1,
    diagram_type: "dataflow",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
    },
    stages: story.document.sections.map((section) => ({
      label: section.title,
    })),
    nodes: story.document.sections.map((section, index) => ({
      id: nodeIds.get(section.id)!,
      type: index === story.document.sections.length - 1
        ? "frontend"
        : "backend",
      label: section.title,
      sublabel: section.body,
      stage: index,
      row: 0,
    })),
    flows: story.document.connections.map((connection, index) => ({
      id: stableId(
        "flow",
        `${index}\0${connection.from}\0${connection.to}`,
      ),
      from: nodeIds.get(connection.from)!,
      to: nodeIds.get(connection.to)!,
      label: requiredConnectionLabel(connection, "dataflow"),
    })),
  };
}

function lifecycleSpec(story: ResolvedStoryDocument): ArchifyLifecycle {
  const statePlacement = (index: number, width = 118) => {
    const last = index === story.document.sections.length - 1;
    const event = story.document.sections.length >= 5 &&
      index >= 2 &&
      index < story.document.sections.length - 2;
    const lane = last ? "terminal" as const : event ? "event" as const : "main" as const;
    const defaultCol = last ? 2 : event ? index - 2 : index - Math.max(0, index - 2);
    const centers = lane === "main"
      ? [94, 248, 402, 556, 710]
      : [402, 556, 710];
    const col = centers
      .map((center, candidate) => ({
        candidate,
        distance: Math.abs(candidate - defaultCol),
        capacity: 2 * Math.min(center - 32, 948 - center),
      }))
      .filter(({ capacity }) => capacity >= width)
      .sort((left, right) =>
        left.distance - right.distance || left.candidate - right.candidate
      )[0]?.candidate ?? defaultCol;
    return {
      lane,
      col,
    };
  };
  const stateIds = new Map(
    story.document.sections.map((section) => [
      section.id,
      componentId(section.id),
    ]),
  );
  return {
    schema_version: 1,
    diagram_type: "lifecycle",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
    },
    lanes: [
      { id: "main", label: story.document.title },
      { id: "event", label: "Interruptions + recovery" },
      { id: "terminal", label: "Outcomes" },
    ],
    states: story.document.sections.map((section, index) => {
      const last = index === story.document.sections.length - 1;
      const labelUnits = Array.from(section.title).reduce(
        (total, character) => total + (character.codePointAt(0)! > 0xff ? 2 : 1),
        0,
      );
      const width = Math.max(118, Math.ceil(labelUnits * 6.2));
      return {
        id: stateIds.get(section.id)!,
        type: index === 0
          ? "start"
          : last
            ? "success"
            : "active",
        label: section.title,
        ...statePlacement(index, width),
        width,
      };
    }),
    transitions: story.document.connections.map((connection, index) => {
      const fromIndex = story.document.sections.findIndex(
        (section) => section.id === connection.from,
      );
      const toIndex = story.document.sections.findIndex(
        (section) => section.id === connection.to,
      );
      return {
        id: stableId(
          "transition",
          `${index}\0${connection.from}\0${connection.to}`,
        ),
        from: stateIds.get(connection.from)!,
        to: stateIds.get(connection.to)!,
        ...(connection.label === undefined ? {} : { label: connection.label }),
        ...(statePlacement(fromIndex).lane === statePlacement(toIndex).lane
          ? { labelDy: 55 }
          : {}),
        ...(index === story.document.connections.length - 1
          ? { route: "right-channel" as const }
          : {}),
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

function improveWorkflowReadability(contents: string): string {
  const headEnd = "</head>";
  if (!contents.includes(headEnd)) {
    throw new Error("Archify Workflow output is missing its closing head element");
  }
  const style = `<style data-topo-workflow-readability>
svg g[data-detail="context"][data-edge-from] > text {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
}
</style>`;
  return contents.replace(headEnd, `${style}\n${headEnd}`);
}

export function renderStory(story: ResolvedStoryDocument): StoryArtifact {
  const integrity = verifyVendoredArchifyIntegrity();
  const family = story.document.diagramFamily ?? "architecture";
  const spec = family === "workflow"
    ? workflowSpec(story)
    : family === "sequence"
      ? sequenceSpec(story)
      : family === "dataflow"
        ? dataflowSpec(story)
        : family === "lifecycle"
          ? lifecycleSpec(story)
          : archifySpec(story);
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "topo-archify-render-"),
  );
  const inputPath = path.join(temporaryDirectory, "story.json");
  const outputPath = path.join(temporaryDirectory, "story.html");
  try {
    writeFileSync(inputPath, `${JSON.stringify(spec, null, 2)}\n`);
    const args = [
      archifyCli,
      "deliver",
      family,
      inputPath,
      outputPath,
      "--quality",
      "standard",
      "--json",
    ];
    if (
      family === "architecture" &&
      story.document.classification !== "capability-demo"
    ) {
      args.splice(5, 0, "--repo-root", story.repositoryRoot);
    }
    execFileSync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const contents = readFileSync(outputPath, "utf8");
    return {
      kind: "html",
      mediaType: "text/html",
      contents: family === "workflow"
        ? improveWorkflowReadability(contents)
        : contents,
      renderer: {
        name: family === "workflow" ? "archify+topocode" : "archify",
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
