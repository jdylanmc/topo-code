import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const root = await realpath(resolve(process.argv[2] ?? "artifacts"));
const port = Number(process.argv[3] ?? "0");
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid local preview port");
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const rel = relative(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) ||
        await realpath(path) !== path || !(await lstat(path)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const bytes = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(bytes);
  } catch (error) {
    if (error.code === "ENOENT") response.writeHead(404).end("Not found");
    else {
      console.error(error.message);
      response.writeHead(500).end("Preview read failed");
    }
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ root, url: `http://127.0.0.1:${server.address().port}`, pid: process.pid }));
});
function stop() {
  server.close();
  server.closeAllConnections();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
