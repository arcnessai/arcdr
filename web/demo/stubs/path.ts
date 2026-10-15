// node:path for the browser demo: POSIX paths, enough for the server code that builds them.
export const sep = "/";

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (absolute ? "/" : "") + out.join("/") || (absolute ? "/" : ".");
}

export const join = (...parts: string[]): string => normalize(parts.filter(Boolean).join("/"));
export const resolve = (...parts: string[]): string => {
  let path = "";
  for (const p of parts) path = p.startsWith("/") ? p : `${path}/${p}`;
  return normalize(path.startsWith("/") ? path : `/${path}`);
};
export const dirname = (path: string): string => {
  const n = normalize(path);
  const at = n.lastIndexOf("/");
  return at <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, at);
};
export const basename = (path: string, ext?: string): string => {
  const base = normalize(path).split("/").pop() ?? "";
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
};
export const extname = (path: string): string => {
  const base = basename(path);
  const at = base.lastIndexOf(".");
  return at > 0 ? base.slice(at) : "";
};
export const relative = (from: string, to: string): string => {
  const a = resolve(from).split("/").filter(Boolean);
  const b = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};
export default { sep, join, resolve, dirname, basename, extname, relative };
