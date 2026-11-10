import type {CityArea,ParkPath,Point2} from '../types';
import {pointInside} from './roads.ts';

/** The Commonwealth Avenue Mall, Arlington Street to Charlesgate East: a 100 ft lawn between the avenue's two
 * roadways with one straight walk down its centre, four rows of trees, a low iron fence across each end of a block
 * and a monument on most blocks. Boston's open space layer types it "Malls, Squares & Plazas", which the park
 * renderer otherwise paves.
 *
 * Everything here is a pure plan in world metres; `src/render/commonwealth-mall.ts` draws it. The walk itself is
 * surveyed: the Boston Sidewalk Inventory has one polygon per block (the 6.2 m walk, the paving that widens around
 * each monument's island and the cross street sidewalks at both ends), which the tile builder already drapes. */
export const isCommonwealthMall=(park:Pick<CityArea,'name'>)=>/^Commonwealth Avenue Mall\b/.test(park.name);

/** Half the lawn's width, half the centre walk's, and the two tree rows on each side, in metres from the axis. */
export const MALL_HALF_WIDTH=15.2,MALL_WALK_HALF=3.15,MALL_ROWS=[5.4,12] as const;
/** Half the opening the fence leaves for the walk, and the last post short of the avenue's curb. */
export const MALL_GATE_HALF=3.55,MALL_FENCE_END=14.45;
/** Where the fence stands behind the back of the cross street sidewalk, in metres. */
export const MALL_FENCE_SETBACK=.15;

/** A fenced end of a block, measured on the surveyed sidewalk polygons (tests/commonwealth-mall.test.mjs holds
 * every post to them): the walk is not quite on the lawn's axis, and the cross street sidewalk overlaps the
 * lawn's end by a different amount at each. */
export interface MallGate {
  /** The walk's centre where it enters, in metres across the axis (north positive). */ centre:number;
  /** How far the cross street sidewalk reaches inside the lawn's end, north then south of the walk. */ back:[number,number];
  /** The last post's distance from the axis, where a narrower lawn or a strip of paving along the curb stops the fence short. */ reach?:number;
}

export interface MallBlock {
  name:string;
  /** Midpoints of the lawn's east and west ends (park records 363-*): the block's axis. Where the Massachusetts
   * Avenue underpass cuts the lawn to a point, that end is the tip's reach along the axis of the street end. */
  east:Point2; west:Point2;
  /** The iron fence across the lawn's east and west ends, where there is one. */ fence:[MallGate|undefined,MallGate|undefined];
  /** The stretch of the axis the centre walk runs on, in metres from `east`. */ walk:[number,number];
  /** Granite posts instead of iron ones at the east entrance. */ stoneGate?:boolean;
}
export const MALL_BLOCKS:readonly MallBlock[]=[
  {name:'Arlington Street to Berkeley Street',east:[253.59,-391.69],west:[82.12,-328.56],fence:[{centre:0,back:[.46,.65]},{centre:.2,back:[.28,.27]}],walk:[0,182.72],stoneGate:true},
  {name:'Berkeley Street to Clarendon Street',east:[61.5,-320.73],west:[-96.09,-262.63],fence:[{centre:.05,back:[.41,.38]},{centre:.05,back:[.71,.58]}],walk:[0,167.96]},
  {name:'Clarendon Street to Dartmouth Street',east:[-114.04,-255.89],west:[-269.73,-198.63],fence:[{centre:.1,back:[.13,.11]},{centre:0,back:[.22,.26]}],walk:[0,165.89]},
  {name:'Dartmouth Street to Exeter Street',east:[-298.85,-187.64],west:[-449.94,-132.18],fence:[{centre:.15,back:[.58,.42]},{centre:-.15,back:[0,.16]}],walk:[0,160.95]},
  {name:'Exeter Street to Fairfield Street',east:[-466.91,-125.55],west:[-638.71,-62.42],fence:[{centre:.2,back:[.65,.64]},{centre:0,back:[0,.11]}],walk:[0,183.04]},
  {name:'Fairfield Street to Gloucester Street',east:[-655.67,-55.79],west:[-799.37,-2.78],fence:[{centre:.65,back:[.63,.78]},{centre:.15,back:[.71,.84]}],walk:[0,153.16]},
  // The lawn is 29 m wide at Gloucester Street, and the inventory has no sidewalk there north of the walk.
  {name:'Gloucester Street to Hereford Street',east:[-816.54,3.44],west:[-923.35,43.2],fence:[{centre:0,back:[0,.01],reach:13.75},{centre:.45,back:[.5,.42]}],walk:[0,113.97]},
  // The walk stops where the underpass ramps start to close the lawn; the lawn runs on to a point.
  {name:'Hereford Street to Massachusetts Avenue',east:[-940.66,49.51],west:[-1055.52,90.83],fence:[{centre:.15,back:[.17,0],reach:13.3},undefined],walk:[0,73.6]},
  // West of the underpass the lawn opens from a point; its walk (OpenStreetMap way 807050706) ends on Leif Eriksson's plaza.
  {name:'Massachusetts Avenue to Charlesgate East',east:[-1212.61,123.79],west:[-1372.55,129.06],fence:[undefined,undefined],walk:[59,137]},
];

