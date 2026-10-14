import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "./api";
import { t } from "./i18n";

const MAX_LINES = 5000;

/** A long path keeps its end — the file's name — and loses its start. */
const tail = (p: string, max = 52) => (p.length > max ? `…${p.slice(p.length - max + 1)}` : p);

export function FileView({ pane, path, onClose }: { pane: string; path: string; onClose: () => void }) {
  const [file, setFile] = useState<{ path: string; text: string; size: number; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFile(null);
    setError(null);
    api
      .file(pane, path)
      .then(setFile)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [pane, path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = file ? file.text.split("\n") : [];
  return (
    <div class="file-view" role="dialog" aria-label={path}>
      <header class="file-head">
        <span class="file-path" title={file?.path ?? path}>
          {tail(file?.path ?? path)}
        </span>
        <button class="icon-btn" onClick={onClose} aria-label={t.close}>
          ✕
        </button>
      </header>
      {error && <p class="file-note warn">{error}</p>}
      {!file && !error && <p class="file-note">…</p>}
      {file && (
        <pre class="file-body">
          {lines.slice(0, MAX_LINES).map((l, i) => (
            <span key={i} class="fl">
              {l || " "}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {file && (file.truncated || lines.length > MAX_LINES) && <p class="file-note">{t.fileTruncated}</p>}
    </div>
  );
}
