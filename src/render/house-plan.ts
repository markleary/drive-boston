import type { Building, CityData, Point2 } from '../types';
import { closestRoad, pointInside } from '../simulation/roads.ts';
import { orientedBox } from '../simulation/oriented-box.ts';
import { houseFloors, victorianEra } from './house-styles.ts';

/** Where a generated northern house keeps its front, corner tower, porch and
 * chimney: a tile-independent function of the footprint and the nearest
 * street, cached per building so the shell stage (towers) and the detail stage
 * (porches) agree. Interpretive, like the typology: the assessor records a
 * style, the footprint and the street decide the rest. */
export interface HouseFront { a:Point2; b:Point2; nx:number; nz:number; length:number; setback:number; road:string; }
export interface HouseTower { center:Point2; radius:number; /** Angle of the first octagon vertex. */ phase:number; top:number; apex:number; corner:'a'|'b'; }
export interface HousePorch { kind:'porch'|'portico'; from:number; to:number; depth:number; }
export interface HousePlan { front?:HouseFront; tower?:HouseTower; porch?:HousePorch; chimney?:Point2; floors:number; floorHeight:number; foundation:number; }

const plans=new WeakMap<Building,HousePlan>();
const hash=(text:string)=>{let n=0;for(const c of text)n=Math.imul(n,31)+c.charCodeAt(0)|0;return Math.abs(n);};
export const footprintArea=(p:Point2[])=>Math.abs(p.reduce((s,a,i)=>{const c=p[(i+1)%p.length];return s+a[0]*c[1]-c[0]*a[1];},0))/2;
const signedArea=(p:Point2[])=>p.reduce((s,a,i)=>{const c=p[(i+1)%p.length];return s+a[0]*c[1]-c[0]*a[1];},0)/2;
/** Distance from a point to the footprint outline. */
export function edgeDistance(p:Point2,ring:Point2[]){
  let best=Infinity;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t));}
  return best;
}
/** Outward unit normal of footprint edge i. */
export function outwardNormal(ring:Point2[],i:number):[number,number]{
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,s=signedArea(ring)>0?1:-1;
  return [dz/l*s,-dx/l*s];
}

/** The street wall: the longest-facing edge toward the nearest street within 25 m. */
export function houseFront(city:CityData,b:Building):HouseFront|undefined {
  const p=b.footprint;let best:HouseFront|undefined,score=-Infinity;
  for(let i=0;i<p.length;i++){
    const a=p[i],c=p[(i+1)%p.length],length=Math.hypot(c[0]-a[0],c[1]-a[1]);if(length<2.4)continue;
    const [nx,nz]=outwardNormal(p,i),x=(a[0]+c[0])/2,z=(a[1]+c[1])/2,near=closestRoad(city,x,z,true);
    if(!near.road||!(near.distance<40))continue;
    const facing=((near.x-x)*nx+(near.z-z)*nz)/Math.max(.01,near.distance),setback=near.distance-(near.road.pavedWidth??near.road.width)/2;
    if(facing<.7||setback<1||setback>25)continue;
    const value=facing*10+Math.min(length,10)*.3-setback*.05;
    if(value>score){score=value;best={a,b:c,nx,nz,length,setback,road:near.road.name};}
  }
  return best;
}

export function housePlan(city:CityData,b:Building):HousePlan {
  const cached=plans.get(b);if(cached)return cached;
  const {floors,floorHeight,foundation}=houseFloors(b),plan:HousePlan={floors,floorHeight,foundation};plans.set(b,plan);
  if(!b.houseStyle||b.footprint.length<3)return plan;
  const n=hash(b.id),style=b.houseStyle,area=footprintArea(b.footprint),front=houseFront(city,b),base=b.baseElevation??0,eave=b.eaveHeight??b.height;
  plan.front=front;
  if(style!=='garage')plan.chimney=chimneySpot(b,n);
  if(!front)return plan;
  const tx=(front.b[0]-front.a[0])/front.length,tz=(front.b[1]-front.a[1])/front.length;
  // Queen Anne corner towers on two of five larger two-storey Victorians that do not already have one.
  if(style==='victorian'&&!b.turrets&&area>=115&&floors>=2&&front.length>=6.5&&n%5<2){
    const corners:{corner:'a'|'b';p:Point2;along:[number,number]}[]=[{corner:'a',p:front.a,along:[tx,tz]},{corner:'b',p:front.b,along:[-tx,-tz]}];
    if(Math.floor(n/5)%2)corners.reverse();
    for(const {corner,p:c,along} of corners){
      const radius=area>180?1.7:1.5,inset=radius*.52;
      const center:Point2=[c[0]+along[0]*inset-front.nx*inset,c[1]+along[1]*inset-front.nz*inset];
      if(!pointInside(center,b.footprint)||edgeDistance(center,b.footprint)<inset*.8)continue;
      const top=base+eave+Math.min(2.2,floorHeight*.7);
      plan.tower={center,radius,phase:Math.atan2(tz,tx)+Math.PI/8,top,apex:top+Math.max(3,radius*2.3),corner};break;
    }
  }
  // Nineteenth-century houses keep a front porch (four in five); later houses a small entry portico now and then.
  const porchShare=victorianEra(b)?80:style==='bungalow'?92:style==='colonial'?28:style==='cape'||style==='gambrel'||style==='tudor'?16:0;
  const room=front.setback-2.9-1.1;
  if(Math.floor(n/7)%100<porchShare&&room>=1.3&&front.length>=4){
    const portico=!victorianEra(b)&&style!=='bungalow';
    const depth=portico?Math.min(1.5,room):Math.min(2.3,room);
    let from=-front.length/2+.15,to=front.length/2-.15;
    if(portico){const mid=(Math.floor(n/3)%3-1)*front.length*.22,half=1.25;from=Math.max(from,mid-half);to=Math.min(to,mid+half);}
    else{
      // A wide front keeps a porch across most of it; the tower's corner stays clear.
      const width=Math.min(to-from,victorianEra(b)&&front.length>9?front.length*.72:8.5);
      if(plan.tower){const r=plan.tower.radius*1.6;if(plan.tower.corner==='a'){from=Math.max(from,-front.length/2+r);to=Math.min(to,from+width);}else{to=Math.min(to,front.length/2-r);from=Math.max(from,to-width);}}
      else if(width<to-from){const shift=Math.floor(n/11)%2?1:-1;if(shift>0)from=to-width;else to=from+width;}
    }
    if(to-from>=2.2)plan.porch={kind:portico?'portico':'porch',from,to,depth};
  }
  return plan;
}

/** A point inside the footprint for the chimney: one gable end of the main roof, or the centre of a cape or some colonials. */
function chimneySpot(b:Building,n:number):Point2|undefined {
  const box=orientedBox(b.footprint),long=box.half>=box.halfPerp,ux=long?box.ux:-box.uz,uz=long?box.uz:box.ux,half=Math.max(box.half,box.halfPerp);
  const style=b.houseStyle??'';
  if(style==='contemporary'&&n%10<6)return undefined;
  if(style==='ranch'&&n%10<4)return undefined;
  const central=style==='cape'||(style==='colonial'&&n%2===0);
  const offsets=central?[0,half*.35,-half*.35]:(Math.floor(n/13)%2?[1,-1]:[-1,1]).map(s=>s*Math.max(0,half-1.1));
  for(const offset of offsets){
    const p:Point2=[box.cx+ux*offset,box.cz+uz*offset];
    if(pointInside(p,b.footprint)&&edgeDistance(p,b.footprint)>=.55)return p;
  }
  return undefined;
}
