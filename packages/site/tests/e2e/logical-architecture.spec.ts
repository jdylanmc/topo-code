import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { commit, test, topo } from "./helpers/production-cli.js";

async function dragLogicalNode(
  page: Page,
  id: string,
  deltaX: number,
  deltaY: number,
  release = true,
) {
  const before = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const node = before.nodes.find((item) => item.id === id)!;
  const canvas = await page.locator("canvas.topo-webgl").boundingBox();
  const x = canvas!.x + before.viewTransform.x + (node.x + node.width / 2) * before.viewTransform.scale;
  const y = canvas!.y + before.viewTransform.y + (node.y + node.height / 2) * before.viewTransform.scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  const during = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  if (release) await page.mouse.up();
  return { before, during };
}

function expectContained(
  boundary: { x: number; y: number; width: number; height: number },
  member: { x: number; y: number; width: number; height: number },
): void {
  expect(member.x).toBeGreaterThan(boundary.x);
  expect(member.y).toBeGreaterThan(boundary.y);
  expect(member.x + member.width).toBeLessThan(boundary.x + boundary.width);
  expect(member.y + member.height).toBeLessThan(boundary.y + boundary.height);
}

test("production CLI serves the responsibility-first logical architecture workflow", async ({
  page,
  repository,
  startSite,
}) => {
  await mkdir(join(repository, "src"));
  await writeFile(join(repository, "package.json"), '{"name":"logical-fixture","type":"module"}\n');
  await writeFile(join(repository, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
    include: ["src"],
  }));
  await writeFile(join(repository, "src/contracts.ts"), `
    export interface Store { read(): string }
    export class MemoryStore implements Store { read(): string { return "value"; } }
    export function createStore(): Store { return new MemoryStore(); }
  `);
  await writeFile(join(repository, "src/app.ts"), `
    import { createStore, type Store } from "./contracts.js";
    export function run(store: Store = createStore()): string { return store.read(); }
  `);
  await writeFile(join(repository, "responsibilities.json"), JSON.stringify({
    schemaVersion: "1.0",
    responsibilities: [
      {
        id: "storage",
        name: "Storage",
        purpose: "Owns the storage contract and implementation.",
        entities: [
          { path: "src/contracts.ts", symbol: "Store" },
          { path: "src/contracts.ts", symbol: "MemoryStore" },
          { path: "src/contracts.ts", symbol: "createStore" },
        ],
      },
      {
        id: "application",
        name: "Application",
        purpose: "Runs the application workflow.",
        entities: [{ path: "src/app.ts", symbol: "run" }],
      },
    ],
  }));
  await commit(repository, "Logical architecture fixture", "package.json", "tsconfig.json", "src", "responsibilities.json");
  const result = await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  expect(result.stderr).toBe("");

  const url = await startSite();
  await page.goto(`${url}/explorer/`);
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
  await expect(page.getByText("Responsibilities: proposed")).toBeVisible();
  await expect(page.locator('[data-status="scope"]')).toContainText("2 responsibilities");
  await expect(page.locator('.webgl-a11y [data-entity-id="storage"]')).toContainText("Store");

  for (const style of ["curved", "straight"] as const) {
    await page.getByLabel("Relationship edge style").selectOption(style);
    const { before, during } = await dragLogicalNode(page, "storage", 45, 25, false);
    const target = during.nodes.find((node) => node.id === "storage")!;
    const beforeEdge = before.edges.find((edge) => edge.targetId === "storage")!;
    const edge = during.edges.find((item) => item.targetId === "storage")!;
    const end = edge.points.at(-1)!;
    const beforeEnd = beforeEdge.points.at(-1)!;
    expect(edge.points).toHaveLength(style === "curved" ? 4 : 2);
    expect(Math.hypot(end.x - beforeEnd.x, end.y - beforeEnd.y)).toBeGreaterThan(5);
    expect(
      Math.abs(end.x - target.x) < 0.01 ||
      Math.abs(end.x - (target.x + target.width)) < 0.01 ||
      Math.abs(end.y - target.y) < 0.01 ||
      Math.abs(end.y - (target.y + target.height)) < 0.01,
    ).toBe(true);
    await page.mouse.up();
  }

  await page.locator('.webgl-a11y [data-entity-id="storage"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-details="selection"]')).toContainText("Owns the storage contract");
  await expect(page.locator('[data-details="selection"]')).toContainText("MemoryStore, Store, createStore");
  await page.getByRole("button", { name: "Expand here" }).click();
  await expect(page.locator('.webgl-a11y [data-entity-id^="semantic:"]')).toHaveCount(3);
  await page.waitForTimeout(350);
  const expanded = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const storageBoundary = expanded.nodes.find((node) => node.id === "storage")!;
  const storageMembers = expanded.nodes.filter((node) => node.id.startsWith("semantic:"));
  expect(storageMembers).toHaveLength(3);
  for (const member of storageMembers) expectContained(storageBoundary, member);

  const memberId = storageMembers[0]!.id;
  const escaped = await dragLogicalNode(page, memberId, 2_000, 2_000, false);
  const escapedBoundary = escaped.during.nodes.find((node) => node.id === "storage")!;
  const escapedMember = escaped.during.nodes.find((node) => node.id === memberId)!;
  expectContained(escapedBoundary, escapedMember);
  await page.mouse.up();
  const memberOffset = {
    x: escapedMember.x - escapedBoundary.x,
    y: escapedMember.y - escapedBoundary.y,
  };

  const movedParent = await dragLogicalNode(page, "storage", 60, 35, false);
  const movingBoundary = movedParent.during.nodes.find((node) => node.id === "storage")!;
  const movingMember = movedParent.during.nodes.find((node) => node.id === memberId)!;
  expect(movingMember.x - movingBoundary.x).toBeCloseTo(memberOffset.x, 4);
  expect(movingMember.y - movingBoundary.y).toBeCloseTo(memberOffset.y, 4);
  expectContained(movingBoundary, movingMember);
  await page.mouse.up();

  await page.getByRole("button", { name: "Collapse" }).click();
  await expect(page.locator('.webgl-a11y [data-entity-id^="semantic:"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Expand here" }).click();
  await page.waitForTimeout(350);
  const reexpanded = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const reexpandedBoundary = reexpanded.nodes.find((node) => node.id === "storage")!;
  const reexpandedMember = reexpanded.nodes.find((node) => node.id === memberId)!;
  expect(reexpandedMember.x - reexpandedBoundary.x).toBeCloseTo(memberOffset.x, 4);
  expect(reexpandedMember.y - reexpandedBoundary.y).toBeCloseTo(memberOffset.y, 4);
  expectContained(reexpandedBoundary, reexpandedMember);

  await page.getByRole("button", { name: "Drill in" }).click();
  await expect(page.locator('[data-status="scope"]')).toContainText("Drilled into Storage");
  await page.getByRole("button", { name: /Store, interface/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-details="selection"]')).toContainText("method read");
  const impactUpdates = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().edgeGeometryUpdates);
  await page.getByRole("button", { name: "What depends on this?" }).click();
  await expect(page.locator('[data-details="selection"]')).toContainText("Direct static potential impact");
  await expect(page.locator('[data-details="selection"]')).toContainText("type-use:");
  expect(await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().edgeGeometryUpdates))
    .toBeGreaterThan(impactUpdates);

  const drilledMove = await dragLogicalNode(page, memberId, -90, 70);
  const drilledPosition = drilledMove.during.nodes.find((node) => node.id === memberId)!;

  await page.getByRole("button", { name: "Back to overview" }).click();
  const overviewAfterDrill = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const overviewBoundary = overviewAfterDrill.nodes.find((node) => node.id === "storage")!;
  const overviewMember = overviewAfterDrill.nodes.find((node) => node.id === memberId)!;
  expect(overviewMember.x - overviewBoundary.x).toBeCloseTo(memberOffset.x, 4);
  expect(overviewMember.y - overviewBoundary.y).toBeCloseTo(memberOffset.y, 4);
  expect(overviewMember).not.toMatchObject({ x: drilledPosition.x, y: drilledPosition.y });
  expect(Object.keys(overviewAfterDrill.positions)).toEqual(expect.arrayContaining([
    "overview:responsibility:storage",
    `overview:member:storage:${memberId}`,
    `drill:storage:${memberId}`,
  ]));
  const persistedBoundary = { x: overviewBoundary.x, y: overviewBoundary.y };
  const persisted = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("topocode:logical-positions:")));
  expect(persisted).toBe(true);

  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  await page.locator('.webgl-a11y [data-entity-id="storage"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Expand here" }).click();
  await page.waitForTimeout(350);
  const reloaded = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const reloadedBoundary = reloaded.nodes.find((node) => node.id === "storage")!;
  const reloadedMember = reloaded.nodes.find((node) => node.id === memberId)!;
  expect(reloadedBoundary).toMatchObject(persistedBoundary);
  expect(reloadedMember.x - reloadedBoundary.x).toBeCloseTo(memberOffset.x, 4);
  expect(reloadedMember.y - reloadedBoundary.y).toBeCloseTo(memberOffset.y, 4);
  expectContained(reloadedBoundary, reloadedMember);

  await page.getByRole("button", { name: "Reset positions" }).click();
  expect(await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().positions)).toEqual({});

  await page.getByRole("button", { name: "Source map" }).click();
  await page.waitForLoadState();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.getByRole("button", { name: "Logical architecture" })).toBeVisible();
  await expect(page.locator('[data-status="architecture"]')).toContainText("Architecture:");
});

