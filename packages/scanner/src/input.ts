import path from "node:path";
import {
  ScanInputError,
  type ScanQualityOptions,
  type ScanRepositoryOptions,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ScanInputError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ScanInputError(`${field} must be a boolean.`);
  }
  return value;
}

function optionalNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ScanInputError(
      `${field} must be a finite number from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function parseQuality(value: unknown): ScanQualityOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ScanInputError("quality must be an object.");
  }

  const allowed = new Set([
    "allowPartial",
    "minimumFileCount",
    "maxUnresolvedImportRatio",
    "requireWorkspaceCoverage",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ScanInputError(`Unknown quality option "${key}".`);
    }
  }

  const minimumFileCount = optionalNumber(
    value.minimumFileCount,
    "quality.minimumFileCount",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (minimumFileCount !== undefined && !Number.isInteger(minimumFileCount)) {
    throw new ScanInputError("quality.minimumFileCount must be an integer.");
  }

  return {
    ...(optionalBoolean(value.allowPartial, "quality.allowPartial") ===
    undefined
      ? {}
      : { allowPartial: value.allowPartial as boolean }),
    ...(minimumFileCount === undefined ? {} : { minimumFileCount }),
    ...(optionalNumber(
      value.maxUnresolvedImportRatio,
      "quality.maxUnresolvedImportRatio",
      0,
      1,
    ) === undefined
      ? {}
      : {
          maxUnresolvedImportRatio: value.maxUnresolvedImportRatio as number,
        }),
    ...(optionalBoolean(
      value.requireWorkspaceCoverage,
      "quality.requireWorkspaceCoverage",
    ) === undefined
      ? {}
      : {
          requireWorkspaceCoverage:
            value.requireWorkspaceCoverage as boolean,
        }),
  };
}

export function parseScanRepositoryOptions(
  value: unknown,
): ScanRepositoryOptions {
  if (!isRecord(value)) {
    throw new ScanInputError("Scanner options must be an object.");
  }

  const allowed = new Set([
    "root",
    "repositoryId",
    "revision",
    "quality",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ScanInputError(`Unknown scanner option "${key}".`);
    }
  }

  if (typeof value.root !== "string" || value.root.trim().length === 0) {
    throw new ScanInputError("root must be a non-empty path string.");
  }

  const quality = parseQuality(value.quality);
  return {
    root: path.resolve(value.root),
    ...(optionalString(value.repositoryId, "repositoryId") === undefined
      ? {}
      : { repositoryId: value.repositoryId as string }),
    ...(optionalString(value.revision, "revision") === undefined
      ? {}
      : { revision: value.revision as string }),
    ...(quality === undefined ? {} : { quality }),
  };
}
