// Experimental wrapper; not product code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, generated, upstream, topoRevision as revision, verifyUpstream } from './paths.mjs';

verifyUpstream();
const cli = path.join(upstream, 'archify/bin/archify.mjs');
const repo = path.resolve(process.env.TOPO_REPO || path.join(root, '../..'));
const specs = path.join(generated, 'specs');
const site = path.join(generated, 'site/pr-34');
const evidence = path.join(generated, 'evidence');
for (const directory of [specs, site, evidence]) fs.mkdirSync(directory, { recursive: true });
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
function sourceBlob(file) {
  const result = spawnSync('git', ['-C', repo, 'show', `${revision}:${file}`], { encoding: 'buffer' });
  assert.equal(result.status, 0, `Cannot read pinned evidence: ${file}`);
  return result.stdout;
}
const results = [];
const startedAt = new Date().toISOString();
function invoke(name, args, expected = 0) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  const record = { name, args, status: result.status, milliseconds: performance.now() - start,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  json(path.join(evidence, `${name}-${Date.now()}.json`), record);
  results.push({ name, status: result.status, milliseconds: record.milliseconds });
  assert.equal(result.error, undefined, `${name}: ${result.error}`);
  assert.equal(result.status, expected, `${name}: ${result.stdout}\n${result.stderr}`);
  return record;
}
const source = (file, symbol, line, end) => ({
  path: file, symbol, line, end_line: end,
});
const main = source('packages/cli/src/main.ts', 'runCli', 61, 142);
const pipeline = source('packages/cli/src/pipeline.ts', 'generateArtifacts', 133, 170);
const load = source('packages/site/src/load.ts', 'loadArtifacts', 187, 225);
const records = [
  ['cli', 'CLI', 'Local scan command', main],
  ['scanner', 'Scanner', 'Resolve source imports', source('packages/scanner/src/typescript-scanner.ts', 'scanRepository')],
  ['graph', 'Graph', 'Validate stable identities', source('packages/schema/src/model.ts', 'GraphDocument')],
  ['modules', 'Modules', 'Optional derived attributes', source('packages/modules/src/modules.ts', 'composeModules')],
  ['layout', 'Layout', 'Derive and place entities', source('packages/graph/src/layout.ts', 'layoutGraphWithArchitecture')],
  ['views', 'Views + reports', 'Add authored view context', pipeline],
  ['bundle', 'Site bundle', 'Publish data.json', source('packages/cli/src/site-bundle.ts', 'serializeSiteBundle')],
  ['browser', 'Browser', 'Validate and display map', load],
];
const canonicalIds = Object.fromEntries(records.map(([id]) => [id, `topo:explanation:scan-to-site:${id}`]));
const archifyId = id => `n_${hash(canonicalIds[id]).slice(0, 16)}`;
const coordinates = [[40,80],[300,80],[560,80],[820,80],[820,310],[560,310],[300,310],[40,310]];
const nodes = records.map(([id,label,sublabel,ref], index) => ({
  id: archifyId(id), type: id === 'browser' ? 'frontend' : 'backend', label, sublabel,
  pos: coordinates[index], size: [160,80],
  sources: [{ path: ref.path, ...(ref.line ? { line: ref.line, end_line: ref.end_line } : {}) }],
}));
const links = [
  ['cli','scanner','scan'], ['scanner','graph','facts'], ['graph','modules','compose'],
  ['modules','layout','derive'], ['layout','views','prepare'], ['views','bundle','serialize'],
  ['bundle','browser','load'],
];
const overview = {
  schema_version: 1, diagram_type: 'architecture',
  meta: {
    title: 'Topo: source to architectural map', quality_profile: 'showcase', locale: 'en',
    repository: { url: 'https://github.com/jdylanmc/topo-code', revision },
    views: [
      { id: 'source-facts', label: 'Source facts', focus: ['cli','scanner','graph','modules'].map(archifyId),
        note: 'Source-backed implementation summary; this is not a runtime trace.' },
      { id: 'publish-and-read', label: 'Publish and read', focus: ['layout','views','bundle','browser'].map(archifyId),
        note: 'Derived layout, curated views and reports feed the browser snapshot.' },
    ],
  },
  components: nodes,
  connections: links.map(([from,to,label]) => ({ id: `e_${from}_${to}`, from: archifyId(from), to: archifyId(to), label,
    ...(from === 'modules' ? { labelAt: [900,174] } : {}) })),
};
const mapping = {
  schemaVersion: 'experimental-1', revision, description: 'Agent-authored abstraction, not complete scan or execution trace.',
  nodes: records.map(([id,, ,ref]) => ({
    canonicalId: canonicalIds[id], diagramId: archifyId(id), sourceEntityId: `path:${ref.path}`,
    anchor: { path: ref.path, symbol: ref.symbol }, interpretation: 'inferred',
    blobHash: hash(sourceBlob(ref.path)),
  })),
  edges: links.map(([from,to]) => ({ diagramId: `e_${from}_${to}`, interpretation: 'inferred',
    evidencePaths: [...new Set([records.find(record => record[0] === from)[3].path, pipeline.path, records.find(record => record[0] === to)[3].path])] })),
};
function workflow(title, steps, laneLabel, note) {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title, locale: 'en', quality_profile: 'showcase' },
    lanes: [{ id: 'flow', label: laneLabel }], mainPath: steps.map(([id]) => id),
    nodes: steps.map(([id,label,sublabel], col) => ({ id, label, sublabel, col, lane: 'flow', type: 'backend', width: 145 })),
    edges: steps.slice(1).map(([to], index) => ({ id: `step_${index}`, from: steps[index][0], to })),
    cards: [{ dot: 'slate', title: 'Scope and evidence', items: [note] }],
  };
}
const generation = workflow('Generation: preserve intent, publish a snapshot', [
  ['lock','Lock workspace','Check repository identity'],
  ['compose','Compose','Enabled modules only'],
  ['layout','Layout','Use previous layout + pins'],
  ['context','Context','Reports, views, commentary'],
  ['publish','Publish','Write generated artifacts'],
], 'generateArtifacts', 'Source: packages/cli/src/pipeline.ts, generateArtifacts. Simplified success path; not a claim of multi-file transactional publication.');
const loading = workflow('Browser: validate before rendering', [
  ['fetch','Fetch','GET ./data.json'],
  ['envelope','Envelope','Check required fields'],
  ['graph','Graph','Parse + check modules'],
  ['layout','Layout','Validate against graph'],
  ['context','Context','Architecture + views'],
], 'loadArtifacts', 'Source: packages/site/src/load.ts. Initial validation path only; enrichment handling and final map rendering are outside this view.');