export type MallMonumentId='hamilton'|'glover'|'collins'|'vendome'|'garrison'|'morison'|'women'|'sarmiento'|'eriksson';
export interface MallMonument {
  id:MallMonumentId; name:string; artist:string; year:number;
  /** Where it stands: the centre of the island the sidewalk inventory leaves open in the walk. */ at:Point2;
  /** The paving around it, as an ellipse about `around` (default `at`): metres along the axis and across it. */ paved:[number,number]; around?:Point2;
  /** Every figure looks toward the Public Garden but Leif Eriksson, who looks west. */ faces:'east'|'west';
}
export const MALL_MONUMENTS:readonly MallMonument[]=[
  {id:'hamilton',name:'Alexander Hamilton',artist:'William Rimmer',year:1865,at:[192.76,-369.39],paved:[8.5,7],faces:'east'},
  {id:'glover',name:'General John Glover',artist:'Martin Milmore',year:1875,at:[5.47,-300.2],paved:[8.5,7],faces:'east'},
  // The inventory leaves a 15 m planted round open here, its east side cut straight where the paving reaches the
  // memorial's face (OpenStreetMap ways 827075375/7 lead to the same spot): it stands 1.3 m inside that edge.
  {id:'collins',name:'Patrick Andrew Collins',artist:'Henry Hudson Kitson and Theo Alice Ruggles Kitson',year:1908,at:[-167.17,-235.82],paved:[13.2,13.2],around:[-171.38,-234.17],faces:'east'},
  {id:'vendome',name:'Vendome Firefighters Memorial',artist:'Ted Clausen and Peter White',year:1997,at:[-248.19,-206.5],paved:[9.5,7.2],faces:'east'},
  {id:'garrison',name:'William Lloyd Garrison',artist:'Olin Levi Warner',year:1886,at:[-349.47,-169.18],paved:[10,8.6],faces:'east'},
  {id:'morison',name:'Samuel Eliot Morison',artist:'Penelope Jencks',year:1982,at:[-496.22,-114.94],paved:[8.8,7.5],faces:'east'},
  {id:'women',name:"Boston Women's Memorial",artist:'Meredith Bergmann',year:2003,at:[-703.81,-38.14],paved:[10.2,9.4],faces:'east'},
  {id:'sarmiento',name:'Domingo Faustino Sarmiento',artist:'Yvette Compagnion',year:1973,at:[-854.43,17.34],paved:[8.6,7.5],faces:'east'},
  {id:'eriksson',name:'Leif Eriksson',artist:'Anne Whitney',year:1887,at:[-1362.67,128.6],paved:[14,9.6],faces:'west'},
];
/** The round of granite paving the Women's Memorial stands on (the inventory's open island there). */
export const WOMENS_MEMORIAL_RADIUS=4.25;

/** A block's own frame: `s` metres west from its east end along the axis, `v` metres across it (north positive). */
export interface MallFrame { block:MallBlock; index:number; length:number; ax:number; az:number; nx:number; nz:number; at(s:number,v:number):Point2; local(p:Point2):[number,number]; }
export const mallFrames:readonly MallFrame[]=MALL_BLOCKS.map((block,index)=>{
  const [ex,ez]=block.east,length=Math.hypot(block.west[0]-ex,block.west[1]-ez),ax=(block.west[0]-ex)/length,az=(block.west[1]-ez)/length,nx=-az,nz=ax;
  return {block,index,length,ax,az,nx,nz,at:(s,v)=>[ex+ax*s+nx*v,ez+az*s+nz*v],local:p=>[(p[0]-ex)*ax+(p[1]-ez)*az,(p[0]-ex)*nx+(p[1]-ez)*nz]};
});
/** The block whose lawn rectangle holds a point (a tapered block's rectangle reaches past its lawn). */
export function mallFrameAt(x:number,z:number,margin=0){
  for(const frame of mallFrames){const [s,v]=frame.local([x,z]);if(s>=-margin&&s<=frame.length+margin&&Math.abs(v)<=MALL_HALF_WIDTH+margin)return frame;}
  return undefined;
}
/** Heading (atan2 of x, z, as a vehicle's yaw) a monument faces. */
export function monumentYaw(monument:MallMonument){
  const frame=mallFrameAt(...monument.at,2)!,sign=monument.faces==='west'?1:-1;return Math.atan2(frame.ax*sign,frame.az*sign);
}

