import test from "node:test";
import assert from "node:assert/strict";
import { validateViewEvidence } from "../src/view.mjs";
import { viewPage } from "../src/view-page.mjs";
import { baselineDigest } from "../src/baseline.mjs";
import { CONTRACT_VERSION, hash, sourceLocation } from "../src/contract.mjs";

function fixture() {
  const contents = "fn main() {\n    run();\n}\n";
  const files = [{ path: "src/main.rs", contents, sha256: hash(contents) }];
  const source = { path: files[0].path, sha256: files[0].sha256, startLine: 2, endLine: 2, excerpt: "    run();" };
  const baseline = {
    entities: [
      { id: "main", kind: "function", location: sourceLocation("src/main.rs", 1, 3) },
      { id: "run", kind: "function", location: sourceLocation("src/main.rs", 2) },
    ], relationships: [], source: { files },
  };
  baseline.id = baselineDigest(baseline);
  const view = {
    schemaVersion: CONTRACT_VERSION, baselineId: baseline.id, id: "startup", title: "Startup",
    summary: "The actual Rust entry calls the native host.",
    sections: [
      { id: "entry", title: "main()", body: "Native entry.", entityIds: ["main"], evidence: [source] },
      { id: "host", title: "run()", body: "The called host.", entityIds: ["run"], kind: "step" },
    ],
    connections: [{ from: "entry", to: "host", label: "calls", classification: "source-traced",
      relationshipIds: [], rationale: "Direct call in the entry body; not a compiler-extracted edge.", evidence: [source] }],
  };
  return { baseline, view, files };
}

test("agent source traces verify exact code without pretending to be analyzer relationships", () => {
  const { baseline, view, files } = fixture();
  validateViewEvidence(baseline, view, files);
  const wrong = structuredClone(view);
  wrong.connections[0].evidence[0].excerpt = "    fabricated();";
  assert.throws(() => validateViewEvidence(baseline, wrong, files), /excerpt does not match/);
  wrong.connections[0].evidence[0].sha256 = "0".repeat(64);
  assert.throws(() => validateViewEvidence(baseline, wrong, files), /not bound/);
});

test("source trace validation rejects changed, absent, or incorrectly ranged evidence", () => {
  const { baseline, view, files } = fixture();
  assert.throws(() => validateViewEvidence(baseline, view, [{ ...files[0], contents: "changed" }]), /evidence changed/);
  view.connections[0].evidence[0].endLine = 99;
  assert.throws(() => validateViewEvidence(baseline, view, files), /excerpt does not match/);
  view.connections[0].evidence = [];
  assert.throws(() => validateViewEvidence(baseline, view, files), /nonempty/);
  view.connections[0].relationshipIds = ["pretend-compiler-edge"];
  assert.throws(() => validateViewEvidence(baseline, view, files));
});

test("technical workbench renders navigation, full explanations, exact excerpts and provenance distinctions", () => {
  const { baseline, view } = fixture();
  baseline.repository = { revision: "a".repeat(40), dirty: false };
  baseline.coverage = { status: "partial", byPlugin: {}, unsupportedLanguages: [] };
  const evidence = {
    sections: view.sections.map((section) => ({ ...section, sources: section.evidence ?? [] })),
    connections: view.connections.map((connection) => ({ ...connection,
      fromTitle: "main()", toTitle: "run()", relationships: [] })),
  };
  const html = viewPage(view, baseline, evidence, "startup.native.html", [
    { id: "startup", title: "Startup" }, { id: "review", title: "Review" },
  ]);
  assert.match(html, /aria-label="PR-Sniper diagrams"/);
  assert.match(html, /href="\.\/review.html"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Agent source trace - exact code checked/);
  assert.match(html, /run\(\);/);
  assert.match(html, /focusSection/);
  assert.throws(() => viewPage(view, baseline, evidence, "native.html", [{ id: "../escape", title: "No" }]), /Invalid chapter ID/);
});
