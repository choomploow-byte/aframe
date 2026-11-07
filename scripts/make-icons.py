"""Generate the 1024x1024 source icon (app-icon.png). Then run: npx tauri icon app-icon.png

Placeholder artwork: a warm accent rounded square (#C96442). Replace before launch (Phase 11).
Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = 232
ACCENT = (201, 100, 66, 255)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=RADIUS, fill=ACCENT)

out = Path(__file__).resolve().parent.parent / "app-icon.png"
img.save(out)
print(f"wrote {out}")
