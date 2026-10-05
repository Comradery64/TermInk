"""TermInk app icon, drawn to Apple's macOS icon template.

Canvas 1024x1024; the icon body is 824x824, centred (100px clear margin), with a
continuous-corner "squircle" outline (superellipse, n=5) and a soft drop shadow,
like the system apps. Drawn at 4x and downsampled for clean edges.
Run: python3 tools/make_icon.py  ->  icon.png (feed to `pnpm tauri icon icon.png`)
"""
import math, random
from PIL import Image, ImageDraw, ImageFilter

S = 4                      # supersampling
C = 1024 * S
BODY, MARGIN = 824 * S, 100 * S
R = round(185.4 * S)          # Apple's template corner radius for the 824 body

def squircle(x0, y0, w, h, n=4.0, steps=720):
    """Superellipse outline: Apple's continuous corners, not circular arcs."""
    cx, cy, a, b = x0 + w / 2, y0 + h / 2, w / 2, h / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    return pts

def rrect_mask(size, box, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, r, fill=255)
    return m

img = Image.new("RGBA", (C, C), (0, 0, 0, 0))

# drop shadow under the body (template: soft, slightly below)
shadow = Image.new("L", (C, C), 0)
ImageDraw.Draw(shadow).rounded_rectangle((MARGIN, MARGIN + 12 * S, MARGIN + BODY, MARGIN + 12 * S + BODY), R, fill=95)
shadow = shadow.filter(ImageFilter.GaussianBlur(14 * S))
img.paste((0, 0, 0, 255), (0, 0), shadow)

# body: matte graphite plastic, faintly lighter at the top
body_mask = Image.new("L", (C, C), 0)
ImageDraw.Draw(body_mask).rounded_rectangle((MARGIN, MARGIN, MARGIN + BODY, MARGIN + BODY), R, fill=255)
body = Image.new("RGBA", (C, C))
bd = ImageDraw.Draw(body)
for y in range(C):
    t = (y - MARGIN) / BODY
    v = int(52 - 16 * max(0.0, min(1.0, t)))
    bd.line([(0, y), (C, y)], fill=(v, v, v - 1, 255))
rnd = random.Random(7)
grain = Image.new("L", (C // 8, C // 8))
grain.putdata([rnd.randint(0, 255) for _ in range((C // 8) ** 2)])
grain = grain.resize((C, C), Image.BILINEAR).point(lambda p: int(p * 0.05))
body = Image.composite(Image.new("RGBA", (C, C), (255, 255, 255, 255)), body, grain)
img.paste(body, (0, 0), body_mask)
# top catch-light on the plastic rim
rim = Image.new("L", (C, C), 0)
ImageDraw.Draw(rim).rounded_rectangle((MARGIN, MARGIN, MARGIN + BODY, MARGIN + BODY), R, outline=70, width=3 * S)
rim = Image.composite(rim, Image.new("L", (C, C), 0), Image.linear_gradient("L").rotate(180).resize((C, C)))
img.paste((255, 255, 255, 255), (0, 0), rim.point(lambda p: p // 2))

# the screen: uniform bezel, softly rounded glass
B = 66 * S
sx0, sy0, sx1, sy1 = MARGIN + B, MARGIN + B, MARGIN + BODY - B, MARGIN + BODY - B
sr = 44 * S
scr_mask = rrect_mask((C, C), (sx0, sy0, sx1, sy1), sr)
page = Image.new("RGBA", (C, C), (226, 225, 219, 255))
pd = ImageDraw.Draw(page)
sw, sh = sx1 - sx0, sy1 - sy0

def bar(x, y, w, h, color):
    pd.rounded_rectangle((sx0 + x * sw, sy0 + y * sh, sx0 + (x + w) * sw, sy0 + (y + h) * sh), radius=3 * S, fill=color)

# ghosts of the previous page: faint text lines that never quite flipped
for i, w in enumerate([0.62, 0.46, 0.70, 0.38]):
    bar(0.13, 0.15 + i * 0.11, w, 0.036, (211, 210, 204, 255))

# the prompt: chevron and a solid block cursor, in pigment black
ink = (22, 22, 21, 255)
px, py, ph = sx0 + 0.13 * sw, sy0 + 0.68 * sh, 0.15 * sh
t = 0.045 * sh
pd.polygon([(px, py), (px + t, py), (px + ph * 0.62 + t, py + ph / 2), (px + t, py + ph),
            (px, py + ph), (px + ph * 0.62, py + ph / 2)], fill=ink)
cx = px + ph * 0.62 + 0.09 * sw
pd.rectangle((cx, py, cx + 0.085 * sw, py + ph), fill=ink)

# stipple: page-colored specks knocked out of the ink, faint mottle on the page
rnd = random.Random(3)
st = Image.new("L", (C, C), 0)
sd = ImageDraw.Draw(st)
for _ in range(9000):
    x, y = rnd.randint(sx0, sx1), rnd.randint(sy0, sy1)
    sd.ellipse((x, y, x + 2 * S, y + 2 * S), fill=rnd.randint(60, 170))
page = Image.composite(Image.new("RGBA", (C, C), (226, 225, 219, 255)), page, st.point(lambda p: p // 3))
# room light: brighter toward the top-left, falloff at the edges
light = Image.radial_gradient("L").resize((sw * 2, sh * 2)).crop((int(sw * 0.55), int(sh * 0.55), int(sw * 1.55), int(sh * 1.55)))
lit = Image.new("L", (C, C), 0); lit.paste(light, (sx0, sy0))
page = Image.composite(Image.new("RGBA", (C, C), (196, 195, 189, 255)), page, lit.point(lambda p: int(p * 0.35)))
img.paste(page, (0, 0), scr_mask)

# recess: the bezel's edge throws a shadow onto the top of the glass
rec = Image.new("L", (C, C), 0)
ImageDraw.Draw(rec).rounded_rectangle((sx0, sy0 - 10 * S, sx1, sy0 + 14 * S), sr, fill=120)
rec = rec.filter(ImageFilter.GaussianBlur(8 * S))
rec = Image.composite(rec, Image.new("L", (C, C), 0), scr_mask)
img.paste((0, 0, 0, 255), (0, 0), rec)
edge = Image.new("L", (C, C), 0)
ImageDraw.Draw(edge).rounded_rectangle((sx0, sy0, sx1, sy1), sr, outline=150, width=2 * S)
img.paste((0, 0, 0, 255), (0, 0), edge)

img.resize((1024, 1024), Image.LANCZOS).save("icon.png")
print("wrote icon.png")
