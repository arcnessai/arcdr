/**
 * The display spec from the command line, for a person or an agent wiring a mod to arcdr (docs/mods.md).
 *
 *   bun run display tokens        what each agent and space reports to herdr right now
 *   bun run display show          the spec arcdr uses now, and where it came from
 *   bun run display check [file]  whether a display.json can be used as it is; exit 1 when it cannot
 *
 * Reads only: herdr's socket for the values, the files for the spec.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { displayLoader } from "../server/display";
import { snapshot } from "../server/herdr";
import { cleanSpec } from "../server/spec";

const home = process.env.HOME ?? "/root";
const configDir = process.env.ARCDR_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "arcdr");
const displayFile = join(configDir, "display.json");
const herdrConfig = join(home, ".config/herdr/config.toml");
const socket = process.env.HERDR_SOCKET_PATH ?? join(home, ".config/herdr/herdr.sock");

const [command = "help", arg] = process.argv.slice(2);

if (command === "tokens") {
  const snap = await snapshot(socket);
  const show = (tokens: Record<string, string>) =>
    Object.entries(tokens).forEach(([k, v]) => console.log(`    ${k.padEnd(18)} ${JSON.stringify(v)}`));
  for (const s of snap.spaces) {
    console.log(`space ${s.number} ${s.label}`);
    show(s.tokens);
    for (const a of snap.agents.filter((a) => a.space === s.id)) {
      console.log(`  ${a.tabLabel || a.title || a.kind}  [${a.pane}, ${a.status}]`);
      show(a.tokens);
    }
  }
} else if (command === "show") {
  const loaded = displayLoader(displayFile, herdrConfig)();
  console.log(`origin: ${loaded.origin}${loaded.origin === "file" ? ` (${displayFile})` : ""}`);
  for (const e of loaded.errors) console.log(`dropped: ${e}`);
  console.log(JSON.stringify(loaded.spec, null, 2));
} else if (command === "check") {
  const file = arg ?? displayFile;
  if (!existsSync(file)) {
    console.log(`${file} does not exist; arcdr uses herdr's sidebar rows or its default`);
    process.exit(0);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`${file}: not JSON — ${(e as Error).message}`);
    process.exit(1);
  }
  const { errors } = cleanSpec(raw);
  for (const e of errors) console.log(`✗ ${e}`);
  console.log(errors.length === 0 ? `✓ ${file} can be used as it is` : `${errors.length} problem(s); arcdr drops those parts`);
  process.exit(errors.length === 0 ? 0 : 1);
} else {
  console.log("usage: bun run display tokens | show | check [file]");
  process.exit(command === "help" ? 0 : 2);
}
