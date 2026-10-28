import type { CityData, Point2, Road } from '../types';
type Segment={road:Road;a:Point2;dx:number;dz:number;len2:number};
const roadIndexes=new WeakMap<CityData,{cells:Map<string,Segment[]>;minX:number;maxX:number;minZ:number;maxZ:number}>();
function roadIndex(city:CityData){
  const cached=roadIndexes.get(city);if(cached)return cached;
  const cells=new Map<string,Segment[]>();let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const road of city.roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz;if(len2<1)continue;
    const segment={road,a,dx,dz,len2},left=Math.floor(Math.min(a[0],b[0])/128),right=Math.floor(Math.max(a[0],b[0])/128),top=Math.floor(Math.min(a[1],b[1])/128),bottom=Math.floor(Math.max(a[1],b[1])/128);
    minX=Math.min(minX,left);maxX=Math.max(maxX,right);minZ=Math.min(minZ,top);maxZ=Math.max(maxZ,bottom);
    for(let x=left;x<=right;x++)for(let z=top;z<=bottom;z++){const key=`${x},${z}`,list=cells.get(key)??[];list.push(segment);cells.set(key,list);}
  }
  const index={cells,minX,maxX,minZ,maxZ};roadIndexes.set(city,index);return index;
}
export function closestRoad(city: CityData, x: number, z: number, majorOnly = false) {
  let best = { x:city.spawn.x, z:city.spawn.z, yaw:city.spawn.yaw, distance:Infinity, road:city.roads[0] };
  const index=roadIndex(city),cx=Math.floor(x/128),cz=Math.floor(z/128),seen=new Set<Segment>();
  if(!index.cells.size)return best;
  const limit=Math.max(Math.abs(cx-index.minX),Math.abs(cx-index.maxX),Math.abs(cz-index.minZ),Math.abs(cz-index.maxZ));
  for(let radius=0;radius<=limit;radius++){
    for(let xx=cx-radius;xx<=cx+radius;xx++)for(let zz=cz-radius;zz<=cz+radius;zz++){
      if(radius&&Math.abs(xx-cx)!==radius&&Math.abs(zz-cz)!==radius)continue;
      for(const segment of index.cells.get(`${xx},${zz}`)??[]){
      if(seen.has(segment))continue;seen.add(segment);
      const {road,a,dx,dz,len2}=segment;
      if(majorOnly && (road.width<7 || /alley|public|unnamed/i.test(road.name)))continue;
      const t=Math.max(.05,Math.min(.95,((x-a[0])*dx+(z-a[1])*dz)/len2));
      const px=a[0]+t*dx,pz=a[1]+t*dz,d=Math.hypot(px-x,pz-z);
      if(d<best.distance){ const dir=road.oneway===-1?-1:1;best={x:px,z:pz,yaw:Math.atan2(dx*dir,dz*dir),distance:d,road}; }
      }
    }
    const unseenDistance=Math.min(x-(cx-radius)*128,(cx+radius+1)*128-x,z-(cz-radius)*128,(cz+radius+1)*128-z);
    if(best.distance<unseenDistance)break;
  }
  return best;
}
export function pointInside(point: Point2, polygon: Point2[]) {
  let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
export function roadLength(road: Road){let length=0;for(let i=1;i<road.points.length;i++)length+=Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]);return length;}
