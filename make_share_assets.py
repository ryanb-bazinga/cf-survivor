#!/usr/bin/env python3
"""
Generates the link preview card and the home screen icons.

Run this once per season, after dropping the new season logo in at
assets/img/season-logo.png:

    python3 make_share_assets.py

It writes:
    assets/img/share-card.png   1200x630, what Teams/iMessage/email show
    assets/img/icon-180.png     iPhone home screen
    assets/img/icon-192.png     Android home screen
    assets/img/icon-512.png     splash / store listing

Nothing else in the site depends on this script at runtime. The files it
makes are plain images committed alongside everything else.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
IMG = ROOT / "assets" / "img"

# Same values as :root in assets/css/site.css.
INK = (10, 22, 20)
INK_2 = (16, 36, 32)
SAND = (241, 243, 240)
SAND_FAINT = (126, 145, 137)
ORANGE = (254, 135, 48)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
    "/Library/Fonts/Arial Narrow Bold.ttf",
]


def font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def tracked_text(draw, center_x, y, text, fnt, fill, tracking=0):
    """Draw letterspaced text centered on center_x. PIL has no tracking."""
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = center_x - total / 2
    for ch, width in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += width + tracking
    return total


def background(width, height):
    """Vertical gradient with a warm radial glow behind the logo."""
    top = np.array(INK_2, dtype=float)
    bottom = np.array(INK, dtype=float)
    ramp = np.linspace(0, 1, height)[:, None, None]
    canvas = top[None, None, :] * (1 - ramp) + bottom[None, None, :] * ramp
    canvas = np.repeat(canvas, width, axis=1)

    ys, xs = np.mgrid[0:height, 0:width]
    cx, cy = width / 2, height * 0.44
    radius = width * 0.46
    distance = np.sqrt(((xs - cx) / radius) ** 2 + ((ys - cy) / (radius * 0.78)) ** 2)
    glow = np.clip(1 - distance, 0, 1) ** 1.9 * 0.34

    warm = np.array(ORANGE, dtype=float)
    canvas = canvas * (1 - glow[..., None]) + warm[None, None, :] * glow[..., None]
    return Image.fromarray(np.clip(canvas, 0, 255).astype("uint8"), "RGB")


def share_card():
    width, height = 1200, 630
    card = background(width, height)
    draw = ImageDraw.Draw(card)

    tracked_text(draw, width / 2, 56, "CORNERSTONE FELLOWSHIP", font(26), SAND_FAINT, 7)

    logo = Image.open(IMG / "season-logo.png").convert("RGBA")
    target = 520
    logo = logo.resize((target, round(logo.height * target / logo.width)), Image.LANCZOS)
    logo_top = 124
    card.paste(logo, ((width - logo.width) // 2, logo_top), logo)

    sub_size = 40
    sub_y = logo_top + logo.height + 42
    tracked_text(
        draw, width / 2, sub_y, "STAFF & FAMILY FANTASY LEAGUE", font(sub_size), SAND, 3
    )

    rule_y = sub_y + sub_size + 24
    draw.rounded_rectangle(
        [width / 2 - 62, rule_y, width / 2 + 62, rule_y + 5], radius=3, fill=ORANGE
    )

    out = IMG / "share-card.png"
    card.save(out, optimize=True)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


def icons():
    """Rasterize the flame favicon into opaque squares for home screens."""
    source = IMG / "favicon.svg"
    staging = Path(tempfile.gettempdir()) / "cf-survivor-icon.png"
    subprocess.run(
        ["convert", "-background", "none", str(source), "-resize", "512x512", str(staging)],
        check=True,
    )
    mark = Image.open(staging).convert("RGBA")

    for size in (180, 192, 512):
        square = Image.new("RGB", (size, size), INK)
        scaled = mark.resize((size, size), Image.LANCZOS)
        square.paste(scaled, (0, 0), scaled)
        out = IMG / f"icon-{size}.png"
        square.save(out, optimize=True)
        print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")

    staging.unlink(missing_ok=True)


if __name__ == "__main__":
    if not (IMG / "season-logo.png").exists():
        sys.exit("assets/img/season-logo.png is missing")
    share_card()
    icons()
