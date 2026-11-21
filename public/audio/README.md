# Back Bay sound effects

The game ships 50 synthetic effects, including 46 original ElevenLabs Sound Effects generations (33 v2 and 13 v3) and four locally mastered variations of the GT exhaust. The Storrowing reaction includes a generated nonverbal crowd boo. Generation prompts, requested durations, provider settings, timestamps, and file checksums are recorded in [provenance.json](./provenance.json).

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
| pond-fountain.mp3 | 10 s | Looping spray and splashes at both Fellsmere Pond jets. On foot and on the Ultra Bee, volume and treble rise as the player approaches the nearest jet within 145 m. |

The first six clips totaled 39 seconds. The helicopter iteration added one eight-second clip, for 47 seconds, and the collision iteration four one-shots totalling 8.5 seconds, for 55.5 seconds overall; existing clips were not regenerated. Assets are stereo MP3 at 44.1 kHz / 128 kbps, except the Tesla reverse loop which ships as lossless mono WAV, using the provider's seamless-loop option for engine, atmosphere, rotor and tire layers; horns, shifts, impacts and the crowd reaction are one-shots. The game decodes these local files after the user starts driving, softens loop seams, balances loudness with peak headroom, and blends/pitches the engine layers according to speed, throttle, and simulated gears. Road noise follows speed; tire scrub follows tight turns and handbraking. Helicopter mode crossfades the car layers away and adds a steady rotor whose load follows lift, climb rate, and horizontal speed. Collision one-shots are chosen by what the chassis touched and by the size of the knock (the chassis velocity change in one physics step): below 3.5 m/s the light bump plays, above it the car-to-car crunch for traffic and parked cars or the heavy impact for buses, trolleys, buildings and barriers, each with volume scaled by the knock and a little playback-rate variation; a struck walker plays the padded thump at a volume following vehicle speed. Each kind is rate-limited so a scraping chassis cannot stack voices. Master fades handle pause, mute, and browser visibility, and the horn cannot accumulate repeated voices. Quiet synthesized engine, horn, rotor and filtered-noise impact fallbacks are used only if their corresponding downloaded assets fail.

The generator is a local development tool: `node scripts/generate-audio.mjs` previews its plan, and adding `--generate` makes billable requests for missing files. Existing assets are skipped. It reads `ELEVENLABS_API_KEY` from the shell or the ignored root `.env`, sends it only as an authentication header to `https://api.elevenlabs.io`, and never includes it in game code or public output. There are no runtime provider calls. If generation is interrupted after a provider response but before a file is saved, inspect the account's usage before repeating the request; the script intentionally does not retry automatically.

Generated output use is subject to the generating account's applicable [ElevenLabs terms](https://elevenlabs.io/terms-of-use). Generation alone does not verify account subscription or license scope. API request fields follow the [official Sound Effects API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

## McLaren GT

Five car-specific effects (22 seconds) were generated with the same ElevenLabs v2 settings: `mclaren-gt-idle` (6 s loop), `mclaren-gt-drive` (8 s loop at 4,000 RPM), `mclaren-gt-high` (6 s loop at 7,000 RPM), `mclaren-gt-upshift` and `mclaren-gt-downshift` (1 s each, one-shots). These are synthetic GT V8 interpretations, not authentic vehicle recordings. The selected car controls the engine layers; the GT's actual Rapier drivetrain gear changes trigger its shift sounds. Shift playback uses a quieter mix, a 1,100 Hz low-pass filter, a 25 ms fade-in and an 80 ms fade-out to soften the generated clutch clicks while retaining the lower exhaust/blip character. Pause, mute, vehicle-mode changes and car changes gate/cancel the sounds.

Generate just these missing assets with `node scripts/generate-audio.mjs --only=mclaren-gt --generate`. The 60-second generation guard applies to pending assets per invocation. Existing files are never regenerated.