test("logical mode preserves partial-scan warnings and coverage", async ({
  page,
  repository,
  startSite,
}) => {
  await writeFile(join(repository, "package.json"), '{"name":"partial-logical","type":"module"}\n');
  await writeFile(join(repository, "index.ts"), 'import "./missing.js";\nexport function run(): void {}\n');
  await writeFile(join(repository, "responsibilities.json"), JSON.stringify({
    schemaVersion: "1.0",
    responsibilities: [{
      id: "application",
      name: "Application",
      purpose: "Runs the application.",
      entities: [{ path: "index.ts", symbol: "run" }],
    }],
  }));
  await commit(repository, "Partial logical fixture", "package.json", "index.ts", "responsibilities.json");
  await expect(topo(repository, "scan", ".", "--allow-partial", "--responsibilities", "responsibilities.json"))
    .rejects.toMatchObject({ code: 2 });
  const url = await startSite();
  await page.goto(`${url}/explorer/`);
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.getByText("Non-authoritative logical architecture.")).toBeVisible();
  const logical = await page.evaluate(async () => (await fetch("./data.json")).json());
  expect(logical.logicalArchitecture.coverage.completeSourceInventory).toBe(false);
});

test("logical positions ignore incompatible revision and grouping namespaces", async ({
  page,
  repository,
  startSite,
}) => {
  await writeFile(join(repository, "package.json"), '{"name":"position-scope","type":"module"}\n');
  await writeFile(join(repository, "index.ts"), `
    export function first(): number { return 1; }
    export function second(): number { return 2; }
  `);
  const grouping = (purpose: string, includeSecond: boolean) => JSON.stringify({
    schemaVersion: "1.0",
    responsibilities: [{
      id: "application",
      name: "Application",
      purpose,
      entities: [
        { path: "index.ts", symbol: "first" },
        ...(includeSecond ? [{ path: "index.ts", symbol: "second" }] : []),
      ],
    }],
  });
  await writeFile(join(repository, "responsibilities.json"), grouping("Owns the first contract.", false));
  await commit(repository, "Position namespace fixture", "package.json", "index.ts", "responsibilities.json");
  await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  const url = await startSite();
  await page.goto(`${url}/explorer/`);
  await page.evaluate(() => window.__TOPO_READY__);
  const firstDocument = await page.evaluate(async () => (await fetch("./data.json")).json());
  const firstNamespace = firstDocument.logicalArchitecture.positionNamespaceId;
  await dragLogicalNode(page, "application", 80, 45);
  const firstPosition = await page.evaluate(() =>
    window.__TOPO_LOGICAL__!.snapshot().positions["overview:responsibility:application"]);
  expect(firstPosition).toBeDefined();

  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  expect(await page.evaluate(() =>
    window.__TOPO_LOGICAL__!.snapshot().positions["overview:responsibility:application"]))
    .toEqual(firstPosition);

  await writeFile(join(repository, "responsibilities.json"), grouping("Owns both contracts.", true));
  await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  const groupedDocument = await page.evaluate(async () => (await fetch("./data.json")).json());
  expect(groupedDocument.logicalArchitecture.snapshotId)
    .toBe(firstDocument.logicalArchitecture.snapshotId);
  expect(groupedDocument.logicalArchitecture.positionNamespaceId).not.toBe(firstNamespace);
  expect(await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().positions)).toEqual({});

  await commit(repository, "Change grouping revision", "responsibilities.json");
  await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  const revisedDocument = await page.evaluate(async () => (await fetch("./data.json")).json());
  expect(revisedDocument.logicalArchitecture.snapshotId)
    .toBe(groupedDocument.logicalArchitecture.snapshotId);
  expect(revisedDocument.logicalArchitecture.positionNamespaceId)
    .not.toBe(groupedDocument.logicalArchitecture.positionNamespaceId);

  await writeFile(join(repository, "index.ts"), `
    export function first(): number { return 10; }
    export function second(): number { return 2; }
  `);
  await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  const dirtyDocument = await page.evaluate(async () => (await fetch("./data.json")).json());
  expect(dirtyDocument.logicalArchitecture.snapshotId)
    .not.toBe(revisedDocument.logicalArchitecture.snapshotId);
  expect(dirtyDocument.logicalArchitecture.positionNamespaceId)
    .not.toBe(revisedDocument.logicalArchitecture.positionNamespaceId);
});
