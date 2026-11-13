"""Rebuild the Car Thing boot logo with DeskGadget branding.

The logo lives in the ``logo`` partition (mmcblk0p7) as an AML_RES package that
holds six 480x800 16-bit BMPs: the "use the adapter" warning and the
ThingsLab / USB-burn screens. This replaces their pixels, keeping each BMP
header, so the package stays valid.

    python tools/make_boot_logo.py logo-backup.img logo-new.img
    python tools/make_boot_logo.py --png appstart.png

Needs Pillow. The splash is only a splash: a bad image can look wrong but
cannot stop the device from booting, and /var/logo-backup.img restores it.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 480, 800
SIZE = 768000  # 480 * 800 * 2
OFFSETS = [256, 768404, 1536556, 4194560, 4962708, 5730860]
BG = (7, 10, 15)
INK = (234, 240, 248)
MUTED = (125, 138, 160)
PINK = (255, 61, 139)
VIOLET = (143, 91, 255)
CYAN = (124, 231, 255)


def load_font(names, size):
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def design() -> Image.Image:
    """The 800x480 landscape layout; it is rotated for the panel below."""
    img = Image.new("RGB", (800, 480), BG)

    glow = Image.new("RGB", (800, 480), BG)
    gd = ImageDraw.Draw(glow)
    for radius in range(230, 0, -6):
        a = 1 - radius / 230
        gd.ellipse(
            (400 - radius, 210 - radius * 0.8, 400 + radius, 210 + radius * 0.8),
            fill=(int(7 + 40 * a), int(10 + 26 * a), int(15 + 70 * a)),
        )
    img = Image.blend(img, glow, 0.55)
    d = ImageDraw.Draw(img)

    mw, mh = 168, 128
    x0, y0 = (800 - mw) // 2, 118

    mask = Image.new("L", (mw, mh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, mw, mh), radius=26, fill=255)
    grad = Image.new("RGB", (mw, mh))
    gp = grad.load()
    for y in range(mh):
        for x in range(mw):
            t = x / (mw - 1) * 0.62 + (1 - y / (mh - 1)) * 0.38
            if t < 0.52:
                k = t / 0.52
                gp[x, y] = tuple(int(PINK[i] + (VIOLET[i] - PINK[i]) * k) for i in range(3))
            else:
                k = (t - 0.52) / 0.48
                gp[x, y] = tuple(int(VIOLET[i] + (CYAN[i] - VIOLET[i]) * k) for i in range(3))
    img.paste(grad, (x0, y0), mask)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y0, x0 + mw, y0 + mh), radius=26,
                        outline=(210, 220, 235), width=3)
    for i, cx in enumerate((x0 + 64, x0 + 84, x0 + 104)):
        shade = (255, 255, 255) if i == 0 else (235, 240, 250) if i == 1 else (205, 214, 228)
        d.ellipse((cx - 7, y0 + mh - 40, cx + 7, y0 + mh - 26), fill=shade)

    title = load_font([r"C:\Windows\Fonts\seguisb.ttf", "DejaVuSans-Bold.ttf"], 46)
    small = load_font([r"C:\Windows\Fonts\segoeui.ttf", "DejaVuSans.ttf"], 13)
    warn = load_font([r"C:\Windows\Fonts\segoeui.ttf", "DejaVuSans.ttf"], 12)

    d.text((400, 300), "DeskGadget", font=title, fill=INK, anchor="mm")
    d.text((400, 350), "C A R   T H I N G", font=small, fill=MUTED, anchor="mm")

    bar_w, bar_h = 168, 3
    bx, by = (800 - bar_w) // 2, 390
    d.rounded_rectangle((bx, by, bx + bar_w, by + bar_h), radius=2, fill=(26, 32, 44))
    for x in range(bar_w):
        t = x / (bar_w - 1)
        if t < 0.5:
            k = t / 0.5
            c = tuple(int(PINK[i] + (VIOLET[i] - PINK[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            c = tuple(int(VIOLET[i] + (CYAN[i] - VIOLET[i]) * k) for i in range(3))
        d.line((bx + x, by, bx + x, by + bar_h), fill=c)

    d.text((400, 438), "Power with the adapter provided with your device",
           font=warn, fill=(74, 84, 100), anchor="mm")
    return img


def rgb565(img: Image.Image) -> bytes:
    out = bytearray()
    px = img.load()
    for y in range(img.height - 1, -1, -1):
        for x in range(img.width):
            r, g, b = px[x, y]
            out += struct.pack("<H", ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))
    return bytes(out)


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--png":
        # the same design as Weston's background, no partition involved
        design().save(sys.argv[2])
        print("wrote", sys.argv[2])
        return 0

    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    data = bytearray(source.read_bytes())

    header = bytes(data[OFFSETS[0]:OFFSETS[0] + 138])
    if header[:2] != b"BM":
        print("This is not a logo partition image (no BMP header at 256).")
        return 1

    body = rgb565(design().rotate(-90, expand=True))
    if len(body) != SIZE:
        print("Unexpected BMP body size", len(body))
        return 1

    for offset in OFFSETS:
        data[offset:offset + 138] = header
        data[offset + 138:offset + 138 + SIZE] = body

    target.write_bytes(data)
    print("wrote", target, len(data), "bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
