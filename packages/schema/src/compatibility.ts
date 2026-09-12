import {
  GRAPH_SCHEMA_VERSION,
  type GraphDocument,
  type GraphSchemaVersion,
  type ModuleManifestEntry,
} from "./model.js";

export interface SchemaCompatibility {
  compatible: boolean;
  authoritative: boolean;
  warnings: string[];
  errors: string[];
}

interface ParsedVersion {
  major: number;
  minor: number;
}

interface ParsedSemanticVersion extends ParsedVersion {
  patch: number;
}

export interface SupportedModuleVersion {
  version: string;
  schemaVersion: GraphSchemaVersion;
}

export type SupportedModules = Readonly<
  Record<string, SupportedModuleVersion | GraphSchemaVersion>
>;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

function parseSemanticVersion(
  version: string,
): ParsedSemanticVersion | undefined {
  const match = SEMANTIC_VERSION_PATTERN.exec(version);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isNewerSemanticVersion(
  document: ParsedSemanticVersion,
  supported: ParsedSemanticVersion,
): boolean {
  return (
    document.major > supported.major ||
    (document.major === supported.major &&
      (document.minor > supported.minor ||
        (document.minor === supported.minor &&
          document.patch > supported.patch)))
  );
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
      authoritative: false,
      warnings: [],
      errors: [`Invalid graph schema version "${documentVersion}".`],
    };
  }

  if (!supported) {
    return {
      compatible: false,
      authoritative: false,
      warnings: [],
      errors: [`Invalid supported graph schema version "${supportedVersion}".`],
    };
  }

  if (document.major !== supported.major) {
    return {
      compatible: false,
      authoritative: false,
      warnings: [],
      errors: [
        `Graph schema ${documentVersion} is incompatible with supported schema ${supportedVersion}.`,
      ],
    };
  }

  if (document.minor > supported.minor) {
    return {
      compatible: true,
      authoritative: false,
      warnings: [
        `Graph schema ${documentVersion} is newer than supported schema ${supportedVersion}; only understood core fields and extensions will be used.`,
      ],
      errors: [],
    };
  }

  return {
    compatible: true,
    authoritative: true,
    warnings: [],
    errors: [],
  };
}

export function assessModuleCompatibility(
  documentModules: readonly ModuleManifestEntry[],
  supportedModules: SupportedModules,
): SchemaCompatibility {
  const warnings: string[] = [];

  for (const module of documentModules) {
    const supported = supportedModules[module.id];
    if (supported === undefined) {
      warnings.push(
        `Module "${module.id}" is not available; its contributions remain present but must not be treated as understood.`,
      );
      continue;
    }

    if (typeof supported === "string") {
      const compatibility = assessSchemaCompatibility(
        module.schemaVersion,
        supported,
      );
      warnings.push(
        `Module "${module.id}" implementation version ${module.version} was not supplied by the consumer and cannot be treated as authoritative.`,
      );
      if (!compatibility.compatible) {
        warnings.push(
          `Module "${module.id}" schema ${module.schemaVersion} is incompatible with supported schema ${supported}; its contributions remain present but unsupported.`,
        );
      } else {
        warnings.push(
          ...compatibility.warnings.map((warning) => `${module.id}: ${warning}`),
        );
      }
      continue;
    }

    const compatibility = assessSchemaCompatibility(
      module.schemaVersion,
      supported.schemaVersion,
    );
    if (!compatibility.compatible) {
      warnings.push(
        `Module "${module.id}" schema ${module.schemaVersion} is incompatible with supported schema ${supported.schemaVersion}; its contributions remain present but unsupported.`,
      );
    } else {
      warnings.push(
        ...compatibility.warnings.map((warning) => `${module.id}: ${warning}`),
      );
    }

    const documentVersion = parseSemanticVersion(module.version);
    const supportedVersion = parseSemanticVersion(supported.version);
    if (!documentVersion || !supportedVersion) {
      warnings.push(
        `Module "${module.id}" implementation version could not be compared (${module.version} versus ${supported.version}).`,
      );
    } else if (documentVersion.major !== supportedVersion.major) {
      warnings.push(
        `Module "${module.id}" implementation ${module.version} is incompatible with supported implementation ${supported.version}; its contributions remain present but unsupported.`,
      );
    } else if (isNewerSemanticVersion(documentVersion, supportedVersion)) {
      warnings.push(
        `Module "${module.id}" implementation ${module.version} is newer than supported implementation ${supported.version}; its contributions must not be treated as authoritative.`,
      );
    }
  }

  return {
    compatible: true,
    authoritative: warnings.length === 0,
    warnings,
    errors: [],
  };
}

export function assessGraphDocumentCompatibility(
  document: Pick<GraphDocument, "schemaVersion" | "modules">,
  supportedModules: SupportedModules = {},
  supportedVersion: GraphSchemaVersion = GRAPH_SCHEMA_VERSION,
): SchemaCompatibility {
  const schema = assessSchemaCompatibility(
    document.schemaVersion,
    supportedVersion,
  );
  if (!schema.compatible) {
    return schema;
  }

  const modules = assessModuleCompatibility(
    document.modules,
    supportedModules,
  );
  const warnings = [...schema.warnings, ...modules.warnings];
  return {
    compatible: true,
    authoritative:
      schema.authoritative && modules.authoritative && warnings.length === 0,
    warnings,
    errors: [],
  };
}
