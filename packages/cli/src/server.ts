import { createServer, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { isMissing, workspacePath } from "@topo/workspace";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function serveSite(root: string, port = 4173): Promise<{ server: Server; url: string }> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535");
  const index = await workspacePath(root, "cache/site/index.html");
  if (!(await stat(index)).isFile()) throw new Error("Site is not built; run topo scan first");
  const directory = await realpath(resolve(index, ".."));
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      const address = server.address();
      if (!address || typeof address === "string" || request.headers.host !== `127.0.0.1:${address.port}`) {
        response.writeHead(403).end("Invalid host");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.writeHead(405).end("Method not allowed");
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      } catch (error) {
        if (!(error instanceof URIError || error instanceof TypeError)) throw error;
        response.writeHead(400).end("Invalid request path");
        return;
      }
      if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((part) => part.startsWith("."))) {
        response.writeHead(403).end("Forbidden path");
        return;
      }
      const requested = resolve(directory, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!contained(directory, requested)) {
        response.writeHead(403).end("Forbidden path");
        return;
      }
      try {
        const file = await realpath(requested);
        if (!contained(directory, file)) {
          response.writeHead(403).end("Forbidden path");
          return;
        }
        if (!(await stat(file)).isFile()) {
          response.writeHead(404).end("Not found");
          return;
        }
        const content = await readFile(file);
        response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        response.setHeader("Content-Length", content.length);
        response.writeHead(200).end(request.method === "HEAD" ? undefined : content);
      } catch (error) {
        if (!isMissing(error)) throw error;
        response.writeHead(404).end("Not found");
      }
    })().catch((error: unknown) => {
      console.error("Topocode request failed:", error);
      if (!response.headersSent) response.writeHead(500).end("Unable to serve site");
      else response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind a TCP address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}
