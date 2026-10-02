import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readBaseline } from "../src/baseline.mjs";
import { readView, renderBook } from "../src/view.mjs";

if (!process.argv[2]) throw new Error("Supply the PR-Sniper adoption worktree path");
const root = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? "artifacts/final-consumer/pr-sniper-guide");
const baseline = await readBaseline(`${root}/.topo/cache/plugin-spike/baseline.json`);
const manifest = JSON.parse(await readFile(`${root}/.topo/cache/plugin-spike/meaningful-guide/manifest.json`, "utf8"));
const views = await Promise.all(manifest.pages.map(({ path }) => readView(resolve(root, path))));
const book = await renderBook(root, baseline, views, output, { renderer: "graphviz" });
console.log(`Book ready: ${book.views} chapters at ${output}`);
