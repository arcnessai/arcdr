import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionFor, saveUpload, sniff, sweepUploads, uploadPath } from "./uploads";

const root = mkdtempSync(join(tmpdir(), "arcdr-uploads-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("what is taken", () => {
  test("the extension comes from the name when it is one we take, else from the type", () => {
    expect(extensionFor("shot.PNG", "")).toBe("png");
    expect(extensionFor("photo.jpeg", "")).toBe("jpg");
    expect(extensionFor("", "image/webp")).toBe("webp");
    expect(extensionFor("run.sh", "application/x-sh")).toBeNull();
  });
  test("an image's first bytes must say it is that image", () => {
    expect(sniff(PNG, "png")).toBe(true);
    expect(sniff(new TextEncoder().encode("#!/bin/sh\nrm -rf /"), "png")).toBe(false);
    expect(sniff(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0]), "txt")).toBe(false);
    expect(sniff(new TextEncoder().encode("notes"), "md")).toBe(true);
  });
});

describe("saving and finding", () => {
  test("a saved file gets our own name, private mode, and an address that finds it again", () => {
    const { path, url } = saveUpload(root, PNG, "../../etc/passwd.png", "image/png");
    expect(path.startsWith(root)).toBe(true);
    expect(path).not.toContain("passwd");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const [, , , day, file] = url.split("/");
    expect(uploadPath(root, day!, file!)).toBe(path);
  });
  test("addresses that are not ours find nothing", () => {
    expect(uploadPath(root, "..", "x")).toBeNull();
    expect(uploadPath(root, "2026-10-14", "../../secret")).toBeNull();
    expect(uploadPath(root, "2026-10-14", "abc-0123abcd.png")).toBeNull();
  });
  test("a renamed program is refused", () => {
    expect(() => saveUpload(root, new TextEncoder().encode("MZ\x90\x00"), "x.png", "image/png")).toThrow("mismatch");
    expect(() => saveUpload(root, PNG, "x.exe", "application/octet-stream")).toThrow("unsupported");
  });
  test("day folders past the keep period are swept", () => {
    const old = join(root, "2000-01-01");
    mkdirSync(old);
    utimesSync(old, new Date("2000-01-01"), new Date("2000-01-01"));
    sweepUploads(root);
    expect(existsSync(old)).toBe(false);
  });
});
