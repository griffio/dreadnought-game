# Asset tools

Build-time scripts that make the game's pictures and sounds. Nothing here runs in the browser, and the keys never reach the bundle.

## Keys

`.env` in the project root (ignored by git; never commit it):

| Variable | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | FLUX.2 [klein] on Cloudflare Workers AI (`@cf/black-forest-labs/flux-2-klein-4b`) |
| `ELEVENLABS_API_TOKEN` | crew speech (text to speech) |

(`CLOUDFLARE_API_KEY`, the account's global key, is not used by any tool: delete it.)

## Ship textures and decals

```
node tools/textures.mjs [layer ...]     # candidates -> assets-src/textures/raw|candidates, logged in provenance.json
python3 tools/contact-sheet.py          # contact sheets of the candidates, to choose from
python3 tools/process-textures.py       # the chosen pictures -> public/textures/weathering.png and decals.png
```

- The model is the 4B one, which is Apache 2.0. Every picture's prompt, seed and model are in `assets-src/textures/provenance.json`.
- `process-textures.py` has a `CHOICE` table naming the picture used for each layer. The atlases are **data, not colours**: the ship shader
  (`src/render/ships/ship.wgsl`) keeps its own palette and uses them as masks and detail. The channel layout of each layer is in that script
  and in the shader's `L_*` constants; keep the two in step.
- Only the chosen source pictures are committed. The other candidates live in `assets-src/textures/candidates/` (ignored).

## Voices

```
node tools/voices.mjs [id ...]          # the lines in tools/voice-lines.json not yet made -> assets-src/voices/raw/, logged in provenance.json
python3 tools/process-voices.py         # raw lines -> filtered AAC in public/audio/voices/ (+ manifest.json, CREDITS.md)
```

- Four premade British ElevenLabs voices, one per role: Daniel (lookout), George (gunnery officer), Alice (damage control), Lily (wireless:
  the spotter aircraft). `tools/voice-lines.json` holds the roles (voice, delivery, filter) and every line; a line's key is its id without
  the number, and `src/audio/voice.ts` says when each key is spoken (its priority, cooldown and whether it is put in the log).
- The filters are the point: `telephone` (masthead telephone), `pipe` (voice-pipe: tinny, with a metallic ring) and `wireless` (narrow,
  fluttering, hissing), the last two with the click of the key. Change a profile in `process-voices.py` and run it again; no new speech is needed.
- To change a line: edit its text in the JSON, delete `assets-src/voices/raw/<id>.mp3`, run both scripts. Whole script is about 1,400 characters.
- Add a new call: add lines (`voice-<key>-1`...), add the key to `VOICE_RULES` in `src/audio/voice.ts`, and cue it from the game with
  `this.cue('<key>')` (`tests/voice.test.ts` checks that the rules, the lines and the game's calls agree).
- `tools/smoke-assets.mjs` is the old three-line trial (its outputs, in `assets-src/smoke/`, are ignored).
