import { deriveArchitecture } from "@topo/graph";
import {
  assessModuleCompatibility,
  assertGraphDocument,
  canonicalizeGraphDocument,
  createAttributeId,
  serializeJson,
  type Evidence,
  type GraphAttribute,
  type GraphDocument,
  type JsonValue,
  type ModuleManifestEntry,
  type SupportedModules,
} from "@topo/schema";
import type { StaticModuleManifest } from "./model.js";

const MODULE_VERSION = "0.0.0";
const MODULE_SCHEMA_VERSION = "1.0";
const DEGREE_MODULE_ID = "@topo/module-degree";
const CYCLES_MODULE_ID = "@topo/module-cycles";
const DEGREE_INCOMING_KEY = `${DEGREE_MODULE_ID}/incoming-edge-count`;
const DEGREE_OUTGOING_KEY = `${DEGREE_MODULE_ID}/outgoing-edge-count`;
const CYCLE_SIZE_KEY = `${CYCLES_MODULE_ID}/membership-size`;
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SCHEMA_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const BUILTIN_MODULE_MANIFESTS: readonly StaticModuleManifest[] = [
  {
    id: DEGREE_MODULE_ID,
    version: MODULE_VERSION,
    schemaVersion: MODULE_SCHEMA_VERSION,
    label: "Dependency edge degree",
    dependencies: [],
    attributes: [
      {
        key: DEGREE_INCOMING_KEY,
        label: "Incoming dependency edge count",
        subjectKind: "node",
        schema: { type: "integer", minimum: 0 },
      },
      {
        key: DEGREE_OUTGOING_KEY,
        label: "Outgoing dependency edge count",
        subjectKind: "node",
        schema: { type: "integer", minimum: 0 },
      },
    ],
    views: [
      {
        id: `${DEGREE_MODULE_ID}/dependency-degree`,
        label: "Dependency edge degree",
        attributeKeys: [DEGREE_INCOMING_KEY, DEGREE_OUTGOING_KEY],
      },
    ],
  },
  {
    id: CYCLES_MODULE_ID,
    version: MODULE_VERSION,
    schemaVersion: MODULE_SCHEMA_VERSION,
    label: "Dependency cycle membership",
    dependencies: [],
    attributes: [
      {
        key: CYCLE_SIZE_KEY,
        label: "Dependency cycle membership size",
        subjectKind: "node",
        schema: { type: "integer", minimum: 0 },
      },
    ],
    views: [
      {
        id: `${CYCLES_MODULE_ID}/cycle-membership`,
        label: "Dependency cycle membership",
        attributeKeys: [CYCLE_SIZE_KEY],
      },
    ],
  },
] as const;

interface ModuleContribution {
  attributes: GraphAttribute[];
  evidence: Evidence[];
}

function fail(message: string): never {
  throw new Error(`Module composition validation failed: ${message}`);
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    fail(`${label} must not be empty.`);
  }
}

function ownedPrefix(moduleId: string): string {
  return `${moduleId}/`;
}

function evidencePrefix(moduleId: string): string {
  return `evidence:${ownedPrefix(moduleId)}`;
}

