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
