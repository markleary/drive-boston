import type {Point2} from '../types';
import {MALL_MONUMENTS,mallFrames} from './commonwealth-mall.ts';

/** Where sidewalk walkers can stroll in a park: straight stretches along its mapped paths, since a walker paces one
 * straight line (street-life.ts). All pure geometry; the caller checks each stretch for buildings, roads and water. */
export interface WalkStretch { start:Point2; end:Point2; }

/** How far either side of a path's line its walkers keep: on the line of a path under 4.5 m, in two files on a wider one. */
export function pathLaneOffsets(width:number):number[]{
  if(width<4.5)return [0];
  const offset=Math.max(.65,Math.min(1.55,width/4));return [offset,-offset];
}
/** How far a straight stretch may leave the lane it follows and stay on a path of this width. */
export const laneTolerance=(width:number,lane:number)=>Math.max(.2,Math.min(.45,width/2-Math.abs(lane)-.55));

/** A polyline moved `offset` metres to its left (positive) or right, mitred at the bends. */
export function offsetLine(points:Point2[],offset:number):Point2[]{
  if(!offset)return points;
  return points.map((b,i)=>{
    const a=points[Math.max(0,i-1)],c=points[Math.min(points.length-1,i+1)];
    let ux=b[0]-a[0],uz=b[1]-a[1],vx=c[0]-b[0],vz=c[1]-b[1];const ul=Math.hypot(ux,uz),vl=Math.hypot(vx,vz);
    if(ul>1e-6){ux/=ul;uz/=ul;}
    if(vl>1e-6){vx/=vl;vz/=vl;}else{vx=ux;vz=uz;}
    if(ul<=1e-6){ux=vx;uz=vz;}
    let nx=-(uz+vz),nz=ux+vx;const nl=Math.hypot(nx,nz);if(nl<1e-6){nx=-uz;nz=ux;}else{nx/=nl;nz/=nl;}
    const reach=offset/Math.max(.5,nx*-uz+nz*ux);
    return [b[0]+nx*reach,b[1]+nz*reach] as Point2;
  });
}
function chordDistance(p:Point2,a:Point2,b:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
/** The straight stretches of a polyline: from each vertex the longest chord every vertex between stays within
 * `tolerance` of, kept when at least `minLength` long. A gentle curve gives a few chords, a tight one none. */
export function straightRuns(points:Point2[],tolerance:number,minLength=10):WalkStretch[]{
  const runs:WalkStretch[]=[];
  for(let i=0;i<points.length-1;){
    let j=i+1;
    extend:for(let k=j+1;k<points.length;k++){
      for(let m=i+1;m<k;m++)if(chordDistance(points[m],points[i],points[k])>tolerance)break extend;
      j=k;
    }
    if(Math.hypot(points[j][0]-points[i][0],points[j][1]-points[i][1])>=minLength)runs.push({start:points[i],end:points[j]});
    i=j;
  }
  return runs;
}

/** The Commonwealth Avenue Mall's centre walk as two files of straight stretches a block: on the surveyed walk
 * (its centre is each end's gate centre, not quite the lawn's axis), between the fences at its ends and the
 * paving that widens round each monument. The mapped paths of those blocks stop at each monument's ring and run
 * on the lawn's axis; these stand in for them. */
export function mallWalkLanes(lane=1.5,endMargin=2.5):WalkStretch[]{
  const stretches:WalkStretch[]=[];
  for(const frame of mallFrames){
    const {block,length}=frame,[from,to]=block.walk,east=block.fence[0]?.centre??0,west=block.fence[1]?.centre??0;
    // The stretches of the walk clear of every monument's paving.
    const breaks=MALL_MONUMENTS.map(m=>({s:frame.local(m.around??m.at),reach:m.paved[0]})).filter(({s})=>Math.abs(s[1])<3&&s[0]>0&&s[0]<length)
      .map(({s,reach})=>[s[0]-reach,s[0]+reach]).sort((a,b)=>a[0]-b[0]);
    let s=from+endMargin;const open:[number,number][]=[];
    for(const [a,b] of breaks){if(a>s)open.push([s,Math.min(a,to-endMargin)]);s=Math.max(s,b);}
    if(to-endMargin>s)open.push([s,to-endMargin]);
    for(const [a,b] of open){
      if(b-a<10)continue;
      for(const side of [1,-1]){
        // An ungated walk (west of the underpass, paved from its mapped line) keeps its files closer in.
        const offset=side*(block.fence[0]||block.fence[1]?lane:lane-.3),centre=(at:number)=>east+(west-east)*at/length;
        stretches.push({start:frame.at(a,centre(a)+offset),end:frame.at(b,centre(b)+offset)});
      }
    }
  }
  return stretches;
}
