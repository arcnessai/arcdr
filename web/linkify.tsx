import type { ComponentChildren } from "preact";

/**
 * Web addresses inside any text, made into links that open in a new tab (on a phone: the browser, out of
 * the installed app). An address ends at a space, a quote, or a Korean, Japanese or Chinese character, so
 * "https://x.dev에서" links "https://x.dev"; trailing punctuation is left out unless it closes a bracket
 * the address opened.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`　-〿぀-ヿ㐀-鿿가-힯＀-￯]+/g;

export function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?]+$/, "");
  while (url.endsWith(")") && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1);
  while (url.endsWith("]") && (url.match(/\[/g) ?? []).length < (url.match(/]/g) ?? []).length) url = url.slice(0, -1);
  return url.replace(/[.,;:!?]+$/, "");
}

/** The pieces of `text`: plain strings, and each address as its own piece. */
export function splitUrls(text: string): { text: string; url: boolean }[] {
  const out: { text: string; url: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const url = trimUrl(m[0]);
    const at = m.index ?? 0;
    if (url.length <= "https://".length) continue;
    if (at > last) out.push({ text: text.slice(last, at), url: false });
    out.push({ text: url, url: true });
    last = at + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), url: false });
  return out;
}

export function Link({ href, children }: { href: string; children?: ComponentChildren }) {
  return (
    <a class="link" href={href} target="_blank" rel="noopener noreferrer">
      {children ?? href}
    </a>
  );
}

export function linkify(text: string): ComponentChildren[] {
  return splitUrls(text).map((p, i) => (p.url ? <Link key={i} href={p.text} /> : p.text));
}

/** For text a component prints as is (a pre, a bubble): the same text, with its addresses clickable. */
export function Linked({ text }: { text: string }) {
  return <>{linkify(text)}</>;
}
