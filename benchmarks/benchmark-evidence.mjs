function sameMembers(left = [], right = []) {
  if (left.length !== right.length) return false;
  const rightMembers = new Set(right);
  return left.every((value) => rightMembers.has(value));
}

export function verifyLayoutTransition(before, after) {
  const expansionStateChanged =
    !sameMembers(
      before.expandedContainerIds,
      after.expandedContainerIds,
    ) ||
    !sameMembers(before.collapsedTangleIds, after.collapsedTangleIds);
  if (!expansionStateChanged) {
    return {
      status: "failed",
      expansionStateChanged: false,
      visibleMembershipChanged: null,
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
      requiredBenchmarkApiField: "snapshot().visibleEntityIds",
      reason:
        "The benchmark API does not expose visible entity membership.",
    };
  }
  const visibleMembershipChanged = !sameMembers(
    before.visibleEntityIds,
    after.visibleEntityIds,
  );
  return {
    status: visibleMembershipChanged ? "verified" : "failed",
    expansionStateChanged: true,
    visibleMembershipChanged,
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
  return snapshot.visibleEntityIds.filter((id) => id.startsWith("tangle:"));
}
