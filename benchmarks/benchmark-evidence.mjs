import { createHash } from "node:crypto";

function hashIds(ids) {
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}

function membershipDelta(before = [], after = []) {
  const beforeMembers = new Set(before);
  const afterMembers = new Set(after);
  return {
    beforeCount: before.length,
    afterCount: after.length,
    beforeSha256: hashIds(before),
    afterSha256: hashIds(after),
    addedIds: after.filter((id) => !beforeMembers.has(id)),
    removedIds: before.filter((id) => !afterMembers.has(id)),
  };
}

export function verifyLayoutTransition(before, after) {
  const expandedContainerDelta = membershipDelta(
    before.expandedContainerIds,
    after.expandedContainerIds,
  );
  const collapsedTangleDelta = membershipDelta(
    before.collapsedTangleIds,
    after.collapsedTangleIds,
  );
  const expansionStateChanged =
    expandedContainerDelta.addedIds.length > 0 ||
    expandedContainerDelta.removedIds.length > 0 ||
    collapsedTangleDelta.addedIds.length > 0 ||
    collapsedTangleDelta.removedIds.length > 0;
  if (!expansionStateChanged) {
    return {
      status: "failed",
      expansionStateChanged: false,
      visibleMembershipChanged: null,
      expandedContainerDelta,
      collapsedTangleDelta,
      reason: "Directory/tangle expansion state did not change.",
    };
  }
  if (
    !Array.isArray(before.visibleEntityIds) ||
    !Array.isArray(after.visibleEntityIds)
  ) {
    return {
      status: "unavailable",
      expansionStateChanged: true,
      visibleMembershipChanged: null,
      expandedContainerDelta,
      collapsedTangleDelta,
      requiredBenchmarkApiField: "snapshot().visibleEntityIds",
      reason:
        "The benchmark API does not expose visible entity membership.",
    };
  }
  const visibleEntityDelta = membershipDelta(
    before.visibleEntityIds,
    after.visibleEntityIds,
  );
  const visibleMembershipChanged =
    visibleEntityDelta.addedIds.length > 0 ||
    visibleEntityDelta.removedIds.length > 0;
  return {
    status: visibleMembershipChanged ? "verified" : "failed",
    expansionStateChanged: true,
    visibleMembershipChanged,
    expandedContainerDelta,
    collapsedTangleDelta,
    visibleEntityDelta,
    ...(visibleMembershipChanged
      ? {}
      : {
          reason:
            "Expansion changed without changing visible entity membership.",
        }),
  };
}

export function collapsedDirectoryCandidates(snapshot) {
  if (!Array.isArray(snapshot.visibleEntityIds)) return undefined;
  const expanded = new Set(snapshot.expandedContainerIds);
  return snapshot.visibleEntityIds.filter(
    (id) => id.startsWith("directory:") && !expanded.has(id),
  );
}

export function visibleTangleCandidates(snapshot) {
  if (!Array.isArray(snapshot.visibleEntityIds)) return undefined;
  return snapshot.visibleEntityIds.filter((id) =>
    id.startsWith("derived:tangle:") || id.startsWith("tangle:"),
  );
}

export function verifyViewportPreflight(bounds, viewport) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return {
      status: "failed",
      reason: "Target renderer has no positive usable size.",
      bounds: bounds ?? null,
      viewport,
    };
  }
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(viewport.width, bounds.x + bounds.width);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height);
  const intersectionWidth = Math.max(0, right - left);
  const intersectionHeight = Math.max(0, bottom - top);
  if (intersectionWidth <= 0 || intersectionHeight <= 0) {
    return {
      status: "failed",
      reason: "Target renderer does not intersect the browser viewport.",
      bounds,
      viewport,
      intersection: {
        x: left,
        y: top,
        width: intersectionWidth,
        height: intersectionHeight,
      },
    };
  }
  return {
    status: "verified",
    bounds,
    viewport,
    intersection: {
      x: left,
      y: top,
      width: intersectionWidth,
      height: intersectionHeight,
    },
    interactionPoint: {
      x: left + intersectionWidth / 2,
      y: top + intersectionHeight / 2,
    },
  };
}
