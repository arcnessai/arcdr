import { useEffect, useState } from "preact/hooks";
import type { Health } from "./api";
import { t } from "./i18n";
import { LangPicker } from "./langpicker";
import { DisplayInfo } from "./parts";
import {
  currentFont,
  currentTextSize,
  currentTheme,
  FONTS,
  setFont,
  setTextSize,
  setTheme,
  TEXT_SIZES,
  THEMES,
  type FontId,
  type ThemeId,
} from "./theme";
import { useContext } from "preact/hooks";
import { readPush, savePrefs, sendTest, turnOff, turnOn, type PushState } from "./push";
import { qrModules } from "./qr";

/** This page's own address as a QR code, for opening it on a phone from a computer that already has it. */
function QrCode({ text }: { text: string }) {
  const m = qrModules(text);
  const quiet = 4;
  const size = m.length + quiet * 2;
  const d = m.flatMap((row, r) => row.flatMap((dark, c) => (dark ? [`M${c + quiet} ${r + quiet}h1v1h-1z`] : []))).join("");
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={text} shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function OtherDevice() {
  const address = location.origin;
  const [copied, setCopied] = useState(false);
  return (
    <div class="other-device">
      <QrCode text={address} />
      <div class="other-device-text">
        <p class="settings-line">{t.otherDeviceHint}</p>
        <code class="other-device-url">{address}</code>
        <button
          class="btn btn-ghost"
          onClick={() =>
            void navigator.clipboard?.writeText(address).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? t.copied : t.copyAddress}
        </button>
      </div>
    </div>
  );
}

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

/** Typeface and size, per device: a phone held at arm's length and a desktop monitor want different ones. */
function TextSection() {
  const [font, pickFont] = useState<FontId>(currentFont());
  const [size, pickSize] = useState(currentTextSize());
  return (
    <section class="settings-card">
      <h2>{t.text}</h2>
      <div class="edit-field">
        <span class="edit-label">{t.font}</span>
        <div class="edit-choices" role="radiogroup" aria-label={t.font}>
          {FONTS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              class={`font-option font-${f}`}
              aria-checked={font === f}
              onClick={() => {
                setFont(f);
                pickFont(f);
              }}
            >
              {t.fonts[f]}
            </button>
          ))}
        </div>
      </div>
      <div class="edit-field">
        <span class="edit-label">{t.textSize}</span>
        <div class="edit-choices" role="radiogroup" aria-label={t.textSize}>
          {TEXT_SIZES.map((v, i) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={size === v}
              onClick={() => {
                setTextSize(v);
                pickSize(v);
              }}
            >
              {t.textSizes[i]}
            </button>
          ))}
        </div>
      </div>
      <p class="text-preview">{t.textPreview}</p>
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
      <a class="btn btn-ghost btn-block" href="#/display">
        {t.customize}
      </a>
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
      <TextSection />
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
      <section class="settings-card">
        <h2>{t.otherDevice}</h2>
        <OtherDevice />
      </section>
    </div>
  );
}
