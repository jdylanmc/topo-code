import { once } from "node:events";
import { connect, type Socket } from "node:net";
import { expect } from "@playwright/test";
import {
  startStaticServer,
  stopStaticServer,
  test,
} from "./helpers/production-cli.js";

test("static fixture teardown closes an unused speculative TCP connection", async ({
  repository,
}) => {
  const { server, url } = await startStaticServer(repository);
  const accepted = new Promise<Socket>((resolve) => server.once("connection", resolve));
  const client = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
  let closing: Promise<void> | undefined;
  let requests = 0;
  server.on("request", () => { requests += 1; });
  try {
    const [connection] = await Promise.all([accepted, once(client, "connect")]);
    expect(requests).toBe(0);
    expect(connection.destroyed).toBe(false);

    closing = stopStaticServer(server);
    expect(connection.destroyed).toBe(true);
    await closing;
    expect(server.listening).toBe(false);
    expect(requests).toBe(0);
  } finally {
    client.destroy();
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (closing) await closing;
  }
});
