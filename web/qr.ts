import qrcode from "qrcode-generator";

/** The dark modules of a QR code for `text`, row by row. Medium error correction: it is read off a screen. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * A QR code as terminal text, two module rows per line in half blocks, light on dark set explicitly so it
 * scans in a light theme too, with the quiet zone a camera needs around it.
 */
export function qrText(text: string, margin = 2): string {
  const inner = qrModules(text);
  const n = inner.length + margin * 2;
  const dark = (r: number, c: number) => inner[r - margin]?.[c - margin] === true;
  const lines: string[] = [];
  for (let r = 0; r < n; r += 2) {
    let line = "\x1b[40;97m";
    for (let c = 0; c < n; c++) {
      const top = !dark(r, c);
      const bottom = r + 1 < n && !dark(r + 1, c);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join("\n");
}
