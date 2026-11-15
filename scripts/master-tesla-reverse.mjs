/** Master the fresh ElevenLabs UFO source to a lossless loop. Requires ffmpeg. */
import {readFile,writeFile,mkdir,mkdtemp,rm,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id='tesla-model-3-performance-reverse',file=`${id}.wav`,sampleRate=22050;
const sourceFile='artifacts/tesla/audio/reverse-elevenlabs-source.mp3';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function masterTeslaReverseAudio({force=false}={}){
  const provenancePath=join(root,'public/audio/provenance.json');
  const provenance=JSON.parse(await readFile(provenancePath,'utf8'));
  const entry=provenance.clips.find(clip=>clip.id===id);
  if(!entry)throw new Error('Generate the reverse source before mastering.');
  if(entry.mastering&&!force)return;
  const generated=join(root,'public/audio',`${id}.mp3`),output=join(root,'public/audio',file);
  const original=await readFile(entry.mastering?join(root,sourceFile):generated);
  if(hash(original)!==(entry.mastering?.sourceSha256??entry.sha256))throw new Error('Reverse source provenance does not match.');
  await mkdir(dirname(join(root,sourceFile)),{recursive:true});
  await writeFile(join(root,sourceFile),original);
  const temp=await mkdtemp(join(tmpdir(),'tesla-ufo-master-'));
  try{
    const decoded=join(temp,'decoded.f32'),pcm=join(temp,'loop.f32'),mastered=join(temp,'reverse.wav');
    // One speaker-like channel avoids stereo cancellation. The new source is
    // already low: preserve its pitch and ghostly harmonics, without the old
    // fast envelope leveling that flattened its character.
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',join(root,sourceFile),'-af',`pan=mono|c0=c1,highpass=f=35,lowpass=f=2600,aresample=${sampleRate}`,'-f','f32le',decoded]);
    const raw=await readFile(decoded),samples=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
    const start=Math.round(.5*sampleRate),signal=samples.slice(start);
    const overlap=Math.round(.25*sampleRate),target=Math.round(8.25*sampleRate),search=Math.round(.1*sampleRate);
    if(signal.length<target+search)throw new Error('Generate a ten-second source for this loop window.');
    let end=target,best=-Infinity;
    for(let shift=-search;shift<=search;shift++){
      let dot=0,headPower=0,tailPower=0;
      for(let i=0;i<overlap;i++){
        const a=signal[i],b=signal[target+shift-overlap+i];dot+=a*b;headPower+=a*a;tailPower+=b*b;
      }
      const correlation=dot/Math.sqrt(headPower*tailPower||1);
      if(correlation>best){best=correlation;end=target+shift;}
    }
    const loop=signal.slice(overlap,end);
    // A cosine crossfade has zero slope at both splice boundaries. Correct
    // correlated power instead of forcing an equal-power bump or linear dip.
    for(let i=0;i<overlap;i++){
      const t=(1-Math.cos(Math.PI*i/(overlap-1)))/2,a=1-t;
      const power=Math.sqrt(a*a+t*t+2*best*a*t);
      loop[loop.length-overlap+i]=(signal[end-overlap+i]*a+signal[i]*t)/Math.max(.5,power);
    }
    let energy=0,peak=0,mean=0;
    for(const value of loop)mean+=value;mean/=loop.length;
    for(let i=0;i<loop.length;i++){loop[i]-=mean;energy+=loop[i]**2;peak=Math.max(peak,Math.abs(loop[i]));}
    const scale=Math.min(.17/Math.sqrt(energy/loop.length),.7/peak);
    for(let i=0;i<loop.length;i++)loop[i]*=scale;
    // Browser resamplers pad the ends of a decoded file. Rotate this periodic
    // signal to a quiet zero crossing so that padding cannot create a step at
    // the seam, including when the device runs at 44.1 or 48 kHz.
    let cut=0,quietest=Infinity;
    for(let i=16;i<loop.length-16;i++)if(loop[i]*loop[i-1]<=0){
      let score=0;
      for(let j=-8;j<=8;j++)score+=loop[i+j]**2/(1+Math.abs(j));
      if(score<quietest){quietest=score;cut=i;}
    }
    const periodic=new Float32Array(loop.length);periodic.set(loop.subarray(cut));periodic.set(loop.subarray(0,cut),loop.length-cut);
    // Ease the sub-millisecond neighborhood of that quiet crossing to exact
    // zero amplitude/slope. This prevents device resampling from ringing
    // against the decoder's zero padding, without an audible volume pulse.
    const edgeSamples=16;
    for(let i=0;i<edgeSamples;i++){
      const gain=(1-Math.cos(Math.PI*i/(edgeSamples-1)))/2;
      periodic[i]*=gain;periodic[periodic.length-1-i]*=gain;
    }
    await writeFile(pcm,Buffer.from(periodic.buffer));
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-f','f32le','-ar',String(sampleRate),'-ac','1','-i',pcm,'-c:a','pcm_s16le',mastered]);
    const bytes=await readFile(mastered);await writeFile(output,bytes);
    Object.assign(entry,{file,bytes:bytes.length,sha256:hash(bytes),masteredAt:new Date().toISOString(),mastering:{
      tool:'scripts/master-tesla-reverse.mjs (ffmpeg + local PCM processing)',sourceFile,sourceSha256:hash(original),sourceBytes:original.length,
      sourceChannel:'right, mono',pitchRatio:1,filters:'highpass 35 Hz; lowpass 2600 Hz',outputFormat:'16-bit mono WAV, 22050 Hz',
      loopCrossfadeMs:250,seamCorrelation:best,zeroCrossingRotationSamples:cut,zeroCrossingEaseMs:edgeSamples/sampleRate*1000,durationSeconds:loop.length/sampleRate,
      description:'Fresh ElevenLabs UFO source at its original low pitch; matched-phase cosine loop splice and lossless output. No fast level modulation or synthesized layers.',
    }});
    await writeFile(provenancePath,JSON.stringify(provenance,null,2)+'\n');
    await unlink(generated).catch(error=>{if(error.code!=='ENOENT')throw error;});
    console.log(JSON.stringify({file,bytes:bytes.length,duration:loop.length/sampleRate,seamCorrelation:best}));
  }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  masterTeslaReverseAudio({force:process.argv.includes('--force')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
