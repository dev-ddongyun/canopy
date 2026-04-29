import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board";
import "./styles.css";

type Theme = "light" | "dark" | "system";

export type Config = {
  homeFile: string;
  home: string;
  theme: Theme;
  platform: string;
  exists: boolean;
};

function getPath(): string {
  return decodeURIComponent(window.location.pathname);
}

function navigate(to: string) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

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

function EmptyState({
  config,
  onPick,
  onSetTheme,
}: {
  config: Config;
  onPick: () => Promise<void>;
  onSetTheme: (t: Theme) => Promise<void>;
}) {
  return (
    <div className="empty-state">
      <h1>canopy</h1>
      <p className="muted">홈 보드로 사용할 .md 파일을 선택하세요.</p>
      <button onClick={onPick} disabled={config.platform !== "darwin"}>
        파일 선택
      </button>
      {config.platform !== "darwin" && (
        <p className="muted small">
          네이티브 파일 다이얼로그는 macOS에서만 지원됩니다.
        </p>
      )}
      {config.homeFile && !config.exists && (
        <p className="error inline">
          이전 파일을 찾을 수 없습니다: <code>{config.homeFile}</code>
        </p>
      )}
      <div className="theme-row">
        {(["light", "dark", "system"] as Theme[]).map((t) => (
          <button
            key={t}
            className={`theme-opt${config.theme === t ? " active" : ""}`}
            onClick={() => onSetTheme(t)}
          >
            {t === "light" ? "라이트" : t === "dark" ? "다크" : "시스템"}
          </button>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [path, setPath] = useState(getPath());
  const [config, setConfig] = useState<Config | null>(null);

  const reloadConfig = useCallback(async () => {
    const r = await fetch("/api/config");
    const d: Config = await r.json();
    setConfig(d);
    applyTheme(d.theme);
    return d;
  }, []);

  const updateConfig = useCallback(
    async (patch: { homeFile?: string; theme?: Theme }) => {
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
    await updateConfig({ homeFile: d.homeFile });
  }, [updateConfig]);

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
    const onPop = () => setPath(getPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!config || config.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [config]);

  if (!config) return <div className="loading">로딩중…</div>;

  if (!config.homeFile || !config.exists) {
    return (
      <EmptyState config={config} onPick={pickFile} onSetTheme={setTheme} />
    );
  }

  const name =
    path === "/" || path === "" ? config.home : path.replace(/^\/+/, "");
  const isHome = name === config.home;
  return (
    <Board
      name={name}
      isHome={isHome}
      config={config}
      onNavigate={navigate}
      onPickFile={pickFile}
      onSetTheme={setTheme}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
