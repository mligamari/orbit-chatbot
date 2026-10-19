// Local development server: serves public/ and routes /api/chat to the same
// handler Vercel runs. Reads GROQ_API_KEY / GROQ_MODEL from the environment or
// from .env.local. Not used in production.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT) || 3000;

const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/chat") return chatHandler(req, res);

    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    try {
      const data = await readFile(file);
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  })
  .listen(port, () => {
    console.log(`Orbit running at http://localhost:${port}`);
    if (!process.env.GROQ_API_KEY) console.log("Note: GROQ_API_KEY is not set, so chat requests will return an error.");
  });
