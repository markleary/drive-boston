import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../public/audio/',import.meta.url);
test('all moving-truck sound effects are complete ElevenLabs MP3 assets with matching provenance',async()=>{
  const provenance=JSON.parse(await readFile(new URL('provenance.json',root),'utf8'));
  const clips=provenance.clips.filter(clip=>clip.id.startsWith('moving-truck-'));
  assert.equal(clips.length,8);assert.equal(provenance.provider,'ElevenLabs');
  assert.equal(clips.reduce((total,clip)=>total+clip.seconds,0),29);
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
    assert.equal(clip.loop,/-idle$|-drive$|-high$/.test(clip.id));
  }
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