If any dedicated combustion-car engine layer is still loading or fails to fetch/decode, the car uses the generic engine recordings across the full RPM range. Either generic loop can cover for the other; if both are unavailable, the synthesized engine remains audible. Once all three selected-car layers are ready, their normal mix replaces the fallback. Shift effects remain independent of engine-loop availability.

## McLaren 720S and Toyota Supra Mk4

Each car has five dedicated files: `idle` (6 s), `drive` (8 s), `high` (6 s), `upshift` (1 s) and `downshift` (1 s), using the prefixes `mclaren-720s` and `supra-mk4`. They are synthetic game effects, not recordings of the actual cars.

The 720S retains its approved ElevenLabs idle and softened shift clips. At the user's request, its driving/high-RPM clips are now **derived directly from the approved McLaren GT engine recordings**, replacing the separately generated layers that sounded like wind/whistle. Local FFmpeg mastering lowers pitch by 4%, adds a modest low/mid exhaust emphasis and reduces upper hiss. No modulation, chorus, extra noise or whistle is added. Its runtime engine blend uses the GT's source RPMs (4,000 / 7,000), filter range and crossfade; idle fades out completely above 8 m/s. The result shares the GT's combustion character while having a slightly deeper and fuller tone. The 720S still reports and shifts at its own physics RPM/gear values.

`node scripts/build-player-car-audio.mjs --only=mclaren-720s` builds missing 720S drive/high files from the existing GT sources without provider calls. Use `--only=supra-mk4` for the Supra. Adding `--force` remasters only the selected pair deliberately. The generator also invokes this step when the selected subset includes them. FFmpeg is a development dependency only. Provenance stores the exact source ID, source hash, original ElevenLabs prompt, mastering filter, output hash and timestamp; these four assets are explicitly marked as derivatives, not separate provider generations. The approved GT files are never modified.

The Supra keeps its separate ElevenLabs idle and soft shift clips. Its rejected windy driving/high layers are replaced by locally mastered GT exhaust sources: pitch is lowered 25% for a smoother six-cylinder-inspired firing character, low rumble is reduced, midrange combustion is emphasized and upper hiss is restrained. This is a synthetic straight-six-inspired interpretation, not an authentic 2JZ recording. Runtime playback follows the GT source RPMs (4,000 / 7,000), fully removes idle above 8 m/s and keeps enough mid/high harmonics for a continuous driving roar. The Supra's shift points and physical performance are unchanged.

Both new cars retain reduced shift gains (0.11 up / 0.14 down), a 650 Hz low-pass, 65 ms attack and 180 ms release. The GT's approved shift mix stays unchanged. Actual physics gear changes trigger each car's upshift/downshift clips.

Selecting a car silences the other engine banks and cancels pending shift sounds. A partial failure of the selected bank falls back to the generic engine mix across the full RPM range. Browser tests cover missing/corrupt files, switching to a healthy bank, pause, bike/helicopter transitions and persistence. Static MP3 playback never calls a provider.

The mastered 720S drive/high files use the `gt-exhaust-4` query revision; the Supra drive/high files use `six-exhaust-3`, and both cars' idle/shift clips retain `exhaust-2`, so reloading a preview fetches only the intended replacements.

## Subaru WRX

Six ElevenLabs Sound Effects v3 clips provide 22 seconds of stock WRX-inspired audio (359 KB). Three loops cover warm idle, loaded exhaust and high-RPM exhaust. The mixer follows engine RPM, matching the two loaded loops’ measured firing-pulse frequencies across their crossfade. The six-speed drivetrain triggers the two shift clips. Above 45% of peak boost, a narrow band around the recorded compressor’s 600 Hz whir rises slightly in pitch and volume under throttle. The whir fades beneath the exhaust on lift and through a shift.

On phones, selecting the WRX loads its six files and switching away releases them. To generate missing WRX files, run `node scripts/generate-audio.mjs --only=subaru-wrx --generate`.

## Maserati GT2 Stradale