json(path.join(specs, 'overview.json'), overview);
json(path.join(specs, 'generation.json'), generation);
json(path.join(specs, 'loading.json'), loading);
json(path.join(site, 'mapping.json'), mapping);
// Reconstruct the pre-correction input; the original failure receipt is preserved separately.
const initialLayout = structuredClone(overview);
delete initialLayout.connections.find(connection => connection.id === 'e_modules_layout').labelAt;
json(path.join(specs, 'initial-layout.json'), initialLayout);
invoke('initial-layout', ['deliver', 'architecture', path.join(specs, 'initial-layout.json'),
  path.join(site, 'initial-layout.artifact.html'), '--repo-root', repo, '--quality', 'showcase', '--json'], 1);
const deliver = (name, spec, out = name) => invoke(name, ['deliver', spec.diagram_type,
  path.join(specs, `${name}.json`), path.join(site, `${out}.artifact.html`),
  '--quality', 'showcase', '--json', ...(spec.meta.repository ? ['--repo-root', repo] : [])]);
for (const [name,spec] of [['overview',overview],['generation',generation],['loading',loading]]) deliver(name,spec);
const first = hash(fs.readFileSync(path.join(site,'overview.artifact.html')));
deliver('overview', overview);
assert.equal(hash(fs.readFileSync(path.join(site,'overview.artifact.html'))), first, 'Identical frozen input must reproduce bytes');
results.push({ name: 'byte-reproducibility', passed: true, sha256: first });

const malformed = structuredClone(overview);
malformed.components[0].id = 'path:invalid/id';
json(path.join(specs,'invalid.json'), malformed);
invoke('invalid-diagram', ['deliver','architecture',path.join(specs,'invalid.json'),path.join(site,'overview.artifact.html'),'--repo-root',repo,'--quality','showcase','--json'], 1);
assert.equal(hash(fs.readFileSync(path.join(site,'overview.artifact.html'))), first);
const missing = structuredClone(overview);
missing.components[0].sources = [{ path: 'does-not-exist.ts' }];
json(path.join(specs,'missing-source.json'), missing);
invoke('missing-source', ['deliver','architecture',path.join(specs,'missing-source.json'),path.join(site,'overview.artifact.html'),'--repo-root',repo,'--quality','showcase','--json'], 1);
assert.equal(hash(fs.readFileSync(path.join(site,'overview.artifact.html'))), first);
const missingEdge = structuredClone(overview);
missingEdge.connections[0].to = 'not_a_node';
json(path.join(specs,'missing-endpoint.json'), missingEdge);
invoke('missing-endpoint', ['validate','architecture',path.join(specs,'missing-endpoint.json'),'--repo-root',repo,'--quality','showcase','--json'],1);

function checkFreshness(manifest, expectedRevision) {
  if (manifest.revision !== expectedRevision) throw new Error('TOPO_STALE: explanation revision differs from requested source revision');
  for (const node of manifest.nodes) {
    const result = spawnSync('git', ['-C',repo,'show',`${expectedRevision}:${node.anchor.path}`], { encoding: 'buffer' });
    if (result.status !== 0) throw new Error(`TOPO_SOURCE_MISSING: ${node.anchor.path}`);
    if (hash(result.stdout) !== node.blobHash) throw new Error(`TOPO_STALE: evidence hash differs for ${node.anchor.path}`);
  }
}
checkFreshness(mapping, revision);
assert.throws(() => checkFreshness(mapping, '0'.repeat(40)), /TOPO_STALE/);
const staleHash = structuredClone(mapping);
staleHash.nodes[0].blobHash = '0'.repeat(64);
assert.throws(() => checkFreshness(staleHash, revision), /TOPO_STALE/);
results.push({ name: 'wrapper-freshness', passed: true, scope: 'revision + referenced Git blob hashes only; not semantic completeness or working-tree changes' });
invoke('native-historical-evidence-valid', ['validate','architecture',path.join(specs,'overview.json'),'--repo-root',repo,'--quality','showcase','--json']);
const nodeLink = structuredClone(overview);
nodeLink.components[0].href = 'generation.html';
json(path.join(specs,'node-link.json'), nodeLink);
invoke('native-node-hyperlink-unsupported', ['validate','architecture',path.join(specs,'node-link.json'),'--repo-root',repo,'--quality','showcase','--json'],1);

