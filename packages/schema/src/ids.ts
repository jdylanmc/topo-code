function requireIdPart(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

export function normalizeRepositoryPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const components = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    components.some(
      (component) =>
        component.length === 0 || component === "." || component === "..",
    )
  ) {
    throw new Error(`Repository path "${path}" must be relative and contained.`);
  }
  return normalized;
}

export function createPathNodeId(path: string): string {
  return `path:${normalizeRepositoryPath(path)}`;
}

export function createExternalNodeId(locator: string): string {
  return `external:${requireIdPart(locator, "External locator")}`;
}

export function createSyntheticNodeId(identity: string): string {
  return `synthetic:${requireIdPart(identity, "Synthetic identity")}`;
}

export function createEdgeId(
  type: string,
  sourceId: string,
  targetId: string,
): string {
  return `edge:${requireIdPart(type, "Edge type")}:${requireIdPart(sourceId, "Source identifier")}->${requireIdPart(targetId, "Target identifier")}`;
}

export function createContainerId(type: string, identity: string): string {
  return `container:${requireIdPart(type, "Container type")}:${requireIdPart(identity, "Container identity")}`;
}

export function createAttributeId(subjectId: string, key: string): string {
  return `attribute:${requireIdPart(subjectId, "Subject identifier")}:${requireIdPart(key, "Attribute key")}`;
}
