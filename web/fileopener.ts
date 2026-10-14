import { createContext } from "preact";
import { useContext } from "preact/hooks";

/** Opens the file preview from anywhere inside a chat (a tool line, a changed file, a path in an answer). */
export const FileOpener = createContext<((path: string) => void) | null>(null);
export const useFileOpener = () => useContext(FileOpener);

/** An absolute path to a file — something with a name and an extension, not a bare directory or a URL. */
export const looksLikeFile = (s: string) => /^\/(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}$/.test(s);