const base = {
  schema_version: 1, diagram_type: 'architecture',
  meta: { title: 'Synthetic PR: validated publication', quality_profile: 'showcase', locale: 'en' },
  components: [
    { id:'agent', type:'backend', label:'Agent', sublabel:'Authors explanation', pos:[40,170], size:[150,80] },
    { id:'render', type:'backend', label:'Renderer', sublabel:'Compiles diagram', pos:[310,170], size:[150,80] },
    { id:'publish', type:'frontend', label:'Preview', sublabel:'Unvalidated output', pos:[850,170], size:[150,80] },
  ],
  connections: [{ id:'author_render',from:'agent',to:'render',label:'specification' },{ id:'publish_direct',from:'render',to:'publish',label:'HTML' }],
};
const head = structuredClone(base);
head.components.splice(2,0,{ id:'gate',type:'security',label:'Validation',sublabel:'Reject invalid artifacts',pos:[580,170],size:[150,80] });
head.components.find(node=>node.id==='publish').sublabel='Last-good output';
head.connections.splice(1,1,{ id:'render_gate',from:'render',to:'gate',label:'candidate' },{ id:'gate_publish',from:'gate',to:'publish',label:'accepted' });
const moved = structuredClone(base);
moved.components[0].pos[1] += 120;
for (const [name,spec] of [['base',base],['head',head],['moved',moved]]) json(path.join(specs,`${name}.json`),spec);
deliver('head',head);
for (const [name,target] of [['delta','head'],['movement','moved']]) {
  invoke(name,['compare','architecture',path.join(specs,'base.json'),path.join(specs,`${target}.json`),path.join(site,`${name}.artifact.html`),'--quality','showcase','--json']);
}
const delta = JSON.parse(fs.readFileSync(path.join(site,'delta.artifact.receipt.json'),'utf8'));
assert.equal(delta.summary.components.added,1);
assert.equal(delta.summary.components.changed,1);
assert.equal(delta.summary.connections.added,2);
assert.equal(delta.summary.connections.removed,1);
assert.equal(delta.summary.components.moved,0);
const movement = JSON.parse(fs.readFileSync(path.join(site,'movement.artifact.receipt.json'),'utf8'));
assert.equal(movement.summary.components.moved,1);
assert.equal(movement.summary.components.changed,0);
assert.equal(movement.changes.connections.length,0);
results.push({name:'delta-classification',passed:true,delta:delta.summary,movement:movement.summary});
const pages = [['overview','System overview'],['generation','Artifact generation'],['loading','Browser loading'],['head','Synthetic PR: proposed system'],['delta','Synthetic PR: architectural delta']];
for (const [name,title] of pages) {
  const nav = pages.map(([id,label])=>`<a href="${id}.html"${id===name?' aria-current="page"':''}>${label}</a>`).join('\n');
  const detailSource = name === 'generation' ? pipeline : name === 'loading' ? load : null;
  const sourceLink = detailSource ? ` | <a href="https://github.com/jdylanmc/topo-code/blob/${revision}/${detailSource.path}#L${detailSource.line}-L${detailSource.end_line}">Read supporting source</a>` : '';
  fs.writeFileSync(path.join(site,`${name}.html`),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Topo POC - ${title}</title><style>body{margin:0;font:15px system-ui;background:#101820;color:#fff}header{padding:12px 20px}nav{display:flex;flex-wrap:wrap;gap:18px}a{color:#8fd9ff}a[aria-current]{color:white;font-weight:bold}iframe{border:0;width:100%;height:calc(100vh - 160px);background:white}p{margin:8px 0;font-size:13px}</style><header><nav aria-label="Architecture documentation">${nav}</nav><p>EXPERIMENTAL - agent-authored explanation; not a complete code review. PR example is synthetic.</p><p><a href="${name}.artifact.html">Open standalone diagram</a> | <a href="mapping.json">Source mapping (overview)</a>${sourceLink}</p></header><iframe title="${title}" src="${name}.artifact.html"></iframe></html>`);
}
fs.copyFileSync(path.join(site,'overview.html'),path.join(site,'index.html'));
json(path.join(evidence,'results.json'), { startedAt, finishedAt:new Date().toISOString(), node:process.version, archifyRevision:'d673e8300df60a5c8166abe78787fdc78f6b8000', topoRevision:revision, results });
console.log(JSON.stringify(results,null,2));
