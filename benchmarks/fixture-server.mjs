import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatedRoot, prepareFixtures } from "./prepare-fixtures.mjs";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(generatedRoot, relative);
  if (
    resolved !== generatedRoot &&
    !resolved.startsWith(`${generatedRoot}${path.sep}`)
  ) {
    return undefined;
  }
  return resolved;
}

export async function startFixtureServer(port = 4178, fixtureOptions = {}) {
  const fixtures = await prepareFixtures(fixtureOptions);
  const server = http.createServer(async (request, response) => {
    const requested = safePath(request.url ?? "/");
    if (!requested) {
      response.writeHead(400).end("Invalid path");
      return;
    }
    let filePath = requested;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
      await stat(filePath);
    } catch {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Type",
      MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    );
    createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, fixtures, port };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portArgument = process.argv.indexOf("--port");
  const port =
    portArgument >= 0 ? Number(process.argv[portArgument + 1]) : 4178;
  const { fixtures } = await startFixtureServer(port);
  process.stdout.write(
    `Fixture server listening at http://127.0.0.1:${port} for ${fixtures.map((fixture) => fixture.name).join(", ")}\n`,
  );
}
