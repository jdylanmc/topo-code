import { createHash } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { commit, test, topo } from "./helpers/production-cli.js";

const fixture = fileURLToPath(new URL("../../../../examples/rust-tauri/", import.meta.url));

async function mixed(repository: string) {
  await topo(repository, "init");
  await cp(fixture, repository, { recursive: true });
  await cp(join(fixture, "topo.config.json"), join(repository, ".topo/config.json"));
  await writeFile(join(repository, "package.json"), '{"name":"synthetic-snapshot","type":"module"}\n');
  await commit(repository, "Synthetic mixed source and persistent stories", "src", "src-tauri", "stories", "package.json", ".topo/config.json");
  await topo(repository, "story", "validate", repository, join(repository, "stories/snapshot.topo.json"));
  await topo(repository, "story", "preview", repository, join(repository, "stories/snapshot.topo.json"));
}

async function scanPartial(repository: string) {
  await expect(topo(repository, "scan", repository, "--allow-partial")).rejects.toMatchObject({
    code: 2, stdout: expect.stringContaining("PARTIAL PREVIEW:"),
  });
}

test("technical branches retain geometry, exact edge evidence, Home links and cache-rebuilt identity", async ({ page, repository, startSite }) => {
  await mixed(repository);
  await scanPartial(repository);
  const url = await startSite();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("[data-home-inventory] [data-story-id]")).toHaveCount(2);
  await page.goto(`${url}/stories/snapshot/?edge=1`);
  const frame = page.frameLocator("[data-story-viewer]");
  await expect(frame.locator("[data-node-id]")).toHaveCount(4);
  await expect(frame.locator("[data-edge-index]")).toHaveCount(3);
  await expect(frame.locator("#node1 polygon")).toHaveCount(1);
  await expect(frame.locator("#node2 path")).toHaveCount(2);
  await expect(page.locator('[data-edge-evidence="1"]')).toContainText('"ready".to_owned()');
  await expect(page.locator('[data-edge-evidence="1"]')).toContainText("source-traced: true");
  await frame.locator('[data-edge-index="2"]').press("Enter");
  await expect(page).toHaveURL(/edge=2/);
  await expect(page.locator('[data-edge-evidence="2"]')).toBeVisible();
  await expect(page.locator('[data-edge-evidence="1"]')).toBeHidden();
  const geometry = await frame.locator("svg").evaluate((svg) => {
    const texts = [...svg.querySelectorAll("text")].map((text) => {
      const box = text.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    const nodeElements = [...svg.querySelectorAll<SVGGElement>(".node")];
    const nodes = nodeElements.map((node) => node.getBoundingClientRect());
    let overlaps = 0;
    nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => {
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)) overlaps++;
    }));
    let intrusions = 0;
    for (const edge of svg.querySelectorAll<SVGGElement>(".edge")) {
      const path = edge.querySelector("path")!;
      const transform = path.getScreenCTM()!;
      const otherNodes = nodeElements.filter((node) =>
        node.dataset.nodeId !== edge.dataset.edgeFrom && node.dataset.nodeId !== edge.dataset.edgeTo);
      for (let sample = 0; sample <= 100; sample++) {
        const point = path.getPointAtLength(path.getTotalLength() * sample / 100).matrixTransform(transform);
        for (const node of otherNodes) {
          const box = node.getBoundingClientRect();
          if (point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom) intrusions++;
        }
      }
    }
    return { texts, overlaps, intrusions };
  });
  expect(geometry.texts.length).toBeGreaterThanOrEqual(7);
  expect(geometry.texts.every((text) => text.width > 0 && text.height >= 12)).toBe(true);
  expect(geometry.overlaps).toBe(0);
  expect(geometry.intrusions).toBe(0);
  const exportedSvg = page.waitForEvent("download");
  await frame.locator("#export-svg").click();
  const svgStream = await (await exportedSvg).createReadStream();
  if (!svgStream) throw new Error("Missing Graphviz export bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of svgStream) chunks.push(Buffer.from(chunk));
  const svgText = Buffer.concat(chunks).toString();
  expect(svgText).toContain('data-theme="dark"');
  expect(svgText).not.toContain("prefers-color-scheme");
  expect(svgText).toContain("rgb(");
  await page.goto(`${url}/stories/snapshot/?focus=choose`);
  await page.locator(".story-details > summary").click();
  await page.locator('[data-cross-story][data-source-node="choose"]').click();
  await expect(page).toHaveURL(/snapshot-overview.*focus=handler/);
  await page.locator(".story-details > summary").click();
  await page.locator("[data-return]").click();
  await expect(page).toHaveURL(/snapshot\/.*focus=choose/);
  const index = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
  expect(index.nodes.some((node: { kind: string }) => node.kind === "struct")).toBe(true);
  expect(index.relationships.some((edge: { kind: string }) => edge.kind === "tauri-command-binding")).toBe(true);
  const before = index.nodes.map((node: { id: string }) => node.id);
  await page.goto("about:blank");
  await rm(join(repository, ".topo/cache"), { recursive: true });
  await scanPartial(repository);
  const rebuilt = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
  expect(rebuilt.nodes.map((node: { id: string }) => node.id)).toEqual(before);
  await topo(repository, "bundle", repository, "--output", join(repository, ".topo/deploy"));
  for (const name of ["spec.dot", "validation.json", "evidence.json", "renderer.json"]) {
    expect((await readFile(join(repository, ".topo/deploy/stories/snapshot", name))).length).toBeGreaterThan(20);
  }
  expect(errors).toEqual([]);
});

