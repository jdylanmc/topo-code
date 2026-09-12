import {
  GRAPH_SCHEMA_VERSION,
  type GraphSchemaVersion,
  type ModuleManifestEntry,
} from "./model.js";

export interface SchemaCompatibility {
  compatible: boolean;
  warnings: string[];
  errors: string[];
}

interface ParsedVersion {
  major: number;
  minor: number;
}

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseGraphSchemaVersion(
  version: string,
): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

export function assessSchemaCompatibility(
  documentVersion: string,
  supportedVersion: GraphSchemaVersion = GRAPH_SCHEMA_VERSION,
): SchemaCompatibility {
  const document = parseGraphSchemaVersion(documentVersion);
  const supported = parseGraphSchemaVersion(supportedVersion);

  if (!document) {
    return {
      compatible: false,
      warnings: [],
      errors: [`Invalid graph schema version "${documentVersion}".`],
    };
  }

  if (!supported) {
    return {
      compatible: false,
      warnings: [],
      errors: [`Invalid supported graph schema version "${supportedVersion}".`],
    };
  }

  if (document.major !== supported.major) {
    return {
      compatible: false,
      warnings: [],
      errors: [
        `Graph schema ${documentVersion} is incompatible with supported schema ${supportedVersion}.`,
      ],
    };
  }

  if (document.minor > supported.minor) {
    return {
      compatible: true,
      warnings: [
        `Graph schema ${documentVersion} is newer than supported schema ${supportedVersion}; only understood core fields and extensions will be used.`,
      ],
      errors: [],
    };
  }

  return { compatible: true, warnings: [], errors: [] };
}

export function assessModuleCompatibility(
  documentModules: readonly ModuleManifestEntry[],
  supportedModules: Readonly<Record<string, string>>,
): SchemaCompatibility {
  const warnings: string[] = [];

  for (const module of documentModules) {
    const supportedVersion = supportedModules[module.id];
    if (supportedVersion === undefined) {
      warnings.push(
        `Module "${module.id}" is not available; its namespaced contributions will be ignored.`,
      );
      continue;
    }

    const compatibility = assessSchemaCompatibility(
      module.schemaVersion,
      supportedVersion as GraphSchemaVersion,
    );
    if (!compatibility.compatible) {
      warnings.push(
        `Module "${module.id}" schema ${module.schemaVersion} is incompatible with supported schema ${supportedVersion}; its contributions will be ignored.`,
      );
    } else {
      warnings.push(...compatibility.warnings.map((warning) => `${module.id}: ${warning}`));
    }
  }

  return { compatible: true, warnings, errors: [] };
}
