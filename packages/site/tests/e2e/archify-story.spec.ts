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
