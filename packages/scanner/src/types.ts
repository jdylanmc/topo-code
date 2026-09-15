import type { GraphDocument, LogicalArchitectureDocument } from "@topo/schema";

export const SCANNER_MODULE_ID = "@topo/scanner-typescript" as const;
export const SCANNER_VERSION = "0.0.0" as const;

export interface ScannerCapabilities {
  languages: readonly ["javascript", "typescript"];
  granularity: readonly ["directory", "file", "semantic-entity"];
  relationships: readonly ["imports", "calls", "constructs", "type-use", "heritage"];
  moduleResolution: "typescript-compiler";
  workspaceManifests: readonly ["package.json"];
  opaqueAssets: readonly ["css"];
  partialResults: true;
}

export interface ScannerManifest {
  id: typeof SCANNER_MODULE_ID;
  version: typeof SCANNER_VERSION;
  contractVersion: "1.0";
  capabilities: ScannerCapabilities;
}

export const TYPESCRIPT_SCANNER_MANIFEST: ScannerManifest = {
  id: SCANNER_MODULE_ID,
  version: SCANNER_VERSION,
  contractVersion: "1.0",
  capabilities: {
    languages: ["javascript", "typescript"],
    granularity: ["directory", "file", "semantic-entity"],
    relationships: ["imports", "calls", "constructs", "type-use", "heritage"],
    moduleResolution: "typescript-compiler",
    workspaceManifests: ["package.json"],
    opaqueAssets: ["css"],
    partialResults: true,
  },
};

export interface ScanQualityOptions {
  allowPartial?: boolean;
  minimumFileCount?: number;
  maxUnresolvedImportRatio?: number;
  requireWorkspaceCoverage?: boolean;
}

export interface ScanRepositoryOptions {
  root: string;
  repositoryId?: string;
  revision?: string;
  quality?: ScanQualityOptions;
  responsibilityFile?: string;
}

export type ScanDiagnosticSeverity = "warning" | "error";

export interface ScanDiagnostic {
  code: string;
  severity: ScanDiagnosticSeverity;
  message: string;
  path?: string;
  specifier?: string;
}

export interface ScanMetrics {
  configCount: number;
  workspacePackageCount: number;
  coveredWorkspacePackageCount: number;
  sourceFileCount: number;
  assetFileCount: number;
  linesOfCode: number;
  localImportCount: number;
  assetImportCount: number;
  externalImportCount: number;
  unresolvedImportCount: number;
}

export interface ScanResult {
  graph: GraphDocument;
  logicalArchitecture: LogicalArchitectureDocument;
  diagnostics: ScanDiagnostic[];
  metrics: ScanMetrics;
  authoritative: boolean;
}

export interface ScannerAdapter {
  readonly manifest: ScannerManifest;
  scan(options: unknown): Promise<ScanResult>;
}

export class ScanInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ScanInputError";
  }
}

export class ScanError extends Error {
  readonly diagnostics: ScanDiagnostic[];

  constructor(message: string, diagnostics: ScanDiagnostic[]) {
    super(message);
    this.name = "ScanError";
    this.diagnostics = diagnostics;
  }
}
