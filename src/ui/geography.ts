import type { Point2 } from '../types';

export interface NamedArea { id:string; name:string; rings:Point2[][]; }

/** Even/odd filling handles the outer boundary and any interior holes. */
export function containsPoint(rings:Point2[][],x:number,z:number) {
  let inside=false;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

/** Choose a point inside a polygon, including concave neighborhoods. */
function labelPoint(rings:Point2[][],minX:number,maxX:number,minZ:number,maxZ:number):Point2 {
  const x=(minX+maxX)/2,z=(minZ+maxZ)/2;
  if(containsPoint(rings,x,z))return[x,z];
  const cuts:number[]=[];
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z))cuts.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]));
  }
  cuts.sort((a,b)=>a-b);
  let width=0,best=x;
  for(let i=0;i+1<cuts.length;i+=2)if(cuts[i+1]-cuts[i]>width){width=cuts[i+1]-cuts[i];best=(cuts[i+1]+cuts[i])/2;}
  return[best,z];
}

export function indexAreas<T extends NamedArea>(areas:readonly T[]) {
  return areas.map(area=>{
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const ring of area.rings)for(const[x,z]of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    return{...area,minX,maxX,minZ,maxZ,label:labelPoint(area.rings,minX,maxX,minZ,maxZ)};
  });
}

export function areaAt(areas:ReturnType<typeof indexAreas>,x:number,z:number) {
  return areas.find(area=>x>=area.minX&&x<=area.maxX&&z>=area.minZ&&z<=area.maxZ&&containsPoint(area.rings,x,z));
}
