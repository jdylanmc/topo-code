import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { commit, test, topo } from "./helpers/production-cli.js";

const ids = ["1-start", "src/api.ts", "\u5165\u53e3", "normal-slug"];
const nativeId = (id: string, renderer: string) =>
  renderer === "graphviz" || /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)
    ? id : `component_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;

async function navigationFixture(repository: string, renderer: "archify" | "graphviz") {
  await topo(repository, "init");
  await mkdir(join(repository, "stories"), { recursive: true });
  for (const id of ["origin", "child"]) {
    await writeFile(join(repository, `stories/${id}.topo.json`), JSON.stringify({
      schemaVersion: "1.0", id, title: id, summary: "Navigation contract fixture.",
      classification: "capability-demo", diagramFamily: renderer === "graphviz" ? "workflow" : "architecture",
      renderer, anchors: [],
      ...(id === "child" ? { parent: { storyId: "origin", nodeId: "normal-slug" } } : {}),
      sections: ids.map((nodeId, index) => ({
        id: nodeId, title: `Section ${index + 1}`, body: `Evidence for ${nodeId}`, anchorIds: [],
        ...(id === "origin" ? { drilldown: { storyId: "child", nodeId: ids[(index + 1) % ids.length] } } : {}),
      })),
      connections: [],
    }));
  }
  await commit(repository, "Navigation fixture", "stories");
  await topo(repository, "preview", repository, join(repository, "stories/origin.topo.json"));
}

for (const renderer of ["archify", "graphviz"] as const) {
  test(`${renderer}: authored IDs survive plain/wrapped activation, explicit targets and reload`, async ({
    page, repository, startSite,
  }) => {
    await navigationFixture(repository, renderer);
    const url = await startSite();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const plain of [false, true]) {
      for (const [index, id] of ids.entries()) {
        const target = ids[(index + 1) % ids.length]!;
        const native = nativeId(id, renderer);
        const destinationNative = nativeId(target, renderer);
        await page.goto(`${url}/stories/origin/${plain ? "viewer.html" : ""}`);
        const node = plain
          ? page.locator(`svg [data-node-id="${native}"]`)
          : page.frameLocator("[data-story-viewer]").locator(`svg [data-node-id="${native}"]`);
        if (index % 2 === 0) await node.click();
        else await node.press(index === 1 ? "Enter" : " ");
        await expect(page.locator("body")).toHaveAttribute("data-story-id", "child");
        expect(new URL(page.url()).searchParams.get("focus")).toBe(target);
        expect(new URL(page.url()).searchParams.get("fromFocus")).toBe(id);
        await expect(page.locator("[data-story-viewer]")).toHaveAttribute("src", `viewer.html#focus=${encodeURIComponent(destinationNative)}`);
        await expect(page.frameLocator("[data-story-viewer]").locator(`svg [data-node-id="${destinationNative}"]`)).toBeVisible();
        await expect(page.locator(`a[data-node-id="${target}"]`)).toHaveAttribute("aria-current", "true");
        await page.reload();
        await expect(page.locator("[data-story-viewer]")).toHaveAttribute("src", `viewer.html#focus=${encodeURIComponent(destinationNative)}`);
        await page.locator("[data-return]").click();
        await expect(page.locator("body")).toHaveAttribute("data-story-id", "origin");
        expect(new URL(page.url()).searchParams.get("focus")).toBe(id);
        await expect(page.locator(`a[data-node-id="${id}"]`)).toHaveAttribute("aria-current", "true");
        await page.reload();
        await expect(page.frameLocator("[data-story-viewer]").locator(`svg [data-node-id="${native}"]`)).toBeVisible();
        await expect(page.locator("body")).toHaveAttribute("data-story-id", "origin");

        // A direct plain viewer accepts authored fragment IDs before native startup.
        await page.goto(`${url}/stories/origin/viewer.html#focus=${encodeURIComponent(id)}`);
        await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("focus")).toBe(native);
        await expect(page.locator(`svg [data-node-id="${native}"]`)).toBeVisible();
        await page.reload();
        await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("focus")).toBe(native);
      }
    }
    expect(errors).toEqual([]);
  });
}

test("return context accepts only catalogue story/node identities and preserves legacy URLs", async ({
  page, repository, startSite,
}) => {
  await navigationFixture(repository, "archify");
  const url = await startSite();
  for (const callers of [
    "not-json",
    JSON.stringify([{ storyId: "https://example.invalid", nodeId: "normal-slug" }]),
    JSON.stringify([{ storyId: "origin", nodeId: "missing" }]),
    JSON.stringify([{ storyId: "origin", nodeId: "normal-slug", url: "https://example.invalid" }]),
  ]) {
    await page.goto(`${url}/stories/child/?callers=${encodeURIComponent(callers)}`);
    await expect(page.locator("[data-return]")).toBeVisible();
    const target = new URL((await page.locator("[data-return]").getAttribute("href"))!);
    expect(target.origin).toBe(url);
    expect(target.pathname).toBe("/stories/origin/");
    expect(target.searchParams.get("focus")).toBe("normal-slug");
    expect(target.searchParams.get("callers")).toBe("[]");
  }
  await page.goto(`${url}/stories/child/?from=origin&fromFocus=1-start`);
  await page.reload();
  await page.locator("[data-return]").click();
  expect(new URL(page.url()).searchParams.get("focus")).toBe("1-start");
  await expect(page.locator("body")).toHaveAttribute("data-story-id", "origin");
});
