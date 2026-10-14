import { useEffect, useMemo, useState } from "preact/hooks";
import { api, ApiError, type Agent, type Space } from "./api";
import { lang, t } from "./i18n";

interface Past {
  id: string;
  title: string;
  at: number;
}

const ago = (ms: number) => {
  const sec = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(sec) < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (Math.abs(sec) < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
};

/**
 * A new Claude Code session in a space: a new herdr tab in a folder, a fresh conversation or an earlier one
 * picked up again (`claude --resume`), and optionally a first message.
 */
export function NewSessionView({ space, agents }: { space: Space; agents: Agent[] }) {
  // The folders this space's agents work in, most used first.
  const folders = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of agents) if (a.cwd) n.set(a.cwd, (n.get(a.cwd) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  }, [agents]);
  const [cwd, setCwd] = useState(folders[0] ?? "");
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [past, setPast] = useState<Past[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPast(null);
    if (!cwd.startsWith("/")) return;
    const timer = setTimeout(
      () =>
        fetch(`/api/sessions/past?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { sessions: [] }))
          .then((r) => setPast(r.sessions))
          .catch(() => setPast([])),
      250,
    );
    return () => clearTimeout(timer);
  }, [cwd]);

  const start = async (resume: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.startSession({ space: space.id, cwd, label, prompt: resume ? "" : prompt, resume });
      location.hash = `#/a/${encodeURIComponent(r.pane)}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div class="settings">
      <section class="settings-card">
        <h2>{t.newSession}</h2>
        <label class="field">
          <span>{t.folder}</span>
          <input
            list="arcdr-folders"
            value={cwd}
            onInput={(e) => setCwd((e.target as HTMLInputElement).value)}
            spellcheck={false}
          />
          <datalist id="arcdr-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label class="field">
          <span>{t.tabName}</span>
          <input value={label} placeholder={t.optional} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>{t.firstMessage}</span>
          <textarea
            rows={2}
            value={prompt}
            placeholder="/start"
            onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <button class="btn btn-primary btn-block" disabled={busy || !cwd.startsWith("/")} onClick={() => start(null)}>
          {busy ? t.starting : t.startSession}
        </button>
        {error && <p class="settings-line warn">{error}</p>}
      </section>

      <section class="settings-card">
        <h2>{t.resume}</h2>
        {past === null ? (
          <p class="settings-line">…</p>
        ) : past.length === 0 ? (
          <p class="settings-line">{t.noPast}</p>
        ) : (
          <ul class="past-list">
            {past.map((p) => (
              <li key={p.id}>
                <button class="past-row" disabled={busy} onClick={() => start(p.id)}>
                  <span class="past-title">{p.title || p.id.slice(0, 8)}</span>
                  <span class="past-at">{ago(p.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
