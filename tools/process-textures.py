"""
Turn the chosen raw pictures into the two atlases the ship shader reads. python3 tools/process-textures.py

  public/textures/weathering.png   512 x (512 x 6)   tiling layers, sampled triplanar in ship space
  public/textures/decals.png       256 x (256 x 3)   one-off marks, projected onto the hull where a shell has struck

They are data, not colours: the shader keeps its own palette, and these say where it is worn, streaked, dirty or burnt. So each layer
is reduced to the channels the shader wants (a detail value around one half, or a mask from zero to one), made to tile, and packed.
Change CHOICE to use another candidate; the raw pictures and what made them are in assets-src/textures/ (provenance.json).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets-src', 'textures', 'raw')
OUT = os.path.join(ROOT, 'public', 'textures')
PREVIEW = os.path.join(ROOT, 'assets-src', 'textures', 'sheets')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

CHOICE = {'steel': 'steel-2', 'wear': 'wear-2', 'streaks': 'streaks-3', 'grime': 'grime-4', 'wood': 'wood-2', 'rivets': 'rivets-1',
          'scorch': 'scorch-3', 'soft': 'scorch-2', 'hole': 'hole-2'}
TILE, DECAL = 512, 256


def load(name):
    for ext in ('jpg', 'png', 'webp'):
        p = os.path.join(RAW, f'{name}.{ext}')
        if os.path.exists(p):
            return np.asarray(Image.open(p).convert('RGB'), dtype=np.float32) / 255.0
    raise FileNotFoundError(name)


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def seamless(a, band=0.16):
    """Make a picture tile: across each edge, over a band of `band` of its size, cross-fade into the picture shifted by half, so that
    the two edges meet on the same content. The middle of the picture is untouched."""
    for axis in (1, 0):
        n = a.shape[axis]
        shifted = np.roll(a, n // 2, axis=axis)
        x = (np.arange(n) + 0.5) / n
        d = np.minimum(x, 1 - x)  # 0 at the edges, 0.5 in the middle
        w = np.clip(d / band, 0, 1)
        w = w * w * (3 - 2 * w)
        shape = [1, 1] + [1] * (a.ndim - 2)
        shape[axis] = n
        w = w.reshape(shape)
        a = a * w + shifted * (1 - w)
    return a


def blur(a, r):
    """A Gaussian blur that wraps round the edges, as a tiling picture's neighbours do, so that no seam is darkened or lightened."""
    pad = int(r * 3) + 2
    padded = np.pad(a, [(pad, pad), (pad, pad)] + [(0, 0)] * (a.ndim - 2), mode='wrap')
    im = Image.fromarray((np.clip(padded, 0, 1) * 255).astype(np.uint8))
    out = np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0
    return out[pad:-pad, pad:-pad]


def highpass(l, sigma):
    """The picture without its slow variations (the light across it): what is left is the detail, and it tiles better."""
    low = blur(l, sigma)
    return l - low + low.mean()


def centred_detail(l, gain=0.5):
    """A brightness detail around one half: the picture's own mean is one half, a standard deviation is `gain` of the range."""
    return np.clip(0.5 + (l - l.mean()) / max(l.std(), 1e-4) * (gain / 3.0), 0, 1)


def resize(a, n):
    c = a.shape[2] if a.ndim == 3 else 1
    chans = [Image.fromarray((np.clip(a[..., i], 0, 1) * 255).astype(np.uint8)).resize((n, n), Image.LANCZOS) for i in range(c)]
    return np.stack([np.asarray(ch, dtype=np.float32) / 255.0 for ch in chans], axis=-1)


def pack(r, g=None, b=None):
    z = np.zeros_like(r)
    return np.stack([r, z if g is None else g, z if b is None else b], axis=-1)


def tile_layers():
    layers = []
    # 0 steel: R detail of the plating (rivets, seams, scuffs), G its finer scratches.
    s = seamless(load(CHOICE['steel']))
    l = lum(s)
    layers.append(pack(centred_detail(highpass(l, 40), 0.55), centred_detail(l - blur(l, 3), 0.6)))
    # 1 wear: R rust and bare-metal patches where the paint has gone, G the lighter chips around them, B the paint's own mottling.
    w = seamless(load(CHOICE['wear']))
    # The paint is blue-grey (red below blue by about a tenth) and rust, of any darkness, is not: the picture is cleanly two-sided.
    rust = np.clip((w[..., 0] - w[..., 2] + 0.06) / 0.09, 0, 1)
    rust = blur(rust, 0.8)
    paint = lum(w)
    chip = np.clip((paint - blur(paint, 6) - 0.02) / 0.12, 0, 1) * (1 - rust)
    layers.append(pack(rust, chip, centred_detail(paint, 0.4)))
    # 2 streaks: R the drip streaks, a little softened so that they are not razor sharp.
    st = seamless(load(CHOICE['streaks']))
    layers.append(pack(blur(np.clip(lum(st) * 1.15, 0, 1), 0.9)))
    # 3 grime: R smudges, lifted and softened.
    g = seamless(load(CHOICE['grime']))
    layers.append(pack(blur(np.clip(lum(g) * 1.2, 0, 1), 1.6)))
    # 4 wood: R the grain and seams of the planks, G the dark caulking lines alone.
    wd = seamless(load(CHOICE['wood']))
    lw = lum(wd)
    layers.append(pack(centred_detail(highpass(lw, 70), 0.6), np.clip((blur(lw, 6) - lw - 0.04) / 0.12, 0, 1)))
    # 5 rivets: R the armour plating's detail.
    rv = seamless(load(CHOICE['rivets']))
    layers.append(pack(centred_detail(highpass(lum(rv), 40), 0.6)))
    return [resize(l, TILE) for l in layers]


