/** Local mastering of the approved ElevenLabs GT recordings into distinct
 * player engine banks. No provider calls; requires ffmpeg only when building assets. */
import {readFile,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),audio=resolve(root,'public/audio');
const profiles={
  'mclaren-720s':{
    filter:'asetrate=42336,aresample=44100,highpass=f=45,equalizer=f=650:t=q:w=0.8:g=3,bass=g=1.5:f=180,treble=g=-3:f=3500,alimiter=limit=0.92:level=false',
    description:'Locally mastered variation of the approved GT engine; not a separate ElevenLabs generation or a recording of a real 720S.',
  },
  'supra-mk4':{
    filter:'asetrate=33075,aresample=44100,highpass=f=90,equalizer=f=800:t=q:w=0.8:g=3,equalizer=f=220:t=q:w=1:g=-2,treble=g=-4:f=4000,alimiter=limit=0.92:level=false',
    description:'Lower-pitched, smoother straight-six-inspired interpretation mastered from the approved GT exhaust; not an authentic 2JZ recording or a separate ElevenLabs generation.',
  },
};
const ids=Object.keys(profiles).flatMap(id=>[`${id}-drive`,`${id}-high`]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(path){try{await access(path);return true;}catch{return false;}}
export async function buildPlayerEngineAudio({selected=ids,overwrite=false}={}){
  const provenancePath=join(audio,'provenance.json');
  let provenance=JSON.parse(await readFile(provenancePath,'utf8'));
  for(const id of ids.filter(id=>selected.includes(id))){
    const output=join(audio,`${id}.mp3`);if(!overwrite&&await exists(output))continue;
    const layer=id.endsWith('drive')?'drive':'high',sourceId=`mclaren-gt-${layer}`,sourceFile=`${sourceId}.mp3`;
    const source=await readFile(join(audio,sourceFile)),sourceEntry=provenance.clips.find(c=>c.id===sourceId);
    if(!sourceEntry||sourceEntry.sha256!==hash(source))throw new Error(`Verify source provenance for ${sourceId} before mastering.`);
    const profile=profiles[id.slice(0,id.lastIndexOf('-'))],filter=profile.filter;
    const seconds=layer==='drive'?8:6,temp=await mkdtemp(join(tmpdir(),'player-engine-master-'));
    try{
      const mastered=join(temp,'master.mp3');
      await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',join(audio,sourceFile),'-af',filter,'-t',String(seconds),'-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','128k',mastered]);
      const bytes=await readFile(mastered);
      await writeFile(output,bytes,{flag:overwrite?'w':'wx'});
      provenance.clips=provenance.clips.filter(c=>c.id!==id);
      provenance.clips.push({id,seconds,loop:true,file:`${id}.mp3`,masteredAt:new Date().toISOString(),bytes:bytes.length,sha256:hash(bytes),derivation:{sourceId,sourceFile,sourceSha256:sourceEntry.sha256,sourceProvider:provenance.provider,sourceModel:provenance.model,sourcePrompt:sourceEntry.prompt,tool:'ffmpeg',filter,description:profile.description}});
      await writeFile(provenancePath,JSON.stringify(provenance,null,2)+'\n');
      console.log(`Mastered ${id} from ${sourceId} (${bytes.length} bytes).`);
    }finally{await rm(temp,{recursive:true,force:true});}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const prefix=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
  const selected=ids.filter(id=>!prefix||id.startsWith(prefix));
  if(!selected.length)throw new Error('No engine assets match --only.');
  buildPlayerEngineAudio({selected,overwrite:process.argv.includes('--force')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
