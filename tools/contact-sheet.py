"""Contact sheets of the raw candidates, one per group of layers, to choose from. python3 tools/contact-sheet.py"""
import glob, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets-src', 'textures')
OUT = os.path.join(ROOT, 'sheets')
os.makedirs(OUT, exist_ok=True)
GROUPS = {'tiles-a': ['steel', 'wear', 'streaks'], 'tiles-b': ['grime', 'wood', 'rivets'], 'decals': ['scorch', 'hole', 'pit']}
T = 300
for name, layers in GROUPS.items():
    rows = []
    for layer in layers:
        files = sorted(glob.glob(os.path.join(ROOT, 'raw', f'{layer}-*.*')))
        rows.append((layer, files))
    width = max(len(f) for _, f in rows) * (T + 6) + 6
    sheet = Image.new('RGB', (width, len(rows) * (T + 26) + 6), (20, 24, 30))
    d = ImageDraw.Draw(sheet)
    for r, (layer, files) in enumerate(rows):
        for c, f in enumerate(files):
            im = Image.open(f).convert('RGB').resize((T, T), Image.LANCZOS)
            x, y = 6 + c * (T + 6), 6 + r * (T + 26)
            sheet.paste(im, (x, y + 20))
            d.text((x, y + 4), os.path.basename(f), fill=(230, 200, 120))
    sheet.save(os.path.join(OUT, f'{name}.png'))
    print(name, sheet.size)
