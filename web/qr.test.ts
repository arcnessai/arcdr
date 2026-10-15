import { describe, expect, test } from "bun:test";
import { qrModules, qrText } from "./qr";

describe("QR codes", () => {
  test("an address makes a square code with the three finder squares in its corners", () => {
    const m = qrModules("https://machine.tailnet.ts.net");
    const n = m.length;
    expect(m.every((row) => row.length === n)).toBe(true);
    // A finder square: a dark ring seven modules wide, a light ring, a dark three-by-three centre.
    const finder = (r: number, c: number) => m[r]![c]! && m[r + 6]![c + 6]! && !m[r + 1]![c + 1]! && m[r + 3]![c + 3]!;
    expect(finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0)).toBe(true);
  });

  test("as terminal text, two module rows per line and a quiet zone all round", () => {
    const n = qrModules("https://machine.tailnet.ts.net").length + 4;
    const lines = qrText("https://machine.tailnet.ts.net").split("\n");
    expect(lines).toHaveLength(Math.ceil(n / 2));
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(plain[0]).toBe("█".repeat(n));
    expect(plain.every((l) => [...l].length === n)).toBe(true);
  });
});
