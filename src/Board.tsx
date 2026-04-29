import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Board as BoardData, Card } from "../kanban";
import type { Config } from "./main";

const LINK_RE = /^\[\[([^\]]+)\]\]$/;

function displayText(text: string): string {
  const m = LINK_RE.exec(text);
  if (!m) return text;
  const inner = m[1];
  const pipeIdx = inner.indexOf("|");
  if (pipeIdx >= 0) return inner.slice(pipeIdx + 1);
  const slashIdx = inner.lastIndexOf("/");
  return slashIdx >= 0 ? inner.slice(slashIdx + 1) : inner;
}

type Theme = "light" | "dark" | "system";

type Props = {
  name: string;
  isHome?: boolean;
  config: Config;
  onNavigate: (to: string) => void;
  onPickFile: () => Promise<void>;
  onSetTheme: (t: Theme) => Promise<void>;
};

function themeIcon(t: Theme): string {
  return t === "light" ? "☀" : t === "dark" ? "☾" : "◐";
}

function ThemeMenu({
  current,
  onPick,
}: {
  current: Theme;
  onPick: (t: Theme) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const opts: { v: Theme; label: string }[] = [
    { v: "light", label: "라이트" },
    { v: "dark", label: "다크" },
    { v: "system", label: "시스템" },
  ];

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className="icon-btn"
        title="테마"
        onClick={() => setOpen((o) => !o)}
      >
        {themeIcon(current)}
      </button>
      {open && (
        <div className="menu">
          {opts.map((o) => (
            <button
              key={o.v}
              className={`menu-item${current === o.v ? " active" : ""}`}
              onClick={() => {
                onPick(o.v);
                setOpen(false);
              }}
            >
              <span className="menu-icon">{themeIcon(o.v)}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type DragInfo = { col: number; idx: number } | null;
type DropTarget = { col: number; idx: number } | null;

export function Board({
  name,
  isHome,
  config,
  onNavigate,
  onPickFile,
  onSetTheme,
}: Props) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [mtime, setMtime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragInfo>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/board/${encodeURIComponent(name)}`);
    if (!r.ok) {
      setError(`로드 실패 ${r.status}`);
      return;
    }
    const d = await r.json();
    setBoard(d.board);
    setMtime(d.mtime);
    setError(null);
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      try {
        const { name: changed } = JSON.parse(e.data);
        if (changed === name) load();
      } catch {}
    };
    return () => es.close();
  }, [name, load]);

  const save = async (next: BoardData) => {
    const prev = board;
    const prevMtime = mtime;
    setBoard(next);
    const r = await fetch(`/api/board/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board: next, mtime: prevMtime }),
    });
    if (!r.ok) {
      if (r.status === 409) {
        await load();
      } else {
        setBoard(prev);
        setError(`저장 실패 ${r.status}`);
      }
      return;
    }
    const d = await r.json();
    setMtime(d.mtime);
  };

  const commitDrop = () => {
    const d = drag;
    const t = dropTarget;
    setDrag(null);
    setDropTarget(null);
    if (!d || !t || !board) return;
    if (d.col === t.col && (d.idx === t.idx || d.idx + 1 === t.idx)) return;
    const next: BoardData = {
      ...board,
      columns: board.columns.map((c) => ({ ...c, cards: [...c.cards] })),
    };
    const [moved] = next.columns[d.col].cards.splice(d.idx, 1);
    let target = t.idx;
    if (d.col === t.col && d.idx < t.idx) target = t.idx - 1;
    next.columns[t.col].cards.splice(target, 0, moved);
    save(next);
  };

  const onCardDragOver = (
    e: React.DragEvent,
    col: number,
    idx: number,
  ) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const insertIdx = before ? idx : idx + 1;
    setDropTarget((prev) =>
      prev && prev.col === col && prev.idx === insertIdx
        ? prev
        : { col, idx: insertIdx },
    );
  };

  const onColumnDragOver = (
    e: React.DragEvent,
    col: number,
    cardCount: number,
  ) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (
      !dropTarget ||
      dropTarget.col !== col
    ) {
      setDropTarget({ col, idx: cardCount });
    }
  };

  const addCard = (colIdx: number) => {
    if (!board) return;
    const text = window.prompt("카드 내용 (예: [[보드이름]] 또는 텍스트)");
    if (!text) return;
    const trimmed = text.trim();
    const m = LINK_RE.exec(trimmed);
    let link: string | null = null;
    if (m) {
      const pipe = m[1].indexOf("|");
      link = pipe >= 0 ? m[1].slice(0, pipe) : m[1];
    }
    const card: Card = { text: trimmed, link };
    const next: BoardData = {
      ...board,
      columns: board.columns.map((c, i) =>
        i === colIdx ? { ...c, cards: [...c.cards, card] } : c,
      ),
    };
    save(next);
  };

  const removeCard = (colIdx: number, cardIdx: number) => {
    if (!board) return;
    if (!window.confirm("삭제?")) return;
    const next: BoardData = {
      ...board,
      columns: board.columns.map((c, i) =>
        i === colIdx
          ? { ...c, cards: c.cards.filter((_, j) => j !== cardIdx) }
          : c,
      ),
    };
    save(next);
  };

  if (error) return <div className="error">{error}</div>;
  if (!board) return <div className="loading">로딩중…</div>;

  return (
    <div className="board">
      <header className="board-header">
        <div className="board-header-inner">
          <h1 className="hdr-title" title={name}>
            {name}
          </h1>
          <div className="hdr-right">
            <ThemeMenu current={config.theme} onPick={onSetTheme} />
            {isHome && (
              <button
                className="icon-btn"
                title={`파일 변경 — ${config.homeFile}`}
                onClick={onPickFile}
                disabled={config.platform !== "darwin"}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="columns">
        {board.columns.map((col, ci) => (
          <div
            key={ci}
            className="column"
            onDragOver={(e) => onColumnDragOver(e, ci, col.cards.length)}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop();
            }}
          >
            <div className="column-name">{col.name}</div>
            <div className="cards">
              {col.cards.map((card, idx) => {
                const showBefore =
                  dropTarget?.col === ci && dropTarget.idx === idx;
                const isDragging = drag?.col === ci && drag.idx === idx;
                return (
                  <React.Fragment key={idx}>
                    {showBefore && <div className="drop-indicator" />}
                    <div
                      className={`card${card.link ? " has-link" : ""}${isDragging ? " dragging" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDrag({ col: ci, idx });
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(e) => onCardDragOver(e, ci, idx)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        commitDrop();
                      }}
                      onClick={() => {
                        if (card.link) onNavigate(`/${card.link}`);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        removeCard(ci, idx);
                      }}
                    >
                      {displayText(card.text)}
                    </div>
                  </React.Fragment>
                );
              })}
              {dropTarget?.col === ci &&
                dropTarget.idx === col.cards.length && (
                  <div className="drop-indicator" />
                )}
            </div>
            <button className="add-card" onClick={() => addCard(ci)}>
              + 카드
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
