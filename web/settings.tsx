import { useEffect, useState } from "preact/hooks";
import type { Health } from "./api";
import { t } from "./i18n";
import { LangPicker } from "./langpicker";
import { DisplayInfo } from "./parts";
import { currentTheme, setTheme, THEMES, type ThemeId } from "./theme";
import { useContext } from "preact/hooks";
import { readPush, savePrefs, sendTest, turnOff, turnOn, type PushState } from "./push";

function Notifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void readPush().then(setState);
  }, []);

  if (!state) return <p class="settings-line">…</p>;
  if (!state.available) return <p class="settings-line">{t.notifyUnavailable}</p>;
  if (!state.supported) return <p class="settings-line">{t.notifyUnsupported}</p>;
  if (state.permission === "denied") return <p class="settings-line warn">{t.notifyDenied}</p>;

  const run = async (work: () => Promise<void>, after?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
      setNote(after ?? null);
    } catch (e) {
      setNote(e instanceof Error && e.message === "denied" ? t.notifyDenied : String(e instanceof Error ? e.message : e));
    } finally {
      setState(await readPush());
      setBusy(false);
    }
  };

  const prefs = { blocked: state.blocked, done: state.done, custom: state.custom };
  const toggle = (key: "blocked" | "done" | "custom") => (e: Event) => {
    const next = { ...prefs, [key]: (e.target as HTMLInputElement).checked };
    setState({ ...state, ...next });
    void run(() => savePrefs(next));
  };

  if (!state.subscribed) {
    return (
      <>
        <button class="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => turnOn(prefs))}>
          {t.notifyOn}
        </button>
        {note && <p class="settings-line warn">{note}</p>}
      </>
    );
  }
  return (
    <>
      <p class="settings-line ok">{t.notifyActive}</p>
      <label class="check">
        <input type="checkbox" checked={state.blocked} disabled={busy} onChange={toggle("blocked")} />
        {t.notifyBlocked}
      </label>
      <label class="check">
        <input type="checkbox" checked={state.done} disabled={busy} onChange={toggle("done")} />
        {t.notifyDone}
      </label>
      <label class="check">
        <input type="checkbox" checked={state.custom} disabled={busy} onChange={toggle("custom")} />
        {t.notifyCustom}
      </label>
      <div class="btn-row">
        <button class="btn btn-ghost" disabled={busy} onClick={() => run(sendTest, t.notifyTestSent)}>
          {t.notifyTest}
        </button>
        <button class="btn btn-ghost" disabled={busy} onClick={() => run(turnOff)}>
          {t.notifyOff}
        </button>
      </div>
      {note && <p class="settings-line">{note}</p>}
    </>
  );
}

function ThemeSection() {
  const [picked, setPicked] = useState<ThemeId>(currentTheme());
  return (
    <section class="settings-card">
      <h2>{t.theme}</h2>
      <div class="themes">
        {THEMES.map((th) => (
          <button
            key={th.id}
            class="theme-option"
            aria-pressed={picked === th.id}
            onClick={() => {
              setTheme(th.id);
              setPicked(th.id);
            }}
          >
            <span class="theme-swatch" aria-hidden="true">
              {th.swatch.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span class="theme-name">{t.themeNames[th.id]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DisplaySection() {
  const info = useContext(DisplayInfo);
  return (
    <section class="settings-card">
      <h2>{t.display}</h2>
      {info && <p class="settings-line">{t.displayOrigin[info.origin]}</p>}
      {info?.errors.map((e) => (
        <p key={e} class="settings-line warn">
          {e}
        </p>
      ))}
      <p class="settings-line">{t.displayHelp}</p>
    </section>
  );
}

export function SettingsView({ health }: { health: Health | null }) {
  return (
    <div class="settings">
      <section class="settings-card">
        <h2>{t.notifications}</h2>
        <Notifications />
      </section>
      <ThemeSection />
      <DisplaySection />
      <section class="settings-card">
        <h2>{t.language}</h2>
        <LangPicker />
      </section>
      <section class="settings-card">
        <h2>{t.connection}</h2>
        {health && (
          <>
            <p class="settings-line">
              {health.machine} · herdr {health.herdr}
            </p>
            <p class="settings-line">{t.account(health.login)}</p>
          </>
        )}
        <a class="btn btn-ghost" href="#/">
          {t.openConnect}
        </a>
      </section>
    </div>
  );
}
