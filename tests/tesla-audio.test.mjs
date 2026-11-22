import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DriveAudio} from '../src/simulation/audio.ts';

const ID='tesla-model-3-performance',DRIVE=ID+'-drive',REVERSE=ID+'-reverse';

test('Tesla hum and refined UFO reverse retain complete ElevenLabs source provenance',async()=>{
  const root=new URL('../public/audio/',import.meta.url),provenance=JSON.parse(await readFile(new URL('provenance.json',root),'utf8'));
  const clips=provenance.clips.filter(clip=>clip.id.startsWith(ID));
  assert.equal(provenance.provider,'ElevenLabs');assert.equal(clips.length,2);assert.equal(clips.reduce((n,c)=>n+c.seconds,0),18);
  for(const clip of clips){
    assert.equal(clip.loop,true);assert.equal(clip.derivedFrom,undefined);assert.ok(clip.prompt.length>50);
    const bytes=await readFile(new URL(clip.file,root));assert.equal(bytes.length,clip.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.sha256);
    if(clip.id===REVERSE){
      assert.equal(clip.model,'eleven_text_to_sound_v3','fresh UFO generation');
      assert.equal(clip.mastering.pitchRatio,1,'preserve the new source timbre instead of retuning the rejected tone');
      const source=await readFile(new URL('../'+clip.mastering.sourceFile,import.meta.url));
      assert.equal(source.length,clip.mastering.sourceBytes);assert.equal(createHash('sha256').update(source).digest('hex'),clip.mastering.sourceSha256);
      assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
      let format,pcm;
      for(let offset=12;offset+8<=bytes.length;){
        const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),body=bytes.subarray(offset+8,offset+8+size);
        assert.equal(body.length,size,'complete lossless WAV chunk');
        if(type==='fmt ')format=body;if(type==='data')pcm=body;offset+=8+size+(size%2);
      }
      assert.ok(format&&pcm);assert.equal(format.readUInt16LE(0),1);assert.equal(format.readUInt16LE(2),1);
      assert.equal(format.readUInt32LE(4),22050);assert.equal(format.readUInt16LE(14),16);
      assert.ok(Math.abs(pcm.length/2/22050-clip.mastering.durationSeconds)<.0001);
      const differences=[];let peak=0;
      for(let i=2;i<pcm.length;i+=2){const a=pcm.readInt16LE(i)/32768,b=pcm.readInt16LE(i-2)/32768;peak=Math.max(peak,Math.abs(a));differences.push(Math.abs(a-b));}
      differences.sort((a,b)=>a-b);const normal=differences[Math.floor(differences.length*.999)];
      assert.ok(peak<.75,'headroom prevents clipping');
      assert.ok(Math.abs(pcm.readInt16LE(0)-pcm.readInt16LE(pcm.length-2))/32768<normal*1.5,'loop seam is no sharper than the sound itself');
      continue;
    }
    let offset=bytes.subarray(0,3).toString()==='ID3'?10+((bytes[6]&127)<<21)+((bytes[7]&127)<<14)+((bytes[8]&127)<<7)+(bytes[9]&127):0,duration=0;
    while(offset+4<=bytes.length){
      const a=bytes[offset+1],b=bytes[offset+2],c=bytes[offset+3];
      assert.equal(bytes[offset],255);assert.equal(a&224,224);assert.equal((a>>3)&3,3);assert.equal((a>>1)&3,1);
      const bitrate=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][b>>4],sampleRate=[44100,48000,32000][(b>>2)&3];
      assert.equal(sampleRate,44100);assert.notEqual(c>>6,3);assert.ok(bitrate);
      const size=Math.floor(144000*bitrate/sampleRate)+((b>>1)&1);assert.ok(offset+size<=bytes.length);offset+=size;duration+=1152/sampleRate;
    }
    assert.equal(offset,bytes.length);assert.ok(Math.abs(duration-clip.seconds)<.15);
  }
});

function harness(){
  const originalDocument=globalThis.document,originalWindow=globalThis.window;
  globalThis.document={hidden:false,removeEventListener(){}};globalThis.window={removeEventListener(){}};
  const sources=[],parameter=()=>({value:0,events:[],setTargetAtTime(value,time,constant){this.value=value;this.events.push({type:'target',value,time,constant});},setValueAtTime(value,time){this.value=value;this.events.push({type:'value',value,time});},linearRampToValueAtTime(value,time){this.value=value;this.events.push({type:'ramp',value,time});},cancelAndHoldAtTime(time){this.events.push({type:'hold',time});},cancelScheduledValues(){}});
  const gain=()=>({gain:parameter(),connect(){},disconnect(){}});
  const context={currentTime:10,state:'running',createGain:gain,close(){return Promise.resolve();},createBiquadFilter(){return{frequency:parameter(),Q:parameter(),connect(){},disconnect(){}};},createBufferSource(){
    const source={playbackRate:parameter(),connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;this.initialRate=this.playbackRate.value;},stop(time=context.currentTime){this.stopped=true;this.stopTime=time;if(time<=context.currentTime)this.onended?.();}};sources.push(source);return source;
  }};
  const audio=new DriveAudio();audio.context=context;audio.master=gain();audio.electric={gain:gain(),oscillator:{frequency:parameter(),stop(){}}};audio.setCar(ID);
  const add=(name,duration=8)=>{const buffer={duration,length:duration*44100,numberOfChannels:2};audio.buffers.set(name,buffer);if(name!==REVERSE)audio.createLoop(name,buffer);};
  return{audio,context,sources,add,advance(seconds){context.currentTime+=seconds;for(const source of sources)if(source.stopTime<=context.currentTime)source.onended?.();},restore(){globalThis.document=originalDocument;globalThis.window=originalWindow;}};
}