function ringDistance(p:Point2,ring:Point2[]){
  let best=Infinity;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;
    best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz));
  }
  return best;
}
interface Lawn { ring:Point2[]; holes:Point2[][]; minX:number; maxX:number; minZ:number; maxZ:number; }
const lawnsOf=(parks:readonly CityArea[]):Lawn[]=>parks.filter(p=>isCommonwealthMall(p)&&p.rings[0]?.length>=3).map(p=>{
  const ring=p.rings[0];let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const [x,z] of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  return {ring,holes:p.rings.slice(1),minX,maxX,minZ,maxZ};
});
/** Signed reach of a point into the Mall's lawns: metres inside the nearest edge (negative outside every lawn). */
function lawnDepth(lawns:Lawn[],p:Point2,reach:number){
  let best=-Infinity;
  for(const lawn of lawns){
    if(p[0]<lawn.minX-reach||p[0]>lawn.maxX+reach||p[1]<lawn.minZ-reach||p[1]>lawn.maxZ+reach)continue;
    const inside=pointInside(p,lawn.ring)&&!lawn.holes.some(h=>pointInside(p,h)),distance=ringDistance(p,lawn.ring);
    best=Math.max(best,inside?distance:-distance);
  }
  return best;
}
/** Whether a point is on the lawn of a planned block, or on the cross street sidewalk at a fenced end of one,
 * where the fence and the walk's opening stand: the trees and grates of the avenue and of the crossing streets
 * keep off both. The other lawns (the slivers beside the underpass, the Kenmore block) keep their street trees. */
export function mallGroundTest(parks:readonly CityArea[],reach=6.5){
  const lawns=lawnsOf(parks.filter(isPlannedMallLawn));
  return (x:number,z:number)=>{
    if(!lawns.length)return false;
    for(const frame of mallFrames){
      const [s,v]=frame.local([x,z]);if(Math.abs(v)>MALL_HALF_WIDTH+.8)continue;
      if(frame.block.fence[0]&&s>=-reach&&s<=1||frame.block.fence[1]&&s>=frame.length-1&&s<=frame.length+reach)return true;
    }
    return lawns.some(lawn=>x>=lawn.minX&&x<=lawn.maxX&&z>=lawn.minZ&&z<=lawn.maxZ&&pointInside([x,z],lawn.ring)&&!lawn.holes.some(h=>pointInside([x,z],h)));
  };
}
/** Which of the Mall's park records a planned block covers (the slivers beside the underpass and the Kenmore block keep the park renderer's own planting). */
export const isPlannedMallLawn=(park:CityArea)=>isCommonwealthMall(park)&&mallFrames.some(f=>{const p=f.at(f.length*.55,0);return pointInside(p,park.rings[0])&&!park.rings.slice(1).some(h=>pointInside(p,h));});

/** How a park path lies on the Mall: on a planned block (its walk, benches and trees come from the plan), on
 * another Mall lawn (the Kenmore block's walks), or not on the Mall at all. A path counts when every vertex is
 * on a lawn or within 2 m of one: the mapped walks run a metre onto the cross street sidewalks. */
export function mallPathTest(parks:readonly CityArea[]){
  const lawns=lawnsOf(parks);
  return (path:Pick<ParkPath,'points'>):'block'|'lawn'|undefined=>{
    if(!lawns.length||path.points.length<2||!path.points.every(p=>lawnDepth(lawns,p,2)>=-2))return undefined;
    const a=path.points[0],b=path.points[path.points.length-1];
    return mallFrameAt((a[0]+b[0])/2,(a[1]+b[1])/2,2)?'block':'lawn';
  };
}
const inPaving=(frame:MallFrame,s:number,v:number,grow=0)=>MALL_MONUMENTS.some(m=>{
  const [ms,mv]=frame.local(m.around??m.at);
  return ((s-ms)/(m.paved[0]+grow))**2+((v-mv)/(m.paved[1]+grow))**2<1;
});

