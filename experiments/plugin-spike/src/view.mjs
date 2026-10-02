import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { assertBaselineCurrent } from "./inventory.mjs";
import { baselineDigest, validateFacts, writeArtifactSet } from "./baseline.mjs";
import { CONTRACT_VERSION, hash, serialize } from "./contract.mjs";
import { viewPage } from "./view-page.mjs";
import { renderNative } from "./native-renderer.mjs";
import { renderFlow } from "./flow-renderer.mjs";

function nonblank(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank text`);
}

function identifiers(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string") ||
      new Set(values).size !== values.length) throw new Error(`${label} must be a unique ID array`);
}

function fields(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} has unsupported field: ${key}`);
}

function checkEvidence(baseline, evidence) {
  if (!Array.isArray(evidence) || !evidence.length) throw new Error("Source evidence must be a nonempty array");
  const sources = new Map(baseline.source.files.map((file) => [file.path, file]));
  for (const item of evidence) {
    fields(item, ["path", "startLine", "endLine", "sha256", "excerpt"], "Source evidence");
    if (!sources.has(item.path) || sources.get(item.path).sha256 !== item.sha256) {
      throw new Error(`Source evidence is not bound to the captured file: ${item.path}`);
    }
    if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) ||
        item.startLine < 1 || item.endLine < item.startLine) throw new Error("Invalid authored source range");
    nonblank(item.excerpt, "Source excerpt");
  }
}

export function validateViewEvidence(baseline, view, files) {
  validateView(baseline, view);
  const sources = new Map(files.map((file) => [file.path, file]));
  for (const item of [...view.sections, ...view.connections].flatMap((part) => part.evidence ?? [])) {
    const source = sources.get(item.path);
    if (!source || hash(source.contents) !== item.sha256) throw new Error(`Source evidence changed: ${item.path}`);
    const lines = source.contents.split("\n");
    if (item.endLine > lines.length ||
        lines.slice(item.startLine - 1, item.endLine).join("\n") !== item.excerpt) {
      throw new Error(`Source excerpt does not match ${item.path}:${item.startLine}-${item.endLine}`);
    }
  }
}

