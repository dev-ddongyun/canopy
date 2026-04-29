import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import chokidar, { type FSWatcher } from "chokidar";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse, serialize, isKanbanFile, type Board } from "./kanban";

const execFileP = promisify(execFile);
const CONFIG_DIR = path.join(os.homedir(), ".config", "canopy");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

type Theme = "light" | "dark" | "system";
type ConfigData = { homeFile: string; theme: Theme };

let currentConfig: ConfigData = { homeFile: "", theme: "system" };

async function loadConfig(): Promise<ConfigData> {
  const cfg: ConfigData = { homeFile: "", theme: "system" };
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.homeFile === "string") cfg.homeFile = parsed.homeFile;
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

function getVault(): string {
  return currentConfig.homeFile ? path.dirname(currentConfig.homeFile) : "";
}

function getHomeName(): string {
  if (!currentConfig.homeFile) return "";
  return path.basename(currentConfig.homeFile, ".md");
}

async function listKanbanBoards(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listKanbanBoards(full, base)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      try {
        const head = await fs.readFile(full, "utf8");
        if (isKanbanFile(head)) {
          out.push(path.relative(base, full).replace(/\.md$/, ""));
        }
      } catch {}
    }
  }
  return out;
}

async function findBoardFile(name: string): Promise<string | null> {
  const vault = getVault();
  if (!vault) return null;
  const safe = name.replace(/\.\./g, "").replace(/^\/+/, "");
  const direct = path.join(vault, safe + ".md");
  if (await fileExists(direct)) return direct;

  const all = await listKanbanBoards(vault);
  const exact = all.find((b) => b === safe);
  if (exact) return path.join(vault, exact + ".md");
  const base = path.basename(safe);
  const byBase = all.find((b) => path.basename(b) === base);
  if (byBase) return path.join(vault, byBase + ".md");
  return null;
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

function canopyPlugin(): Plugin {
  const sseClients = new Set<ServerResponse>();
  let watcher: FSWatcher | null = null;

  const startWatcher = (vault: string) => {
    if (watcher) {
      watcher.close().catch(() => {});
      watcher = null;
    }
    if (!vault) return;
    watcher = chokidar.watch(vault, {
      ignored: /(^|[\\/])\../,
      ignoreInitial: true,
      persistent: true,
      depth: 99,
    });
    const onChange = (full: string) => {
      if (!full.endsWith(".md")) return;
      const name = path.relative(vault, full).replace(/\.md$/, "");
      const payload = `data: ${JSON.stringify({ name })}\n\n`;
      for (const c of sseClients) {
        try {
          c.write(payload);
        } catch {}
      }
    };
    watcher.on("change", onChange);
    watcher.on("add", onChange);
    watcher.on("unlink", onChange);
  };

  return {
    name: "canopy-api",
    async configureServer(server) {
      currentConfig = await loadConfig();
      if (getVault()) startWatcher(getVault());

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/")) return next();
        try {
          if (req.method === "GET" && url === "/api/config") {
            return send(res, 200, {
              homeFile: currentConfig.homeFile,
              home: getHomeName(),
              theme: currentConfig.theme,
              platform: process.platform,
              exists: currentConfig.homeFile
                ? await fileExists(currentConfig.homeFile)
                : false,
            });
          }

          if (req.method === "POST" && url === "/api/pick-home") {
            if (process.platform !== "darwin") {
              return send(res, 501, { error: "macOS only" });
            }
            const script = `try
  set p to POSIX path of (choose file with prompt "홈 보드 .md 파일을 선택하세요" of type {"md", "markdown", "public.text"})
  return p
on error number -128
  return ""
end try`;
            const { stdout } = await execFileP("osascript", ["-e", script]);
            const picked = stdout.trim();
            return send(res, 200, { homeFile: picked || null });
          }

          if (req.method === "PUT" && url === "/api/config") {
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

            if (typeof patch.homeFile === "string") {
              if (!(await fileExists(patch.homeFile))) {
                return send(res, 400, { error: "file not found" });
              }
              if (!patch.homeFile.endsWith(".md")) {
                return send(res, 400, { error: ".md 파일이어야 합니다" });
              }
              next.homeFile = patch.homeFile;
            }

            await saveConfig(next);
            const oldVault = getVault();
            currentConfig = next;
            const newVault = getVault();
            if (newVault !== oldVault) startWatcher(newVault);
            return send(res, 200, { ok: true });
          }

          if (url === "/api/events" && req.method === "GET") {
            res.statusCode = 200;
            res.setHeader("content-type", "text/event-stream");
            res.setHeader("cache-control", "no-cache");
            res.setHeader("connection", "keep-alive");
            res.write(": connected\n\n");
            sseClients.add(res);
            req.on("close", () => sseClients.delete(res));
            return;
          }

          const m = /^\/api\/board\/(.+)$/.exec(url.split("?")[0]);
          if (m) {
            const name = decodeURIComponent(m[1]);
            const file = await findBoardFile(name);
            if (!file) return send(res, 404, { error: "not found" });

            if (req.method === "GET") {
              const stat = await fs.stat(file);
              const md = await fs.readFile(file, "utf8");
              return send(res, 200, { board: parse(md), mtime: stat.mtimeMs });
            }

            if (req.method === "PUT") {
              const body = await readBody(req);
              const { board, mtime } = JSON.parse(body) as {
                board: Board;
                mtime: number;
              };
              const stat = await fs.stat(file);
              if (Math.abs(stat.mtimeMs - mtime) > 1) {
                return send(res, 409, {
                  error: "mtime mismatch",
                  mtime: stat.mtimeMs,
                });
              }
              await fs.writeFile(file, serialize(board), "utf8");
              const newStat = await fs.stat(file);
              return send(res, 200, { ok: true, mtime: newStat.mtimeMs });
            }
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
