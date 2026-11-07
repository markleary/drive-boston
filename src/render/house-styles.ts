import type { Building } from '../types';

/** Paint and roof choices for the generated houses of the northern towns
 * (build-metro.py shapes them from the assessor's style, year and storeys).
 * Pure functions of the building record, mirrored by house_palette() in
 * scripts/building_semantics.py so a far box carries the body colour its
 * detailed house will show. Interpretive: the assessor records a style, not a
 * paint colour, so the colours follow period practice rather than a survey of
 * any one house. Nineteenth-century houses mostly take the polychrome schemes
 * of Melrose Highlands and the Bellevue Avenue area (deep body colour, cream
 * trim, an accent sash and fish-scale shingles in the gables); later
 * colonials, capes and ranches take quieter colours, half of them with
 * shutters. */
export interface HousePalette {
  id:string; body:string; trim:string; sash:string;
  /** Gable colour: fish-scale shingles when `scales`, otherwise clapboard. */
  accent:string; scales:boolean;
  shutter?:string;
}
export const HOUSE_PALETTES:HousePalette[]=[
  {id:'lavender',body:'#8e88b8',trim:'#ece4cb',sash:'#6e2a3a',accent:'#6b6496',scales:true},
  {id:'sage',body:'#8fa77a',trim:'#ece4cb',sash:'#7b2230',accent:'#b5543c',scales:true},
  {id:'barn-red',body:'#9e3f36',trim:'#ece4cb',sash:'#2f4a3a',accent:'#3f5e4a',scales:true},
  {id:'teal',body:'#3f8c86',trim:'#ece4cb',sash:'#7a2e2e',accent:'#c9a24b',scales:true},
  {id:'golden',body:'#d9ae4c',trim:'#f3f2ec',sash:'#2f4f3e',accent:'#7e9a6a',scales:true},
  {id:'dusty-rose',body:'#b5788a',trim:'#f3f2ec',sash:'#4e3b5e',accent:'#7a5a8e',scales:true},
  {id:'slate-blue',body:'#5e7a99',trim:'#f3f2ec',sash:'#8a2e2e',accent:'#c8a060',scales:true},
  {id:'olive',body:'#7a7a45',trim:'#ece4cb',sash:'#6b2b24',accent:'#a0522d',scales:true},
  {id:'buff-and-green',body:'#e1d3a6',trim:'#ece4cb',sash:'#3e5b44',accent:'#3e5b44',scales:true,shutter:'#3e5b44'},
  {id:'peach',body:'#e3a982',trim:'#f3f2ec',sash:'#3d5a6c',accent:'#8c9e7a',scales:true},
  {id:'white',body:'#e9e7de',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#e9e7de',scales:false,shutter:'#24302c'},
  {id:'pale-grey',body:'#b9bcb6',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#b9bcb6',scales:false,shutter:'#2b3236'},
  {id:'greige',body:'#b9ae9b',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#b9ae9b',scales:false},
  {id:'blue-grey',body:'#8195a6',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#8195a6',scales:false,shutter:'#1e2933'},
  {id:'cedar',body:'#8d6b4e',trim:'#ece4cb',sash:'#ece4cb',accent:'#8d6b4e',scales:false},
  {id:'butter',body:'#ebdb9e',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#ebdb9e',scales:false,shutter:'#3a4a3f'},
  {id:'navy',body:'#3a4e66',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#3a4e66',scales:false},
  {id:'sage-grey',body:'#a3b39a',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#a3b39a',scales:false,shutter:'#2e3b34'},
  {id:'sky',body:'#a9bfcf',trim:'#f3f2ec',sash:'#f3f2ec',accent:'#a9bfcf',scales:false,shutter:'#22303c'},
  {id:'colonial-red',body:'#8e3b32',trim:'#ece4cb',sash:'#ece4cb',accent:'#8e3b32',scales:false},
];
const VIVID=HOUSE_PALETTES.map((p,i)=>p.scales?i:-1).filter(i=>i>=0),MUTED=HOUSE_PALETTES.map((p,i)=>p.scales?-1:i).filter(i=>i>=0);
/** far.bin style byte of palette 0; the far city maps style bytes from here on to house body colours. */
export const HOUSE_FAR_STYLE=32;

/** Roof coverings, by index into the house roof materials. */
export interface HouseRoof { id:string; kind:'shingle'|'slate'|'patterned-slate'; base:string; }
export const HOUSE_ROOFS:HouseRoof[]=[
  {id:'charcoal-shingle',kind:'shingle',base:'#45474a'},
  {id:'weathered-wood-shingle',kind:'shingle',base:'#615a50'},
  {id:'slate-grey-shingle',kind:'shingle',base:'#5c6266'},
  {id:'forest-green-shingle',kind:'shingle',base:'#3f4b42'},
  {id:'brown-shingle',kind:'shingle',base:'#53433a'},
  {id:'slate',kind:'slate',base:'#525866'},
  {id:'patterned-slate',kind:'patterned-slate',base:'#4f5560'},
];

/** Storey height of each typology (scripts/house_shapes.py FORMS) and the footing every generated shell stands on. */
const FLOOR:Record<string,number>={victorian:3.15,mansard:3.1,'old-style':3,'two-family':2.95,'three-decker':2.95,colonial:2.85,tudor:2.9,cape:2.7,gambrel:2.8,bungalow:2.8,ranch:2.7,contemporary:2.8,'row-house':2.9,garage:2.6};
export const HOUSE_FOUNDATION=.6;

const hash=(text:string)=>{let n=0;for(const c of text)n=Math.imul(n,31)+c.charCodeAt(0)|0;return Math.abs(n);};
export const isGeneratedHouse=(b?:Building):b is Building&{houseStyle:string}=>!!b?.houseStyle;
/** Built before 1916 in a nineteenth-century style: Victorian paint, trim and porches. */
export function victorianEra(b:Building){
  const style=b.houseStyle??'',year=b.yearBuilt??0;
  return style==='victorian'||style==='mansard'||((style==='old-style'||style==='two-family')&&year>=1840&&year<1916);
}
/** Index into HOUSE_PALETTES. */
export function housePalette(b:Building):number {
  const n=hash(b.id),style=b.houseStyle??'';
  const share=style==='victorian'||style==='mansard'?72:victorianEra(b)?38:style==='garage'?0:6;
  const list=n%100<share?VIVID:MUTED;
  return list[Math.floor(n/100)%list.length];
}
/** Index into HOUSE_ROOFS, or -1 for a flat (gravel) roof. Mansards are slate;
 * so are many Victorians, sometimes with banded fish-scale courses. */
export function houseRoof(b:Building):number {
  if(!b.roofShape||b.roofShape==='flat')return -1;
  const n=hash(`${b.id}:roof`),style=b.houseStyle??'';
  if(style==='mansard')return n%3===0?6:5;
  const slate=style==='victorian'?40:victorianEra(b)?18:0;
  if(n%100<slate)return n%5===0?6:5;
  const shingles=style==='garage'?[0,0,2,1]:[0,0,0,2,2,1,4,3];
  return shingles[Math.floor(n/100)%shingles.length];
}
/** Full storeys below the eave and their height (the shell's eave is the footing plus whole storeys). */
export function houseFloors(b:Building){
  const floor=FLOOR[b.houseStyle??'']??2.9,foundation=b.houseStyle==='garage'?.25:HOUSE_FOUNDATION,wall=(b.eaveHeight??b.height)-foundation;
  const floors=Math.max(1,Math.round(wall/floor));return {floors,floorHeight:wall/floors,foundation};
}