test('unused engine layers keep their initial gain and pitch until the driver selects the car', t => {
  const { audio, add, advance, restore } = harness();
  t.after(restore);
  for (const name of [DRIVE, 'mclaren-gt-idle', 'mclaren-gt-drive', 'mclaren-gt-high']) add(name);
  const { source, gain, filter } = audio.loops.get('mclaren-gt-drive');
  function driveFrame() {
    advance(1 / 60);
    audio.update(10, 1, false, {gear: 1, rpm: 3500});
  }
  for (let i = 0; i < 60; i++) driveFrame();
  assert.equal(gain.gain.value, 0);
  assert.equal(source.playbackRate.value, 1);
  assert.equal(gain.gain.events.length, 0);
  assert.equal(source.playbackRate.events.length, 0);
  assert.equal(filter.frequency.events.length, 60, 'the filter follows its original curve before the layer becomes audible');

  audio.setCar('mclaren-gt');
  driveFrame();
  assert.ok(gain.gain.events.at(-1).value > 0);
  assert.notEqual(source.playbackRate.events.at(-1).value, 1);
  audio.setCar(ID);
  driveFrame();
  driveFrame();
  assert.deepEqual(gain.gain.events.slice(-2).map(e => [e.value, e.constant]), [[0, .14], [0, .14]]);
  assert.deepEqual(source.playbackRate.events.slice(-2).map(e => [e.value, e.constant]), [[1, .12], [1, .12]]);
});

test('EV forward hum is silent at rest, follows speed without gears, and never falls back to gas sounds',()=>{
  const h=harness(),{audio,context,add}=h;
  try{
    for(const name of ['engine-idle','engine-drive','mclaren-gt-idle','mclaren-gt-drive','mclaren-gt-high','tire-road',DRIVE])add(name);
    audio.update(0,0,false,{gear:1,rpm:0});assert.equal(audio.getStatus().engineGain,0);assert.equal(audio.getStatus().engineProfile,ID);
    audio.update(5,1,false,{gear:1,rpm:1500});assert.ok(audio.getStatus().engineGain>.04&&audio.getStatus().engineGain<.15);
    const firstRate=audio.loops.get(DRIVE).source.playbackRate.value;
    context.currentTime+=1;audio.update(30,1,false,{gear:4,rpm:8000});assert.ok(audio.loops.get(DRIVE).source.playbackRate.value>firstRate);assert.equal(audio.getStatus().shiftCount,0);assert.equal(audio.getStatus().activeOneShots,0);
    for(const name of ['engine-idle','engine-drive','mclaren-gt-idle','mclaren-gt-drive','mclaren-gt-high'])assert.equal(audio.loops.get(name).gain.gain.value,0);
    audio.releaseSound(DRIVE);audio.update(20,1,false,{gear:1});assert.equal(audio.getStatus().engineProfile,'electric-fallback');assert.ok(audio.getStatus().electricGain>0);
    for(const name of ['engine-idle','engine-drive'])assert.equal(audio.loops.get(name).gain.gain.value,0);
    audio.setCar('harbor-s4');assert.equal(audio.getStatus().electricGain,0);
  }finally{h.restore();}
});

