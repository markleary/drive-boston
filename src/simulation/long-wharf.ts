import type {CityData,ParkPath,Point2} from '../types.ts';
import {nearestQuay,waterfrontAt,waterfrontHeight,waterfrontSites} from './waterfront.ts';

const site=waterfrontSites.find(s=>s.id==='long-wharf')!;
const nearby=(p:Point2)=>p[0]>=site.bounds.minX-20&&p[0]<=site.bounds.maxX+20&&p[1]>=site.bounds.minZ-20&&p[1]<=site.bounds.maxZ+20;
const landing:Point2=[2159.782,-1114.99];
export const LONG_WHARF_DOCK={a:[2143.2,-1094.84] as Point2,b:[2154,-1095.83] as Point2,width:4.4,level:-4.2};
/** The dedicated paved quay owns the HarborWalk. Its coarse hydro edge is up
 * to nine metres inland of the OSM walk: keep routes on the paved side of that
 * wall instead of drawing a second unsupported ribbon out over the harbour. */
export function longWharfOwnsPath(path:ParkPath){
  return !path.bridge&&path.points.every(p=>{
    if(!nearby(p))return false;
    if(waterfrontAt(...p)?.id==='long-wharf')return true;
    const q=nearestQuay(...p);return q.edge?.site.id==='long-wharf'&&q.distance<15;
  });
}
export function refineLongWharfPaths(city:CityData,paths:ParkPath[]){
  return paths.flatMap(path=>{
    if(path.id.startsWith('osm-way-236582646-')){
      const start:Point2=[2146,-1095.1],dx=landing[0]-start[0],dz=landing[1]-start[1],length=Math.hypot(dx,dz),quay=nearestQuay(...landing).edge!;
      const signed=(p:Point2)=>(p[0]-quay.a[0])*quay.nx+(p[1]-quay.a[1])*quay.nz;
      const t=-signed(start)/(signed(landing)-signed(start)),wall:Point2=[start[0]+dx*t,start[1]+dz*t],lip=waterfrontHeight(city,...wall)+.18;
      // Clear the whole seawall cap before descending onto the inland paving.
      // A straight end-to-end incline otherwise runs into the raised quay edge.
      const stations=[[0,LONG_WHARF_DOCK.level],[t-.8/length,lip],[t+.35/length,lip],[1,waterfrontHeight(city,...landing)+.021]];
      const points:Point2[]=[],elevations:number[]=[];
      for(let i=1;i<stations.length;i++){
        const [a,ya]=stations[i-1],[b,yb]=stations[i],steps=Math.ceil((b-a)*length/1.5);
        for(let j=0;j<steps;j++){const s=j/steps,u=a+(b-a)*s;points.push([start[0]+dx*u,start[1]+dz*u]);elevations.push(ya+(yb-ya)*s);}
      }
      points.push(landing);elevations.push(stations.at(-1)![1]);
      const gangway:ParkPath={...path,points,bridgePoints:undefined,elevations};
      const dockPoints:Point2[]=Array.from({length:9},(_,i)=>[LONG_WHARF_DOCK.a[0]+(LONG_WHARF_DOCK.b[0]-LONG_WHARF_DOCK.a[0])*i/8,LONG_WHARF_DOCK.a[1]+(LONG_WHARF_DOCK.b[1]-LONG_WHARF_DOCK.a[1])*i/8]);
      const dock:ParkPath={id:`long-wharf-floating-landing-${path.id}`,name:'Long Wharf floating landing',width:LONG_WHARF_DOCK.width,bridge:true,points:dockPoints,elevations:dockPoints.map(()=>LONG_WHARF_DOCK.level)};
      return [gangway,dock];
    }
    if(!longWharfOwnsPath(path))return [path];
    const points=path.points.map((p):Point2=>{
      const q=nearestQuay(...p);if(!q.edge||q.edge.site.id!=='long-wharf'||q.distance>15)return p;
      const inset=path.width/2+.9;
      if(waterfrontAt(...p)&&q.distance>=inset)return p;
      return [q.point[0]+q.edge.nx*inset,q.point[1]+q.edge.nz*inset];
    });
    return [{...path,points}];
  });
}
/** Clear a continuous entrance through the otherwise continuous quay railing. */
export function longWharfGangwayOpening(x:number,z:number){return Math.hypot(x-landing[0],z-landing[1])<3.4;}

export function longWharfDockRailOpening(path:ParkPath,x:number,z:number){return path.id.startsWith('long-wharf-floating-landing-')&&x>2143.9&&x<2148.1&&z< -1096;}
