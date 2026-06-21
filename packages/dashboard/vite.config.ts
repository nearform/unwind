import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

/**
 * The dashboard reads the rebuild graph produced by build-graph.mjs:
 *   <project>/docs/unwind/rebuild-graph.json
 *
 * Point the dev server at a project with UNWIND_GRAPH_DIR (the directory that
 * CONTAINS docs/unwind), or run from inside the project. Resolution order:
 *   1. $UNWIND_GRAPH_DIR/docs/unwind/rebuild-graph.json
 *   2. <cwd>/docs/unwind/rebuild-graph.json
 *   3. <cwd up to repo root>/docs/unwind/rebuild-graph.json (walk up a few)
 *   4. packages/dashboard/public/rebuild-graph.json (bundled sample / build)
 */
const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

function graphCandidates(): string[] {
  const dir = process.env.UNWIND_GRAPH_DIR;
  const out: string[] = [];
  if (dir) out.push(path.resolve(dir, "docs/unwind/rebuild-graph.json"));
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    out.push(path.resolve(cur, "docs/unwind/rebuild-graph.json"));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  out.push(path.resolve(__dirname, "public/rebuild-graph.json"));
  return out;
}

function findGraphFile(): string | null {
  return graphCandidates().find((c) => fs.existsSync(c)) ?? null;
}

function projectRootFromGraph(graphFile: string): string {
  // .../docs/unwind/rebuild-graph.json -> project root is three dirs up.
  return path.dirname(path.dirname(path.dirname(graphFile)));
}

function send(res: import("node:http").ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readSourceFile(url: URL) {
  const requested = url.searchParams.get("path") ?? "";
  if (!requested || requested.includes("\0") || path.isAbsolute(requested)) {
    return { code: 400, body: { error: "Invalid path" } };
  }
  const norm = path.normalize(requested);
  if (norm === "." || norm === ".." || norm.startsWith(`..${path.sep}`)) {
    return { code: 400, body: { error: "Path escapes project" } };
  }
  const graphFile = findGraphFile();
  if (!graphFile) return { code: 404, body: { error: "No rebuild-graph.json found" } };
  const root = projectRootFromGraph(graphFile);
  const abs = path.resolve(root, norm);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return { code: 400, body: { error: "Path escapes project" } };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { code: 404, body: { error: "File not found" } };
  }
  if (!stat.isFile()) return { code: 400, body: { error: "Not a file" } };
  if (stat.size > MAX_SOURCE_FILE_BYTES) return { code: 413, body: { error: "Too large" } };
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return { code: 415, body: { error: "Binary file" } };
  const content = buf.toString("utf8");
  return {
    code: 200,
    body: {
      path: rel.split(path.sep).join("/"),
      content,
      lineCount: content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length,
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "../core/dist"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          if (id.includes("node_modules/elkjs/")) return "elk";
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "serve-rebuild-graph",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const g = findGraphFile();
          console.log(
            `\n  Unwind dashboard — graph source: ${g ?? "(none found; run build-graph.mjs)"}\n`,
          );
        });
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1:5174");
          if (url.pathname === "/rebuild-graph.json") {
            const g = findGraphFile();
            if (!g) {
              send(res, 404, { error: "No rebuild-graph.json found. Run build-graph.mjs first." });
              return;
            }
            try {
              const raw = fs.readFileSync(g, "utf8");
              res.setHeader("Content-Type", "application/json");
              res.end(raw);
            } catch (err) {
              send(res, 500, { error: `Failed to read graph: ${String(err)}` });
            }
            return;
          }
          if (url.pathname === "/file-content.json") {
            const r = readSourceFile(url);
            send(res, r.code, r.body);
            return;
          }
          next();
        });
      },
    },
  ],
});
