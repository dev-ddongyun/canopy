export type Card = { text: string; link: string | null };
export type Column = { name: string; cards: Card[] };
export type Board = { columns: Column[]; rawHeader: string; rawFooter: string };

const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/;
const SETTINGS_RE = /(\n*%% kanban:settings\n[\s\S]*?\n%%\s*)$/;
const LINK_RE = /^\[\[([^\]]+)\]\]$/;

export function parse(md: string): Board {
  let rest = md;
  let rawHeader = "";
  let rawFooter = "";

  const fm = rest.match(FRONTMATTER_RE);
  if (fm) {
    rawHeader = fm[1];
    rest = rest.slice(fm[1].length);
  }

  const settings = rest.match(SETTINGS_RE);
  if (settings) {
    rawFooter = settings[1].replace(/^\n+/, "");
    rest = rest.slice(0, rest.length - settings[1].length);
  }

  const columns: Column[] = [];
  const lines = rest.split("\n");
  let cur: Column | null = null;

  for (const line of lines) {
    const colMatch = /^## (.+)$/.exec(line);
    if (colMatch) {
      cur = { name: colMatch[1].trim(), cards: [] };
      columns.push(cur);
      continue;
    }
    const cardMatch = /^- \[[ xX]\] (.+)$/.exec(line);
    if (cardMatch && cur) {
      const text = cardMatch[1].trim();
      const linkMatch = LINK_RE.exec(text);
      let link: string | null = null;
      if (linkMatch) {
        const inner = linkMatch[1];
        const pipeIdx = inner.indexOf("|");
        link = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
      }
      cur.cards.push({ text, link });
    }
  }

  return { columns, rawHeader, rawFooter };
}

export function serialize(b: Board): string {
  let out = b.rawHeader;
  if (out) {
    if (!out.endsWith("\n")) out += "\n";
    if (!out.endsWith("\n\n")) out += "\n";
  }

  const parts: string[] = [];
  for (const col of b.columns) {
    let s = `## ${col.name}\n\n`;
    for (const card of col.cards) {
      s += `- [ ] ${card.text}\n`;
    }
    parts.push(s);
  }
  out += parts.join("\n");

  if (b.rawFooter) {
    out = out.replace(/\n+$/, "\n");
    out += "\n" + b.rawFooter;
    if (!out.endsWith("\n")) out += "\n";
  }
  return out;
}

export function isKanbanFile(md: string): boolean {
  const fm = md.match(FRONTMATTER_RE);
  if (!fm) return false;
  return /kanban-plugin:\s*(basic|board)/.test(fm[1]);
}
