import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  commit,
  startTopoServer,
  stopTopoServer,
  test,
  topo,
} from "./helpers/production-cli.js";

test("story preview renders the real Archify artifact without CSP errors", async ({
  page,
  repository,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${message.text()} (${message.location().url})`);
    }
  });

  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  await writeFile(
    join(repository, "package.json"),
    '{"name":"archify-story-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export function checkoutClient() { return 'checkout'; }",
      "export function paymentService() { return 'payment'; }",
      "",
    ].join("\n"),
  );
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");

  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/checkout.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    id: "checkout",
    title: "Checkout architecture",
    summary: "Checkout client reaches the payment service.",
    anchors: [
      { id: "client", path: "source.ts", symbol: "checkoutClient" },
      { id: "payment", path: "source.ts", symbol: "paymentService" },
    ],
    sections: [
      {
        id: "checkout-client",
        title: "Checkout client",
        body: "Starts the checkout flow.",
        anchorIds: ["client"],
      },
      {
        id: "payment-service",
        title: "Payment service",
        body: "Authorizes the payment.",
        anchorIds: ["payment"],
      },
    ],
    connections: [{
      from: "checkout-client",
      to: "payment-service",
      label: "authorize",
    }],
  }, null, 2)}\n`);
  await commit(repository, "Story", "stories/checkout.topo.json");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/checkout/`);
    const viewer = page.frameLocator("[data-story-viewer]");
    const diagram = viewer.locator("svg").first();
    await expect(diagram).toBeVisible();
    await expect(diagram.locator("text", { hasText: "Checkout client" })).toBeVisible();
    await expect(diagram.locator("text", { hasText: "Payment service" })).toBeVisible();
    await expect(diagram.locator("text", { hasText: "Legend" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Export diagram" })).toBeVisible();
    await expect(viewer.getByText("Present", { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("workflow story labels remain at least 12px after iframe and SVG scaling", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeFile(
    join(repository, "package.json"),
    '{"name":"workflow-story-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export function validateStory() { return 'valid'; }",
      "export function previewStory() { return 'preview'; }",
      "",
    ].join("\n"),
  );
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");

  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/workflow.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "workflow",
    id: "workflow",
    title: "Story authoring workflow",
    summary: "Validate and preview an authored story.",
    anchors: [
      { id: "validate", path: "source.ts", symbol: "validateStory" },
      { id: "preview", path: "source.ts", symbol: "previewStory" },
    ],
    sections: [
      {
        id: "validate",
        title: "Validate story",
        body: "Resolve source evidence.",
        anchorIds: ["validate"],
      },
      {
        id: "preview",
        title: "Preview story",
        body: "Render the validated story.",
        anchorIds: ["preview"],
      },
    ],
    connections: [{ from: "validate", to: "preview", label: "then" }],
  }, null, 2)}\n`);
  await commit(repository, "Story", "stories/workflow.topo.json");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/workflow/`);
    const labels = page.frameLocator("[data-story-viewer]")
      .locator("svg text[data-node-label]");
    await expect(labels).toHaveCount(2);
    const heights = await labels.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height)
    );

    expect(Math.min(...heights)).toBeGreaterThanOrEqual(12);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});
