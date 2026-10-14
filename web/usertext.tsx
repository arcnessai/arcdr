import { Linked } from "./linkify";

/**
 * What a person wrote, with files added from arcdr shown as what they are: an image as a small picture,
 * anything else as its type. Both open the file in a new tab.
 */
const UPLOAD = /@?(\/[^\s]*\/\.claude\/uploads\/arcdr\/(\d{4}-\d{2}-\d{2})\/([a-z0-9]+-[0-9a-f]{8}\.([a-z]+)))/g;
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export function UserText({ text }: { text: string }) {
  const out: (string | { url: string; ext: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(UPLOAD)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ url: `/api/uploads/${m[2]}/${m[3]}`, ext: m[4]! });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return (
    <>
      {out.map((p, i) =>
        typeof p === "string" ? (
          <Linked key={i} text={p} />
        ) : IMAGE.has(p.ext) ? (
          <a key={i} class="upload-thumb" href={p.url} target="_blank" rel="noopener noreferrer">
            <img src={p.url} alt="" loading="lazy" />
          </a>
        ) : (
          <a key={i} class="link upload-file" href={p.url} target="_blank" rel="noopener noreferrer">
            📎 {p.ext.toUpperCase()}
          </a>
        ),
      )}
    </>
  );
}