export interface MallTree { x:number; z:number; species:'elm'|'maple'|'red oak'|'honey locust'; scale:number; }
export interface MallBench { x:number; z:number; /** Heading the sitter faces: across the walk. */ yaw:number; }
export type MallPostKind='gate'|'stone'|'line'|'end';
/** One run of fence, from the walk's opening out to the avenue's curb: posts in order, a panel between each pair. */
export interface MallFenceRun { block:number; /** 0 at the block's east end, 1 at its west. */ end:number; posts:{at:Point2;kind:MallPostKind}[]; }
export interface MallPlan { trees:MallTree[]; benches:MallBench[]; fences:MallFenceRun[]; monuments:readonly MallMonument[]; }

const TREE_SPACING=9.5,TREE_MARGIN=2.6,BENCH_SPACING=21;
const SPECIES:[MallTree['species'],number][]=[['elm',.46],['maple',.66],['red oak',.84],['honey locust',1]];
const plans=new WeakMap<readonly CityArea[],MallPlan>();
/** Trees, benches and fences of every planned block. `parks` supplies the lawn outlines: a trunk stands at least
 * 2.6 m inside one. Each block's sequence is its own, so a tile that sees only some of the lawns plans the same
 * trees on them as a tile that sees them all; an item belongs to the tile its position falls in. */
export function planMall(parks:readonly CityArea[]):MallPlan{
  const cached=plans.get(parks);if(cached)return cached;
  const lawns=lawnsOf(parks),trees:MallTree[]=[],benches:MallBench[]=[],fences:MallFenceRun[]=[];
  for(const frame of lawns.length?mallFrames:[]){
    const {block,length}=frame;let seed=7919*(frame.index+1);
    const random=()=>(seed=(Math.imul(seed,1664525)+1013904223)|0,(seed>>>0)/4294967296);
    // Four rows, the outer pair half a spacing along from the inner; beyond the walk's ends one more down the middle.
    const stations=Math.max(1,Math.round((length-14)/TREE_SPACING)),step=(length-14)/stations;
    const rows:[number,number][]=[[MALL_ROWS[0],0],[-MALL_ROWS[0],0],[MALL_ROWS[1],.5],[-MALL_ROWS[1],.5],[0,.25]];
    for(const [row,shift] of rows)for(let i=0;i+shift<=stations;i++){
      // Drawn before any test, so the sequence does not depend on which lawns this tile sees.
      const jitterS=(random()-.5)*1.8,jitterV=(random()-.5)*.9,gap=random(),kind=random(),size=random(),young=random();
      const s=7+(i+shift)*step+jitterS,v=row+jitterV;
      if(row===0&&s>block.walk[0]-5&&s<block.walk[1]+5)continue;
      if(gap<.09||inPaving(frame,s,v))continue;
      const p=frame.at(s,v);if(lawnDepth(lawns,p,0)<TREE_MARGIN)continue;
      trees.push({x:p[0],z:p[1],species:SPECIES.find(entry=>kind<entry[1])![0],scale:young<.14?.5+size*.18:.92+size*.3});
    }
    // Benches face each other across the walk.
    const [from,to]=block.walk,count=Math.max(0,Math.round((to-from-28)/BENCH_SPACING));
    for(let i=0;i<=count&&to-from>=28;i++){
      const s=from+14+(count?i*(to-from-28)/count:(to-from-28)/2);
      for(const side of [1,-1]){
        const v=side*(MALL_WALK_HALF+.8);if(inPaving(frame,s,v,1.2))continue;
        const p=frame.at(s,v);benches.push({x:p[0],z:p[1],yaw:Math.atan2(-frame.nx*side,-frame.nz*side)});
      }
    }
    for(const [end,gate] of block.fence.entries()){
      if(!gate)continue;
      for(const [k,side] of [1,-1].entries()){
        // Just behind the back of the cross street sidewalk, from the walk's edge out to the curb.
        const inset=Math.max(.2,gate.back[k]+MALL_FENCE_SETBACK),s=end?length-inset:inset,from=gate.centre+side*MALL_GATE_HALF,to=side*(gate.reach??MALL_FENCE_END);
        const panels=Math.max(1,Math.round(Math.abs(to-from)/2.2)),posts:MallFenceRun['posts']=[];
        for(let i=0;i<=panels;i++)posts.push({at:frame.at(s,from+(to-from)*i/panels),kind:i===0?(block.stoneGate&&!end?'stone':'gate'):i===panels?'end':'line'});
        fences.push({block:frame.index,end,posts});
      }
    }
  }
  const plan={trees,benches,fences,monuments:lawns.length?MALL_MONUMENTS:[]};plans.set(parks,plan);return plan;
}