async function exported(page: Page, format: string) {
  const download = page.waitForEvent("download");
  await page.frameLocator("[data-story-viewer]").locator("html").evaluate((_, format) => {
    const native = Reflect.get(window, "Archify");
    return native.exportMenu.run(format);
  }, format);
  const stream = await (await download).createReadStream();
  if (!stream) throw new Error("Missing native export bytes");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function svgPixels(page: Page, contents: string) {
  return page.evaluate(async (contents) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${contents}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels))].map((n) => n.toString(16).padStart(2, "0")).join("");
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) painted++;
    return { hash, painted };
  }, Buffer.from(contents).toString("base64"));
}

test("app theme survives native focus, media, storage, key, button and command changes; exports lock the chosen paint", async ({ page, repository, startSite }) => {
  await mixed(repository);
  const url = await startSite();
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("archify-theme", "light"));
  await page.goto(`${url}/stories/snapshot-overview/?focus=handler`);
  const frame = page.frameLocator("[data-story-viewer]");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = (await exported(page, "svg")).toString();
  expect(dark).toContain('data-theme="dark"');
  expect(dark).not.toContain("prefers-color-scheme");
  const underLightMedia = await svgPixels(page, dark);
  expect(underLightMedia.painted).toBeGreaterThan(100);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await svgPixels(page, dark)).toEqual(underLightMedia);
  await page.emulateMedia({ colorScheme: "light" });
  const png = await exported(page, "png");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const pixel = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(30, 30, 1, 1).data];
  }, png.toString("base64"));
  expect(pixel[3]).toBe(255);
  expect(Math.max(...pixel.slice(0, 3))).toBeLessThan(100);
  await frame.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  await frame.locator("body").press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await frame.locator("html").evaluate(() => Reflect.get(window, "Archify").theme.toggle());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = (await exported(page, "svg")).toString();
  expect(light).toContain('data-theme="light"');
  expect(light).not.toContain("prefers-color-scheme");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  expect(createHash("sha256").update(dark).digest("hex")).not.toBe(createHash("sha256").update(light).digest("hex"));
  await scanPartial(repository);
  await page.goto(url);
  await page.locator("[data-repository-home]").click();
  const repositoryFrame = page.locator("[data-repository-viewer]").contentFrame();
  await expect(repositoryFrame.locator("html")).toHaveAttribute("data-theme", "light");
  await repositoryFrame.locator("#btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(repositoryFrame.locator("html")).toHaveAttribute("data-theme", "dark");
  const index = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
  const rustFile = index.nodes.find((node: { path: string }) => node.path === "src-tauri/src/lib.rs");
  await page.goto(`${url}/?scope=${rustFile.id}`);
  await expect(repositoryFrame.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(repositoryFrame.locator("svg [data-node-id]")).not.toHaveCount(0);
});