Five ElevenLabs Sound Effects v3 clips provide 21 seconds (342 KB) for the Nettuno twin-turbo V6, written to what road tests say of the car: a hushed, gruff idle, a bass-heavy gravelly roar that never becomes a scream, hard shifts and audible turbo induction. They are synthetic interpretations, not recordings of a Maserati.

| File | Requested duration | Use |
| --- | ---: | --- |
| maserati-gt2-stradale-idle.mp3 | 5 s | Idle loop, heard alone at rest and faded out by 2,250 rpm |
| maserati-gt2-stradale-drive.mp3 | 6 s | Loaded exhaust loop; its strongest tone is at 124 Hz |
| maserati-gt2-stradale-high.mp3 | 5 s | Full-load exhaust loop; its strongest tone is at 202 Hz |
| maserati-gt2-stradale-upshift.mp3 | 1 s | Dual-clutch upshift thump, entered 0.50 s in, where the event begins |
| maserati-gt2-stradale-turbo.mp3 | 4 s | Induction rush of the two turbochargers, with a whistle at 611 Hz |

The two exhaust loops are played at rpm/4,000 and rpm/6,500, the ratio of their measured tones, so the note is the same in both wherever they overlap (4,700 to 6,600 rpm) and rises in proportion to the revs. A closed throttle lowers the level and the low-pass cutoff, as the car's exhaust valves stay shut below 5,000 rpm in its road modes. The induction loop follows the physics' boost state through a band-pass on its whistle: it comes in with the boost at part throttle, stays under a fifth of the exhaust's level, and goes on the brakes. The upshift is loud under load and soft on a light pedal. The first high-rpm generation was 19 dB quieter than the other loops with a wandering pitch and was replaced by a second one with a reworded prompt; the rejected file is not shipped.

A downshift has no clip of its own: the loops rise with the revs as the lower gear takes up. A generated rev-match blip was tried first (its prompt asked for a short exhaust "bark"). Played beside the engine it stood apart from it, and as the gearbox dropped from fourth to first on the way to a stop the three in a row were heard as a dog barking, so that clip is not shipped and the generator no longer lists it.

The levels were set on recordings of the game's own output, not on the clips: a tap on the node that feeds the audio output while the real game ran muted, the car driven down Logan's runway 09/27 from a synthetic controller's triggers (idle, full throttle to 187 km/h, lift, brake to a stop; then the same at 30% pedal), and three other cars through the same run for comparison. The idle plays at -23.5 dBFS RMS, where the McLaren 720S and the WRX idle (-23.1 both; the Supra -27.7); full throttle at -21.0 (those three: -20.8 to -22.1); a closed throttle at speed at -26.8; 30% pedal at -23.7. No sample clips (peak -8.4 dBFS) and there is no step in the waveform. The idle loop's gain was 1.7 at first, which played it 7 dB over the car's own full throttle: every loop is normalized to one level as it loads, so a quiet file needs no more gain than a loud one, and the gain is .5 as on the other cars.

On phones, selecting the car loads its five files and switching away releases them. To generate missing files, run `node scripts/generate-audio.mjs --only=maserati-gt2-stradale --generate`.

## Storrow Movers

Nine original ElevenLabs Sound Effects v2 clips (33 requested seconds) accompany the older loaded moving truck: `moving-truck-idle` (6 s at 650 RPM), `moving-truck-drive` (8 s at 1,800 RPM), `moving-truck-high` (6 s at 2,800 RPM), `moving-truck-upshift` and `moving-truck-downshift` (1 s each), `moving-truck-horn` (1.5 s), `moving-truck-reverse` (4 s loop), `moving-truck-storrow-crash` (3 s), and `moving-truck-boo` (2.5 s). These are synthetic interpretations of a worn medium-duty diesel, buckling aluminum cargo box and lighthearted spectator reaction, not recordings of a specific truck or actual collision. The boo clip contains nonverbal generated crowd voices; no reference voices or recordings were supplied.

