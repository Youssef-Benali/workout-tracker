"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

function createStaticServer() {
  return http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://localhost");
      let pathname;
      try {
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Bad request");
        return;
      }
      if (pathname === "/" || pathname === "") {
        pathname = "/index.html";
      }
      const resolved = path.resolve(ROOT, `.${pathname}`);
      if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }
      fs.readFile(resolved, (error, content) => {
        if (error) {
          response.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          });
          response.end("Not found");
          return;
        }
        const extension = path.extname(resolved).toLowerCase();
        response.writeHead(200, {
          "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
          "Cache-Control": "no-store",
          "Service-Worker-Allowed": "/"
        });
        response.end(content);
      });
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
    }
  });
}

async function startServer() {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

module.exports = { startServer, ROOT };

if (require.main === module) {
  startServer()
    .then(({ baseUrl }) => {
      // eslint-disable-next-line no-console
      console.log(`Serving ${ROOT} at ${baseUrl}`);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exitCode = 1;
    });
}
