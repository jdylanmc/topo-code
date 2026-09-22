export interface RepositorySourceEvidenceAnchor {
  readonly id: string;
}

export interface ResolvedRepositorySourceEvidenceAnchor
  extends RepositorySourceEvidenceAnchor {
  readonly excerpt: string;
}

export type SupportedNativeDiagramFamily =
  | "architecture"
  | "workflow";

export interface SourceGroundedStoryDocument {
  readonly diagramFamily?: SupportedNativeDiagramFamily;
}

export interface ResolvedSourceGroundedStoryDocument {
  readonly document: SourceGroundedStoryDocument;
  readonly anchors: readonly ResolvedRepositorySourceEvidenceAnchor[];
}

export interface RenderedSourceGroundedStoryArtifact {
  readonly contents: string;
}

export interface SourceGroundedStoryRenderer {
  render(
    story: ResolvedSourceGroundedStoryDocument,
  ): RenderedSourceGroundedStoryArtifact;
}

export class SourceGroundedStoryDocumentError extends Error {}

export interface SourceGroundedStoryValidationResult {
  readonly error?: SourceGroundedStoryDocumentError;
}

export class SourceGroundedStoryRendererImplementation
  implements SourceGroundedStoryRenderer {
  render(
    _story: ResolvedSourceGroundedStoryDocument,
  ): RenderedSourceGroundedStoryArtifact {
    return { contents: "" };
  }
}
