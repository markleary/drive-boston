import type {Point2} from '../types';

/** Find signal visits along dense routes without comparing every route segment
 * with every junction in the metro. Keep the same nine-metre detection radius,
 * twenty-metre visit grouping, and eight-metre stop-line setback. */
export function createRouteSignalLookup(junctions:Point2[]){
  const cell=64,cells=new Map<string,{point:Point2;index:number}[]>();
  junctions.forEach((point,index)=>{
    const key=`${Math.floor(point[0]/cell)},${Math.floor(point[1]/cell)}`,list=cells.get(key)??[];
    list.push({point,index});cells.set(key,list);
  });
  return(points:Point2[],distances:number[])=>{
    const visits=new Map<number,{along:number;separation:number}[]>();
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],segment=Math.hypot(dx,dz);
      const minX=Math.floor((Math.min(a[0],b[0])-9)/cell),maxX=Math.floor((Math.max(a[0],b[0])+9)/cell);
      const minZ=Math.floor((Math.min(a[1],b[1])-9)/cell),maxZ=Math.floor((Math.max(a[1],b[1])+9)/cell);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)for(const {point,index}of cells.get(`${x},${z}`)??[]){
        const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(segment*segment||1)));
        const separation=Math.hypot(a[0]+t*dx-point[0],a[1]+t*dz-point[1]);
        if(separation>=9)continue;
        const list=visits.get(index)??[];list.push({along:distances[i-1]+segment*t,separation});visits.set(index,list);
      }
    }
    const stops:number[]=[];
    // Preserve source junction order for ties, as well as repeated visits to a
    // junction after the route loops around a block.
    for(const index of [...visits.keys()].sort((a,b)=>a-b)){
      const nearby=visits.get(index)!;let best:typeof nearby[number]|undefined,previous=-Infinity;
      for(const candidate of nearby){
        if(candidate.along-previous>20&&best){stops.push(Math.max(0,best.along-8));best=undefined;}
        if(!best||candidate.separation<best.separation)best=candidate;
        previous=candidate.along;
      }
      if(best)stops.push(Math.max(0,best.along-8));
    }
    return stops.sort((a,b)=>a-b);
  };
}
