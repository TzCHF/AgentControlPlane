import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.ACP_HARNESS_PORT ?? 4320);
const fixtureRoot = path.resolve("tests", "fixtures", "companion-harness");
const sourceRoot = path.resolve("browser-companion", "src");

function contentType(target) {
  if (target.endsWith(".html")) return "text/html; charset=utf-8";
  if (target.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function safeFile(root, relative) {
  const target = path.resolve(root, relative);
  const relation = path.relative(root, target);
  return relation.startsWith("..") || path.isAbsolute(relation) ? null : target;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  const target = url.pathname.startsWith("/src/")
    ? safeFile(sourceRoot, url.pathname.slice(5))
    : safeFile(
        fixtureRoot,
        url.pathname === "/" ? "index.html" : url.pathname.slice(1),
      );
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const body = fs.readFileSync(target);
  response.writeHead(200, {
    "content-type": contentType(target),
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
});

server.listen(port, host, () => {
  console.log(`Companion harness listening on http://${host}:${port}`);
});
