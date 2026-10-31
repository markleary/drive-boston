# Back Bay sound effects

These twenty-six local sound effects comprise twenty-two ElevenLabs Sound Effects v2 generations and four locally mastered variations of the approved GT engine sources. They are not recordings of Boston or of a particular vehicle. No voices, music, or third-party recordings were supplied. The prompts, requested durations, provider settings, generation timestamps, and file checksums are recorded in [provenance.json](./provenance.json).

| File | Requested duration | Use |
| --- | ---: | --- |
| engine-idle.mp3 | 8 s | Constant idle engine loop |
| engine-drive.mp3 | 8 s | Constant mid-RPM engine loop |
| city-ambience.mp3 | 10 s | Quiet urban atmosphere loop |
| tire-road.mp3 | 8 s | Tire rolling loop |
| horn.mp3 | 2 s | Single natural dual-tone horn |
| tire-skid.mp3 | 3 s | Tire scrub loop |
| helicopter-rotor.mp3 | 8 s | Steady civilian helicopter rotor loop |
| crash-light.mp3 | 1.5 s | Low-speed bumper bump |
| crash-car.mp3 | 2.5 s | Car-to-car collision crunch |
| crash-heavy.mp3 | 3 s | Car into bus or wall at speed |
| pedestrian-thump.mp3 | 1.5 s | Soft padded thump of a struck walker |

The first six clips totaled 39 seconds. The helicopter iteration added one eight-second clip, for 47 seconds, and the collision iteration four one-shots totalling 8.5 seconds, for 55.5 seconds overall; existing clips were not regenerated. All assets are stereo MP3 at 44.1 kHz / 128 kbps, using the provider's seamless-loop option except for the horn and the four collision one-shots. The game decodes these local files after the user starts driving, softens loop seams, balances loudness with peak headroom, and blends/pitches the engine layers according to speed, throttle, and simulated gears. Road noise follows speed; tire scrub follows tight turns and handbraking. Helicopter mode crossfades the car layers away and adds a steady rotor whose load follows lift, climb rate, and horizontal speed. Collision one-shots are chosen by what the chassis touched and by the size of the knock (the chassis velocity change in one physics step): below 3.5 m/s the light bump plays, above it the car-to-car crunch for traffic and parked cars or the heavy impact for buses, trolleys, buildings and barriers, each with volume scaled by the knock and a little playback-rate variation; a struck walker plays the padded thump at a volume following vehicle speed. Each kind is rate-limited so a scraping chassis cannot stack voices. Master fades handle pause, mute, and browser visibility, and the horn cannot accumulate repeated voices. Quiet synthesized engine, horn, rotor and filtered-noise impact fallbacks are used only if their corresponding downloaded assets fail.

The generator is a local development tool: `node scripts/generate-audio.mjs` previews its plan, and adding `--generate` makes billable requests for missing files. Existing assets are skipped. It reads `ELEVENLABS_API_KEY` from the shell or the ignored root `.env`, sends it only as an authentication header to `https://api.elevenlabs.io`, and never includes it in game code or public output. There are no runtime provider calls. If generation is interrupted after a provider response but before a file is saved, inspect the account's usage before repeating the request; the script intentionally does not retry automatically.

Generated output use is subject to the generating account's applicable [ElevenLabs terms](https://elevenlabs.io/terms-of-use). Generation alone does not verify account subscription or license scope. API request fields follow the [official Sound Effects API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

## McLaren GT

Five car-specific effects (22 seconds) were generated with the same ElevenLabs v2 settings: `mclaren-gt-idle` (6 s loop), `mclaren-gt-drive` (8 s loop at 4,000 RPM), `mclaren-gt-high` (6 s loop at 7,000 RPM), `mclaren-gt-upshift` and `mclaren-gt-downshift` (1 s each, one-shots). These are synthetic GT V8 interpretations, not authentic vehicle recordings. The selected car controls the engine layers; the GT's actual Rapier drivetrain gear changes trigger its shift sounds. Shift playback uses a quieter mix, a 1,100 Hz low-pass filter, a 25 ms fade-in and an 80 ms fade-out to soften the generated clutch clicks while retaining the lower exhaust/blip character. Pause, mute, vehicle-mode changes and car changes gate/cancel the sounds.

Generate just these missing assets with `node scripts/generate-audio.mjs --only=mclaren-gt --generate`. The 60-second generation guard applies to pending assets per invocation. Existing files are never regenerated. The full library now has 121.5 nominal seconds of audio (93.5 directly generated, plus 28 mastered from existing sources).

If any dedicated car engine layer is still loading or fails to fetch/decode, the car uses the generic engine recordings across the full RPM range. Either generic loop can cover for the other; if both are unavailable, the synthesized engine remains audible. Once all three selected-car layers are ready, their normal mix replaces the fallback. Shift effects remain independent of engine-loop availability.

## McLaren 720S and Toyota Supra Mk4

Each car has five dedicated files: `idle` (6 s), `drive` (8 s), `high` (6 s), `upshift` (1 s) and `downshift` (1 s), using the prefixes `mclaren-720s` and `supra-mk4`. They are synthetic game effects, not recordings of the actual cars.

The 720S retains its approved ElevenLabs idle and softened shift clips. At the user's request, its driving/high-RPM clips are now **derived directly from the approved McLaren GT engine recordings**, replacing the separately generated layers that sounded like wind/whistle. Local FFmpeg mastering lowers pitch by 4%, adds a modest low/mid exhaust emphasis and reduces upper hiss. No modulation, chorus, extra noise or whistle is added. Its runtime engine blend uses the GT's source RPMs (4,000 / 7,000), filter range and crossfade; idle fades out completely above 8 m/s. The result shares the GT's combustion character while having a slightly deeper and fuller tone. The 720S still reports and shifts at its own physics RPM/gear values.

`node scripts/build-player-car-audio.mjs --only=mclaren-720s` builds missing 720S drive/high files from the existing GT sources without provider calls. Use `--only=supra-mk4` for the Supra. Adding `--force` remasters only the selected pair deliberately. The generator also invokes this step when the selected subset includes them. FFmpeg is a development dependency only. Provenance stores the exact source ID, source hash, original ElevenLabs prompt, mastering filter, output hash and timestamp; these four assets are explicitly marked as derivatives, not separate provider generations. The approved GT files are never modified.

The Supra keeps its separate ElevenLabs idle and soft shift clips. Its rejected windy driving/high layers are replaced by locally mastered GT exhaust sources: pitch is lowered 25% for a smoother six-cylinder-inspired firing character, low rumble is reduced, midrange combustion is emphasized and upper hiss is restrained. This is a synthetic straight-six-inspired interpretation, not an authentic 2JZ recording. Runtime playback follows the GT source RPMs (4,000 / 7,000), fully removes idle above 8 m/s and keeps enough mid/high harmonics for a continuous driving roar. The Supra's shift points and physical performance are unchanged.

Both new cars retain reduced shift gains (0.11 up / 0.14 down), a 650 Hz low-pass, 65 ms attack and 180 ms release. The GT's approved shift mix stays unchanged. Actual physics gear changes trigger each car's upshift/downshift clips.

Selecting a car silences the other engine banks and cancels pending shift sounds. A partial failure of the selected bank falls back to the generic engine mix across the full RPM range. Browser tests cover missing/corrupt files, switching to a healthy bank, pause, bike/helicopter transitions and persistence. Static MP3 playback never calls a provider.

The mastered 720S drive/high files use the `gt-exhaust-4` query revision; the Supra drive/high files use `six-exhaust-3`, and both cars' idle/shift clips retain `exhaust-2`, so reloading a preview fetches only the intended replacements.
