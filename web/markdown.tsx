import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import { Link, linkify, splitUrls } from "./linkify";

/**
 * A small Markdown subset — fences, headings, lists, quotes, tables, rules, inline code, bold, links —
 * built as elements, never as HTML strings: transcripts carry text fetched from anywhere, and this page
 * can type into a shell.
 */

type Block =
  | { t: "code"; lang: string; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "list"; ordered: boolean; items: { depth: number; text: string; n: string }[] }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" }
  | { t: "p"; text: string };

const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line) ||
    (TABLE_ROW.test(line) && next !== undefined && TABLE_SEP.test(next))
  );
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      const close = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(close)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1]!.length, text: h[2]! });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const base = li[1]!.length;
      const items: { depth: number; text: string; n: string }[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (m && (/\d/.test(m[2]!) === ordered || m[1]!.length > base)) {
          items.push({ depth: Math.min(3, Math.floor(Math.max(0, m[1]!.length - base) / 2)), text: m[3]!, n: m[2]! });
          i++;
        } else if (!m && lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length > 0) {
          items[items.length - 1]!.text += "\n" + lines[i]!.trim();
          i++;
        } else break;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ t: "quote", text: body.join("\n") });
      continue;
    }
    const body: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!, lines[i + 1])) body.push(lines[i++]!);
    blocks.push({ t: "p", text: body.join("\n") });
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))/g;

/** Inline code that is nothing but an address is a link too: agents print `http://…` that way. */
function codeSpan(code: string, key: number) {
  const parts = splitUrls(code);
  if (parts.length === 1 && parts[0]!.url)
    return (
      <Link key={key} href={code}>
        <code>{code}</code>
      </Link>
    );
  return <code key={key}>{code}</code>;
}

export function inline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let last = 0;
  // Plain stretches between marks get their bare addresses linked.
  const plain = (s: string) => out.push(...linkify(s));
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) plain(text.slice(last, at));
    if (m[1]) out.push(codeSpan(m[1].slice(1, -1), at));
    else if (m[2]) out.push(<strong key={at}>{linkify(m[2].slice(2, -2))}</strong>);
    else if (m[3])
      out.push(
        <Link key={at} href={m[5]!}>
          {m[4]}
        </Link>,
      );
    last = at + m[0].length;
  }
  if (last < text.length) plain(text.slice(last));
  return out;
}

function renderBlock(b: Block, key: number) {
  switch (b.t) {
    case "code":
      return (
        <pre key={key} class="md-code" data-lang={b.lang || undefined}>
          <code>{b.text}</code>
        </pre>
      );
    case "h":
      return (
        <p key={key} class={`md-h md-h${Math.min(b.level, 3)}`}>
          {inline(b.text)}
        </p>
      );
    case "list": {
      const items = b.items.map((it, j) => (
        <li key={j} class={`md-d${it.depth}`} data-n={b.ordered ? it.n : undefined}>
          {inline(it.text)}
        </li>
      ));
      return b.ordered ? (
        <ol key={key} class="md-list md-ol">
          {items}
        </ol>
      ) : (
        <ul key={key} class="md-list">
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote key={key} class="md-quote">
          {inline(b.text)}
        </blockquote>
      );
    case "table":
      return (
        <div key={key} class="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={key} class="md-hr" />;
    case "p":
      return (
        <p key={key} class="md-p">
          {inline(b.text)}
        </p>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div class="md">{blocks.map(renderBlock)}</div>;
}
