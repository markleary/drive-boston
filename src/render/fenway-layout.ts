import type { Point2 } from '../types';
import fenway from '../data/fenway-detail.json' with {type:'json'};
const feature=(role:string)=>fenway.features.find(f=>f.role===role)!.points as Point2[];

/** Include the separately surveyed lower bowl as well as the stadium shell.
 * Sampling only the main shell leaves chairs hidden inside the lower-bowl slab. */
export function createFenwayRoofSampler(translation=0){
  const cells=new Map<string,number[][]>();
  for(const triangle of fenway.roofTriangles){
    const xs=[triangle[0],triangle[3],triangle[6]],zs=[triangle[2],triangle[5],triangle[8]];
    for(let x=Math.floor(Math.min(...xs)/12);x<=Math.floor(Math.max(...xs)/12);x++)for(let z=Math.floor(Math.min(...zs)/12);z<=Math.floor(Math.max(...zs)/12);z++){
      const key=`${x},${z}`,list=cells.get(key)??[];list.push(triangle);cells.set(key,list);
    }
  }
  return(x:number,z:number)=>{
    let top=-Infinity;
    for(const t of cells.get(`${Math.floor(x/12)},${Math.floor(z/12)}`)??[]){
      const[ax,ay,az,bx,by,bz,cx,cy,cz]=t,den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;
      if(Math.min(u,v,w)>=-.0001)top=Math.max(top,u*ay+v*by+w*cy+translation);
    }
    return top;
  };
}

/** Solve home plate against mapped foul-pole placement and published distances.
 * The diamond is then a regulation square, independent of the irregular outfield. */
export function fenwayDiamond(){
  const left=feature('monster-wall')[0],right=fenway.markers.rightFoulPole as Point2;
  const dx=right[0]-left[0],dz=right[1]-left[1],d=Math.hypot(dx,dz),r=fenway.dimensions.leftFieldDistance,s=fenway.dimensions.rightFieldDistance;
  const along=(r*r-s*s+d*d)/(2*d),offset=Math.sqrt(Math.max(0,r*r-along*along));
  const candidates=[-1,1].map(sign=>[left[0]+dx/d*along-sign*dz/d*offset,left[1]+dz/d*along+sign*dx/d*offset] as Point2);
  const home=candidates.sort((a,b)=>b[1]-a[1])[0],firstDirection:[number,number]=[(right[0]-home[0])/s,(right[1]-home[1])/s],thirdDirection:[number,number]=[firstDirection[1],-firstDirection[0]];
  const base=fenway.dimensions.basePath;
  const first:Point2=[home[0]+firstDirection[0]*base,home[1]+firstDirection[1]*base],third:Point2=[home[0]+thirdDirection[0]*base,home[1]+thirdDirection[1]*base],second:Point2=[first[0]+thirdDirection[0]*base,first[1]+thirdDirection[1]*base];
  const mound:Point2=[home[0]+(firstDirection[0]+thirdDirection[0])*fenway.dimensions.moundDistance/Math.SQRT2,home[1]+(firstDirection[1]+thirdDirection[1])*fenway.dimensions.moundDistance/Math.SQRT2];
  return{home,first,second,third,mound,left,right,firstDirection,thirdDirection};
}

