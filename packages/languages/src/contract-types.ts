export interface SourceLocation {
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SourceFile {
  path: string;
  contents: string;
  sha256: string;
  language?: string;
}

export interface Entity {
  id: string;
  language: string;
  kind: string;
  name: string;
  qualifiedName: string;
  location: SourceLocation;
  exported: boolean;
  signatures: string[];
  attributes: string[];
  ownerId?: string;
}

export interface Relationship {
  id: string;
  from: string;
  to: string;
  kind: string;
  method: string;
  evidence: SourceLocation[];
}

export interface UnresolvedReference {
  id: string;
  kind: string;
  text: string;
  reason: string;
  location: SourceLocation;
  ownerId?: string;
  candidates?: string[];
}

export interface Diagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
  path?: string;
}

export interface Contribution {
  plugin: {
    id: string;
    version: string;
    kind: "language" | "framework";
    languages: string[];
    capabilities: string[];
  };
  entities: Entity[];
  relationships: Relationship[];
  unresolved: UnresolvedReference[];
  diagnostics: Diagnostic[];
  coverage: {
    status: "complete" | "partial" | "unsupported";
    analyzedFiles: string[];
    limitations: string[];
  };
  extensions: Record<string, unknown>;
}

export interface ScanContext {
  root: string;
  files: readonly SourceFile[];
}

// Plugins receive a captured source inventory; they must not mutate the repository.
export type LanguagePlugin = (context: ScanContext) => Promise<Contribution>;
export type FrameworkPlugin = (
  context: ScanContext,
  languages: readonly Contribution[],
) => Promise<Contribution>;
