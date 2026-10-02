#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpath } from "node:fs/promises";
import { scanBaseline, readBaseline, writeArtifact } from "../src/baseline.mjs";
import { serialize } from "../src/contract.mjs";
import { assertBaselineCurrent } from "../src/inventory.mjs";
import { initialize } from "../src/initialize.mjs";
import { readView, renderView, renderBook, validateViewEvidence } from "../src/view.mjs";

const HELP = `Topocode plugin spike (EXPERIMENTAL; not published Rust support)

  topo-spike init <repository>
  topo-spike scan <repository> [--output file] [--plugins typescript,rust,tauri] [--allow-partial]
  topo-spike inspect <baseline.json> [--query text] [--entity id] [--relationship id] [--limit 20]
  topo-spike validate <repository> <baseline.json> <view.json>
  topo-spike render <repository> <baseline.json> <view.json> --output diagram.html
  topo-spike book <repository> <baseline.json> <view.json> [more.json ...] --output directory [--renderer archify|graphviz]

Partial analysis requires --allow-partial to publish a baseline and exits 2.
Source-derived connections must cite baseline relationships with matching endpoints.
Inferred connections require an explicit classification and rationale.
Agent source-traced connections require snapshot-bound exact code excerpts.
No model, Cargo build, procedural macro, application, or package installation is invoked.
`;

export function inspectBaseline(baseline, values) {
  const limit = Number(values.limit ?? 20);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("--limit must be an integer from 1 to 200");
  const query = (values.query ?? "").toLowerCase();
  const allEntities = new Map(baseline.entities.map((entity) => [entity.id, entity]));
  const entityMatches = baseline.entities.filter((entity) => values.entity
    ? entity.id === values.entity
    : `${entity.id} ${entity.name} ${entity.qualifiedName} ${entity.location.path} ${entity.kind}`.toLowerCase().includes(query));
  if (values.entity && !entityMatches.length) throw new Error(`Unknown entity: ${values.entity}`);
  const matchingIds = new Set(entityMatches.map(({ id }) => id));
  const relationshipMatches = baseline.relationships.filter((relationship) => values.relationship
    ? relationship.id === values.relationship
    : values.entity
      ? relationship.from === values.entity || relationship.to === values.entity
      : !query || matchingIds.has(relationship.from) || matchingIds.has(relationship.to) ||
        `${relationship.id} ${relationship.kind}`.toLowerCase().includes(query));
  if (values.relationship && !relationshipMatches.length) throw new Error(`Unknown relationship: ${values.relationship}`);
  const relationships = relationshipMatches.slice(0, limit);
  const entities = values.relationship
    ? [...new Set(relationships.flatMap(({ from, to }) => [from, to]))].map((id) => allEntities.get(id))
    : entityMatches.slice(0, limit);
  const unresolvedMatches = baseline.unresolved.filter((item) =>
    `${item.text} ${item.location.path} ${item.reason}`.toLowerCase().includes(query));
  return {
    baselineId: baseline.id, repository: baseline.repository, coverage: baseline.coverage,
    totals: { entities: baseline.entities.length, relationships: baseline.relationships.length, unresolved: baseline.unresolved.length },
    matching: { entities: entityMatches.length, relationships: relationshipMatches.length, unresolved: unresolvedMatches.length },
    truncated: { entities: !values.relationship && entityMatches.length > entities.length,
      relationships: relationshipMatches.length > relationships.length, unresolved: unresolvedMatches.length > limit },
    entities, relationships,
    relatedEntities: [...new Set(relationships.flatMap(({ from, to }) => [from, to]))]
      .filter((id) => !entities.some((entity) => entity.id === id)).map((id) => allEntities.get(id)),
    unresolved: unresolvedMatches.slice(0, limit),
  };
}

export async function run(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" }, output: { type: "string" }, plugins: { type: "string" },
      "allow-partial": { type: "boolean" }, "repository-id": { type: "string" },
      query: { type: "string" }, entity: { type: "string" }, relationship: { type: "string" },
      limit: { type: "string" }, renderer: { type: "string" },
    },
  });
  const [command, ...inputs] = positionals;
  if (values.help || !command || command === "help") { console.log(HELP); return 0; }
  if (command === "init") {
    if (inputs.length !== 1) throw new Error("init requires one repository path");
    console.log(serialize(await initialize(inputs[0])).trim());
    return 0;
  }
  if (command === "scan") {
    if (inputs.length !== 1) throw new Error("scan requires one repository path");
    const baseline = await scanBaseline(inputs[0], {
      ...(values.plugins ? { plugins: values.plugins.split(",") } : {}),
      ...(values["repository-id"] ? { repositoryId: values["repository-id"] } : {}),
    });
    const partial = baseline.coverage.status !== "complete";
    if (partial && !values["allow-partial"]) {
      console.error(serialize({ coverage: baseline.coverage, diagnostics: baseline.diagnostics }).trim());
      throw new Error("Analysis is partial; no baseline was published. Use --allow-partial only for an explicit limited-evidence preview.");
    }
    const output = resolve(values.output ?? `${inputs[0]}/.topo/cache/plugin-spike/baseline.json`);
    await writeArtifact(output, serialize(baseline));
    console.log(serialize({
      baselineId: baseline.id, output, status: baseline.coverage.status,
      entities: baseline.entities.length, relationships: baseline.relationships.length,
      unresolved: baseline.unresolved.length, plugins: baseline.plugins.map(({ id }) => id),
    }).trim());
    return partial ? 2 : 0;
  }
  if (command === "inspect") {
    if (inputs.length !== 1) throw new Error("inspect requires one baseline JSON file");
    console.log(serialize(inspectBaseline(await readBaseline(inputs[0]), values)).trim());
    return 0;
  }
  if (command === "validate" || command === "render") {
    if (inputs.length !== 3) throw new Error(`${command} requires repository, baseline JSON, and authored view JSON`);
    const [root, baselinePath, viewPath] = inputs;
    const baseline = await readBaseline(baselinePath);
    const view = await readView(viewPath);
    const source = await assertBaselineCurrent(root, baseline);
    validateViewEvidence(baseline, view, source.files);
    if (command === "validate") {
      console.log(serialize({ validReferences: true, baselineId: baseline.id,
        coverage: baseline.coverage.status, semanticTruth: "requires human review" }).trim());
    } else {
      if (!values.output) throw new Error("render requires an explicit --output HTML path");
      console.log(serialize(await renderView(root, baseline, view, values.output, { renderer: values.renderer })).trim());
    }
    return 0;
  }
  if (command === "book") {
    if (inputs.length < 3 || !values.output) throw new Error("book requires repository, baseline, views and --output directory");
    const [root, baselinePath, ...paths] = inputs;
    const baseline = await readBaseline(baselinePath);
    const views = await Promise.all(paths.map(readView));
    console.log(serialize(await renderBook(root, baseline, views, resolve(values.output), { renderer: values.renderer })).trim());
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

let invokedPath;
if (process.argv[1]) {
  try { invokedPath = await realpath(resolve(process.argv[1])); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`Topocode plugin spike: ${error.message}`);
    process.exitCode = 1;
  });
}