def radial(n, inner, outer):
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n * 2 - 1
    r = np.sqrt(x * x + y * y)
    t = np.clip((outer - r) / (outer - inner), 0, 1)
    return t * t * (3 - 2 * t)


def decal_layers():
    layers = []
    # 0 scorch: R the soot (dark on the picture is soot), fading to nothing before the edge of the square.
    sc = load(CHOICE['scorch'])
    soot = np.clip((1 - lum(sc) - 0.04) / 0.85, 0, 1)
    soot = resize(soot[..., None], DECAL)[..., 0] * radial(DECAL, 0.78, 0.98)
    layers.append(pack(soot))
    # 1 soft scorch: the same from the feathered picture.
    sf = load(CHOICE['soft'])
    soot2 = np.clip((1 - lum(sf) - 0.03) / 0.8, 0, 1)
    soot2 = resize(soot2[..., None], DECAL)[..., 0] * radial(DECAL, 0.78, 0.98)
    layers.append(pack(soot2))
    # 2 hole: R the opening (the picture's pure black), G the charred and rusted rim around it, B the torn metal's edge detail.
    h = load(CHOICE['hole'])
    lh = lum(h)
    # The hole is the dark region joined to the centre of the picture.
    dark = (lh < 0.09).astype(np.float32)
    n = lh.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    centre = ((xx - n / 2) ** 2 + (yy - n / 2) ** 2) < (n * 0.36) ** 2
    opening = blur(dark * centre, 2.0)
    opening = np.clip((opening - 0.35) / 0.4, 0, 1)
    ring = np.clip(blur(opening, 26) * 1.6, 0, 1) * (1 - opening)
    rust = np.clip((h[..., 0] - (h[..., 1] + h[..., 2]) * 0.5 - 0.02) / 0.18, 0, 1)
    rim = np.clip(ring * (0.55 + 0.9 * blur(rust, 4)), 0, 1)
    edge = np.clip(0.5 + (lh - blur(lh, 5)) * 3.0, 0, 1)
    layers.append(pack(opening, rim, edge))
    out = []
    for l in layers:
        out.append(resize(l, DECAL) if l.shape[0] != DECAL else l)
    return out


def save_strip(layers, name):
    h = layers[0].shape[0]
    strip = np.concatenate(layers, axis=0)
    rgba = np.concatenate([strip, np.ones(strip.shape[:2] + (1,), np.float32)], axis=2)
    Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name), optimize=True)
    print(name, rgba.shape[1], 'x', rgba.shape[0], f'({len(layers)} layers of {h})', f'{os.path.getsize(os.path.join(OUT, name)) // 1024} KB')


tiles = tile_layers()
decals = decal_layers()
save_strip(tiles, 'weathering.png')
save_strip(decals, 'decals.png')

# A preview, to look at: every layer's channels side by side, and each tiling layer tiled 2x2.
def prev(l):
    return Image.fromarray((np.clip(l, 0, 1) * 255).astype(np.uint8))
cols = []
for l in tiles + decals:
    n = l.shape[0]
    ch = [prev(np.repeat(l[..., i:i + 1], 3, axis=2)).resize((200, 200)) for i in range(3)]
    cols.append(ch)
sheet = Image.new('RGB', (3 * 206 + 6, len(cols) * 206 + 6), (20, 24, 30))
for r, ch in enumerate(cols):
    for c, im in enumerate(ch):
        sheet.paste(im, (6 + c * 206, 6 + r * 206))
sheet.save(os.path.join(PREVIEW, 'packed-channels.png'))
tiled = Image.new('RGB', (6 * 258, 2 * 258), (20, 24, 30))
for i, l in enumerate(tiles):
    im = prev(np.concatenate([np.concatenate([l[..., :1].repeat(3, 2)] * 2, axis=1)] * 2, axis=0)).resize((256, 256))
    tiled.paste(im, (i * 258 + 1, 1))
    if tiles[i].shape[2] > 1:
        im2 = prev(np.concatenate([np.concatenate([l[..., 1:2].repeat(3, 2)] * 2, axis=1)] * 2, axis=0)).resize((256, 256))
        tiled.paste(im2, (i * 258 + 1, 259))
tiled.save(os.path.join(PREVIEW, 'packed-tiled.png'))