export function validateView(baseline, view) {
  fields(view, ["schemaVersion", "baselineId", "id", "title", "summary", "sections", "connections"], "View");
  if (baseline.id !== baselineDigest(baseline)) throw new Error("Baseline digest does not match its contents");
  if (view.schemaVersion !== CONTRACT_VERSION) throw new Error("Unsupported experimental view schemaVersion");
  if (view.baselineId !== baseline.id) throw new Error("View is bound to a different baseline; reconcile it explicitly");
  if (!/^[a-z][a-z0-9-]*$/.test(view.id)) throw new Error("View id must be a stable lowercase slug");
  nonblank(view.title, "View title");
  nonblank(view.summary, "View summary");
  if (!Array.isArray(view.sections) || view.sections.length < 1 || view.sections.length > 8) {
    throw new Error("A focused experimental view must contain 1 to 8 sections");
  }
  if (!Array.isArray(view.connections)) throw new Error("View connections must be an array");
  const entities = new Map(baseline.entities.map((entity) => [entity.id, entity]));
  const relations = new Map(baseline.relationships.map((relation) => [relation.id, relation]));
  const sections = new Map();
  for (const section of view.sections) {
    fields(section, ["id", "title", "body", "entityIds", "kind", "evidence"], "Section");
    if (!/^[a-z][a-z0-9-]*$/.test(section.id) || sections.has(section.id)) throw new Error("Invalid or duplicate section id");
    nonblank(section.title, "Section title");
    nonblank(section.body, "Section body");
    identifiers(section.entityIds, "Section entityIds");
    if (!section.entityIds.length) throw new Error("Every section must reference baseline entities");
    if (section.kind !== undefined && !["step", "decision", "data"].includes(section.kind)) throw new Error("Unsupported section kind");
    if (section.evidence !== undefined) checkEvidence(baseline, section.evidence);
    const members = new Set(section.entityIds);
    for (const id of members) if (!entities.has(id)) throw new Error(`View references unknown entity: ${id}`);
    let previous;
    do {
      previous = members.size;
      for (const entity of entities.values()) if (entity.ownerId && members.has(entity.ownerId)) members.add(entity.id);
      for (const relation of relations.values()) {
        if (["declares", "contains"].includes(relation.kind) && members.has(relation.from)) members.add(relation.to);
      }
    } while (previous !== members.size);
    sections.set(section.id, { section, members });
  }
  for (const connection of view.connections) {
    fields(connection, ["from", "to", "label", "classification", "relationshipIds", "rationale", "evidence"], "Connection");
    const from = sections.get(connection.from);
    const to = sections.get(connection.to);
    if (!from || !to || from === to) throw new Error("Connection must join two different existing sections");
    nonblank(connection.label, "Connection label");
    identifiers(connection.relationshipIds, "Connection relationshipIds");
    if (connection.rationale !== undefined) nonblank(connection.rationale, "Connection rationale");
    if (connection.evidence !== undefined) checkEvidence(baseline, connection.evidence);
    if (connection.classification === "source-traced") {
      if (connection.relationshipIds.length) throw new Error("A source trace must not borrow analyzer relationship IDs");
      nonblank(connection.rationale, "Source-traced rationale");
      checkEvidence(baseline, connection.evidence);
      continue;
    }
    if (connection.classification === "inferred") {
      if (connection.relationshipIds.length) throw new Error("An inferred connection must not borrow factual relationship IDs");
      nonblank(connection.rationale, "Inferred connection rationale");
      continue;
    }
    if (connection.classification !== "source-derived" || !connection.relationshipIds.length) {
      throw new Error("A source-derived connection needs baseline relationships; otherwise mark it inferred with rationale");
    }
    for (const id of connection.relationshipIds) {
      const relation = relations.get(id);
      if (!relation) throw new Error(`View references unknown relationship: ${id}`);
      if (!from.members.has(relation.from) || !to.members.has(relation.to)) {
        throw new Error(`Relationship ${id} does not support the displayed connection direction/membership`);
      }
    }
  }
  return { entities, relations, sections };
}

