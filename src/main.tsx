import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Board, Header } from "./Board";
import "./styles.css";

type Theme = "light" | "dark" | "system";

export type Config = {
  theme: Theme;
  platform: string;
};

const TAIL_SEGMENTS = 3;

function shortenPath(p: string): string {
  const stripped = p.replace(/\.md$/, "");
  const segs = stripped.split("/").filter(Boolean);
  if (segs.length <= TAIL_SEGMENTS) return stripped;
  return "…/" + segs.slice(-TAIL_SEGMENTS).join("/");
}

const HOME_KEY = "canopy:homeFile";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  let resolved = theme;
  if (theme === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  root.dataset.theme = resolved;
}

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [homeFile, setHomeFile] = useState<string>(
    () => sessionStorage.getItem(HOME_KEY) || "",
  );

  const reloadConfig = useCallback(async () => {
    const r = await fetch("/api/config");
    const d: Config = await r.json();
    setConfig(d);
    applyTheme(d.theme);
  }, []);

  const updateConfig = useCallback(
    async (patch: { theme?: Theme }) => {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `error ${r.status}`);
      await reloadConfig();
    },
    [reloadConfig],
  );

  const pickFile = useCallback(async () => {
    const r = await fetch("/api/pick-home", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `error ${r.status}`);
    if (!d.homeFile) return;
    sessionStorage.setItem(HOME_KEY, d.homeFile);
    setHomeFile(d.homeFile);
  }, []);

  const setTheme = useCallback(
    async (theme: Theme) => {
      applyTheme(theme);
      await updateConfig({ theme });
    },
    [updateConfig],
  );

  useEffect(() => {
    reloadConfig();
  }, [reloadConfig]);

  useEffect(() => {
    if (!config || config.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [config]);

  if (!config) return <div className="loading">로딩중…</div>;

  if (!homeFile) {
    return (
      <div className="board">
        <Header
          homeFile={homeFile}
          config={config}
          onPickFile={() => {
            pickFile().catch(() => {});
          }}
          onSetTheme={setTheme}
        />
        <div className="empty-pick">
          <button
            onClick={() => {
              pickFile().catch(() => {});
            }}
            disabled={config.platform !== "darwin"}
          >
            파일 선택
          </button>
        </div>
      </div>
    );
  }

  return (
    <Board
      title={shortenPath(homeFile)}
      config={config}
      homeFile={homeFile}
      onPickFile={pickFile}
      onSetTheme={setTheme}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
