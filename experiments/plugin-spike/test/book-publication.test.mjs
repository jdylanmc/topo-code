import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { scanBaseline } from "../src/baseline.mjs";
import { CONTRACT_VERSION } from "../src/contract.mjs";
import { renderBook } from "../src/view.mjs";
import { renderFlow } from "../src/flow-renderer.mjs";
import { repository } from "./helpers.mjs";

async function existingBook(context) {
  const root = await repository(context, {
    "Cargo.toml": '[package]\nname="book_fixture"\nversion="0.1.0"\nedition="2021"\n',
    "src/lib.rs": "pub struct Snapshot;\n",
  });
  const baseline = await scanBaseline(root);
  const entity = baseline.entities.find((item) => item.name === "Snapshot");
  const views = ["first", "second"].map((id) => ({
    schemaVersion: CONTRACT_VERSION, baselineId: baseline.id, id, title: `${id} chapter`,
    summary: "Original source-backed chapter.",
    sections: [{ id: "snapshot", title: "Snapshot", body: "The captured Rust declaration.", entityIds: [entity.id] }],
    connections: [],
  }));
  const output = join(root, ".topo/cache/book");
  await renderBook(root, baseline, views, output, { renderer: "graphviz" });
  const before = await artifacts(output);
  assert.equal(before.length, 12, "Two complete five-file chapter sets, index and book metadata");
  return { root, baseline, views, output, before, entity };
}

async function artifacts(directory) {
  return Promise.all((await readdir(directory)).sort().map(async (name) => ({
    name, bytes: await readFile(join(directory, name)),
  })));
}

async function assertUnchanged(fixture) {
  const current = await artifacts(fixture.output);
  assert.deepEqual(current.map(({ name }) => name), fixture.before.map(({ name }) => name));
  for (const [index, file] of current.entries()) {
    assert.ok(file.bytes.equals(fixture.before[index].bytes), `Previous bytes must survive: ${file.name}`);
  }
}

test("a second-chapter renderer failure leaves every prior book artifact byte-identical", async (context) => {
  const fixture = await existingBook(context);
  const updated = structuredClone(fixture.views);
  updated[0].summary = "A changed first chapter must not publish before later rendering succeeds.";
  const rendered = [];
  await assert.rejects(renderBook(fixture.root, fixture.baseline, updated, fixture.output, {
    renderer: "graphviz",
    renderArtifact: async (view) => {
      rendered.push(view.id);
      if (view.id === "second") throw new Error("Injected second-chapter rendering failure");
      return renderFlow(view);
    },
  }), /Injected second-chapter rendering failure/);
  assert.deepEqual(rendered, ["first", "second"]);
  await assertUnchanged(fixture);
});

test("late book metadata publication failure rolls back all chapters, companions and index", async (context) => {
  const fixture = await existingBook(context);
  const updated = fixture.views.map((view) => ({ ...view, title: `Updated ${view.title}`, summary: "New generation." }));
  const committed = [];
  await assert.rejects(renderBook(fixture.root, fixture.baseline, updated, fixture.output, {
    renderer: "graphviz",
    publication: {
      renameFile: async (from, to) => {
        if (basename(to) === "book.json") throw new Error("Injected late book publication failure");
        await rename(from, to);
        committed.push(basename(to));
      },
    },
  }), /Injected late book publication failure/);
  assert.equal(committed.length, 11);
  assert.ok(committed.includes("second.html.receipt.json"));
  assert.ok(committed.includes("index.html"));
  await assertUnchanged(fixture);
});

test("reserved index chapter ID is rejected before replacing any existing two-chapter book artifact", async (context) => {
  const fixture = await existingBook(context);
  const updated = [
    { ...fixture.views[0], title: "Changed first chapter" },
    { ...fixture.views[1], id: "index" },
  ];
  await assert.rejects(renderBook(fixture.root, fixture.baseline, updated, fixture.output,
    { renderer: "graphviz" }), /reserved.*index|index.*reserved/i);
  await assertUnchanged(fixture);
});
