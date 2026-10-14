import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeFile, filterSlash, slashCommands } from "./complete";

const root = mkdtempSync(join(tmpdir(), "arcdr-complete-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const project = join(root, "project");
const home = join(root, "home");
mkdirSync(join(project, "web", "chat"), { recursive: true });
mkdirSync(join(project, ".claude", "skills", "land"), { recursive: true });
mkdirSync(join(project, ".claude", "commands", "ops"), { recursive: true });
mkdirSync(join(home, ".claude", "skills", "start"), { recursive: true });
mkdirSync(join(project, "node_modules", "x"), { recursive: true });
writeFileSync(join(project, ".claude", "skills", "land", "SKILL.md"), "---\nname: land\ndescription: Get a branch onto master\n---\nbody");
writeFileSync(join(project, ".claude", "commands", "deploy.md"), "---\ndescription: Ship it\n---\nDeploy the app");
writeFileSync(join(project, ".claude", "commands", "ops", "restart.md"), "Restart the service");
writeFileSync(join(home, ".claude", "skills", "start", "SKILL.md"), "---\nname: start\ndescription: \"Open a unit\"\n---");
writeFileSync(join(project, "web", "chat.tsx"), "");
writeFileSync(join(project, "web", "app.tsx"), "");
writeFileSync(join(project, ".env"), "SECRET=1");
symlinkSync("/etc", join(project, "out"));

describe("slashCommands", () => {
  const list = slashCommands(join(project, "web"), home, 0);
  const find = (v: string) => list.find((s) => s.value === v);

  test("finds the project's skills and commands from a subdirectory, the user's skills, and the built-ins", () => {
    expect(find("/land")).toEqual({ value: "/land", detail: "Get a branch onto master", kind: "skill" });
    expect(find("/deploy")).toEqual({ value: "/deploy", detail: "Ship it", kind: "command" });
    expect(find("/ops:restart")).toMatchObject({ kind: "command", detail: "Restart the service" });
    expect(find("/start")).toEqual({ value: "/start", detail: "Open a unit", kind: "skill" });
    expect(find("/compact")?.kind).toBe("builtin");
  });

  test("never offers the commands that end or sign out the session", () => {
    for (const v of ["/exit", "/quit", "/logout"]) expect(find(v)).toBeUndefined();
  });

  test("ranks names that start with the query before names that contain it", () => {
    expect(filterSlash(list, "st").map((s) => s.value).slice(0, 2)).toEqual(["/start", "/status"]);
    expect(filterSlash(list, "art").map((s) => s.value)).toContain("/ops:restart");
  });
});

describe("completeFile", () => {
  const values = (q: string) => completeFile(project, q).map((s) => s.value);

  test("lists the directory the partial path names, directories first", () => {
    expect(values("web/")).toEqual(["web/chat/", "web/app.tsx", "web/chat.tsx"]);
    expect(values("web/ch")).toEqual(["web/chat/", "web/chat.tsx"]);
  });

  test("hides dotfiles and dependency folders until asked for", () => {
    expect(values("")).not.toContain(".env");
    expect(values("")).not.toContain("node_modules/");
    expect(values(".e")).toEqual([".env"]);
  });

  test("never leaves the working directory", () => {
    expect(values("../")).toEqual([]);
    expect(values("/etc/")).toEqual([]);
    expect(values("out/")).toEqual([]);
  });
});
