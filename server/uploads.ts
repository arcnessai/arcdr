import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Files a person adds from a phone or another computer — a screenshot, a photo, a PDF — saved where the
 * agent can read them and named in the message as @path, as Claude Code's Remote Control does with
 * ~/.claude/uploads. Each day gets a folder; folders older than the keep period are swept.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 14;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  log: "text/plain; charset=utf-8",
};

const FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
};

export function contentTypeOf(name: string): string | null {
  return TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? null;
}

/** The first bytes have to agree with what the name or type says it is; a renamed executable is not an image. */
export function sniff(bytes: Uint8Array, ext: string): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  switch (ext) {
    case "png":
      return at(0, 0x89, 0x50, 0x4e, 0x47);
    case "jpg":
    case "jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "gif":
      return ascii(0, "GIF8");
    case "webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "heic":
    case "heif":
      return ascii(4, "ftyp");
    case "pdf":
      return ascii(0, "%PDF");
    default:
      // Text: no NUL byte in the first 8 KB.
      return !bytes.subarray(0, 8192).includes(0);
  }
}

/** The extension a file is kept under: from its name when that is one we take, else from its type. */
export function extensionFor(name: string, mime: string): string | null {
  const fromName = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (TYPES[fromName]) return fromName === "jpeg" ? "jpg" : fromName;
  return FROM_MIME[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);

export function saveUpload(root: string, bytes: Uint8Array, name: string, mime: string): { path: string; url: string } {
  const ext = extensionFor(name, mime);
  if (!ext) throw new Error("unsupported");
  if (!sniff(bytes, ext)) throw new Error("mismatch");
  const folder = join(root, day());
  mkdirSync(folder, { recursive: true });
  // The name is ours: the one the browser sends is shown nowhere and decides nothing.
  const file = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const path = join(folder, file);
  writeFileSync(path, bytes, { mode: 0o600 });
  return { path, url: `/api/uploads/${day()}/${file}` };
}

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;
const FILE = /^[a-z0-9]+-[0-9a-f]{8}\.[a-z]+$/;

/** The saved file a /api/uploads/<day>/<file> address names, or null. */
export function uploadPath(root: string, dayDir: string, file: string): string | null {
  if (!DAY_DIR.test(dayDir) || !FILE.test(file)) return null;
  const path = join(root, dayDir, file);
  return existsSync(path) ? path : null;
}

export function sweepUploads(root: string, now = Date.now()) {
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return;
  }
  for (const d of dirs) {
    if (!DAY_DIR.test(d)) continue;
    const path = join(root, d);
    if (now - statSync(path).mtimeMs > KEEP_DAYS * 86_400_000) rmSync(path, { recursive: true, force: true });
  }
}