test('UFO reverse uses one continuous loop and stops at all lifecycle gates',()=>{
  const h=harness(),{audio,sources,add,advance}=h;add(REVERSE,8);
  const reverse=()=>audio.update(-2,-1,false,{gear:-1,rpm:1000}),playing=()=>audio.getStatus().electricReverse;
  try{
    audio.update(0,0,false,{gear:-1});assert.equal(playing(),true);const first=sources.at(-1);assert.equal(first.loop,true);assert.equal(audio.getStatus().reverseAlarm,false);
    reverse();reverse();assert.equal(sources.length,1);assert.ok(audio.getStatus().electricReverseGain>.1);assert.equal(audio.getStatus().activeOneShots,0);
    assert.equal(first.initialRate,.86,'set the low starting pitch before the source is audible');
    let previousRate=0;
    for(const speed of [0,-.3,-2,-7]){
      audio.update(speed,-1,false,{gear:-1,rpm:1000+Math.abs(speed)*500});
      assert.ok(first.playbackRate.value>previousRate,'pitch rises continuously with reverse speed');
      previousRate=first.playbackRate.value;
      assert.equal(audio.loops.get(REVERSE).filter.frequency.value,2200,'restrain the piercing upper harmonics');
    }
    assert.ok(previousRate<=1.22,'fast reverse stays in a restrained pitch range');
    audio.update(-2,0,false,{gear:-1,rpm:0});const steadyRate=first.playbackRate.value;
    audio.update(-2,-1,false,{gear:-1,rpm:15000});assert.equal(first.playbackRate.value,steadyRate,'pedal and RPM do not wobble a fixed-speed warning');
    audio.update(-50,-1,false,{gear:-1});assert.equal(first.playbackRate.value,previousRate,'pitch is capped for unexpected speed values');
    assert.equal(sources.length,1,'one continuous source prevents retrigger wobble');
    audio.update(3,-1,false,{gear:-1});assert.equal(playing(),false,'braking forward is not reversing');
    assert.ok(first.stopped&&!first.disconnected,'the source stays connected during its click-free release');
    advance(1.51);assert.equal(first.disconnected,true);assert.equal(audio.retiringLoops.size,0);
    reverse();audio.update(-2,-1,true,{gear:-1});assert.equal(playing(),false);
    reverse();audio.enabled=false;assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.enabled=true;
    reverse();document.hidden=true;audio.visibilityChanged();assert.equal(playing(),false);reverse();assert.equal(playing(),false);document.hidden=false;
    reverse();audio.hidePage();assert.equal(playing(),false);
    for(const mode of ['bike','helicopter','walk']){reverse();audio.setMode(mode);assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.setMode('drive');}
    reverse();audio.setCar('moving-truck');assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.setCar(ID);
    reverse();audio.dispose();assert.equal(playing(),false);assert.ok(sources.every(source=>source.stopped&&source.disconnected));assert.equal(audio.buffers.size,0);assert.equal(audio.retiringLoops.size,0);
  }finally{h.restore();}
});

test('reverse uses smooth pitch and a 1.5-second fade when changing to forward',()=>{
  const h=harness(),{audio,context,sources,add,advance}=h;add(REVERSE,8);
  try{
    audio.update(0,0,false,{gear:-1});const source=sources.at(-1),loop=audio.loops.get(REVERSE);
    assert.equal(source.initialRate,.86);
    for(const speed of [.18,.21,.19,.25,.32,.1,0,-.1])audio.update(speed,0,false,{gear:-1});
    assert.equal(sources.length,1,'near-zero velocity noise does not retrigger the warning');
    audio.update(-5,-1,false,{gear:-1});
    const rateEvent=source.playbackRate.events.at(-1);
    assert.equal(rateEvent.type,'target');assert.ok(rateEvent.constant>=.15,'speed changes glide rather than jump in pitch');
    audio.update(.5,0,false,{gear:-1});
    assert.deepEqual(loop.gain.gain.events.slice(-2),[{type:'hold',time:context.currentTime},{type:'ramp',value:0,time:context.currentTime+1.5}]);
    const end=source.stopTime;assert.equal(end,context.currentTime+1.505,'stop only after the 1.5-second envelope reaches zero');
    assert.equal(audio.getStatus().electricReverse,false);
    advance(.5);audio.update(4,1,false,{gear:1});
    assert.equal(source.disconnected,undefined,'keep the fading sound connected while driving forward');
    assert.equal(source.stopTime,end,'subsequent forward updates do not restart or shorten the fade');
    advance(1.01);assert.ok(source.disconnected);assert.equal(audio.retiringLoops.size,0);
  }finally{audio.dispose();h.restore();}
});

test('long reverse tails are curtailed by lifecycle changes and do not stack on re-entry',()=>{
  const gates=[
    audio=>audio.update(2,1,true,{gear:1}),
    audio=>{audio.enabled=false;},
    audio=>audio.setMode('walk'),
    audio=>audio.setCar('harbor-s4'),
    audio=>{document.hidden=true;audio.visibilityChanged();},
    audio=>audio.update(-2,-1,false,{gear:-1}),
  ];
  for(const gate of gates){
    const h=harness(),{audio,context,sources,add,advance}=h;add(REVERSE,8);
    try{
      audio.update(-2,-1,false,{gear:-1});const tail=sources.at(-1);
      audio.update(2,1,false,{gear:1});advance(.2);gate(audio);
      assert.ok(tail.stopTime<=context.currentTime+.041,'cancel the old driving tail promptly');
      advance(.05);assert.ok(tail.disconnected);assert.equal(audio.retiringLoops.size,0);
    }finally{audio.dispose();h.restore();}
  }
});

test('mobile only loads the two Tesla layers and releases them when selecting another vehicle',()=>{
  const originalDocument=globalThis.document;globalThis.document={hidden:false};
  try{
    const audio=new DriveAudio(true);audio.setCar(ID);assert.equal(audio.getStatus().expectedCount,13);
    assert.deepEqual(audio.wantedSounds.filter(name=>name.startsWith(ID)),[DRIVE,REVERSE]);
    audio.buffers.set(DRIVE,{length:352800,numberOfChannels:2});audio.buffers.set(REVERSE,{length:264600,numberOfChannels:2});
    audio.setCar('supra-mk4');assert.equal(audio.getStatus().expectedCount,16);assert.equal(audio.buffers.has(DRIVE),false);assert.equal(audio.buffers.has(REVERSE),false);
  }finally{globalThis.document=originalDocument;}
});