The truck engine follows the actual loaded drivetrain RPM and shifts, crossfading its low diesel layers with mechanical clatter and subdued body rattle. A confirmed cargo-roof strike plays the metal impact and tearing, followed 0.7 s later by a single boo. Scheduling uses the audio clock and is cancelled by pause, mute or switching vehicles/modes. The standard reversing alarm starts when the truck engages reverse or moves backward, and stops when it moves forward, becomes wedged, pauses, is muted, switches car or travel mode, leaves the visible page, or is disposed. Its generated warning tone uses a fixed audio-clock envelope of 0.45 seconds on and 0.55 seconds silent, with short ramps at each edge; pitch and cadence do not follow engine RPM. One loop source serves every beep and is stopped and disconnected when inactive. Phone builds decode only the selected car bank and load the four truck-specific effects only for the moving truck; the reverse buffer is released when another car is selected. These nine assets add approximately 537 KB of downloads and make no provider calls during play. Generate missing clips with `node scripts/generate-audio.mjs --only=moving-truck --generate`; generation prompts, provider settings and hashes are recorded in `provenance.json`.


## Tesla Model 3 Performance

Two ElevenLabs assets provide the electric sound: `tesla-model-3-performance-drive.mp3` is the unchanged 8-second v2 traction-motor hum. Reverse uses a fresh 10-second **Sound Effects v3** UFO generation, replacing the rejected high tone. The selected source has a low resonant body and airy, ghostly harmonics. It retains its original pitch and natural texture; there is no rapid envelope leveling or added synthesized layer. The source is retained in `artifacts/tesla/audio/reverse-elevenlabs-source.mp3`, with its model, prompt and hashes in `provenance.json`.

`tesla-model-3-performance-reverse.wav` is an approximately 8-second, 22.05 kHz, 16-bit mono loop. A matched-phase cosine crossfade joins it smoothly, and the loop starts at a quiet zero crossing to avoid resampling clicks at 44.1 or 48 kHz. Lossless output avoids another MP3 encoding step at the splice. A gentle 35 Hz high-pass and 2.6 kHz low-pass remove rumble and piercing highs while retaining the UFO harmonics. Together the two shipped Tesla assets total about 483 KB. These are synthetic interpretations, not recordings sampled from a Tesla.
The motor loop rises smoothly with road speed and load without combustion idle, exhaust or shift sounds. It is silent while stationary and substantially quieter than the petrol cars; tire and road noise become dominant at speed. The deliberately quiet source is normalized to the existing RMS/headroom target before the restrained EV mix. Regenerative coasting lowers motor load smoothly. If its audio fails or is still loading, a quiet sine motor fallback is used; an EV never falls back to a petrol engine bank.

Reverse engages one continuous warning loop at rest in reverse or while moving backward. Its playback rate rises from 0.86× at rest to 1.22× at 7 m/s reverse speed, with 200 ms smoothing. Throttle and motor RPM do not directly bend the warning tone. A standstill dead band avoids repeated starts/stops from tiny velocity changes. The already-spliced WAV bypasses the generic loop crossfade. Changing from reverse to forward fades its gain to zero over 1.5 seconds before stopping and disconnecting the source. Pause, mute, page visibility, vehicle/mode switching and re-entering reverse shorten an existing tail to a 35 ms release; disposal cleans it up immediately. Mobile releases the Tesla buffers after a car change. The game makes no provider calls during play; `ufo-pws-3` refreshes the reverse asset on reload.
Generate missing Tesla clips with `node scripts/generate-audio.mjs --only=tesla-model-3-performance --generate`; reverse mastering runs automatically after generation and requires ffmpeg. Rebuild the mastered reverse from its retained source with `node scripts/master-tesla-reverse.mjs --force`. Audio tests verify the MP3/WAV integrity and provenance, absence of combustion/shift sounds, speed-following motor pitch, speed-driven reverse pitch, release ramps, repeated loop seams, every reverse lifecycle gate, fallback behavior and mobile buffer release.
