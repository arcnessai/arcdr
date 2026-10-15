/** Prints a QR code for an address in the terminal: `bun scripts/qr.ts https://machine.tailnet.ts.net`. */
import { qrText } from "../web/qr";

const address = process.argv[2];
if (!address) {
  console.error("usage: bun scripts/qr.ts <address>");
  process.exit(2);
}
console.log(qrText(address));
