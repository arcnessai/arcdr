/** The directory every path sits under, ending in "/"; empty when they share nothing but the root. */
export function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/").slice(0, -1));
  const first = split[0]!;
  let n = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < n && i < parts.length && parts[i] === first[i]) i++;
    n = i;
  }
  const dir = first.slice(0, n).join("/");
  return dir && dir !== "" ? `${dir}/` : "";
}

/** A path shown relative to the agent's working directory when it is inside it. */
export function displayPath(path: string, cwd: string): string {
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return cwd && path.startsWith(base) ? path.slice(base.length) : path;
}