async function prepareView(root, baseline, view, output, options = {}) {
  const validated = validateView(baseline, view);
  const current = await assertBaselineCurrent(root, baseline);
  validateFacts(baseline, current.files);
  validateViewEvidence(baseline, view, current.files);
  const files = new Map(current.files.map((file) => [file.path, file]));
  const anchors = new Map();
  const sectionAnchors = new Map();
  for (const section of view.sections) {
    const ids = [];
    const represented = new Set(section.entityIds);
    const members = validated.sections.get(section.id).members;
    for (const connection of view.connections) {
      for (const relationshipId of connection.relationshipIds) {
        const relationship = validated.relations.get(relationshipId);
        if (connection.from === section.id && members.has(relationship.from)) represented.add(relationship.from);
        if (connection.to === section.id && members.has(relationship.to)) represented.add(relationship.to);
      }
    }
    for (const entityId of represented) {
      const entity = validated.entities.get(entityId);
      const location = entity.location;
      const id = `source-${hash(`${location.path}:${location.startLine}:${location.endLine}`).slice(0, 20)}`;
      const contents = files.get(location.path).contents;
      anchors.set(id, {
        id, path: location.path,
        location: { startLine: location.startLine, endLine: location.endLine },
        excerpt: contents.split(/\r?\n/).slice(location.startLine - 1, location.endLine).join("\n"),
      });
      ids.push(id);
    }
    sectionAnchors.set(section.id, [...new Set(ids)]);
  }
  if (options.renderer && !["archify", "graphviz"].includes(options.renderer)) throw new Error("Unsupported view renderer");
  const renderArtifact = options.renderArtifact ?? (options.renderer === "graphviz" ? renderFlow : renderNative);
  const artifact = await renderArtifact(view);
  const evidence = {
    baselineId: baseline.id,
    sections: view.sections.map((section) => ({
      id: section.id, title: section.title, body: section.body, kind: section.kind ?? "step",
      sources: section.evidence ?? sectionAnchors.get(section.id).map((id) => {
        const anchor = anchors.get(id);
        return { path: anchor.path, ...anchor.location, excerpt: anchor.excerpt };
      }),
    })),
    connections: view.connections.map((connection) => ({
      ...connection,
      fromTitle: validated.sections.get(connection.from).section.title,
      toTitle: validated.sections.get(connection.to).section.title,
      relationships: connection.relationshipIds.map((id) => validated.relations.get(id)),
    })),
  };
  const page = viewPage(view, baseline, evidence, `${basename(output)}.native.html`, options.navigation);
  await assertBaselineCurrent(root, baseline);
  const receipt = {
    schemaVersion: CONTRACT_VERSION,
    viewId: view.id, baselineId: baseline.id,
    viewSha256: hash(serialize(view)), htmlSha256: hash(page), nativeHtmlSha256: hash(artifact.contents),
    renderer: artifact.renderer,
    nativeValidation: artifact.validation,
    specificationSha256: artifact.specificationSha256,
    layout: { strategy: options.renderer === "graphviz" ? "graphviz-directed-flow" : "native-grid-auto-routing",
      ...(artifact.specification.layout ? { columns: artifact.specification.layout.cols } : {}),
      sectionOrder: view.sections.map(({ id }) => id), presentation: "contained-source-view" },
    sourceDerivedConnections: view.connections.filter((connection) => connection.classification === "source-derived").length,
    sourceTracedConnections: view.connections.filter((connection) => connection.classification === "source-traced").length,
    inferredConnections: view.connections.filter((connection) => connection.classification === "inferred").length,
    humanReview: "pending",
    limitation: "Checks establish source references and baseline topology, not semantic truth of authored text or runtime behavior.",
  };
  const artifacts = [
    { path: `${output}.native.html`, contents: artifact.contents },
    { path: `${output}.spec.json`, contents: serialize(artifact.specification) },
    { path: `${output}.evidence.json`, contents: serialize(evidence) },
    { path: output, contents: page },
    { path: `${output}.receipt.json`, contents: serialize(receipt) },
  ];
  return { receipt, artifacts, page };
}

export async function renderView(root, baseline, view, output, options = {}) {
  const prepared = await prepareView(root, baseline, view, output, options);
  await writeArtifactSet(prepared.artifacts);
  return prepared.receipt;
}

export async function renderBook(root, baseline, views, output, options = {}) {
  if (!views.length || new Set(views.map(({ id }) => id)).size !== views.length) throw new Error("A diagram book requires unique view IDs");
  if (views.some(({ id }) => id === "index")) throw new Error("The view ID index is reserved for the book entry page");
  const source = await assertBaselineCurrent(root, baseline);
  for (const view of views) validateViewEvidence(baseline, view, source.files);
  const navigation = views.map(({ id, title }) => ({ id, title }));
  const prepared = [];
  for (const view of views) {
    prepared.push(await prepareView(root, baseline, view, join(output, `${view.id}.html`),
      { navigation, renderer: options.renderer, renderArtifact: options.renderArtifact }));
  }
  await assertBaselineCurrent(root, baseline);
  const receipts = prepared.map(({ receipt }) => receipt);
  await writeArtifactSet([
    ...prepared.flatMap(({ artifacts }) => artifacts),
    { path: join(output, "index.html"), contents: prepared[0].page },
    { path: join(output, "book.json"), contents: serialize({ baselineId: baseline.id, navigation, receipts }) },
  ], options.publication);
  return { views: views.length, baselineId: baseline.id, receipts };
}

export async function readView(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
