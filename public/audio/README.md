# Back Bay sound effects

These seven synthetic sound effects were generated for this prototype with ElevenLabs Sound Effects v2. They are not recordings of Boston or of a particular vehicle. No voices, music, or third-party recordings were supplied. The prompts, requested durations, provider settings, generation timestamps, and file checksums are recorded in [provenance.json](./provenance.json).

| File | Requested duration | Use |
| --- | ---: | --- |
| engine-idle.mp3 | 8 s | Constant idle engine loop |
| engine-drive.mp3 | 8 s | Constant mid-RPM engine loop |
| city-ambience.mp3 | 10 s | Quiet urban atmosphere loop |
| tire-road.mp3 | 8 s | Tire rolling loop |
| horn.mp3 | 2 s | Single natural dual-tone horn |
| tire-skid.mp3 | 3 s | Tire scrub loop |
| helicopter-rotor.mp3 | 8 s | Steady civilian helicopter rotor loop |

The first six clips totaled 39 seconds. The helicopter iteration added one eight-second clip, for 47 seconds overall; existing clips were not regenerated. All assets are stereo MP3 at 44.1 kHz / 128 kbps, using the provider's seamless-loop option except for the horn. The game decodes these local files after the user starts driving, softens loop seams, balances loudness with peak headroom, and blends/pitches the engine layers according to speed, throttle, and simulated gears. Road noise follows speed; tire scrub follows tight turns and handbraking. Helicopter mode crossfades the car layers away and adds a steady rotor whose load follows lift, climb rate, and horizontal speed. Master fades handle pause, mute, and browser visibility, and the horn cannot accumulate repeated voices. Quiet synthesized engine, horn, and rotor fallbacks are used only if their corresponding downloaded assets fail.

The generator is a local development tool: `node scripts/generate-audio.mjs` previews its plan, and adding `--generate` makes billable requests for missing files. Existing assets are skipped. It reads `ELEVENLABS_API_KEY` from the shell or the ignored root `.env`, sends it only as an authentication header to `https://api.elevenlabs.io`, and never includes it in game code or public output. There are no runtime provider calls. If generation is interrupted after a provider response but before a file is saved, inspect the account's usage before repeating the request; the script intentionally does not retry automatically.

Generated output use is subject to the generating account's applicable [ElevenLabs terms](https://elevenlabs.io/terms-of-use). Generation alone does not verify account subscription or license scope. API request fields follow the [official Sound Effects API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).
