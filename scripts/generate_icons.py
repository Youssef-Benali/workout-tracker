#!/usr/bin/env python3
"""Generate the Workout Tracker PWA icons.

The icon is a flat dark tile with an accent ring and a dumbbell. All drawing is
done at 4x and downsampled with Lanczos for clean edges. Pillow is only needed
to build the assets; the deployed app has no dependencies.

Usage:
    python scripts/generate_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
DARK = (16, 19, 26, 255)
ACCENT = (124, 151, 255, 255)
SUPERSAMPLE = 4


def rounded_bar(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int, int],
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_icon(size: int, maskable: bool) -> Image.Image:
    scale = SUPERSAMPLE
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), DARK)
    draw = ImageDraw.Draw(image)

    # A single, simple idea: a training ring with a dumbbell at its centre.
    art_scale = 0.70 if maskable else 0.86
    cx = cy = canvas_size / 2
    ring_radius = canvas_size * 0.5 * art_scale * 0.76
    ring_width = max(2, round(canvas_size * 0.014 * art_scale))
    ring_box = (
        round(cx - ring_radius),
        round(cy - ring_radius),
        round(cx + ring_radius),
        round(cy + ring_radius),
    )
    draw.ellipse(ring_box, outline=ACCENT, width=ring_width)

    # Dimensions are expressed against the super-sampled canvas so the artwork
    # scales identically at 192 and 512 px.
    unit = canvas_size * art_scale / 512
    bar_w = round(214 * unit)
    bar_h = round(30 * unit)
    bar_left = round(cx - bar_w / 2)
    bar_top = round(cy - bar_h / 2)
    bar_radius = round(bar_h / 2)
    rounded_bar(
        draw,
        (bar_left, bar_top, bar_left + bar_w, bar_top + bar_h),
        bar_radius,
        ACCENT,
    )

    plate_h = round(160 * unit)
    plate_w = round(42 * unit)
    plate_radius = round(16 * unit)
    gap = round(8 * unit)
    inner_offset = round(66 * unit)
    outer_offset = inner_offset + plate_w + gap
    for direction in (-1, 1):
        # Put each plate outside the bar's centre by using the sign cleanly.
        if direction > 0:
            inner_box = (
                round(cx + inner_offset),
                round(cy - plate_h / 2),
                round(cx + inner_offset + plate_w),
                round(cy + plate_h / 2),
            )
            outer_box = (
                round(cx + outer_offset),
                round(cy - plate_h * 0.39),
                round(cx + outer_offset + plate_w * 0.82),
                round(cy + plate_h * 0.39),
            )
        else:
            inner_box = (
                round(cx - inner_offset - plate_w),
                round(cy - plate_h / 2),
                round(cx - inner_offset),
                round(cy + plate_h / 2),
            )
            outer_box = (
                round(cx - outer_offset - plate_w * 0.82),
                round(cy - plate_h * 0.39),
                round(cx - outer_offset),
                round(cy + plate_h * 0.39),
            )
        rounded_bar(draw, inner_box, plate_radius, ACCENT)
        rounded_bar(draw, outer_box, round(plate_radius * 0.8), ACCENT)

    image = image.resize((size, size), Image.Resampling.LANCZOS)
    return image.convert("RGB")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for filename, size, maskable in targets:
        path = ICONS / filename
        draw_icon(size, maskable).save(path, "PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
