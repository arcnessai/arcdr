import type { ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { api, ApiError, type Agent } from "./api";
import { AgentRow } from "./lists";
import { DisplayContext, DisplayInfo, DisplaySet, PartRow, PartView } from "./parts";
import { findToken, guessFormat, placeToken, reported, type Place, type Reported } from "./specedit";
import { t } from "./i18n";
import type { DisplaySpec, Format, Part } from "../server/spec";

const PLACES: Place["at"][] = ["none", "badge", "line", "band", "footer"];
const FORMATS: Format[] = ["text", "chip", "badge", "dots", "meter", "ago"];
const SIDES: ("left" | "right")[] = ["left", "right"];
const COLORS = ["", "cyan", "purple", "yellow", "green", "orange", "pink", "red", "muted", "dim"];

/** Where a value goes when the person first picks a place for it. */
function placeAt(at: Place["at"], spec: DisplaySpec): Place {
  if (at === "band") return { at, row: Math.max(0, (spec.band?.length ?? 1) - 1), side: "left" };
  if (at === "footer") return { at, side: "right" };
  return { at } as Place;
}

function placeText(p: Place, rows: number): string {
  if (p.at === "band") return `${t.places.band}${rows > 1 ? ` · ${t.rowN(p.row + 1)}` : ""} · ${t.sides[p.side]}`;
  if (p.at === "footer") return `${t.places.footer} · ${t.sides[p.side]}`;
  return t.places[p.at];
}

function Choices<T extends string | number>(props: {
  label: string;
  options: T[];
  value: T;
  text: (o: T) => ComponentChildren;
  onPick: (o: T) => void;
}) {
  return (
    <div class="edit-field">
      <span class="edit-label">{props.label}</span>
      <div class="edit-choices" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === props.value} onClick={() => props.onPick(o)}>
            {props.text(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ValueEditor(props: { value: Reported; spec: DisplaySpec; subject: Agent | null; onChange: (s: DisplaySpec) => void }) {
  const { value, spec, subject, onChange } = props;
  const { place, part } = findToken(spec, value.name);
  const current: Part = part ?? { from: `token:${value.name}`, as: guessFormat(value.sample) };
  const put = (p: Place, with_: Part = current) => onChange(placeToken(spec, value.name, p, with_));
  const restyle = (patch: Partial<Part>) => {
    const next: Part = { ...current, ...patch };
    for (const k of Object.keys(patch) as (keyof Part)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    put(place, next);
  };
  const rows = spec.band?.length ?? 0;
  return (
    <div class="value-edit">
      {/* The value as it will look, here where the choices are: on a phone the full preview is off-screen. */}
      {subject && place.at !== "none" && (
        <div class="value-look">
          <DisplayContext.Provider value={spec}>
            <PartView part={current} of={subject} />
          </DisplayContext.Provider>
        </div>
      )}
      <Choices
        label={t.placeLabel}
        options={PLACES}
        value={place.at}
        text={(o) => t.places[o]}
        onPick={(at) => put(placeAt(at, spec))}
      />
      {place.at === "band" && (
        <Choices
          label={t.rowLabel}
          options={[...Array(Math.min(rows + 1, 4)).keys()]}
          value={place.row}
          text={(o) => (o < rows ? t.rowN(o + 1) : t.newRow)}
          onPick={(row) => put({ ...place, row })}
        />
      )}
      {(place.at === "band" || place.at === "footer") && (
        <Choices
          label={t.sideLabel}
          options={SIDES}
          value={place.side}
          text={(o) => t.sides[o]}
          onPick={(side) => put({ ...place, side })}
        />
      )}
      {place.at !== "none" && (
        <>
          <Choices
            label={t.formatLabel}
            options={FORMATS}
            value={current.as ?? "text"}
            text={(o) => t.formats[o]}
            onPick={(as) => restyle({ as })}
          />
          <div class="edit-field">
            <span class="edit-label">{t.colorLabel}</span>
            <div class="swatches" role="radiogroup" aria-label={t.colorLabel}>
              {COLORS.map((c) => (
                <button
                  key={c || "default"}
                  type="button"
                  role="radio"
                  class={`swatch${c ? "" : " swatch-default"}`}
                  style={c ? { background: `var(--${c})` } : undefined}
                  aria-checked={(current.color ?? "") === c}
                  title={c || t.colorDefault}
                  aria-label={c || t.colorDefault}
                  onClick={() => restyle({ color: c || undefined })}
                />
              ))}
            </div>
          </div>
          <label class="field">
            <span>{t.prefixLabel}</span>
            <input
              value={current.prefix ?? ""}
              maxLength={40}
              placeholder={t.optional}
              onInput={(e) => restyle({ prefix: (e.target as HTMLInputElement).value || undefined })}
            />
          </label>
          <div class="edit-toggles">
            <label class="check">
              <input
                type="checkbox"
                checked={!!current.bold}
                onChange={() => restyle({ bold: current.bold ? undefined : true })}
              />
              {t.bold}
            </label>
            <label class="check">
              <input type="checkbox" checked={!!current.dim} onChange={() => restyle({ dim: current.dim ? undefined : true })} />
              {t.dim}
            </label>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Settings → Display → Customize: every value the mods report now, and for each one where it shows and how,
 * with the list row and the message box drawn as they will look. Saving writes display.json.
 */
export function DisplayEditor({ agents }: { agents: Agent[] }) {
  const info = useContext(DisplayInfo);
  const setInfo = useContext(DisplaySet);
  const [draft, setDraft] = useState<DisplaySpec | null>(info?.spec ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [pane, setPane] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  useEffect(() => {
    if (info && draft === null) setDraft(info.spec);
  }, [info]);

  const values = useMemo(() => (draft ? reported(agents, draft) : []), [agents, draft]);
  if (!info || !draft) return <p class="settings-line">…</p>;

  // The preview agent wears every value's sample, so a value its own agent does not report still shows.
  const withMost = [...agents].sort((a, b) => Object.keys(b.tokens).length - Object.keys(a.tokens).length)[0];
  const base = agents.find((a) => a.pane === pane) ?? withMost;
  const samples = Object.fromEntries(values.filter((v) => v.sample).map((v) => [v.name, v.sample]));
  const subject = base ? { ...base, tokens: { ...samples, ...base.tokens } } : null;
  const changed = JSON.stringify(draft) !== JSON.stringify(info.spec);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const loaded = await api.saveDisplay(draft);
      setInfo(loaded);
      setDraft(loaded.spec);
      setNote({ text: t.saved });
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : String(e), warn: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="settings display-editor">
      <section class="settings-card">
        <h2>{t.preview}</h2>
        {agents.length > 1 && (
          <label class="field">
            <span>{t.previewAgent}</span>
            <select value={base?.pane} onChange={(e) => setPane((e.target as HTMLSelectElement).value)}>
              {agents.map((a) => (
                <option key={a.pane} value={a.pane}>
                  {[a.tokens.tree, a.tabLabel || a.title || a.kind].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {subject && (
          <DisplayContext.Provider value={draft}>
            {/* Drawn as the real screens draw it, but not a link anyone can follow. */}
            <div class="preview" ref={(el) => el?.setAttribute("inert", "")}>
              <AgentRow agent={subject} selected={false} />
              <div class="preview-dock">
                {draft.band?.map((row, i) => (
                  <PartRow key={i} row={row} of={subject} />
                ))}
                <div class="preview-input">{t.message}</div>
                {draft.footer && <PartRow row={draft.footer} of={subject} />}
              </div>
            </div>
          </DisplayContext.Provider>
        )}
      </section>

      <section class="settings-card">
        <h2>{t.reportedValues}</h2>
        <p class="settings-line">{t.customizeHint}</p>
        {values.length === 0 && <p class="settings-line">{t.noValues}</p>}
        <ul class="value-list">
          {values.map((v) => {
            const where = findToken(draft, v.name).place;
            const isOpen = open === v.name;
            return (
              <li key={v.name} class={`value-row${isOpen ? " is-open" : ""}`}>
                <button type="button" class="value-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.name)}>
                  <span class="value-name">{v.name}</span>
                  <span class={`value-sample${v.sample ? "" : " is-quiet"}`}>{v.sample || t.notReportedNow}</span>
                  <span class={`value-place at-${where.at}`}>{placeText(where, draft.band?.length ?? 0)}</span>
                </button>
                {isOpen && <ValueEditor value={v} spec={draft} subject={subject} onChange={setDraft} />}
              </li>
            );
          })}
        </ul>
        <p class="settings-line">{t.notifyTokenHint}</p>
      </section>

      <div class="editor-bar">
        {note ? (
          <span class={`editor-note${note.warn ? " warn" : ""}`}>{note.text}</span>
        ) : (
          <span class="editor-note">
            {info.errors.length > 0 ? t.saveDropsErrors : info.origin !== "file" ? t.saveMakesFile : ""}
          </span>
        )}
        <button type="button" class="btn btn-ghost" disabled={!changed || busy} onClick={() => setDraft(info.spec)}>
          {t.revert}
        </button>
        <button type="button" class="btn btn-primary" disabled={!changed || busy} onClick={() => void save()}>
          {t.save}
        </button>
      </div>
    </div>
  );
}
