import type {CityArea,Point2} from '../types';

export const SHORE_WIDTH=3;
export const SHORE_FADE=.75;
type Edge={a:Point2;b:Point2};
export interface WaterShore { rings:Point2[][]; width:number; distance:(x:number,z:number)=>number; }
const cache=new WeakMap<CityArea,WeakMap<Point2[][],WaterShore>>();
const boundaries=new WeakMap<CityArea,ReturnType<typeof edgeIndex>>();
const cross=(a:Point2,b:Point2,c:Point2)=>(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
function edgeIndex(edges:Edge[],reach:number){
  const cell=16,cells=new Map<string,Edge[]>();
  for(const edge of edges){const {a,b}=edge;
    for(let x=Math.floor((Math.min(a[0],b[0])-reach)/cell);x<=Math.floor((Math.max(a[0],b[0])+reach)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-reach)/cell);z<=Math.floor((Math.max(a[1],b[1])+reach)/cell);z++){
      const key=`${x},${z}`,list=cells.get(key)??[];list.push(edge);cells.set(key,list);
    }
  }
  return(x:number,z:number)=>{
    let distance=Infinity;
    for(const {a,b} of cells.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)??[]){
      const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(length||1)));
      distance=Math.min(distance,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
    }return distance;
  };
}
const edgesOf=(rings:Point2[][])=>rings.flatMap(r=>r.map((a,i)=>({a,b:r[(i+1)%r.length]})));

/** Round projecting shoreline corners inward by at most eight metres. Source
 * basin seams stay untouched: only edges on the complete hydro boundary count
 * as shore. Rounding is conservative, so trees on dry land stay dry, and island
 * holes grow rather than being filled. The cache is independent of tile bounds. */
export function waterShore(water:CityArea,source=water.rings):WaterShore{
  let sources=cache.get(water);if(!sources){sources=new WeakMap();cache.set(water,sources);}const cached=sources.get(source);if(cached)return cached;
  let originalDistance=boundaries.get(water);if(!originalDistance){originalDistance=edgeIndex(edgesOf(water.rings),4);boundaries.set(water,originalDistance);}const shoreEdges:Edge[]=[];
  let area=0,perimeter=0;
  for(const [index,ring] of water.rings.entries()){
    let signed=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];signed+=a[0]*b[1]-b[0]*a[1];perimeter+=Math.hypot(b[0]-a[0],b[1]-a[1]);}area+=(index?-1:1)*Math.abs(signed)/2;
  }
  // Leave open water in tiny ponds and narrow canals; a fixed-width bank can
  // otherwise consume the complete source footprint.
  const width=Math.min(SHORE_WIDTH,Math.max(.1,area/Math.max(1,perimeter)*.5));
  const onShore=(a:Point2,b:Point2)=>originalDistance((a[0]+b[0])/2,(a[1]+b[1])/2)<.01&&originalDistance(...a)<.01&&originalDistance(...b)<.01;
  const rings=source.map((ring,index)=>{
    const area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0),sign=Math.sign(area)*(index?-1:1);
    const out:Point2[]=[],flags:boolean[]=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[(i+ring.length-1)%ring.length],p=ring[i],b=ring[(i+1)%ring.length],before=onShore(a,p),after=onShore(p,b);
      const la=Math.hypot(a[0]-p[0],a[1]-p[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]);
      const turn=Math.atan2(cross(a,p,b)*sign,(p[0]-a[0])*(b[0]-p[0])+(p[1]-a[1])*(b[1]-p[1]));
      if(before&&after&&turn>.18&&la>.01&&lb>.01){
        const trim=Math.min(width/SHORE_WIDTH*8,la*.45,lb*.45),u:Point2=[p[0]+(a[0]-p[0])*trim/la,p[1]+(a[1]-p[1])*trim/la],v:Point2=[p[0]+(b[0]-p[0])*trim/lb,p[1]+(b[1]-p[1])*trim/lb],steps=Math.max(3,Math.ceil(turn/.2));
        for(let j=0;j<=steps;j++){const t=j/steps,s=1-t;out.push([s*s*u[0]+2*s*t*p[0]+t*t*v[0],s*s*u[1]+2*s*t*p[1]+t*t*v[1]]);flags.push(true);}
      }else{out.push(p);flags.push(after);}
    }
    for(let i=0;i<out.length;i++)if(flags[i])shoreEdges.push({a:out[i],b:out[(i+1)%out.length]});
    return out;
  });
  const result={rings,width,distance:edgeIndex(shoreEdges,SHORE_WIDTH+9)};sources.set(source,result);return result;
}
