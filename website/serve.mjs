import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { basePath, root } from "./build.mjs";

const base = basePath(process.env.SITE_BASE_PATH);
const port = Number(process.env.PORT ?? 4188);
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (base !== "/" && pathname === base.slice(0, -1)) {
      response.writeHead(302, { Location: base });
      response.end();
      return;
    }
    let directory = path.join(root, "dist/public-site");
    let relative;
    if (pathname.startsWith(base)) relative = pathname.slice(base.length);
    else if (process.env.WEBSITE_TEST_ROOT === "1") {
      directory = path.join(root, "dist/public-site-root");
      relative = pathname.slice(1);
    } else {
      response.writeHead(404).end("Not found");
      return;
    }
    let file = path.resolve(directory, relative);
    if (!file.startsWith(`${directory}${path.sep}`) && file !== directory) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    response.writeHead(200, { "Content-Type": `${mime[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(await readFile(file));
  } catch (error) {
    if (error.code === "ENOENT") response.writeHead(404).end("Not found");
    else {
      console.error("Website preview request failed:", error);
      response.writeHead(500).end("Website preview failed; see server output");
    }
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Website: http://127.0.0.1:${server.address().port}${base}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
});
