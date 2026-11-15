import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../public/audio/',import.meta.url);
test('all moving-truck sound effects are complete ElevenLabs MP3 assets with matching provenance',async()=>{
  const provenance=JSON.parse(await readFile(new URL('provenance.json',root),'utf8'));
  const clips=provenance.clips.filter(clip=>clip.id.startsWith('moving-truck-'));
  assert.equal(clips.length,9);assert.equal(provenance.provider,'ElevenLabs');
  assert.equal(clips.reduce((total,clip)=>total+clip.seconds,0),33);
  for(const clip of clips){
    const file=new URL(clip.file,root),bytes=await readFile(file);
    assert.ok(bytes.length>1000);assert.equal(bytes.length,clip.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.sha256);
    assert.equal(typeof clip.prompt,'string');assert.ok(clip.prompt.length>50);
    // Verify the actual MPEG-1 layer III frames without adding a decoder or
    // external executable dependency to the physics/data CI suite.
    let offset=bytes.subarray(0,3).toString()==='ID3'?10+((bytes[6]&127)<<21)+((bytes[7]&127)<<14)+((bytes[8]&127)<<7)+(bytes[9]&127):0,duration=0;
    while(offset+4<=bytes.length){
      const a=bytes[offset+1],b=bytes[offset+2],c=bytes[offset+3];
      assert.equal(bytes[offset],255);assert.equal(a&224,224);assert.equal((a>>3)&3,3);assert.equal((a>>1)&3,1);
      const bitrate=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320][b>>4],sampleRate=[44100,48000,32000][(b>>2)&3];
      assert.equal(sampleRate,44100);assert.notEqual(c>>6,3,'assets are stereo');assert.ok(bitrate);
      const frameLength=Math.floor(144000*bitrate/sampleRate)+((b>>1)&1);assert.ok(offset+frameLength<=bytes.length,'MP3 frame is complete');
      offset+=frameLength;duration+=1152/sampleRate;
    }
    assert.equal(offset,bytes.length);assert.ok(Math.abs(duration-clip.seconds)<.15,`${clip.id} has its requested duration`);
    assert.equal(clip.loop,/-idle$|-drive$|-high$|-reverse$/.test(clip.id));
  }
});

test('truck reverse alarm loops at fixed cadence and stops across every lifecycle gate',async()=>{
  const {DriveAudio}=await import('../src/simulation/audio.ts'),originalDocument=globalThis.document,originalWindow=globalThis.window;
  globalThis.document={hidden:false,removeEventListener(){}};globalThis.window={removeEventListener(){}};
  const sources=[],parameter=()=>({value:0,events:[],setTargetAtTime(value){this.value=value;},setValueAtTime(value,time){this.events.push({kind:'set',value,time});},linearRampToValueAtTime(value,time){this.events.push({kind:'ramp',value,time});}}),gain=()=>({gain:parameter(),connect(){},disconnect(){}});
  const context={currentTime:10,state:'running',createGain:gain,close(){this.closed=true;return Promise.resolve();},createBiquadFilter(){return{frequency:parameter(),Q:parameter(),connect(){},disconnect(){}};},createBufferSource(){
    const source={playbackRate:parameter(),connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;}};sources.push(source);return source;
  }};
  const audio=new DriveAudio();audio.context=context;audio.master=gain();audio.setCar('moving-truck');
  audio.buffers.set('moving-truck-reverse',{duration:4,length:176400,numberOfChannels:2});
  const reverse=()=>audio.update(-2,-1,false,{gear:-1,rpm:1800}),playing=()=>audio.getStatus().reverseAlarm;
  try{
    audio.update(0,0,false,{gear:-1});assert.equal(playing(),true,'selecting reverse at rest starts the alarm');
    const first=sources.at(-1);assert.equal(first.loop,true);assert.equal(first.playbackRate.value,1);
    const envelope=audio.loops.get('moving-truck-reverse').gain.gain.events;
    assert.deepEqual(envelope.slice(0,4),[{kind:'set',value:0,time:10},{kind:'ramp',value:.42,time:10.008},{kind:'set',value:.42,time:10.435},{kind:'ramp',value:0,time:10.45}]);
    assert.deepEqual(envelope.filter(event=>event.kind==='set'&&event.value===0).map(event=>event.time),[10,11],'beeps are scheduled exactly one second apart on the audio clock');
    reverse();audio.update(-5,-1,false,{gear:-1,rpm:2800});assert.equal(sources.length,1,'updates never stack duplicate alarms');assert.equal(first.playbackRate.value,1,'engine RPM does not change beep cadence');
    audio.update(3,-1,false,{gear:1});assert.equal(playing(),false,'braking forward motion is not reversing');assert.ok(first.stopped&&first.disconnected);
    audio.update(-1,0,false);assert.equal(playing(),true,'actual backward motion also activates it');
    audio.update(-.1,0,false,{gear:1});assert.equal(playing(),false,'tiny idle drift does not sound the alarm');
    reverse();audio.update(-2,-1,true,{gear:-1});assert.equal(playing(),false);reverse();assert.equal(playing(),true);
    audio.enabled=false;assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.enabled=true;reverse();assert.equal(playing(),true);
    document.hidden=true;audio.visibilityChanged();assert.equal(playing(),false);reverse();assert.equal(playing(),false);document.hidden=false;audio.visibilityChanged();reverse();assert.equal(playing(),true);
    audio.hidePage();assert.equal(playing(),false);reverse();assert.equal(playing(),true);
    for(const mode of ['bike','helicopter','walk']){audio.setMode(mode);assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.setMode('drive');reverse();assert.equal(playing(),true);}
    audio.setCar('harbor-s4');assert.equal(playing(),false);reverse();assert.equal(playing(),false);audio.setCar('moving-truck');reverse();assert.equal(playing(),true);
    audio.update(-2,-1,false,{gear:-1,storrowed:true});assert.equal(playing(),false,'a wedged truck cannot reverse');
    audio.update(0,-1,false,{gear:-1,storrowed:true});assert.equal(playing(),false,'reverse input cannot sound the alarm while wedged');
    reverse();assert.equal(audio.getStatus().activeOneShots,0,'the alarm is a bounded loop, not repeated one-shots');
    audio.dispose();assert.equal(playing(),false);assert.ok(sources.every(source=>source.stopped));assert.equal(audio.buffers.size,0);assert.equal(context.closed,true);
  }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;}
});

