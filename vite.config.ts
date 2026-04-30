import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import chokidar, { type FSWatcher } from "chokidar";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse, serialize, type Board } from "./kanban";

const execFileP = promisify(execFile);
const CONFIG_DIR = path.join(os.homedir(), ".config", "canopy");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

type Theme = "light" | "dark" | "system";
type ConfigData = { theme: Theme };

let currentConfig: ConfigData = { theme: "system" };

async function loadConfig(): Promise<ConfigData> {
  const cfg: ConfigData = { theme: "system" };
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system") {
      cfg.theme = parsed.theme;
    }
  } catch {}
  return cfg;
}

async function saveConfig(cfg: ConfigData): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function getQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

function canopyPlugin(): Plugin {
  return {
    name: "canopy-api",
    async configureServer(server) {
      currentConfig = await loadConfig();

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();
        const pathname = url.split("?")[0];
        try {
          if (req.method === "GET" && pathname === "/api/config") {
            return send(res, 200, {
              theme: currentConfig.theme,
              platform: process.platform,
            });
          }

          if (req.method === "PUT" && pathname === "/api/config") {
            const body = await readBody(req);
            const patch = JSON.parse(body) as Partial<ConfigData>;
            const next: ConfigData = { ...currentConfig };

            if (typeof patch.theme === "string") {
              if (
                patch.theme !== "light" &&
                patch.theme !== "dark" &&
                patch.theme !== "system"
              ) {
                return send(res, 400, { error: "invalid theme" });
              }
              next.theme = patch.theme;
            }

            await saveConfig(next);
            currentConfig = next;
            return send(res, 200, { ok: true });
          }

          if (req.method === "POST" && pathname === "/api/pick-home") {
            if (process.platform !== "darwin") {
              return send(res, 501, { error: "macOS only" });
            }
            const script = `try
  set p to POSIX path of (choose file with prompt "보드 .md 파일을 선택하세요" of type {"md", "markdown", "public.text"})
  return p
on error number -128
  return ""
end try`;
            const { stdout } = await execFileP("osascript", ["-e", script]);
            const picked = stdout.trim();
            return send(res, 200, { homeFile: picked || null });
          }

          if (pathname === "/api/board") {
            const home = getQuery(url).get("home") || "";
            if (!home) return send(res, 400, { error: "home required" });
            if (!(await fileExists(home))) {
              return send(res, 404, { error: "not found" });
            }

            if (req.method === "GET") {
              const stat = await fs.stat(home);
              const md = await fs.readFile(home, "utf8");
              return send(res, 200, { board: parse(md), mtime: stat.mtimeMs });
            }

            if (req.method === "PUT") {
              const body = await readBody(req);
              const { board, mtime } = JSON.parse(body) as {
                board: Board;
                mtime: number;
              };
              const stat = await fs.stat(home);
              if (Math.abs(stat.mtimeMs - mtime) > 1) {
                return send(res, 409, {
                  error: "mtime mismatch",
                  mtime: stat.mtimeMs,
                });
              }
              await fs.writeFile(home, serialize(board), "utf8");
              const newStat = await fs.stat(home);
              return send(res, 200, { ok: true, mtime: newStat.mtimeMs });
            }
          }

          if (pathname === "/api/events" && req.method === "GET") {
            const home = getQuery(url).get("home") || "";
            res.statusCode = 200;
            res.setHeader("content-type", "text/event-stream");
            res.setHeader("cache-control", "no-cache");
            res.setHeader("connection", "keep-alive");
            res.write(": connected\n\n");
            let watcher: FSWatcher | null = null;
            if (home) {
              watcher = chokidar.watch(home, {
                ignoreInitial: true,
                persistent: true,
              });
              const onChange = () => {
                try {
                  res.write(`data: ${JSON.stringify({ changed: true })}\n\n`);
                } catch {}
              };
              watcher.on("change", onChange);
              watcher.on("add", onChange);
            }
            req.on("close", () => {
              watcher?.close().catch(() => {});
            });
            return;
          }

          return send(res, 404, { error: "not found" });
        } catch (err) {
          return send(res, 500, { error: String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), canopyPlugin()],
  server: { port: 22667, strictPort: true },
});
