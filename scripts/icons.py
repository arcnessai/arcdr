"""Draws the PNG app icons (three dots on the dark background) without an image library.

Run once after changing the design: python3 scripts/icons.py
The dots sit inside the central 60% so the 512 icon also works as a maskable icon.
"""

import struct
import sys
import zlib
from pathlib import Path

BG = (0x12, 0x13, 0x18)
DOTS = [((0.28, 0.5), (0x8B, 0xE9, 0xFD)), ((0.5, 0.5), (0xBD, 0x93, 0xF9)), ((0.72, 0.5), (0xFF, 0x79, 0xC6))]
RADIUS = 0.095
SAMPLES = 4  # per axis, for anti-aliasing


def pixel(x: float, y: float) -> tuple[int, int, int]:
    for (cx, cy), colour in DOTS:
        if (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS**2:
            return colour
    return BG


def draw(size: int) -> bytes:
    rows = []
    step = 1 / (size * SAMPLES)
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    r, g, b = pixel(px / size + (sx + 0.5) * step, py / size + (sy + 0.5) * step)
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
            n = SAMPLES * SAMPLES
            row += bytes(c // n for c in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web")
    for size in (192, 512):
        (out / f"icon-{size}.png").write_bytes(draw(size))
        print(f"wrote {out / f'icon-{size}.png'}")