function attributeEvidenceId(moduleId: string, nodeId: string): string {
  return `${evidencePrefix(moduleId)}${nodeId}`;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function derivationLocator(
  moduleId: string,
  nodeId: string,
  inputs: Readonly<Record<string, readonly string[]>>,
): string {
  const parameters = Object.keys(inputs)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          serializeJson([...(inputs[key] ?? [])]).trim(),
        )}`,
    )
    .join("&");
  return `topo:derivation/${encodeURIComponent(moduleId)}/${encodeURIComponent(nodeId)}?${parameters}`;
}

function derivedAttribute(
  moduleId: string,
  nodeId: string,
  key: string,
  value: number,
  method: string,
  evidenceId: string,
): GraphAttribute {
  return {
    id: createAttributeId(nodeId, key),
    subject: { kind: "node", id: nodeId },
    key,
    value,
    provenance: {
      kind: "derived",
      moduleId,
      method,
      evidenceIds: [evidenceId],
    },
    evidenceIds: [evidenceId],
    confidence: 1,
  };
}

function degreeContribution(graph: GraphDocument): ModuleContribution {
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.get(edge.targetId)?.push(edge.id);
    outgoing.get(edge.sourceId)?.push(edge.id);
  }

  const attributes: GraphAttribute[] = [];
  const evidence: Evidence[] = [];
  for (const node of graph.nodes) {
    const incomingEdgeIds = sorted(incoming.get(node.id) ?? []);
    const outgoingEdgeIds = sorted(outgoing.get(node.id) ?? []);
    const evidenceId = attributeEvidenceId(DEGREE_MODULE_ID, node.id);
    evidence.push({
      id: evidenceId,
      kind: "annotation",
      label: `Dependency edge inputs for ${node.id}`,
      locator: derivationLocator(DEGREE_MODULE_ID, node.id, {
        incomingEdgeIds,
        outgoingEdgeIds,
      }),
    });
    attributes.push(
      derivedAttribute(
        DEGREE_MODULE_ID,
        node.id,
        DEGREE_INCOMING_KEY,
        incomingEdgeIds.length,
        "count-incoming-dependency-edges",
        evidenceId,
      ),
      derivedAttribute(
        DEGREE_MODULE_ID,
        node.id,
        DEGREE_OUTGOING_KEY,
        outgoingEdgeIds.length,
        "count-outgoing-dependency-edges",
        evidenceId,
      ),
    );
  }
  return { attributes, evidence };
}

function cyclesContribution(graph: GraphDocument): ModuleContribution {
  const membership = new Map<
    string,
    { memberNodeIds: string[]; internalEdgeIds: string[] }
  >();
  for (const component of deriveArchitecture(graph).stronglyConnectedComponents) {
    const inputs = {
      memberNodeIds: sorted(component.memberNodeIds),
      internalEdgeIds: sorted(component.internalEdgeIds),
    };
    for (const nodeId of component.memberNodeIds) {
      membership.set(nodeId, inputs);
    }
  }

  const evidenceId = `${evidencePrefix(CYCLES_MODULE_ID)}graph-inputs`;
  const evidence: Evidence[] = [
    {
      id: evidenceId,
      kind: "annotation",
      label: "Directed graph inputs for strongly connected components",
      locator: derivationLocator(CYCLES_MODULE_ID, graph.graphId, {
        nodeIds: sorted(graph.nodes.map((node) => node.id)),
        edges: sorted(
          graph.edges.map(
            (edge) => `${edge.id}\u0000${edge.sourceId}\u0000${edge.targetId}`,
          ),
        ),
      }),
    },
  ];
  const attributes: GraphAttribute[] = [];
  for (const node of graph.nodes) {
    const inputs = membership.get(node.id) ?? {
      memberNodeIds: [],
      internalEdgeIds: [],
    };
    attributes.push(
      derivedAttribute(
        CYCLES_MODULE_ID,
        node.id,
        CYCLE_SIZE_KEY,
        inputs.memberNodeIds.length,
        "strongly-connected-cycle-membership-size",
        evidenceId,
      ),
    );
  }
  return { attributes, evidence };
}

function generateContribution(
  moduleId: string,
  graph: GraphDocument,
): ModuleContribution {
  switch (moduleId) {
    case DEGREE_MODULE_ID:
      return degreeContribution(graph);
    case CYCLES_MODULE_ID:
      return cyclesContribution(graph);
    default:
      return fail(`No generator is compiled for module "${moduleId}".`);
  }
}

function moduleEntry(manifest: StaticModuleManifest): ModuleManifestEntry {
  return {
    id: manifest.id,
    version: manifest.version,
    schemaVersion: manifest.schemaVersion,
  };
}

function isCompatibleEntry(
  entry: ModuleManifestEntry,
  manifest: StaticModuleManifest,
): boolean {
  return assessModuleCompatibility([entry], moduleSupport([manifest]))
    .authoritative;
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return serializeJson(left as JsonValue) === serializeJson(right as JsonValue);
}

function equalAttributes(
  left: readonly GraphAttribute[],
  right: readonly GraphAttribute[],
): boolean {
  const byId = (values: readonly GraphAttribute[]) =>
    [...values].sort((first, second) =>
      first.id < second.id ? -1 : first.id > second.id ? 1 : 0
    );
  return equalCanonical(byId(left), byId(right));
}

function referencedEvidenceIds(graph: GraphDocument): Set<string> {
  const references = new Set<string>();
  for (const edge of graph.edges) {
    edge.provenance.evidenceIds.forEach((id) => references.add(id));
  }
  for (const attribute of graph.attributes) {
    attribute.provenance.evidenceIds.forEach((id) => references.add(id));
    attribute.evidenceIds.forEach((id) => references.add(id));
  }
  return references;
}

export function validateModuleCatalog(
  manifests: readonly StaticModuleManifest[],
): void {
  const moduleIds = new Set<string>();
  const attributeOwners = new Map<string, string>();
  const viewOwners = new Map<string, string>();

  for (const manifest of manifests) {
    requireNonEmpty(manifest.id, "Module identifier");
    if (moduleIds.has(manifest.id)) {
      fail(`Duplicate module identifier "${manifest.id}".`);
    }
    moduleIds.add(manifest.id);
    requireNonEmpty(manifest.label, `Module "${manifest.id}" label`);
    if (!SEMANTIC_VERSION_PATTERN.test(manifest.version)) {
      fail(
        `Module "${manifest.id}" has invalid implementation version "${manifest.version}".`,
      );
    }
    if (!SCHEMA_VERSION_PATTERN.test(manifest.schemaVersion)) {
      fail(
        `Module "${manifest.id}" has invalid schema version "${manifest.schemaVersion}".`,
      );
    }
    if (manifest.dependencies.length > 0) {
      fail(`Module "${manifest.id}" must depend only on core.`);
    }

    const localAttributes = new Set<string>();
    for (const attribute of manifest.attributes) {
      requireNonEmpty(attribute.key, `Module "${manifest.id}" attribute key`);
      requireNonEmpty(
        attribute.label,
        `Module "${manifest.id}" attribute "${attribute.key}" label`,
      );
      if (!attribute.key.startsWith(ownedPrefix(manifest.id))) {
        fail(
          `Attribute "${attribute.key}" must be namespaced to module "${manifest.id}".`,
        );
      }
      if (localAttributes.has(attribute.key)) {
        fail(
          `Module "${manifest.id}" declares attribute "${attribute.key}" more than once.`,
        );
      }
      const owner = attributeOwners.get(attribute.key);
      if (owner !== undefined) {
        fail(
          `Attribute "${attribute.key}" is declared by both "${owner}" and "${manifest.id}".`,
        );
      }
      localAttributes.add(attribute.key);
      attributeOwners.set(attribute.key, manifest.id);
      if (
        attribute.subjectKind !== "node" ||
        attribute.schema.type !== "integer" ||
        attribute.schema.minimum !== 0
      ) {
        fail(
          `Attribute "${attribute.key}" must be a node integer with minimum 0.`,
        );
      }
    }

    for (const view of manifest.views) {
      requireNonEmpty(view.id, `Module "${manifest.id}" view identifier`);
      requireNonEmpty(view.label, `Module "${manifest.id}" view "${view.id}" label`);
      if (!view.id.startsWith(ownedPrefix(manifest.id))) {
        fail(`View "${view.id}" must be namespaced to module "${manifest.id}".`);
      }
      const owner = viewOwners.get(view.id);
      if (owner !== undefined) {
        fail(
          `View "${view.id}" is registered by both "${owner}" and "${manifest.id}".`,
        );
      }
      viewOwners.set(view.id, manifest.id);
      const keys = new Set<string>();
      for (const key of view.attributeKeys) {
        if (!localAttributes.has(key)) {
          fail(
            `View "${view.id}" references undeclared attribute "${key}".`,
          );
        }
        if (keys.has(key)) {
          fail(`View "${view.id}" references attribute "${key}" more than once.`);
        }
        keys.add(key);
      }
    }
  }
}

export function moduleSupport(
  manifests: readonly StaticModuleManifest[] = BUILTIN_MODULE_MANIFESTS,
): SupportedModules {
  validateModuleCatalog(manifests);
  return Object.fromEntries(
    [...manifests]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((manifest) => [
        manifest.id,
        {
          version: manifest.version,
          schemaVersion: manifest.schemaVersion,
        },
      ]),
  );
}

export function validateModuleContributions(
  graph: GraphDocument,
  manifests: readonly StaticModuleManifest[] = BUILTIN_MODULE_MANIFESTS,
): void {
  validateModuleCatalog(manifests);
  assertGraphDocument(graph);

  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const entryById = new Map(graph.modules.map((entry) => [entry.id, entry]));
  const attributeOwner = new Map(
    manifests.flatMap((manifest) =>
      manifest.attributes.map((attribute) => [attribute.key, manifest.id] as const),
    ),
  );
  const compatibleIds = new Set(
    manifests
      .filter((manifest) => {
        const entry = entryById.get(manifest.id);
        return entry !== undefined && isCompatibleEntry(entry, manifest);
      })
      .map((manifest) => manifest.id),
  );
  const allEvidenceReferences = referencedEvidenceIds(graph);

  for (const attribute of graph.attributes) {
    const owner = attributeOwner.get(attribute.key);
    if (owner !== undefined) {
      if (!entryById.has(owner)) {
        fail(
          `Attribute "${attribute.id}" uses owned key "${attribute.key}" without module "${owner}".`,
        );
      }
      if (compatibleIds.has(owner) && attribute.provenance.moduleId !== owner) {
        fail(
          `Attribute "${attribute.id}" shadows module-owned key "${attribute.key}".`,
        );
      }
    }
    if (
      compatibleIds.has(attribute.provenance.moduleId) &&
      owner !== attribute.provenance.moduleId
    ) {
      fail(
        `Module "${attribute.provenance.moduleId}" contributed undeclared attribute "${attribute.key}".`,
      );
    }
  }

  for (const moduleId of compatibleIds) {
    const expected = generateContribution(moduleId, graph);
    const actualAttributes = graph.attributes.filter(
      (attribute) => attribute.provenance.moduleId === moduleId,
    );
    if (!equalAttributes(actualAttributes, expected.attributes)) {
      fail(`Module "${moduleId}" attributes do not match their derivation inputs.`);
    }

    const expectedEvidenceById = new Map(
      expected.evidence.map((evidence) => [evidence.id, evidence]),
    );
    for (const [evidenceId, expectedEvidence] of expectedEvidenceById) {
      const actualEvidence = graph.evidence.find(
        (evidence) => evidence.id === evidenceId,
      );
      if (
        actualEvidence === undefined ||
        !equalCanonical(actualEvidence, expectedEvidence)
      ) {
        fail(
          `Module "${moduleId}" evidence "${evidenceId}" does not match its derivation inputs.`,
        );
      }
    }
  }

  for (const evidence of graph.evidence) {
    for (const manifest of manifests) {
      if (
        evidence.id.startsWith(evidencePrefix(manifest.id)) &&
        !entryById.has(manifest.id) &&
        !allEvidenceReferences.has(evidence.id)
      ) {
        fail(
          `Module-owned evidence "${evidence.id}" is present without module "${manifest.id}".`,
        );
      }
    }
    for (const moduleId of compatibleIds) {
      if (
        evidence.id.startsWith(evidencePrefix(moduleId)) &&
        !graph.attributes.some(
          (attribute) =>
            attribute.provenance.moduleId === moduleId &&
            (attribute.evidenceIds.includes(evidence.id) ||
              attribute.provenance.evidenceIds.includes(evidence.id)),
        ) &&
        !graph.edges.some((edge) =>
          edge.provenance.evidenceIds.includes(evidence.id),
        ) &&
        !graph.attributes.some(
          (attribute) =>
            attribute.provenance.moduleId !== moduleId &&
            (attribute.evidenceIds.includes(evidence.id) ||
              attribute.provenance.evidenceIds.includes(evidence.id)),
        )
      ) {
        fail(`Module "${moduleId}" has unreferenced evidence "${evidence.id}".`);
      }
    }
  }
}

export function composeModules(
  graph: GraphDocument,
  enabledModuleIds: readonly string[],
): GraphDocument {
  validateModuleCatalog(BUILTIN_MODULE_MANIFESTS);
  assertGraphDocument(graph);
  validateModuleContributions(graph);

  const manifestById = new Map<string, StaticModuleManifest>(
    BUILTIN_MODULE_MANIFESTS.map((manifest) => [manifest.id, manifest]),
  );
  const enabled = new Set<string>();
  for (const moduleId of enabledModuleIds) {
    if (enabled.has(moduleId)) {
      fail(`Configured module "${moduleId}" is duplicated.`);
    }
    if (!manifestById.has(moduleId)) {
      fail(`Configured module "${moduleId}" is not compiled into this generator.`);
    }
    enabled.add(moduleId);
  }

  for (const entry of graph.modules) {
    const manifest = manifestById.get(entry.id);
    if (
      manifest !== undefined &&
      (entry.version !== manifest.version ||
        entry.schemaVersion !== manifest.schemaVersion)
    ) {
      fail(
        `Module "${entry.id}" version ${entry.version} / schema ${entry.schemaVersion} is unsupported by this generator.`,
      );
    }
  }

  const knownIds = new Set<string>(manifestById.keys());
  const baseAttributes = graph.attributes.filter(
    (attribute) => !knownIds.has(attribute.provenance.moduleId),
  );
  const base: GraphDocument = {
    ...graph,
    modules: graph.modules.filter((entry) => !knownIds.has(entry.id)),
    attributes: baseAttributes,
    evidence: graph.evidence,
  };
  const retainedEvidenceIds = referencedEvidenceIds(base);
  base.evidence = graph.evidence.filter(
    (evidence) =>
      ![...knownIds].some((moduleId) =>
        evidence.id.startsWith(evidencePrefix(moduleId)),
      ) || retainedEvidenceIds.has(evidence.id),
  );

  const attributes = [...base.attributes];
  const evidence = [...base.evidence];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const modules = [...base.modules];

  for (const moduleId of sorted(enabled)) {
    const manifest = manifestById.get(moduleId)!;
    const contribution = generateContribution(moduleId, base);
    modules.push(moduleEntry(manifest));
    attributes.push(...contribution.attributes);
    for (const item of contribution.evidence) {
      const existing = evidenceById.get(item.id);
      if (existing !== undefined) {
        if (!equalCanonical(existing, item)) {
          fail(`Evidence identifier "${item.id}" conflicts with module "${moduleId}".`);
        }
        continue;
      }
      evidence.push(item);
      evidenceById.set(item.id, item);
    }
  }

  const composed = canonicalizeGraphDocument({
    ...base,
    modules,
    attributes,
    evidence,
  });
  assertGraphDocument(composed);
  validateModuleContributions(composed);
  return composed;
}
