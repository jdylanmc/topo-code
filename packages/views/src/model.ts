export interface ViewAnchor {
  kind: "node" | "directory";
  path: string;
}

export interface ViewPin {
  anchor: ViewAnchor;
  position: { x: number; y: number };
}

export interface ViewMember {
  path: string;
  fingerprint?: string;
}

export interface CuratedViewDefinition {
  schemaVersion: "1.0";
  id: string;
  name: string;
  provenance: "human";
  pathRules: string[];
  includes: ViewAnchor[];
  excludes: ViewAnchor[];
  pins: ViewPin[];
  expandedPaths: string[];
  reviewed?: {
    graphHash: string;
    members: ViewMember[];
  };
}

export interface CuratedViewDelta {
  added: ViewMember[];
  removed: ViewMember[];
  changed: ViewMember[];
  unplaced: ViewMember[];
  missingPins: ViewAnchor[];
  excludedPins: ViewAnchor[];
  retainedPins: ViewAnchor[];
  unresolvedIncludes: ViewAnchor[];
  unresolvedExcludes: ViewAnchor[];
}

export interface CuratedViewEvaluation {
  nodeIds: string[];
  members: ViewMember[];
  delta: CuratedViewDelta;
}

export interface CuratedViewRecord {
  definition: CuratedViewDefinition;
  revision: string;
}

export interface CuratedViewsSnapshot {
  schemaVersion: "1.0";
  graphHash: string;
  views: CuratedViewRecord[];
}

export interface SaveCuratedViewRequest {
  definition: CuratedViewDefinition;
  expectedRevision: string | null;
  expectedGraphHash: string;
  review: boolean;
}
