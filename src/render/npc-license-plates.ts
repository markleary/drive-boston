import * as THREE from 'three';
import {massachusettsPlateTexture} from './car.ts';

const issued=new Set(['4BK 026']); // Keep NPC registrations distinct from the player.
const letters='ABCDEFGHJKLMNPRSTUVWXYZ';
let fallback=0;
function registration(random:()=>number){
  const pick=(n:number)=>Math.min(n-1,Math.max(0,Math.floor(random()*n)));
  for(let attempt=0;attempt<128;attempt++){
    const value=`${1+pick(9)}${letters[pick(letters.length)]}${letters[pick(letters.length)]} ${String(pick(1000)).padStart(3,'0')}`;
    if(!issued.has(value)){issued.add(value);return value;}
  }
  // Bounded fallback also makes deterministic RNGs safe in tests.
  for(;;){const n=fallback++,value=`${1+Math.floor(n/(letters.length**2*1000))%9}${letters[Math.floor(n/(letters.length*1000))%letters.length]}${letters[Math.floor(n/1000)%letters.length]} ${String(n%1000).padStart(3,'0')}`;if(!issued.has(value)){issued.add(value);return value;}}
}

/** One small texture atlas per fleet, with one immutable cell per actor. Both
 * end plates share that cell; paint colors never tint the registration batch. */
export function createNPCPlateAtlas(capacity:number,random=Math.random){
  const columns=Math.min(8,capacity),rows=Math.ceil(capacity/columns),cellW=256,cellH=128,pad=2;
  const canvas=typeof document==='undefined'?undefined:document.createElement('canvas');
  if(canvas){canvas.width=columns*cellW;canvas.height=rows*cellH;}
  const context=canvas?.getContext('2d'),texture=canvas?new THREE.CanvasTexture(canvas):null;
  if(texture){texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;}
  const numbers:string[]=Array(capacity).fill('');
  return {
    texture,
    assign(index:number){
      if(numbers[index])return numbers[index];
      const number=registration(random);numbers[index]=number;
      if(context&&texture){const art=massachusettsPlateTexture(number)!;context.drawImage(art.image,(index%columns)*cellW+pad,Math.floor(index/columns)*cellH+pad,cellW-2*pad,cellH-2*pad);art.dispose();texture.needsUpdate=true;}
      return number;
    },
    number(index:number){return numbers[index];},
    geometry(source:THREE.BufferGeometry,index:number){
      const geometry=source.clone(),uv=geometry.getAttribute('uv');
      const x=(index%columns)*cellW,y=Math.floor(index/columns)*cellH;
      for(let i=0;i<uv.count;i++)uv.setXY(i,(x+pad+uv.getX(i)*(cellW-2*pad))/(columns*cellW),1-(y+pad+(1-uv.getY(i))*(cellH-2*pad))/(rows*cellH));
      return geometry;
    },
    dispose(){for(const number of numbers)if(number)issued.delete(number);texture?.dispose();},
  };
}
