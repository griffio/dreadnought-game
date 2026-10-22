"""
Make the crew's voices from the raw speech. python3 tools/process-voices.py [id ...]

Reads tools/voice-lines.json; each line is trimmed of the silence round it, put over its role's filter (the masthead telephone, a
voice-pipe, the wireless set), levelled and encoded as mono AAC in public/audio/voices/, with a manifest.json of the same shape as the
sound effects' (plus the role and the words, for captions) and a CREDITS.md. The filters are what makes a clean studio voice sound like
a 1940s ship: a narrow band, squashed and a little clipped, with hiss under it and, on the telephone and the wireless, the click of
the key as it goes on and off.
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets-src', 'voices', 'raw')
OUT = os.path.join(ROOT, 'public', 'audio', 'voices')
os.makedirs(OUT, exist_ok=True)
doc = json.load(open(os.path.join(ROOT, 'tools', 'voice-lines.json')))
wanted = sys.argv[1:]
prov = {p['id']: p for p in json.load(open(os.path.join(ROOT, 'assets-src', 'voices', 'provenance.json')))}

# hp/lp: the band that gets through, Hz. comp: the compressor. hiss: level of the noise under it. key: level of the click when the key
# goes on and off (0: none). flutter: depth of the wavering of a weak signal. echo: a short metallic ring, as in a tube.
PROFILES = {
    'telephone': dict(hp=380, lp=3300, comp='acompressor=threshold=0.04:ratio=6:attack=5:release=80:makeup=4', hiss=0.010, key=0.10, flutter=0.0, echo=None, mid=None),
    'pipe': dict(hp=300, lp=3800, comp='acompressor=threshold=0.05:ratio=5:attack=5:release=90:makeup=3', hiss=0.005, key=0.0, flutter=0.0, echo='aecho=0.85:0.5:11|23:0.30|0.15', mid='equalizer=f=1300:t=q:w=1.3:g=5'),
    'wireless': dict(hp=520, lp=2700, comp='acompressor=threshold=0.035:ratio=8:attack=4:release=70:makeup=5', hiss=0.020, key=0.14, flutter=0.10, echo=None, mid='equalizer=f=1800:t=q:w=1.5:g=3'),
}


def run(args):
    return subprocess.run(args, capture_output=True, text=True)


def duration(path):
    r = run(['ffmpeg', '-hide_banner', '-i', path, '-f', 'null', '-'])
    m = re.findall(r'time=(\d+):(\d+):([\d.]+)', r.stderr)
    if not m:
        return 0.0
    h, mi, s = m[-1]
    return int(h) * 3600 + int(mi) * 60 + float(s)


def max_volume(path):
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'])
    m = re.search(r'max_volume:\s*(-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else 0.0


TRIM = 'silenceremove=start_periods=1:start_threshold=-48dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-48dB:detection=peak,areverse'

manifest = {}
for line in doc['lines']:
    role = doc['roles'][line['role']]
    p = PROFILES[role['filter']]
    src = os.path.join(RAW, line['id'] + '.mp3')
    if not os.path.exists(src):
        continue
    out = os.path.join(OUT, line['id'] + '.m4a')
    if wanted and line['id'] not in wanted and os.path.exists(out) and False:
        continue
    # 1. Trim, then the voice's own chain (band, shape, compress, clip) into a temporary file.
    tmp = os.path.join(OUT, '_' + line['id'] + '.wav')
    chain = [TRIM, f"highpass=f={p['hp']}", f"lowpass=f={p['lp']}"]
    if p['mid']:
        chain.append(p['mid'])
    chain += [p['comp'], 'asoftclip=type=tanh']
    if p['flutter']:
        chain.append(f"tremolo=f=9:d={p['flutter']}")
    if p['echo']:
        chain.append(p['echo'])
    r = run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-af', ','.join(chain), '-ar', '44100', '-ac', '1', tmp])
    if r.returncode != 0:
        print('FAILED', line['id'], r.stderr[:300])
        continue
    d = duration(tmp)
    # 2. Hiss under it, and the key's click before and after, then level it.
    graph = f"[0:a]apad=pad_dur=0.12[v];anoisesrc=color=pink:amplitude={p['hiss']}:sample_rate=44100:duration={d + 0.12:.3f},highpass=f=600,lowpass=f={p['lp']}[h];[v][h]amix=inputs=2:duration=first:normalize=0[m]"
    if p['key'] > 0:
        click = f"anoisesrc=color=white:amplitude={p['key']}:sample_rate=44100:duration=0.045,highpass=f=1100,lowpass=f=3400,afade=t=out:d=0.045"
        graph += f";{click},asplit[a][b];[a][m][b]concat=n=3:v=0:a=1[o]"
    else:
        graph += ';[m]anull[o]'
    tmp2 = os.path.join(OUT, '_' + line['id'] + '-2.wav')
    r = run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, '-filter_complex', graph, '-map', '[o]', '-ar', '44100', '-ac', '1', tmp2])
    if r.returncode != 0:
        print('FAILED', line['id'], r.stderr[:300])
        continue
    gain = -3.0 - max_volume(tmp2)
    r = run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', tmp2, '-af', f'volume={gain:.2f}dB', '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', out])
    os.remove(tmp)
    os.remove(tmp2)
    if r.returncode != 0:
        print('FAILED', line['id'], r.stderr[:300])
        continue
    manifest[line['id']] = {
        'file': line['id'] + '.m4a',
        'duration': round(duration(out), 3),
        'bus': 'voice',
        'loop': False,
        'source': 'elevenlabs-tts',
        'licence': 'ElevenLabs terms',
        'role': line['role'],
        'text': line['text'],
    }
    print(f"{line['id']:30} {line['role']:9} {manifest[line['id']]['duration']:5.2f} s  {os.path.getsize(out) // 1024:3d} KB  gain {gain:+.1f} dB")

json.dump({'sounds': manifest}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
lines = [
    '# Voice credits',
    '',
    "The crew's lines are spoken by synthetic voices from ElevenLabs text to speech (model eleven_multilingual_v2), from the words in tools/voice-lines.json.",
    'Whether commercial use is allowed depends on the ElevenLabs plan the lines were made under: check https://elevenlabs.io/terms before shipping.',
    '',
]
for name, role in doc['roles'].items():
    ids = [k for k, v in manifest.items() if v['role'] == name]
    lines.append(f"- **{role['title']}**: the premade voice \"{role['voice']}\" over a {role['filter']} filter. {len(ids)} lines.")
open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(lines) + '\n')
print(f'{len(manifest)} lines, {sum(os.path.getsize(os.path.join(OUT, v["file"])) for v in manifest.values()) // 1024} KB, {sum(v["duration"] for v in manifest.values()):.0f} s in public/audio/voices/')
