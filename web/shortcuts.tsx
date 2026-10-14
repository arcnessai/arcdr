import { useEffect, useState } from "preact/hooks";
import { api, ApiError, type Shortcut, type Suggestion } from "./api";
import * as I from "./icons";
import { t } from "./i18n";

// The last list seen, so the tray opens with its buttons instead of an empty moment.
let lastSeen: Shortcut[] | null = null;

/** The machine's commands kept at hand. Read again each time the tray opens: another device may have changed them. */
function useShortcuts(onError: (m: string) => void) {
  const [list, setList] = useState<Shortcut[] | null>(lastSeen);
  useEffect(() => {
    let live = true;
    api
      .shortcuts()
      .then((r) => live && setList((lastSeen = r.shortcuts)))
      .catch(() => live && setList((l) => l ?? []));
    return () => {
      live = false;
    };
  }, []);
  const save = async (next: Shortcut[]) => {
    const before = list;
    setList(next);
    try {
      setList((lastSeen = (await api.saveShortcuts(next)).shortcuts));
      return true;
    } catch (e) {
      setList(before);
      onError(e instanceof ApiError ? e.message : String(e));
      return false;
    }
  };
  return { list, save };
}

function useSlashCommands(pane: string, query: string | null): Suggestion[] {
  const [items, setItems] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (query === null) {
      setItems([]);
      return;
    }
    let live = true;
    const timer = setTimeout(
      () =>
        api
          .complete(pane, "slash", query)
          .then((r) => live && setItems(r.items.slice(0, 8)))
          .catch(() => live && setItems([])),
      60,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pane, query]);
  return items;
}

const move = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/**
 * What the ＋ beside the message box opens: the key buttons, photos, the camera on a phone, files, and
 * the commands this machine keeps — each one a tap from the message box or from being sent.
 */
export function Tray(props: {
  pane: string;
  keysOpen: boolean;
  /** The message box's text, offered as the new command's text. */
  draft: string;
  onKeys: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  onCamera: (() => void) | null;
  onUse: (s: Shortcut) => void;
  onError: (m: string) => void;
}) {
  const { list, save } = useShortcuts(props.onError);
  const [editing, setEditing] = useState(false);
  // The command being written: `at` is its place in the list, null for a new one.
  const [form, setForm] = useState<{ at: number | null; value: Shortcut } | null>(null);

  const add = () => setForm({ at: null, value: { text: props.draft.trim().slice(0, 600), label: "", send: false } });
  const keep = async (value: Shortcut) => {
    const current = list ?? [];
    const next = form?.at == null ? [...current, value] : current.map((s, i) => (i === form.at ? value : s));
    if (await save(next)) setForm(null);
  };

  return (
    <div class="tray" role="group" aria-label={t.extras}>
      <div class="tray-tiles">
        <button type="button" class="tile" aria-pressed={props.keysOpen} onClick={props.onKeys}>
          <I.Keyboard size={22} />
          <span>{t.keyButtons}</span>
        </button>
        <button type="button" class="tile" onClick={props.onPhotos}>
          <I.Image size={22} />
          <span>{t.photos}</span>
        </button>
        {props.onCamera && (
          <button type="button" class="tile" onClick={props.onCamera}>
            <I.Camera size={22} />
            <span>{t.camera}</span>
          </button>
        )}
        <button type="button" class="tile" onClick={props.onFiles}>
          <I.Clip size={22} />
          <span>{t.files}</span>
        </button>
      </div>

      <div class="tray-section">
        <div class="tray-head">
          <span>{t.commands}</span>
          {!form && list && list.length > 0 && (
            <button type="button" class="link-btn" onClick={() => setEditing(!editing)}>
              {editing ? t.finishEdit : t.editShortcuts}
            </button>
          )}
        </div>

        {form ? (
          <ShortcutForm pane={props.pane} initial={form.value} onSave={keep} onCancel={() => setForm(null)} />
        ) : list === null ? null : editing ? (
          <ul class="shortcut-rows">
            {list.map((s, i) => (
              <li key={`${i}:${s.text}`}>
                <button type="button" class="shortcut-row" onClick={() => setForm({ at: i, value: s })}>
                  <span class="shortcut-row-name">
                    {s.label || s.text}
                    {s.send && <I.Bolt size={12} class="shortcut-bolt" />}
                  </span>
                  {s.label && <span class="shortcut-row-text">{s.text}</span>}
                </button>
                <button
                  type="button"
                  class="icon-btn small"
                  aria-label={t.moveUp}
                  disabled={i === 0}
                  onClick={() => void save(move(list, i, i - 1))}
                >
                  <I.Up size={16} />
                </button>
                <button
                  type="button"
                  class="icon-btn small danger"
                  aria-label={t.remove}
                  onClick={() => void save(list.filter((_, j) => j !== i))}
                >
                  <I.X size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div class="shortcuts">
              {list.map((s, i) => (
                <button
                  type="button"
                  key={`${i}:${s.text}`}
                  class={`shortcut${!s.label && s.text.startsWith("/") ? " is-command" : ""}`}
                  title={s.send ? `${s.text} · ${t.sendsNow}` : s.text}
                  onClick={() => props.onUse(s)}
                >
                  <span class="shortcut-name">{s.label || s.text}</span>
                  {s.send && <I.Bolt size={12} class="shortcut-bolt" />}
                </button>
              ))}
              <button type="button" class="shortcut shortcut-add" onClick={add}>
                <I.Plus size={14} />
                {t.addShortcut}
              </button>
            </div>
            {list.length === 0 && <p class="tray-hint">{t.shortcutsHint}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function ShortcutForm(props: { pane: string; initial: Shortcut; onSave: (s: Shortcut) => void; onCancel: () => void }) {
  const [text, setText] = useState(props.initial.text);
  const [label, setLabel] = useState(props.initial.label);
  const [send, setSend] = useState(props.initial.send);
  // While the command's name is being typed, the skills and commands of this agent's folder are offered.
  const typing = /^\/(\S*)$/.exec(text);
  const suggestions = useSlashCommands(props.pane, typing ? typing[1]! : null);

  return (
    <form
      class="shortcut-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) props.onSave({ text: text.trim(), label: label.trim(), send });
      }}
    >
      <label class="field">
        <span>{t.shortcutText}</span>
        <textarea
          rows={2}
          value={text}
          maxLength={600}
          placeholder={t.shortcutTextHint}
          spellcheck={false}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      {suggestions.length > 0 && (
        <ul class="shortcut-suggest">
          {suggestions.map((s) => (
            <li key={s.value}>
              <button type="button" onClick={() => setText(`${s.value} `)}>
                <span class={`sg-value sg-${s.kind}`}>{s.value}</span>
                {s.detail && <span class="sg-detail">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label class="field">
        <span>{t.shortcutLabel}</span>
        <input
          value={label}
          maxLength={40}
          placeholder={t.shortcutLabelHint}
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="check">
        <input type="checkbox" checked={send} onChange={(e) => setSend((e.target as HTMLInputElement).checked)} />
        {t.shortcutSend}
      </label>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" onClick={props.onCancel}>
          {t.cancel}
        </button>
        <button type="submit" class="btn btn-primary" disabled={!text.trim()}>
          {t.save}
        </button>
      </div>
    </form>
  );
}
