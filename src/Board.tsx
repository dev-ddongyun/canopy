import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Board as BoardData, Card } from "../kanban";
import type { Config } from "./main";

type Theme = "light" | "dark" | "system";

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

export function Header({
  title,
  homeFile,
  config,
  onPickFile,
  onSetTheme,
}: {
  title?: string;
  homeFile: string;
  config: Config;
  onPickFile: () => void;
  onSetTheme: (t: Theme) => void;
}) {
  return (
    <header className="board-header">
      <div className="board-header-inner">
        <h1 className="hdr-title" title={title || ""}>
          {title || ""}
        </h1>
        <div className="hdr-right">
          <ThemeMenu current={config.theme} onPick={onSetTheme} />
          <button
            className="icon-btn"
            title={homeFile ? `파일 변경 — ${homeFile}` : "파일 선택"}
            onClick={onPickFile}
            disabled={config.platform !== "darwin"}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" fill="none" stroke="var(--panel)" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

type Props = {
  title: string;
  config: Config;
  homeFile: string;
  onPickFile: () => Promise<void>;
  onSetTheme: (t: Theme) => Promise<void>;
};

type DragInfo = { col: number; idx: number } | null;
type DropTarget = { col: number; idx: number } | null;

export function Board({
  title,
  config,
  homeFile,
  onPickFile,
  onSetTheme,
}: Props) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [mtime, setMtime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragInfo>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/board?home=${encodeURIComponent(homeFile)}`);
    if (!r.ok) {
      setError(`로드 실패 ${r.status}`);
      return;
    }
    const d = await r.json();
    setBoard(d.board);
    setMtime(d.mtime);
    setError(null);
  }, [homeFile]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const es = new EventSource(
      `/api/events?home=${encodeURIComponent(homeFile)}`,
    );
    es.onmessage = () => load();
    return () => es.close();
  }, [homeFile, load]);

  const save = async (next: BoardData) => {
    const prev = board;
    const prevMtime = mtime;
    setBoard(next);
    const r = await fetch(
      `/api/board?home=${encodeURIComponent(homeFile)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: next, mtime: prevMtime }),
      },
    );
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
    if (!dropTarget || dropTarget.col !== col) {
      setDropTarget({ col, idx: cardCount });
    }
  };

  const addCard = (colIdx: number) => {
    if (!board) return;
    const text = window.prompt("카드 내용");
    if (!text) return;
    const card: Card = { text: text.trim() };
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

  return (
    <div className="board">
      <Header
        title={title}
        homeFile={homeFile}
        config={config}
        onPickFile={() => {
          onPickFile().catch(() => {});
        }}
        onSetTheme={onSetTheme}
      />
      {error ? (
        <div className="error">{error}</div>
      ) : !board ? (
        <div className="loading">로딩중…</div>
      ) : (
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
                        className={`card${isDragging ? " dragging" : ""}`}
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
                        onContextMenu={(e) => {
                          e.preventDefault();
                          removeCard(ci, idx);
                        }}
                      >
                        {card.text}
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
      )}
    </div>
  );
}
