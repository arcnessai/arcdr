/** Colour themes (web/style.css holds their values). "auto" follows the system's light or dark setting. */

export const THEMES = [
  { id: "auto", swatch: ["#121318", "#f6f6f9", "#bd93f9", "#6d28d9"] },
  { id: "dracula", swatch: ["#121318", "#262834", "#bd93f9", "#8be9fd", "#ff79c6"] },
  { id: "light", swatch: ["#f6f6f9", "#ffffff", "#6d28d9", "#0e7490", "#be185d"] },
  { id: "arcness", swatch: ["#0a101b", "#182335", "#5b97e8", "#7fb0f2", "#78dba3"] },
  { id: "arcness-light", swatch: ["#f2f5fa", "#ffffff", "#1d5bab", "#4f5bd5", "#1f7a47"] },
  { id: "nord", swatch: ["#2b303b", "#3b4252", "#88c0d0", "#b48ead", "#a3be8c"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "theme";

export function currentTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.some((th) => th.id === v)) return v as ThemeId;
  } catch {
    /* private mode */
  }
  return "auto";
}

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === "auto") delete root.dataset.theme;
  else root.dataset.theme = id;
  // The browser's bar takes the page's own background.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (id === "auto") m.content = m.media.includes("light") ? "#f6f6f9" : "#121318";
    else if (bg) m.content = bg;
  });
}

export function setTheme(id: ThemeId) {
  try {
    if (id === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    /* private mode: it holds for this visit */
  }
  applyTheme(id);
}

applyTheme(currentTheme());

/** Typefaces already on the device (web/style.css holds the stacks) and text sizes, kept per device. */
export const FONTS = ["system", "serif", "mono"] as const;
export type FontId = (typeof FONTS)[number];
export const TEXT_SIZES = [0.9, 1, 1.12, 1.25, 1.4] as const;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: it holds for this visit */
  }
}

export function currentFont(): FontId {
  const v = stored("font");
  return FONTS.includes(v as FontId) ? (v as FontId) : "system";
}

export function currentTextSize(): number {
  const v = Number(stored("textSize"));
  return TEXT_SIZES.includes(v as (typeof TEXT_SIZES)[number]) ? v : 1;
}

function applyText(font: FontId, size: number) {
  const root = document.documentElement;
  if (font === "system") delete root.dataset.font;
  else root.dataset.font = font;
  root.style.setProperty("--text-scale", String(size));
}

export function setFont(font: FontId) {
  keep("font", font === "system" ? null : font);
  applyText(font, currentTextSize());
}

export function setTextSize(size: number) {
  keep("textSize", size === 1 ? null : String(size));
  applyText(currentFont(), size);
}

applyText(currentFont(), currentTextSize());
