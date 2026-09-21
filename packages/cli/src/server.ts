import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertGraphDocument, type GraphDocument } from "@topo/schema";
import { isMissing, loadConfig, workspacePath } from "@topo/workspace";
import {
  augmentSiteBundle,
  buildCuratedViews,
  CuratedViewConflictError,
  CuratedViewMetadataError,
  graphFromSiteBundle,
  parseSaveCuratedViewRequest,
  saveCuratedView,
  serializeCuratedViewsSnapshot,
} from "./views.js";

const MAX_SAVE_BODY = 1024 * 1024;
const STORY_VIEWER_PATH = /^\/stories\/[^/]+\/viewer\.html$/;

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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeTokenEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function inlineScriptHashes(content: Buffer): string[] {
  const html = content.toString("utf8");
  const hashes: string[] = [];
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    if (/\bsrc\s*=/i.test(match[1] ?? "")) continue;
    hashes.push(
      `'sha256-${createHash("sha256").update(match[2] ?? "").digest("base64")}'`,
    );
  }
  return hashes;
}

function contentSecurityPolicy(
  pathname: string,
  content?: Buffer,
): string {
  const storyViewer = STORY_VIEWER_PATH.test(pathname);
  const scriptSources = storyViewer && content !== undefined
    ? ["'self'", ...inlineScriptHashes(content)].join(" ")
    : "'self'";
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${storyViewer ? " blob:" : ""}`,
    ...(storyViewer ? ["font-src 'self' data:"] : []),
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    `frame-ancestors ${storyViewer ? "'self'" : "'none'"}`,
    "base-uri 'none'",
  ].join("; ");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const length = request.headers["content-length"];
  if (length !== undefined) {
    if (!/^\d+$/.test(length)) throw new HttpError(400, "Invalid Content-Length");
    if (Number(length) > MAX_SAVE_BODY) throw new HttpError(413, "Request body is too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    size += chunk.length;
    if (size > MAX_SAVE_BODY) throw new HttpError(413, "Request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function parseSiteData(content: Buffer): unknown {
  try {
    return JSON.parse(content.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Generated site data.json is invalid JSON", { cause: error });
  }
}

function hasGraph(input: unknown): boolean {
  return typeof input === "object" && input !== null && !Array.isArray(input) && "graph" in input;
}

async function editingGraph(root: string, input: unknown): Promise<GraphDocument | undefined> {
  if (!hasGraph(input)) return undefined;
  const graph = graphFromSiteBundle(input);
  let config;
  try {
    config = await loadConfig(root);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (config.repositoryId !== graph.repository.id) {
    throw new Error("Graph repository identity differs from .topo/config.json");
  }
  return graph;
}

export async function composeSiteData(
  root: string,
  input: unknown,
): Promise<string | undefined> {
  const graph = await editingGraph(root, input);
  if (!graph) return undefined;
  assertGraphDocument(graph);
  return augmentSiteBundle(
    input,
    (await buildCuratedViews(root, graph)).snapshot,
  );
}

export async function serveSite(root: string, port = 4173): Promise<{ server: Server; url: string }> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer from 0 to 65535");
  const index = await workspacePath(root, "cache/site/index.html");
  if (!(await stat(index)).isFile()) throw new Error("Site is not built; run topo scan first");
  const directory = await realpath(resolve(index, ".."));
  const dataPath = resolve(directory, "data.json");
  const viewsToken = randomBytes(32).toString("base64url");
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Cache-Control", "no-store");
      const address = server.address();
      const expectedHost = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
      if (!expectedHost || request.headers.host !== expectedHost) {
        throw new HttpError(403, "Invalid host");
      }

      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      } catch (error) {
        if (!(error instanceof URIError || error instanceof TypeError)) throw error;
        throw new HttpError(400, "Invalid request path");
      }
      response.setHeader("Content-Security-Policy", contentSecurityPolicy(pathname));

      if (
        request.method === "POST" &&
        ["/__topo/views", "/explorer/__topo/views"].includes(pathname)
      ) {
        const expectedOrigin = `http://${expectedHost}`;
        if (request.headers.origin !== expectedOrigin) throw new HttpError(403, "Invalid origin");
        if (!safeTokenEqual(
          typeof request.headers["x-topo-views-token"] === "string"
            ? request.headers["x-topo-views-token"]
            : undefined,
          viewsToken,
        )) {
          throw new HttpError(403, "Invalid views capability");
        }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) {
          throw new HttpError(400, "Content-Type must be application/json");
        }
        const requestValue = await readJsonBody(request);
        let saveRequest;
        try {
          saveRequest = parseSaveCuratedViewRequest(requestValue);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error));
        }
        try {
          const snapshot = await saveCuratedView(root, saveRequest, async () => {
            const data = parseSiteData(await readFile(dataPath));
            const graph = await editingGraph(root, data);
            if (!graph) throw new HttpError(403, "Curated view editing is unavailable");
            return graph;
          });
          const body = serializeCuratedViewsSnapshot(snapshot);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Content-Length", Buffer.byteLength(body));
          response.writeHead(200).end(body);
          return;
        } catch (error) {
          if (error instanceof CuratedViewConflictError) throw new HttpError(409, error.message);
          if (error instanceof CuratedViewMetadataError) throw new HttpError(400, error.message);
          if (error instanceof HttpError) throw error;
          if (
            error instanceof SyntaxError ||
            error instanceof TypeError ||
            (error instanceof Error && error.name.endsWith("ValidationError"))
          ) {
            throw new HttpError(400, error.message);
          }
          throw error;
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        throw new HttpError(405, "Method not allowed");
      }
      if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((part) => part.startsWith("."))) {
        throw new HttpError(403, "Forbidden path");
      }
      const requestedPath = pathname === "/explorer/data.json"
        ? "/data.json"
        : pathname === "/"
        ? "/index.html"
        : pathname.endsWith("/")
          ? `${pathname}index.html`
          : pathname;
      const requested = resolve(directory, `.${requestedPath}`);
      if (!contained(directory, requested)) throw new HttpError(403, "Forbidden path");

      try {
        const file = await realpath(requested);
        if (!contained(directory, file)) throw new HttpError(403, "Forbidden path");
        if (!(await stat(file)).isFile()) throw new HttpError(404, "Not found");
        let content = await readFile(file);
        if (file === dataPath) {
          const data = parseSiteData(content);
          const composed = await composeSiteData(root, data);
          if (composed !== undefined) {
            content = Buffer.from(composed);
            const origin = request.headers.origin;
            if (origin === undefined || origin === `http://${expectedHost}`) {
              response.setHeader("X-Topo-Views-Token", viewsToken);
            }
          }
        }
        if (STORY_VIEWER_PATH.test(pathname)) {
          response.setHeader(
            "Content-Security-Policy",
            contentSecurityPolicy(pathname, content),
          );
        }
        response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        response.setHeader("Content-Length", content.length);
        response.writeHead(200).end(request.method === "HEAD" ? undefined : content);
      } catch (error) {
        if (!isMissing(error)) throw error;
        throw new HttpError(404, "Not found");
      }
    })().catch((error: unknown) => {
      if (error instanceof HttpError) {
        if (!response.headersSent) response.writeHead(error.status).end(error.message);
        else response.destroy();
        return;
      }
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
