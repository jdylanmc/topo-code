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
    readonly legend: { readonly mode: "hidden" };
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
    readonly labelAt?: readonly [number, number];
    readonly labelDx?: number;
    readonly labelDy?: number;
    readonly labelSegment?: number;
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
    readonly legend: { readonly mode: "hidden" };
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
    readonly labelDx?: number;
    readonly labelDy?: number;
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
    readonly legend: { readonly mode: "hidden" };
    readonly column_fit: "spread";
    readonly viewBox: readonly [number, number];
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
    readonly variant?: "return";
  }[];
}

interface ArchifyDataflow {
  readonly schema_version: 1;
  readonly diagram_type: "dataflow";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
    readonly viewBox: readonly [number, number];
    readonly legend: { readonly mode: "hidden" };
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
    readonly width: number;
  }[];
  readonly flows: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label: string;
    readonly labelDy?: number;
  }[];
}

interface ArchifyLifecycle {
  readonly schema_version: 1;
  readonly diagram_type: "lifecycle";
  readonly meta: {
    readonly title: string;
    readonly quality_profile: "standard";
    readonly locale: "en";
    readonly legend: { readonly mode: "hidden" };
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
const architectureFontSize = 24;
// The pinned renderer measures 8px monospace labels at 0.6em per text unit;
// authored Architecture CSS scales the same glyphs to 24px.
const architectureLabelAscent = 25;
const architectureLabelDescent = 7;

function architectureLabelUnits(label: string): number {
  return Array.from(label).reduce(
    (units, character) =>
      units + ((character.codePointAt(0) ?? 0) > 0xff ? 2 : 1),
    0,
  );
}

function architectureLabelWidth(label: string): number {
  const units = architectureLabelUnits(label);
  return Math.max(
    30,
    units * 4.8 + 10,
    units * architectureFontSize * 0.6,
  );
}

const sequenceReadability = {
  minimumViewBoxWidth: 480,
  minimumViewBoxHeight: 480,
  messageStartY: 180,
  minimumMessageSpacing: 28,
  timelineBottomPadding: 83,
  sideMargin: 62,
  participantGapAllowance: 24,
  minimumParticipantGap: 108,
  rightMargin: 40,
  maximumParticipantWidth: 190,
  minimumParticipantWidth: 86,
  nativeLabelWidthFactor: 6.8,
  nativeLabelTolerance: 6,
  textHorizontalPadding: 8,
  textWidthFactor: 0.6,
  targetEffectiveFontSize: 12,
  maximumNativeFontSize: 13,
  viewerBodyHorizontalPadding: 64,
  compactViewerDiagramPadding: 32,
  regularViewerDiagramPadding: 48,
  compactViewerMaximumHeight: 920,
  maximumReaderWidth: 1440,
  supportedViewports: [
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1600, 1000],
    [1920, 1080],
  ],
} as const;

interface SequenceLayout {
  readonly viewBox: readonly [number, number];
  readonly fontSize: number;
  readonly participantWidth: number;
  readonly inlineBodyIds: ReadonlySet<string>;
  readonly messageYs: readonly number[];
}

function stableId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${prefix}_${hash}`;
}

function componentId(sectionId: string): string {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(sectionId)
    ? sectionId
    : stableId("component", sectionId);
}

// Match the pinned renderer's text-unit model before deciding whether prose
// can remain inline at the final readable font size.
const fullwidthCharacter =
  /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2630-\u2637\u2648-\u2653\u267F\u268A-\u268F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\uA4CF\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{18DFF}\u{1AFF0}-\u{1AFFF}\u{1B000}-\u{1B2FF}\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

function sequenceTextUnits(text: string): number {
  const characters = Array.from(text);
  let units = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const codePoint = characters[index]!.codePointAt(0)!;
    if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) continue;
    const next = characters[index + 1]?.codePointAt(0) ?? -1;
    if (next === 0xfe0f) units += 2;
    else if (next === 0xfe0e) units += 1;
    else units += fullwidthCharacter.test(characters[index]!) ? 2 : 1;
  }
  return units;
}

function requiredSequenceParticipantWidth(text: string): number {
  return Math.ceil(
    sequenceTextUnits(text) * sequenceReadability.nativeLabelWidthFactor -
      sequenceReadability.nativeLabelTolerance,
  );
}

function fittedSequenceFontSize(text: string, width: number): number {
  const units = Math.max(1, sequenceTextUnits(text));
  const available = Math.max(
    1,
    width - sequenceReadability.textHorizontalPadding,
  );
  return Math.floor(
    Math.min(
        sequenceReadability.maximumNativeFontSize,
        available / (units * sequenceReadability.textWidthFactor),
      ) * 10,
  ) / 10;
}

function sequenceLayout(story: ResolvedStoryDocument): SequenceLayout {
  const participantCount = Math.max(1, story.document.sections.length);
  const requiredParticipantWidth = Math.min(
    sequenceReadability.maximumParticipantWidth,
    Math.max(
      sequenceReadability.minimumParticipantWidth,
      ...story.document.sections.map(({ title }) =>
        requiredSequenceParticipantWidth(title)
      ),
    ),
  );
  const viewBoxWidth = Math.max(
    sequenceReadability.minimumViewBoxWidth,
    participantCount *
        (requiredParticipantWidth +
          sequenceReadability.participantGapAllowance) +
      sequenceReadability.sideMargin * 2,
    sequenceReadability.sideMargin +
      requiredParticipantWidth +
      (participantCount - 1) * sequenceReadability.minimumParticipantGap +
      sequenceReadability.rightMargin,
  );
  const messageYs = story.document.connections.map((_, index) =>
    sequenceReadability.messageStartY +
    index * sequenceReadability.minimumMessageSpacing
  );
  const lastMessageY = messageYs.at(-1) ??
    sequenceReadability.messageStartY;
  const viewBox = [
    viewBoxWidth,
    Math.max(
      sequenceReadability.minimumViewBoxHeight,
      lastMessageY + sequenceReadability.timelineBottomPadding,
    ),
  ] as const;
  const minimumScale = Math.min(
    ...sequenceReadability.supportedViewports.map(([width, height]) => {
      const readerWidth = Math.min(
        width - sequenceReadability.viewerBodyHorizontalPadding,
        sequenceReadability.maximumReaderWidth,
      );
      const diagramPadding =
        height <= sequenceReadability.compactViewerMaximumHeight
          ? sequenceReadability.compactViewerDiagramPadding
          : sequenceReadability.regularViewerDiagramPadding;
      return Math.min(
        (readerWidth - diagramPadding) / viewBox[0],
        height / viewBox[1],
      );
    }),
  );
  const fontSize = Math.ceil(
    sequenceReadability.targetEffectiveFontSize / minimumScale * 10,
  ) / 10;
  if (fontSize > sequenceReadability.maximumNativeFontSize) {
    throw new Error(
      `Sequence story requires ${fontSize}px native text to remain ` +
        `${sequenceReadability.targetEffectiveFontSize}px effective across ` +
        "supported viewports; reduce the message count or split the story",
    );
  }

  const participantWidth = Math.max(
    sequenceReadability.minimumParticipantWidth,
    Math.min(
      sequenceReadability.maximumParticipantWidth,
      Math.round(
          (viewBox[0] - sequenceReadability.sideMargin * 2) /
            participantCount,
        ) - sequenceReadability.participantGapAllowance,
    ),
  );
  const inlineBodyIds = new Set<string>();
  for (const section of story.document.sections) {
    if (fittedSequenceFontSize(section.title, participantWidth) < fontSize) {
      throw new Error(
        `Sequence participant "${section.title}" cannot fit inside its ` +
          `${participantWidth}px box at the ${fontSize}px native font ` +
          `required for ${sequenceReadability.targetEffectiveFontSize}px ` +
          "effective text",
      );
    }
    if (fittedSequenceFontSize(section.body, participantWidth) >= fontSize) {
      inlineBodyIds.add(section.id);
    }
  }

  return {
    viewBox,
    fontSize,
    participantWidth,
    inlineBodyIds,
    messageYs,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function addSequenceNarrativeDetails(
  contents: string,
  story: ResolvedStoryDocument,
  layout: SequenceLayout,
): string {
  let result = contents;
  for (const section of story.document.sections) {
    if (layout.inlineBodyIds.has(section.id)) continue;
    const id = componentId(section.id);
    const marker = `data-node-id="${id}"`;
    const markerIndex = result.indexOf(marker);
    const tagStart = result.lastIndexOf("<g ", markerIndex);
    const tagEnd = result.indexOf(">", markerIndex);
    if (markerIndex < 0 || tagStart < 0 || tagEnd < 0) {
      throw new Error(
        `Archify sequence output is missing participant "${section.id}"`,
      );
    }

    const body = escapeHtml(section.body);
    const openTag = result.slice(tagStart, tagEnd);
    const labelledTag = openTag.replace(
      / aria-label="([^"]*)"/,
      (_, label: string) => ` aria-label="${label}, ${body}"`,
    );
    if (labelledTag === openTag) {
      throw new Error(
        `Archify sequence output is missing participant label "${section.id}"`,
      );
    }
    result = result.slice(0, tagStart) +
      `${labelledTag} data-node-sublabel="${body}"` +
      result.slice(tagEnd);

    const titleStart = result.indexOf("<title>", tagEnd);
    const titleEnd = result.indexOf("</title>", titleStart);
    if (titleStart < 0 || titleEnd < 0) {
      throw new Error(
        `Archify sequence output is missing participant title "${section.id}"`,
      );
    }
    const titleContentsStart = titleStart + "<title>".length;
    result = result.slice(0, titleContentsStart) +
      `${result.slice(titleContentsStart, titleEnd)} · ${body}` +
      result.slice(titleEnd);
  }
  return result;
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
  // Balance components across rows of at most four, then snake each row so
  // consecutive sections stay adjacent without producing a tall column.
  const maxRowSize = sections.length >= 10 ? 4 : 3;
  const rowCount = Math.max(1, Math.ceil(sections.length / maxRowSize));
  const shortRowSize = Math.floor(sections.length / rowCount);
  const longRowCount = sections.length % rowCount;
  const rowSizes = Array.from(
    { length: rowCount },
    (_, row) => shortRowSize + (row < longRowCount ? 1 : 0),
  );
  const baseBoxWidth = Math.max(280, ...resolved.map((entry) => entry.width));
  const boxHeight = 130;
  const columnGap = 90;
  const cellOf = (index: number) => {
    let row = 0;
    let rowStart = 0;
    while (index >= rowStart + rowSizes[row]!) {
      rowStart += rowSizes[row]!;
      row += 1;
    }
    const rowSize = rowSizes[row]!;
    const positionInRow = index - rowStart;
    // Reverse odd rows so the sequence snakes and stays adjacent at the wrap.
    const column = row % 2 === 0 ? positionInRow : rowSize - 1 - positionInRow;
    return { row, column };
  };
  const sectionIndexById = new Map(
    sections.map((section, index) => [section.id, index]),
  );
  // Plan label and route corridors before placing rows so shared gaps reserve
  // only the space their realized content and detours require.
  const sharedGapConnections = new Map<number, number[]>();
  const crossRowRouteGaps = new Set<number>();
  const detourLaneByConnection = new Map<number, number>();
  let detourLaneCount = 0;
  let hasBottomOuterLabels = false;
  for (
    const [connectionIndex, connection] of
      story.document.connections.entries()
  ) {
    const fromIndex = sectionIndexById.get(connection.from)!;
    const toIndex = sectionIndexById.get(connection.to)!;
    const from = cellOf(fromIndex);
    const to = cellOf(toIndex);
    if (
      Math.abs(to.row - from.row) +
          Math.abs(to.column - from.column) !==
        1
    ) {
      detourLaneByConnection.set(connectionIndex, detourLaneCount);
      detourLaneCount += 1;
    }
    for (
      let gap = Math.min(from.row, to.row);
      gap < Math.max(from.row, to.row);
      gap += 1
    ) {
      crossRowRouteGaps.add(gap);
    }
    if (connection.label === undefined) continue;
    const deltaColumn = to.column - from.column;
    if (from.row !== to.row || Math.abs(deltaColumn) !== 1) continue;
    const gap = deltaColumn > 0 ? from.row : from.row - 1;
    if (gap === rowCount - 1) {
      hasBottomOuterLabels = true;
    }
    if (gap < 0 || gap >= rowCount - 1) continue;
    const connections = sharedGapConnections.get(gap) ?? [];
    connections.push(connectionIndex);
    sharedGapConnections.set(gap, connections);
  }
  const sharedGapLaneByConnection = new Map(
    [...sharedGapConnections.entries()].flatMap(([gap, connections]) =>
      connections.map((connectionIndex, lane) => [
        connectionIndex,
        { gap, lane },
      ] as const)
    ),
  );
  const labelLaneStep =
    architectureLabelAscent + architectureLabelDescent + 1;
  const labelCorridorPadding = 2;
  const routeCorridorBand = 8;
  const requiredRowGap = Math.max(
    0,
    ...[...sharedGapConnections.entries()].map(([gap, connections]) =>
      labelCorridorPadding * 2 +
      architectureLabelAscent +
      architectureLabelDescent +
      (connections.length - 1) * labelLaneStep +
      (crossRowRouteGaps.has(gap) ? routeCorridorBand : 0)
    ),
  );
  const rowGap = Math.max(
    80,
    requiredRowGap,
  );
  const maxSharedLabelWidth = Math.max(
    0,
    ...[...sharedGapLaneByConnection.keys()].map((connectionIndex) =>
      architectureLabelWidth(
        story.document.connections[connectionIndex]!.label!,
      )
    ),
  );
  const maxConnectionLabelWidth = Math.max(
    0,
    ...story.document.connections.flatMap((connection) =>
      connection.label === undefined
        ? []
        : [architectureLabelWidth(connection.label)]
    ),
  );
  const boxWidth = Math.max(
    baseBoxWidth,
    Math.ceil(maxSharedLabelWidth + labelCorridorPadding * 2),
  );
  const margin = Math.max(
    80,
    Math.ceil(maxConnectionLabelWidth / 2 + labelCorridorPadding),
  );
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
  const gridBottom = margin + rowCount * boxHeight + (rowCount - 1) * rowGap;
  const laneBase = gridBottom +
    (hasBottomOuterLabels
      ? rowGap / 2 +
        architectureLabelAscent +
        architectureLabelDescent +
        4
      : 60);
  const laneGap = 40;
  const widestRow = Math.max(...rowSizes);
  const gridRight =
    margin + widestRow * boxWidth + (widestRow - 1) * columnGap;
  const gapRouteCorridors = new Map<number, Set<number>>();
  for (const connection of story.document.connections) {
    const fromIndex = sectionIndexById.get(connection.from)!;
    const toIndex = sectionIndexById.get(connection.to)!;
    const from = cellOf(fromIndex);
    const to = cellOf(toIndex);
    if (from.row === to.row) continue;
    const fromX = components[fromIndex]!.pos[0] + boxWidth / 2;
    const toX = components[toIndex]!.pos[0] + boxWidth / 2;
    for (
      let gap = Math.min(from.row, to.row);
      gap < Math.max(from.row, to.row);
      gap += 1
    ) {
      const corridors = gapRouteCorridors.get(gap) ?? new Set<number>();
      corridors.add(fromX);
      corridors.add(toX);
      gapRouteCorridors.set(gap, corridors);
    }
  }
  const sharedGapLabelX = (
    connectionIndex: number,
    gap: number,
  ): number => {
    const connection = story.document.connections[connectionIndex]!;
    const fromIndex = sectionIndexById.get(connection.from)!;
    const sourceX = components[fromIndex]!.pos[0] + boxWidth / 2;
    const width = architectureLabelWidth(connection.label!);
    const routeClearance = 12;
    const corridorXs = [...(gapRouteCorridors.get(gap) ?? [])]
      .sort((left, right) => left - right);
    const intervals: [number, number][] = [];
    let left = margin / 2;
    for (const corridorX of corridorXs) {
      intervals.push([left, corridorX - routeClearance]);
      left = corridorX + routeClearance;
    }
    intervals.push([left, gridRight + margin / 2]);
    const candidates = intervals.flatMap(([intervalLeft, intervalRight]) => {
      const minCenter = intervalLeft + width / 2;
      const maxCenter = intervalRight - width / 2;
      if (minCenter > maxCenter) return [];
      return [Math.min(maxCenter, Math.max(minCenter, sourceX))];
    });
    if (candidates.length === 0) {
      throw new Error(
        `Architecture label "${connection.label}" cannot fit a clear row-gap corridor.`,
      );
    }
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - sourceX) < Math.abs(best - sourceX)
        ? candidate
        : best
    );
  };
  const viewBoxWidth = Math.max(
    800,
    gridRight + margin,
  );
  const viewBoxHeight = Math.max(
    500,
    gridBottom + margin,
    laneBase + Math.max(0, detourLaneCount - 1) * laneGap + margin,
  );
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: story.document.title,
      quality_profile: "standard",
      locale: "en",
      viewBox: [viewBoxWidth, viewBoxHeight],
      legend: { mode: "hidden" },
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
        const horizontalLabelBelow = deltaColumn > 0;
        const sharedGapLane = sharedGapLaneByConnection.get(index);
        return {
          ...base,
          ...(vertical
            ? { labelDy: deltaRow > 0 ? 40 : -24 }
            : sharedGapLane === undefined
            ? {
                labelDy: horizontalLabelBelow
                  ? boxHeight / 2 + rowGap / 2
                  : -(boxHeight / 2 + rowGap / 2),
              }
            : {
                labelAt: [
                  sharedGapLabelX(index, sharedGapLane.gap),
                  margin +
                    sharedGapLane.gap * (boxHeight + rowGap) +
                    boxHeight +
                    (crossRowRouteGaps.has(sharedGapLane.gap)
                      ? routeCorridorBand
                      : 0) +
                    labelCorridorPadding +
                    architectureLabelAscent +
                    sharedGapLane.lane * labelLaneStep,
                ] as const,
              }),
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
      const lane =
        laneBase + detourLaneByConnection.get(index)! * laneGap;
      const blockedBelow = (endpointIndex: number) => {
        const endpoint = cellOf(endpointIndex);
        return sections.some((_, candidateIndex) => {
          if (candidateIndex === endpointIndex) return false;
          const candidate = cellOf(candidateIndex);
          return candidate.column === endpoint.column &&
            candidate.row > endpoint.row;
        });
      };
      const outside = (column: number) =>
        column < widestRow / 2 ? margin / 2 : gridRight + margin / 2;
      const upperCorridor = (endpointIndex: number) => {
        const endpoint = cellOf(endpointIndex);
        if (endpoint.row === 0) return margin / 2;
        return margin +
          endpoint.row * (boxHeight + rowGap) -
          rowGap +
          routeCorridorBand / 2;
      };
      const fromBlocked = blockedBelow(fromIndex);
      const toBlocked = blockedBelow(toIndex);
      const fromOutside = outside(from.column);
      const toOutside = outside(to.column);
      const fromUpperCorridor = upperCorridor(fromIndex);
      const toUpperCorridor = upperCorridor(toIndex);
      return {
        ...base,
        fromSide: fromBlocked
          ? "top" as const
          : "bottom" as const,
        toSide: toBlocked
          ? "top" as const
          : "bottom" as const,
        via: [
          ...(fromBlocked
            ? [
                [fromX, fromUpperCorridor],
                [fromOutside, fromUpperCorridor],
                [fromOutside, lane],
              ] as const
            : [[fromX, lane]] as const),
          ...(toBlocked
            ? [
                [toOutside, lane],
                [toOutside, toUpperCorridor],
                [toX, toUpperCorridor],
              ] as const
            : [[toX, lane]] as const),
        ],
        labelSegment: fromBlocked ? 3 : 1,
      };
    }),
  };
}

function workflowSpec(story: ResolvedStoryDocument): ArchifyWorkflow {
  const laneId = "story-flow";
  const columns = 2;
  const rows = Math.ceil(story.document.sections.length / columns);
  const cellOf = (index: number) => {
    const row = Math.floor(index / columns);
    const position = index % columns;
    return {
      row,
      col: row % 2 === 0 ? position : columns - 1 - position,
    };
  };
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
      legend: { mode: "hidden" },
    },
    lanes: [{ id: laneId, label: story.document.title }],
    nodes: story.document.sections.map((section, index) => {
      const { row, col } = cellOf(index);
      return {
        id: nodeIds.get(section.id)!,
        lane: laneId,
        col,
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
        yOffset: (row - (rows - 1) / 2) * 160,
      };
    }),
    edges: story.document.connections.map((connection, index) => {
      const fromIndex = story.document.sections.findIndex(
        (section) => section.id === connection.from,
      );
      const toIndex = story.document.sections.findIndex(
        (section) => section.id === connection.to,
      );
      const from = cellOf(fromIndex);
      const to = cellOf(toIndex);
      return {
        id: stableId(
          "edge",
          `${index}\0${connection.from}\0${connection.to}`,
        ),
        from: nodeIds.get(connection.from)!,
        to: nodeIds.get(connection.to)!,
        ...(connection.label === undefined ? {} : { label: connection.label }),
        ...(from.col === to.col
          ? { labelDx: from.col === 0 ? -180 : 180 }
          : { labelDy: 72 }),
        role: "main",
      };
    }),
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

function sequenceSpec(
  story: ResolvedStoryDocument,
  layout: SequenceLayout,
): ArchifySequence {
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
      legend: { mode: "hidden" },
      column_fit: "spread",
      viewBox: layout.viewBox,
    },
    participants: story.document.sections.map((section, index) => ({
      id: participantIds.get(section.id)!,
      type: index === story.document.sections.length - 1
        ? "frontend"
        : "backend",
      label: section.title,
      sublabel: layout.inlineBodyIds.has(section.id) ? section.body : "",
    })),
    messages: story.document.connections.map((connection, index) => ({
      id: stableId(
        "message",
        `${index}\0${connection.from}\0${connection.to}`,
      ),
      from: participantIds.get(connection.from)!,
      to: participantIds.get(connection.to)!,
      y: layout.messageYs[index]!,
      label: requiredConnectionLabel(connection, "sequence"),
      ...(connection.variant === undefined
        ? {}
        : { variant: connection.variant }),
    })),
  };
}

const dataflowReadability = {
  maximumFontSize: 15,
  minimumFontSize: 6,
  fontSizePrecision: 10,
  widthFactor: 0.6,
  horizontalPadding: 8,
  defaultNodeWidth: 112,
  firstNodeMaximumWidth: 152,
  stageCenterGap: 215,
  minimumNodeGap: 10,
  firstStageCenterX: 100,
  stageWidth: 168,
  viewBoxMargin: 24,
  minimumViewBoxWidth: 360,
  viewBoxHeight: 360,
  flowLabelHorizontalPadding: 12,
  minimumFlowLabelWidth: 34,
  nativeFlowLabelWidthFactor: 4.9,
  flowLabelMaskBaselineTop: 11,
  flowLabelMaskBaselineBottom: 5,
  flowLabelFontAscentPadding: 1,
  flowLabelClearanceDy: 53,
} as const;

function dataflowTextUnits(value: string): number {
  return Array.from(value).reduce(
    (total, character) =>
      total + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );
}

function dataflowNodeWidth(
  label: string,
  sublabel: string,
  fontSize: number,
): number {
  const units = Math.max(
    dataflowTextUnits(label),
    dataflowTextUnits(sublabel),
  );
  return Math.max(
    dataflowReadability.defaultNodeWidth,
    Math.ceil(
      units * fontSize *
        dataflowReadability.widthFactor +
        dataflowReadability.horizontalPadding,
    ),
  );
}

interface DataflowLayout {
  readonly fontSize: number;
  readonly nodeWidths: readonly number[];
  readonly flowLabelWidths: readonly number[];
  readonly viewBox: readonly [number, number];
}

function dataflowFlowLabelWidth(label: string, fontSize: number): number {
  return Math.max(
    dataflowReadability.minimumFlowLabelWidth,
    Math.ceil(
      (
        dataflowTextUnits(label) *
          fontSize *
          dataflowReadability.widthFactor +
        dataflowReadability.flowLabelHorizontalPadding
      ) * dataflowReadability.fontSizePrecision,
    ) / dataflowReadability.fontSizePrecision,
  );
}

function dataflowNativeFlowLabelWidth(label: string): number {
  return Math.round(
    Math.max(
      dataflowReadability.minimumFlowLabelWidth,
      dataflowTextUnits(label) *
          dataflowReadability.nativeFlowLabelWidthFactor +
        dataflowReadability.flowLabelHorizontalPadding,
    ) * dataflowReadability.fontSizePrecision,
  ) / dataflowReadability.fontSizePrecision;
}

function dataflowFlowLabelMaskTop(fontSize: number): number {
  return Math.max(
    dataflowReadability.flowLabelMaskBaselineTop,
    Math.ceil(
      fontSize + dataflowReadability.flowLabelFontAscentPadding,
    ),
  );
}

function dataflowLayout(story: ResolvedStoryDocument): DataflowLayout {
  const sections = story.document.sections;
  const minimumTenths = dataflowReadability.minimumFontSize *
    dataflowReadability.fontSizePrecision;
  const maximumTenths = dataflowReadability.maximumFontSize *
    dataflowReadability.fontSizePrecision;
  let selected:
    | { readonly fontSize: number; readonly nodeWidths: readonly number[] }
    | undefined;

  for (let tenths = maximumTenths; tenths >= minimumTenths; tenths -= 1) {
    const fontSize = tenths / dataflowReadability.fontSizePrecision;
    const nodeWidths = sections.map((section) =>
      dataflowNodeWidth(section.title, section.body, fontSize)
    );
    const firstNodeFits =
      (nodeWidths[0] ?? dataflowReadability.defaultNodeWidth) <=
        dataflowReadability.firstNodeMaximumWidth;
    const adjacentNodesFit = nodeWidths.every((width, index) =>
      index === 0 ||
      (nodeWidths[index - 1]! + width) / 2 <=
        dataflowReadability.stageCenterGap -
          dataflowReadability.minimumNodeGap
    );
    if (firstNodeFits && adjacentNodesFit) {
      selected = { fontSize, nodeWidths };
      break;
    }
  }

  const fallbackFontSize = dataflowReadability.minimumFontSize;
  const fontSize = selected?.fontSize ?? fallbackFontSize;
  const nodeWidths = selected?.nodeWidths ?? sections.map((section) =>
    dataflowNodeWidth(section.title, section.body, fallbackFontSize)
  );
  const lastStageX = dataflowReadability.firstStageCenterX +
    Math.max(0, sections.length - 1) * dataflowReadability.stageCenterGap;
  const lastNodeWidth = nodeWidths.at(-1) ??
    dataflowReadability.defaultNodeWidth;
  const viewBoxWidth = Math.max(
    dataflowReadability.minimumViewBoxWidth,
    lastStageX + dataflowReadability.stageWidth / 2 +
      dataflowReadability.viewBoxMargin,
    lastStageX + lastNodeWidth / 2 + dataflowReadability.viewBoxMargin,
  );

  return {
    fontSize,
    nodeWidths,
    flowLabelWidths: story.document.connections.map((connection) =>
      dataflowFlowLabelWidth(
        requiredConnectionLabel(connection, "dataflow"),
        fontSize,
      )
    ),
    viewBox: [Math.ceil(viewBoxWidth), dataflowReadability.viewBoxHeight],
  };
}

function dataflowSpec(
  story: ResolvedStoryDocument,
  layout: DataflowLayout,
): ArchifyDataflow {
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
      viewBox: layout.viewBox,
      legend: { mode: "hidden" },
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
      width: layout.nodeWidths[index]!,
    })),
    flows: story.document.connections.map((connection, index) => {
      const fromIndex = story.document.sections.findIndex(
        (section) => section.id === connection.from,
      );
      const toIndex = story.document.sections.findIndex(
        (section) => section.id === connection.to,
      );
      const label = requiredConnectionLabel(connection, "dataflow");
      const endpointGap = Math.abs(toIndex - fromIndex) *
          dataflowReadability.stageCenterGap -
        (layout.nodeWidths[fromIndex]! + layout.nodeWidths[toIndex]!) / 2;
      const labelWidth = Math.max(
        layout.flowLabelWidths[index]!,
        dataflowNativeFlowLabelWidth(label),
      );
      return {
        id: stableId(
          "flow",
          `${index}\0${connection.from}\0${connection.to}`,
        ),
        from: nodeIds.get(connection.from)!,
        to: nodeIds.get(connection.to)!,
        label,
        ...(labelWidth > endpointGap
          ? {
              labelDy: dataflowReadability.flowLabelClearanceDy +
                dataflowFlowLabelMaskTop(layout.fontSize) -
                dataflowReadability.flowLabelMaskBaselineTop,
            }
          : {}),
      };
    }),
  };
}

function lifecycleSpec(story: ResolvedStoryDocument): ArchifyLifecycle {
  const stateDrafts = story.document.sections.map((section, index) => {
    const last = index === story.document.sections.length - 1;
    const event = story.document.sections.length >= 5 &&
      index >= 2 &&
      index < story.document.sections.length - 2;
    const lane = last ? "terminal" as const : event ? "event" as const : "main" as const;
    const defaultCol = last ? 2 : event ? index - 2 : index - Math.max(0, index - 2);
    return {
      section,
      index,
      lane,
      defaultCol,
      width: Math.max(
        118,
        Math.ceil(Array.from(section.title).reduce(
          (total, character) =>
            total + (character.codePointAt(0)! > 0xff ? 2 : 1),
          0,
        ) * 6.2),
      ),
    };
  });
  const placements = new Map<string, {
    lane: "main" | "event" | "terminal";
    col: number;
  }>();
  for (const lane of ["main", "event", "terminal"] as const) {
    const drafts = stateDrafts.filter((draft) => draft.lane === lane);
    const centers = lane === "main"
      ? [94, 248, 402, 556, 710]
      : [402, 556, 710];
    let best: { cols: number[]; score: number } | undefined;
    const search = (position: number, cols: number[], score: number) => {
      if (position === drafts.length) {
        if (
          best === undefined ||
          score < best.score ||
          (score === best.score && cols.join(",") < best.cols.join(","))
        ) {
          best = { cols: [...cols], score };
        }
        return;
      }
      const draft = drafts[position]!;
      for (let col = 0; col < centers.length; col += 1) {
        if (position > 0 && col <= cols[position - 1]!) continue;
        const center = centers[col]!;
        const left = center - draft.width / 2;
        const right = center + draft.width / 2;
        if (left < 32 || right > 948) continue;
        const overlaps = drafts.slice(0, position).some((other, otherIndex) => {
          const otherCenter = centers[cols[otherIndex]!]!;
          const otherRight = otherCenter + other.width / 2;
          return left - otherRight < 10;
        });
        if (overlaps) continue;
        search(
          position + 1,
          [...cols, col],
          score + Math.abs(col - draft.defaultCol),
        );
      }
    };
    search(0, [], 0);
    if (best === undefined) {
      throw new Error(
        `Lifecycle ${lane} states cannot fit the native columns without overlap`,
      );
    }
    drafts.forEach((draft, index) => {
      placements.set(draft.section.id, {
        lane,
        col: best!.cols[index]!,
      });
    });
  }
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
      legend: { mode: "hidden" },
    },
    lanes: [
      { id: "main", label: story.document.title },
      { id: "event", label: "Interruptions + recovery" },
      { id: "terminal", label: "Outcomes" },
    ],
    states: stateDrafts.map(({ section, index, width }) => {
      const last = index === story.document.sections.length - 1;
      return {
        id: stateIds.get(section.id)!,
        type: index === 0
          ? "start"
          : last
            ? "success"
            : "active",
        label: section.title,
        ...placements.get(section.id)!,
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
        ...(placements.get(story.document.sections[fromIndex]!.id)!.lane ===
            placements.get(story.document.sections[toIndex]!.id)!.lane
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

function improveStoryReadability(
  contents: string,
  family:
    | "architecture"
    | "workflow"
    | "sequence"
    | "dataflow"
    | "lifecycle",
  dataflowLayout?: DataflowLayout,
  sequenceFontSize?: number,
): string {
  const headEnd = "</head>";
  if (!contents.includes(headEnd)) {
    throw new Error(`Archify ${family} output is missing its closing head element`);
  }
  const rules = family === "architecture"
    ? `
svg { max-height: 100vh; }
svg [data-source-evidence-beacon] { display: none; }
svg text[data-node-label],
svg text[data-detail="context"],
svg g[data-edge-from] > text { font-size: ${architectureFontSize}px; }`
    : family === "workflow"
      ? `
svg text[data-node-label],
svg text[font-size="10"][font-weight="600"],
svg g[data-edge-from] > text {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
}`
      : family === "sequence"
        ? `
svg { max-height: 100vh; }
svg text {
  font-size: ${sequenceFontSize}px;
}
.semantic-passport-detail {
  font-size: 0.875rem;
}`
        : family === "dataflow"
          ? `
svg text[data-node-label],
svg text[data-detail="context"],
svg text[font-size="9"][font-weight="600"],
svg g[data-edge-from] > text {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
  font-size: ${dataflowLayout?.fontSize ?? dataflowReadability.maximumFontSize}px;
  font-weight: 600;
}`
          : `
svg text[data-node-label],
svg text[font-size="10"][font-weight="600"],
svg g[data-edge-from] > text {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
}`;
  const style = `<style data-topo-story-readability>${rules}
</style>`;
  const adjustedContents = family === "dataflow" && dataflowLayout
    ? dataflowLayout.flowLabelWidths.reduce((html, width, index) => {
        const pattern = new RegExp(
          `(<g data-detail="context"[^>]*data-edge-key="${index}"[^>]*>\\s*<rect x=")(-?\\d+(?:\\.\\d+)?)(" y=")(-?\\d+(?:\\.\\d+)?)(" width=")(\\d+(?:\\.\\d+)?)(" height=")(\\d+(?:\\.\\d+)?)(" rx="4" class="c-mask"/>)`,
        );
        let replaced = false;
        const next = html.replace(
          pattern,
          (
            _match,
            prefix: string,
            xValue: string,
            yPrefix: string,
            yValue: string,
            widthPrefix: string,
            nativeWidthValue: string,
            heightPrefix: string,
            _nativeHeightValue: string,
            suffix: string,
          ) => {
            replaced = true;
            const nativeWidth = Number(nativeWidthValue);
            const center = Number(xValue) + nativeWidth / 2;
            const x = Math.round(
              (center - width / 2) * dataflowReadability.fontSizePrecision,
            ) / dataflowReadability.fontSizePrecision;
            const baseline = Number(yValue) +
              dataflowReadability.flowLabelMaskBaselineTop;
            const top = dataflowFlowLabelMaskTop(dataflowLayout.fontSize);
            const y = baseline - top;
            const height = top +
              dataflowReadability.flowLabelMaskBaselineBottom;
            const [viewBoxWidth, viewBoxHeight] = dataflowLayout.viewBox;
            if (
              ![x, y, width, height].every(Number.isFinite) ||
              x < 0 ||
              y < 0 ||
              x + width > viewBoxWidth ||
              y + height > viewBoxHeight
            ) {
              throw new Error(
                `Archify dataflow final flow label mask ${index} exceeds the ${viewBoxWidth}x${viewBoxHeight} viewBox`,
              );
            }
            return `${prefix}${x}${yPrefix}${y}${widthPrefix}${width}${heightPrefix}${height}${suffix}`;
          },
        );
        if (!replaced) {
          throw new Error(
            `Archify dataflow output is missing flow label mask ${index}`,
          );
        }
        return next;
      }, contents)
    : contents;
  return adjustedContents.replace(headEnd, `${style}\n${headEnd}`);
}

export function renderStory(story: ResolvedStoryDocument): StoryArtifact {
  const integrity = verifyVendoredArchifyIntegrity();
  const family = story.document.diagramFamily ?? "architecture";
  const adaptiveSequenceLayout = family === "sequence"
    ? sequenceLayout(story)
    : undefined;
  const adaptiveDataflowLayout = family === "dataflow"
    ? dataflowLayout(story)
    : undefined;
  const spec = family === "workflow"
    ? workflowSpec(story)
    : family === "sequence"
      ? sequenceSpec(story, adaptiveSequenceLayout!)
      : family === "dataflow"
        ? dataflowSpec(story, adaptiveDataflowLayout!)
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
    const contents = family === "sequence"
      ? addSequenceNarrativeDetails(
        readFileSync(outputPath, "utf8"),
        story,
        adaptiveSequenceLayout!,
      )
      : readFileSync(outputPath, "utf8");
    return {
      kind: "html",
      mediaType: "text/html",
      contents: family === "architecture" ||
          family === "workflow" ||
          family === "sequence" ||
          family === "dataflow" ||
          family === "lifecycle"
        ? improveStoryReadability(
          contents,
          family,
          adaptiveDataflowLayout,
          adaptiveSequenceLayout?.fontSize,
        )
        : contents,
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
