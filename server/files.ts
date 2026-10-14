import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, sep } from "node:path";

/**
 * Reading a file the agent works on, for the preview. Agents edit in trees far from the folder they
 * started in, so paths are not held to that folder; whoever reaches this route can already run any command
 * in the agent's terminal. What is refused is where secrets live, so a glance at a file never shows one.
 */

export const MAX_PREVIEW_BYTES = 1024 * 1024;

export function secretPath(real: string, home: string): string | null {
  const name = basename(real);
  const under = (dir: string) => real === dir || real.startsWith(dir + sep);
  for (const dir of [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/arcdr", ".config/gh", ".config/gcloud"]) {
    if (under(`${home}/${dir}`)) return `${dir} holds credentials`;
  }
  if (
    real === `${home}/.claude.json` ||
    /^\.credentials/.test(name) ||
    name === ".netrc" ||
    name === ".npmrc" ||
    name === ".pypirc"
  )
    return "a login file";
  if (/^\.env($|\.)/.test(name) && !/\.(example|sample|template)$/.test(name)) return "an environment file";
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || /^id_(rsa|ed25519|ecdsa|dsa)/.test(name)) return "a key file";
  return null;
}

export type Preview = { path: string; text: string; size: number; truncated: boolean };

export function readPreview(path: string, home: string): Preview {
  if (!path.startsWith("/")) throw Object.assign(new Error("the path must be absolute"), { code: "bad_path" });
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw Object.assign(new Error("no such file"), { code: "not_found" });
  }
  const why = secretPath(real, home);
  if (why) throw Object.assign(new Error(`not shown: ${why}`), { code: "secret" });
  const st = statSync(real);
  if (!st.isFile()) throw Object.assign(new Error("not a file"), { code: "bad_path" });
  const length = Math.min(st.size, MAX_PREVIEW_BYTES);
  const buf = Buffer.alloc(length);
  const fd = openSync(real, "r");
  try {
    readSync(fd, buf, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.subarray(0, 8192).includes(0)) throw Object.assign(new Error("not a text file"), { code: "binary" });
  return { path: real, text: buf.toString("utf8"), size: st.size, truncated: st.size > length };
}
