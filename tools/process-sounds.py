"""
Make the game's sounds from the raw recordings. python3 tools/process-sounds.py

Reads tools/sounds.json; for each sound: trims trailing silence, makes it mono (unless it is stereo ambience), peak-normalises it to
its `peak` (dBFS), and encodes AAC in an .m4a, which every browser the game targets decodes (Safari included). Writes the files to
public/audio/ with a manifest.json (id -> file, duration, bus, loop, source) and CREDITS.md listing every source and licence.
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets-src', 'sounds', 'raw')
OUT = os.path.join(ROOT, 'public', 'audio')
os.makedirs(OUT, exist_ok=True)
cfg = json.load(open(os.path.join(ROOT, 'tools', 'sounds.json')))


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def max_volume(path, chain, stereo=False):
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-ac', '2' if stereo else '1', '-af', chain + 'volumedetect', '-f', 'null', '-'])
    m = re.search(r'max_volume:\s*(-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else 0.0


def duration(path):
    r = run(['ffmpeg', '-hide_banner', '-i', path, '-f', 'null', '-'])
    m = re.findall(r'time=(\d+):(\d+):([\d.]+)', r.stderr)
    if not m:
        return 0.0
    h, mi, s = m[-1]
    return int(h) * 3600 + int(mi) * 60 + float(s)


# The sounds made with ElevenLabs: the tool adds them with defaults, unless sounds.json names one (to change how it is made).
STEREO = {'sea-loop', 'engine-loop'}
named = {x['id'] for x in cfg['sounds']}
generated = json.load(open(os.path.join(ROOT, 'tools', 'sfx-prompts.json')))['sounds']
for g in generated:
    if g['id'] in named or not os.path.exists(os.path.join(RAW, 'elevenlabs', g['id'] + '.mp3')):
        continue
    loop = bool(g.get('loop'))
    cfg['sounds'].append({'id': g['id'], 'src': 'elevenlabs/' + g['id'] + '.mp3', 'bus': 'ambience' if loop else 'sfx', 'peak': -6 if loop else -2, 'loop': loop, 'stereo': g['id'] in STEREO})

manifest = {}
for s in cfg['sounds']:
    src = os.path.join(RAW, s['src'])
    out = os.path.join(OUT, s['id'] + '.m4a')
    stereo = s.get('stereo', False)
    chain = ''
    # Trailing silence goes (a reverb tail's last whisper is not worth its seconds), and the start is cut to the first sound.
    if not s.get('loop'):
        chain += 'silenceremove=start_periods=1:start_threshold=-55dB:stop_periods=1:stop_duration=0.25:stop_threshold=-55dB,'
    gain = s.get('peak', -3) - max_volume(src, chain, stereo)
    r = run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-af', f'{chain}volume={gain:.2f}dB', '-ar', '44100', '-ac', '2' if stereo else '1', '-c:a', 'aac', '-b:a', '112k' if stereo else '96k', out])
    if r.returncode != 0:
        print('FAILED', s['id'], r.stderr[:300])
        continue
    src_name = s['src'].split('/')[0]
    info = cfg['sources'].get(src_name, {})
    manifest[s['id']] = {'file': s['id'] + '.m4a', 'duration': round(duration(out), 3), 'bus': s.get('bus', 'sfx'), 'loop': bool(s.get('loop')), 'source': src_name, 'licence': info.get('licence', '?')}
    print(f"{s['id']:18} {manifest[s['id']]['duration']:6.2f} s  {os.path.getsize(out) // 1024:4d} KB  gain {gain:+.1f} dB")

json.dump({'sounds': manifest}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
lines = ['# Sound credits', '', 'The game\'s sounds are real recordings, made by the people below. Licences are those of the originals.', '']
for name, info in cfg['sources'].items():
    used = [k for k, v in manifest.items() if v['source'] == name]
    lines += [f"- **{info['title']}** by {info['author']}, {info['licence']}. {info['url']}", f"  - {info.get('note', '')}", f"  - used for: {', '.join(used)}"]
open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(lines) + '\n')
print(f'{len(manifest)} sounds, {sum(os.path.getsize(os.path.join(OUT, v["file"])) for v in manifest.values()) // 1024} KB in public/audio/')