test('mobile audio requests the reversing alarm only for the truck and releases its decoded buffer on switching cars',async()=>{
  const {DriveAudio}=await import('../src/simulation/audio.ts'),originalDocument=globalThis.document;globalThis.document={hidden:false};
  try{
    const audio=new DriveAudio(true);assert.equal(audio.getStatus().expectedCount,11);
    audio.setCar('moving-truck');assert.equal(audio.getStatus().expectedCount,20);
    assert.ok(audio.wantedSounds.includes('moving-truck-reverse'));
    audio.buffers.set('moving-truck-reverse',{length:176400,numberOfChannels:2});
    const source={stop(){this.stopped=true;},disconnect(){}};audio.loops.set('moving-truck-reverse',{source,filter:{disconnect(){}},gain:{disconnect(){}}});
    audio.setCar('supra-mk4');assert.equal(audio.getStatus().expectedCount,16);assert.equal(audio.getStatus().reverseAlarm,false);
    assert.equal(audio.buffers.has('moving-truck-reverse'),false);assert.equal(source.stopped,true);assert.equal(audio.wantedSounds.includes('moving-truck-reverse'),false);
  }finally{globalThis.document=originalDocument;}
});

test('honking after a bridge strike preserves the crash and delayed boo; mute cancels every voice',async()=>{
  const {DriveAudio}=await import('../src/simulation/audio.ts'),originalDocument=globalThis.document;
  globalThis.document={hidden:false};
  const sources=[],parameter=()=>({value:0,setTargetAtTime(){}}),gain=()=>({gain:parameter(),connect(){},disconnect(){}});
  const context={currentTime:10,state:'running',createGain:gain,createBufferSource(){
    const source={playbackRate:parameter(),connect(){},disconnect(){},start(when=0){this.when=when;},stop(){this.stopped=true;this.onended?.();}};sources.push(source);return source;
  }};
  const audio=new DriveAudio();
  // Inject a small Web Audio harness: exercise real scheduling and source
  // cancellation without a browser, network, decoding or speaker output.
  audio.context=context;audio.master=gain();audio.paused=false;audio.carId='moving-truck';
  for(const name of ['moving-truck-storrow-crash','moving-truck-boo','moving-truck-horn'])audio.buffers.set(name,{duration:3});
  try{
    audio.storrowed(12);assert.equal(sources.length,2);assert.equal(sources[1].when,10.7);
    audio.storrowed(12);assert.equal(sources.length,2,'one strike cannot stack reactions');
    audio.horn();assert.equal(sources.length,3);assert.ok(sources.slice(0,2).every(s=>!s.stopped),'horn leaves impact and boo intact');
    context.currentTime=10.8;audio.horn();assert.equal(sources.length,4);assert.equal(sources[2].stopped,true,'only previous horn stops');assert.ok(sources.slice(0,2).every(s=>!s.stopped));
    audio.enabled=false;assert.ok(sources.every(s=>s.stopped));assert.equal(audio.getStatus().activeOneShots,0);
  }finally{globalThis.document=originalDocument;}
});
