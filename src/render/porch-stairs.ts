import type {Point2} from '../types';

export interface PorchStairSite {
  origin:Point2; tangent:Point2; normal:Point2; frontDepth:number;
  width:number; depth:number; frontage:number; along:number; setback:number; landingY:number;
}
export interface StairBlock {
  center:Point2; width:number; depth:number; top:number; bottom:number; corners:Point2[];
}
export interface PorchStairs {
  entry:'front'|'left'|'right'; direction:Point2; start:Point2;
  width:number; run:number; riser:number; steps:StairBlock[]; landing:StairBlock;
}

export function stairFootprint(center:Point2,direction:Point2,width:number,depth:number):Point2[]{
  const [dx,dz]=direction;
  return [-1,1].flatMap(side=>[-1,1].map(end=>[
    center[0]+dz*width/2*side+dx*depth/2*end,
    center[1]-dx*width/2*side+dz*depth/2*end,
  ] as Point2));
}

function footprintSamples(center:Point2,corners:Point2[]):Point2[]{
  return [center,...corners,...[[0,1],[0,2],[1,3],[2,3]].map(([a,b])=>[
    (corners[a][0]+corners[b][0])/2,(corners[a][1]+corners[b][1])/2,
  ] as Point2)];
}

/** Solve the run and its actual landing elevation together. The house floor is
 * level, while every step's masonry extends into the terrain beneath it. */
export function planPorchStairs(site:PorchStairSite,ground:(x:number,z:number)=>number,clear:(p:Point2)=>boolean=()=>true):PorchStairs|undefined{
  const at=(u:number,d:number):Point2=>[
    site.origin[0]+site.tangent[0]*u+site.normal[0]*(site.frontDepth+d),
    site.origin[1]+site.tangent[1]*u+site.normal[1]*(site.frontDepth+d),
  ];
  const candidates=[
    {entry:'front' as const,start:at(0,site.depth),direction:site.normal,available:site.setback-site.frontDepth-site.depth-1.4,width:1.25},
    {entry:'left' as const,start:at(-site.width/2,site.depth/2),direction:site.tangent.map(v=>-v) as Point2,available:site.frontage/2+site.along-site.width/2-.15,width:Math.min(1.25,site.depth-.12)},
    {entry:'right' as const,start:at(site.width/2,site.depth/2),direction:site.tangent,available:site.frontage/2-site.along-site.width/2-.15,width:Math.min(1.25,site.depth-.12)},
  ];
  const tread=.28,landingDepth=.4;
  for(const candidate of candidates){
    const {start,direction,width,available}=candidate;
    const point=(distance:number):Point2=>[start[0]+direction[0]*distance,start[1]+direction[1]*distance];
    const footprint=(distance:number,depth:number)=>stairFootprint(point(distance),direction,width,depth);
    for(let count=1;count<=40&&count*tread+landingDepth<=available;count++){
      const run=count*tread,corners=footprint(run+landingDepth/2,landingDepth);
      // Include the landing center as well as corners when a terrain triangle
      // boundary crosses the small pad. Its top stays above the highest ground.
      const landingSamples=footprintSamples(point(run+landingDepth/2),corners),landingHeights=landingSamples.map(p=>ground(...p));
      const top=Math.max(...landingHeights)+.06,riser=(site.landingY-top)/(count+1);
      if(riser<.09||riser>.205)continue;
      const steps:StairBlock[]=[];
      for(let i=0;i<count;i++){
        const center=point((i+.5)*tread),corners=footprint((i+.5)*tread,tread+.012);
        const samples=footprintSamples(center,corners),heights=samples.map(p=>ground(...p)),top=site.landingY-(i+1)*riser;
        if(top<Math.max(...heights)+.025||!samples.every(clear))break;
        steps.push({center,width,depth:tread+.012,top,bottom:Math.min(...heights)-.12,corners});
      }
      if(steps.length!==count||!landingSamples.every(clear))continue;
      return{entry:candidate.entry,direction,start,width,run,riser,steps,landing:{center:point(run+landingDepth/2),width,depth:landingDepth,top,bottom:Math.min(...landingHeights)-.12,corners}};
    }
  }
  // Do not attach a decorative porch that would require an impossible stair
  // squeezed onto the sidewalk or through a neighboring surveyed building.
  return undefined;
}
