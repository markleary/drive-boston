import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DriveAudio } from '../src/simulation/audio.ts';

const id = 'subaru-wrx';
const layers = ['idle', 'drive', 'high', 'upshift', 'downshift', 'turbo-spool'];
const sound = layer => id + '-' + layer;

test('the six WRX effects match their ElevenLabs generation records', async () => {
  const dir = new URL('../public/audio/', import.meta.url);
  const library = JSON.parse(await readFile(new URL('provenance.json', dir)));
  const clips = library.clips.filter(clip => clip.id.startsWith(id));
  assert.equal(library.provider, 'ElevenLabs');
  assert.deepEqual(clips.map(clip => clip.id).sort(), layers.map(sound).sort());
  assert.equal(clips.reduce((seconds, clip) => seconds + clip.seconds, 0), 22);
  for (const clip of clips) {
    const data = await readFile(new URL(clip.file, dir));
    assert.equal(clip.model, 'eleven_text_to_sound_v3');
    assert.equal(clip.loop, ['idle', 'drive', 'high', 'turbo-spool'].map(sound).includes(clip.id));
    assert.equal(data.length, clip.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256);
  }
});

test('WRX compressor emphasizes the recorded whir only under boost and fades on lift and shifts', t => {
  const saved = globalThis.document;
  globalThis.document = { hidden:false };
  t.after(() => { globalThis.document = saved; });
  const audio = new DriveAudio();
  const param = () => ({value:0, setTargetAtTime(value){ this.value=value; }});
  const context = {
    currentTime:0,
    createBufferSource:() => ({playbackRate:param(),connect(){},start(){}}),
    createBiquadFilter:() => ({frequency:param(),Q:param(),connect(){}}),
    createGain:() => ({gain:param(),connect(){}}),
  };
  audio.context=context;
  audio.master={gain:param()};
  audio.setCar(id);
  for (const layer of ['idle','drive','high','turbo-spool']) audio.createLoop(sound(layer),{});
  audio.buffers.set(sound('upshift'),'upshift');
  const shots=[];
  audio.playOneShot=buffer=>{shots.push(buffer);};
  function frame(pressure, throttle=1, gear=1, paused=false) {
    context.currentTime+=1/60;
    audio.update(12,throttle,paused,{rpm:3600,gear,turboBoost:pressure});
    return audio.getStatus();
  }

  assert.equal(frame(.44).turboGain,0,'ordinary part-boost driving');
  const spool=audio.loops.get(sound('turbo-spool'));
  assert.equal(spool.filter.type,'bandpass');
  assert.equal(spool.filter.Q.value,2);
  const partial=frame(.72).turboGain;
  const full=frame(1);
  assert.ok(partial>0 && full.turboGain>3*partial);
  for(let i=0;i<60;i++) frame(1);
  assert.ok(full.turboGain<.055*audio.getStatus().engineGain,'compressor stays below the loaded exhaust');
  assert.equal(spool.filter.frequency.value,600*spool.source.playbackRate.value);
  assert.equal(frame(.9,0).turboGain,0,'lifting the pedal cuts the compressor target');
  frame(1);
  assert.equal(frame(.83,1,2).turboGain,0,'the open clutch unloads the compressor');
  assert.deepEqual(shots,['upshift'],'the gear change plays only the exhaust shift');

  for (const gate of [
    () => { frame(1,1,2,true); },
    () => { audio.enabled=false; frame(1); audio.enabled=true; },
    () => { audio.setMode('walk'); audio.setMode('drive'); },
    () => { audio.setCar('harbor-s4'); audio.setCar(id); },
    () => { document.hidden=true; audio.visibilityChanged(); document.hidden=false; },
  ]) {
    frame(1,1,2);
    gate();
    assert.equal(audio.getStatus().turboGain,0);
    assert.equal(frame(.1,0,2).turboGain,0);
  }
});

test('mobile audio keeps the WRX compressor only with the selected car', () => {
  const audio = new DriveAudio(true);
  audio.setCar(id);
  assert.deepEqual(audio.wantedSounds.filter(name => name.startsWith(id)).sort(), layers.map(sound).sort());
  for (const layer of layers) audio.buffers.set(sound(layer), {});
  audio.setCar('supra-mk4');
  assert.ok(audio.wantedSounds.every(name => !name.startsWith(id)));
  assert.equal(audio.buffers.size, 0);
});
