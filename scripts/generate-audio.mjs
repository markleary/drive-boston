/**
 * Optional, billable, local asset generation. Never imported into the game.
 * Preview: node scripts/generate-audio.mjs
 * Optional subset: --only=mclaren-gt
 * Generate missing clips: node scripts/generate-audio.mjs --generate
 * Requires ELEVENLABS_API_KEY in the shell or root .env (never VITE_*).
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {buildPlayerEngineAudio} from './build-player-car-audio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/audio');
const model = 'eleven_text_to_sound_v2';
const format = 'mp3_44100_128';
const clips = [
  {"id": "mclaren-720s-idle", "seconds": 6, "loop": true, "prompt": "Realistic close tailpipe recording of a McLaren 720S petrol V8 at constant 850 RPM idle. Deep gritty combustion growl, low exhaust burble, throaty harmonics. Dry muffled exhaust, steady pitch and volume throughout, seamless loop. No air hiss, whistle, wind, electronic tones, sci fi drone, music, clicks or gear changes."},
  {"id": "mclaren-720s-upshift", "seconds": 1, "loop": false, "prompt": "Realistic close tailpipe recording of a McLaren 720S petrol V8: a brief rounded falling exhaust note as engine speed drops. Soft bassy combustion burble for half a second, fading smoothly to silence. Only the muffled exhaust note. No mechanical clicks, clutch noise, impacts, bangs, air hiss, whistle, electronic tones, music or speech."},
  {"id": "mclaren-720s-downshift", "seconds": 1, "loop": false, "prompt": "Realistic close tailpipe recording of a McLaren 720S petrol V8: one gentle accelerator blip, rounded rise and fall in exhaust pitch. Soft bassy combustion burble for half a second, fading smoothly to silence. Only the muffled exhaust note. No mechanical clicks, clutch noise, impacts, bangs, air hiss, whistle, electronic tones, music or speech."},
  {"id": "supra-mk4-idle", "seconds": 6, "loop": true, "prompt": "Realistic close tailpipe recording of a 1990s Toyota Supra 2JZ petrol straight six at constant 850 RPM idle. Warm bass rumble, rapid distinct combustion pulses, throaty mechanical growl. Dry muffled exhaust, steady pitch and volume throughout, seamless loop. No air hiss, whistle, wind, electronic tones, sci fi drone, music, clicks or gear changes."},
  {"id": "supra-mk4-upshift", "seconds": 1, "loop": false, "prompt": "Realistic close tailpipe recording of a 1990s Toyota Supra 2JZ petrol straight six: a brief rounded falling exhaust note as engine speed drops. Soft bassy combustion burble for half a second, fading smoothly to silence. Only the muffled exhaust note. No mechanical clicks, clutch noise, impacts, bangs, air hiss, whistle, electronic tones, music or speech."},
  {"id": "supra-mk4-downshift", "seconds": 1, "loop": false, "prompt": "Realistic close tailpipe recording of a 1990s Toyota Supra 2JZ petrol straight six: one gentle accelerator blip, rounded rise and fall in exhaust pitch. Soft bassy combustion burble for half a second, fading smoothly to silence. Only the muffled exhaust note. No mechanical clicks, clutch noise, impacts, bangs, air hiss, whistle, electronic tones, music or speech."},
  {
    id:'mclaren-gt-idle',seconds:6,loop:true,
    prompt:'Close dry recording of a McLaren GT M840TE 4.0 litre twin turbo V8 idling steadily at 850 RPM. Refined low burbling eight cylinder exhaust with subtle metallic ticking. Exactly constant engine speed and level, seamless continuous loop. No revving, gear changes, start or stop, voices, music or other cars.'
  },
  {
    id:'mclaren-gt-drive',seconds:8,loop:true,
    prompt:'McLaren GT 4.0 litre twin turbo V8 held steadily at 4000 RPM under engine load, rear exhaust perspective. Rich sharp supercar V8 growl, tight rapid combustion pulses, restrained turbo whistle. Constant pitch and load for seamless looping. No acceleration, gear changes, flyby, Doppler effect, tire squeal, voices or music.'
  },
  {
    id:'mclaren-gt-high',seconds:6,loop:true,
    prompt:'McLaren GT M840TE twin turbo V8 held at exactly constant 7000 RPM under heavy throttle, close dry rear exhaust recording. High urgent raspy V8 howl and fine turbo hiss, constant pitch and volume throughout, seamless loop. No gear shifts, acceleration sweep, flyby, tires, voices or music.'
  },
  {
    id:'mclaren-gt-upshift',seconds:1,loop:false,
    prompt:'A single immediate fast McLaren GT seven speed dual clutch full throttle upshift. Very brief sharp exhaust crack and mechanical clutch snap with a short turbo air chirp and sudden falling V8 pitch, then silence. One short dry transient within a quarter second. No repeated shifting, long revs, voices or music.'
  },
  {
    id:'mclaren-gt-downshift',seconds:1,loop:false,
    prompt:'A single immediate McLaren GT seven speed dual clutch downshift: short precise automatic throttle blip of a twin turbo V8 with a tight mechanical clutch click, then silence. One short dry transient under half a second. No repeated revs, gear changes, voices, music or ambient noise.'
  },
  {
    id: 'engine-idle', seconds: 8, loop: true,
    prompt: 'A realistic small four-cylinder gasoline car engine idling steadily at 850 RPM, close perspective beside the car, warm low mechanical rumble and subtle even combustion pulses. Exactly constant idle speed throughout, continuous seamless loop. Dry natural recording, no revving, no starting or stopping, no voices, no music, no horns, no passing traffic.'
  },
  {
    id: 'engine-drive', seconds: 8, loop: true,
    prompt: 'A realistic compact four-cylinder gasoline car engine held at a constant moderate 2600 RPM under light driving load. Warm rounded engine growl, fine mechanical vibration, evenly spaced combustion pulses. Steady speed from beginning to end, continuous seamless loop, close dry perspective. No acceleration or gear changes, no race car, no horns, no voices, no music, no other vehicles.'
  },
  {
    id: 'city-ambience', seconds: 10, loop: true,
    prompt: 'Quiet late afternoon ambience on a leafy residential Boston Back Bay street: a soft distant wash of urban traffic, very faint wind moving tree leaves, an occasional distant small bird. Calm open-air city atmosphere with no close pass-bys. Continuous subtle seamless loop, no intelligible speech, no music, no horns, no sirens, no construction, no engine in the foreground.'
  },
  {
    id: 'tire-road', seconds: 8, loop: true,
    prompt: 'The soft steady rolling sound of car rubber tires on dry smooth urban asphalt at a constant moderate speed. Broad low road rumble mixed with a fine continuous airy tire hiss, natural close recording from inside the vehicle. Seamless continuous loop at exactly constant level, no engine, no impacts, no squealing, no rain, no voices, no music.'
  },
  {
    id: 'horn', seconds: 2, loop: false,
    prompt: 'One short friendly realistic two-tone electric car horn honk, from a normal compact passenger car on a quiet open street. The honk starts immediately, lasts about half a second then naturally decays into silence. Clean close natural recording, no repeated honking, no truck horn, no cartoon sound, no voices, no music, no other vehicles.'
  },
  {
    id: 'tire-skid', seconds: 3, loop: true,
    prompt: 'A steady restrained rubber tire scrub and squeal on dry asphalt during a tight car turn, with a gritty rolling undertone. Natural everyday car sound, medium intensity and constant texture, continuous seamless loop. No collision, no crash, no explosion, no engine, no racing crowd, no voices, no music.'
  },
  {
    id: 'helicopter-rotor', seconds: 8, loop: true,
    prompt: 'A small civilian sightseeing helicopter hovering steadily, heard from a close chase-camera perspective just behind the aircraft. Continuous warm rhythmic rotor blade chopping and a restrained turbine hum, natural realistic recording. Exactly constant operating speed and level throughout, seamless loop. No start-up, no shutdown, no flyby, no Doppler pitch change, no speech, no radio, no weapons, no music, no sirens.'
  },
  {
    id: 'crash-light', seconds: 1.5, loop: false,
    prompt: 'A single low-speed car bump: a dull plastic bumper thud against the bumper of another parked car, with a brief shudder of body panels and a faint rattle of trim. One short impact that starts immediately and fades within a second. Close, dry, natural recording. No glass breaking, no horn, no tire squeal, no voices, no music, no engine.'
  },
  {
    id: 'crash-car', seconds: 2.5, loop: false,
    prompt: 'A single hard collision between two passenger cars: a sharp heavy metal crunch, crumpling body panels, a short burst of shattering glass and a snapping plastic bumper, then a few pieces of debris settling on asphalt. The impact starts immediately and decays within two seconds. Close, dry and realistic. No explosion, no horn, no tire squeal, no voices, no music, no engine.'
  },
  {
    id: 'crash-heavy', seconds: 3, loop: false,
    prompt: 'A single very heavy collision of a passenger car driving into the side of a large city bus or a concrete wall at speed: a deep booming impact, metal crumpling with a long steel groan, glass shattering, then loose parts clattering onto the road. The impact starts immediately and decays within three seconds. Close, dry and realistic. No explosion, no fire, no horn, no voices, no music, no engine.'
  },
  {
    id: 'pedestrian-thump', seconds: 1.5, loop: false,
    prompt: 'A single soft dull thump of a heavy padded duffel bag landing on a car hood, with a short rustle of thick winter clothing and a faint flap of a coat, then silence. Starts immediately and fades within a second. Close, natural recording. No voices, no screaming, no glass, no metal crunch, no music.'
  },
];

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function localKey() {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim();
  let source;
  try { source = await readFile(resolve(root, '.env'), 'utf8'); }
  catch { throw new Error('Add ELEVENLABS_API_KEY to the local .env file before generating.'); }
  const match = source.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/m);
  let key = match?.[1] ?? '';
  if (key.startsWith('"') || key.startsWith("'")) key = key.slice(1, key.lastIndexOf(key[0]));
  else key = key.replace(/\s+#.*$/, '').trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY is empty or missing.');
  return key;
}

async function main() {
  const selection=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
  const selected=selection?clips.filter(clip=>clip.id.startsWith(selection)):clips;
  const derivedSelected=['mclaren-720s-drive','mclaren-720s-high','supra-mk4-drive','supra-mk4-high'].filter(id=>!selection||id.startsWith(selection));
  if(!selected.length&&!derivedSelected.length)throw new Error('No clips match --only.');
  const total = selected.reduce((sum, clip) => sum + clip.seconds, 0);
  const pending = [];
  for (const clip of selected) if (!await exists(resolve(output, `${clip.id}.mp3`))) pending.push(clip);
  if(pending.reduce((sum,clip)=>sum+clip.seconds,0)>60)throw new Error('Pending generation exceeds the 60-second budget; use --only=prefix.');
  console.log(`Audio plan: ${selected.length} clips / ${total}s total; ${pending.length} missing / ${pending.reduce((sum, clip) => sum + clip.seconds, 0)}s to generate.`);
  if (!process.argv.includes('--generate')) {
    for (const clip of pending) console.log(`  ${clip.id}: ${clip.seconds}s${clip.loop ? ' loop' : ''}`);
    if(derivedSelected.length)console.log('Selected drive/high assets are mastered locally from the existing GT sources; no additional provider requests.');
    console.log('Preview only. Add --generate to make billable ElevenLabs requests. Existing files are never overwritten.');
    return;
  }
  if (!pending.length) {await buildPlayerEngineAudio({selected:derivedSelected});return;}
  const key = await localKey();
  await mkdir(output, { recursive: true });
  const provenancePath = resolve(output, 'provenance.json');
  let completed = [];
  if (await exists(provenancePath)) completed = JSON.parse(await readFile(provenancePath, 'utf8')).clips ?? [];
  for (const clip of pending) {
    console.log(`Generating ${clip.id} (${clip.seconds}s)...`);
    let response;
    try {
      response = await fetch(`https://api.elevenlabs.io/v1/sound-generation?output_format=${format}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clip.prompt, duration_seconds: clip.seconds, loop: clip.loop, model_id: model, prompt_influence: 0.5 }),
      });
    } catch {
      throw new Error(`Network request failed for ${clip.id}. No automatic retry was made; check connectivity before running again.`);
    }
    if (!response.ok) {
      let code = '';
      try {
        const detail = (await response.json()).detail;
        if (typeof detail?.status === 'string' && /^[a-z_]{1,80}$/.test(detail.status)) code = ` (${detail.status})`;
      } catch { /* Do not print provider response bodies or request headers. */ }
      throw new Error(`ElevenLabs returned HTTP ${response.status}${code} for ${clip.id}. Generation stopped without retrying.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000 || !(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
      throw new Error(`The response for ${clip.id} was not a valid MP3. No audio file was saved.`);
    }
    const file = `${clip.id}.mp3`;
    await writeFile(resolve(output, file), bytes, { flag: 'wx' });
    completed = completed.filter(item => item.id !== clip.id);
    completed.push({ ...clip, file, generatedAt: new Date().toISOString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    await writeFile(provenancePath, JSON.stringify({
      provider: 'ElevenLabs', endpoint: 'https://api.elevenlabs.io/v1/sound-generation',
      documentation: 'https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert',
      model, format, promptInfluence: 0.5,
      description: 'Synthetic sound effects generated for this prototype, not field recordings of Boston.',
      clips: completed,
    }, null, 2) + '\n');
    console.log(`Saved ${file} (${bytes.length} bytes).`);
  }
  await buildPlayerEngineAudio({selected:derivedSelected});
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
