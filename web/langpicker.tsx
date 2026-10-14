import { lang, LANGUAGES, setLang, t, type Lang } from "./i18n";

export function LangPicker() {
  return (
    <label class="lang-picker">
      <span class="lang-label">{t.language}</span>
      <select value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value as Lang)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
