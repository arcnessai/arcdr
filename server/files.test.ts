import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPreview, secretPath } from "./files";

const home = mkdtempSync(join(tmpdir(), "arcdr-files-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("secretPath", () => {
  const h = "/home/me";
  test("refuses where credentials live", () => {
    expect(secretPath("/home/me/.ssh/id_ed25519", h)).not.toBeNull();
    expect(secretPath("/home/me/.config/arcdr/push.json", h)).not.toBeNull();
    expect(secretPath("/home/me/.claude.json", h)).not.toBeNull();
    expect(secretPath("/home/me/.claude/.credentials.json", h)).not.toBeNull();
    expect(secretPath("/srv/app/.env.production", h)).not.toBeNull();
    expect(secretPath("/srv/app/tls/server.key", h)).not.toBeNull();
  });
  test("lets ordinary files through, examples of env files included", () => {
    expect(secretPath("/srv/app/src/main.ts", h)).toBeNull();
    expect(secretPath("/srv/app/.env.example", h)).toBeNull();
    expect(secretPath("/home/me/.sshconfig-notes.md", h)).toBeNull();
  });
});

describe("readPreview", () => {
  test("reads text, and follows a link to judge where it really points", () => {
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_ed25519"), "PRIVATE");
    writeFileSync(join(home, "notes.md"), "hello");
    symlinkSync(join(home, ".ssh", "id_ed25519"), join(home, "innocent.txt"));
    expect(readPreview(join(home, "notes.md"), home)).toMatchObject({ text: "hello", truncated: false });
    expect(() => readPreview(join(home, "innocent.txt"), home)).toThrow(/not shown/);
  });
  test("refuses binary files and relative paths", () => {
    writeFileSync(join(home, "a.bin"), Buffer.from([0, 1, 2, 3]));
    expect(() => readPreview(join(home, "a.bin"), home)).toThrow("not a text file");
    expect(() => readPreview("notes.md", home)).toThrow("absolute");
  });
});
