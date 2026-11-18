import * as THREE from 'three';
import data from '../data/fellsmere.json' with { type: 'json' };
import type { CityArea, CityData, Point2 } from '../types.ts';
import { pointInside } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { waterHeight } from '../simulation/water-level.ts';
import { LandmarkModel, finish, landmarkTexture, lettering, type Vertex } from './landmark-model.ts';
import { seeded } from './materials.ts';
import { pondFountain } from './fellsmere-fountains.ts';
import { DrapedSurface } from './draped-surface.ts';
import type { Bounds, ParkOptions } from './city-parks.ts';
import type { TreePlanting } from './foliage.ts';
import { WATER_SURFACE_OFFSET } from './area-surfaces.ts';

const upper = data.upperWall as Point2[];
const upperBack = data.upperBack as Point2[];
export const fellsmereUpperTerrace = [[[...upper, upperBack[1], upperBack[0]]]];
const woods = data.woods as Point2[][][];
export const fellsmereLawns = new Map(Object.entries(data.lawns).map(
  ([id, faces]) => [id, faces as Point2[][][]]
));
export const fellsmereWalkIds: ReadonlySet<string> = new Set(data.walks.ids);
const owns = (bounds: Bounds | undefined, x: number, z: number) => !bounds ||
  (x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ);

export function onFellsmereLookout(x: number, z: number) {
  return x > -865 && x < -823 && z > -8787 && z < -8747;
}

export function fellsmereTrees(city: CityData, bounds: Bounds | undefined, safe: (p: Point2) => boolean) {
  const trees: TreePlanting[] = [], random = seeded(21332);
  // A common jittered grid keeps the groves continuous across the West Border
  // Road tile boundary. Both woodland outlines end before the north lawn.
  for (let xx=-1050; xx< -698; xx+=8.8) for(let zz=-8895; zz< -8470; zz+=8.8) {
    const x=xx+(random()-.5)*5.6, z=zz+(random()-.5)*5.6;
    const p: Point2 = [x,z], species = random(), scale=.65+random()*.66;
    const clearing=((x+934)/13)**2+((z+8664)/14)**2<1;
    if (clearing || !owns(bounds,x,z) || onFellsmereLookout(x,z) || !woods.some(([ring,...holes]) =>
      pointInside(p,ring) && !holes.some(h=>pointInside(p,h))) || !safe(p)) continue;
    trees.push({ position:new THREE.Vector3(x,sampleElevation(city,x,z),z),
      species: species<.49?'red oak':species<.89?'maple':'white pine', scale });
  }
  return trees;
}

// A seamless field of irregular, differently weathered stones. The two nearest
// sites set the mortar joint; gentle warping keeps the edges from looking sawn.
function fieldstone() {
  const random=seeded(4891), cells=10;
  const sites=Array.from({length:cells*cells},()=>({
    x:.12+.76*random(), y:.12+.76*random(), shade:102+random()*69, warmth:random()*15-5,
  }));
  return landmarkTexture(384,384,ctx=>{
    const img=ctx.createImageData(384,384);
    for(let y=0;y<384;y++) for(let x=0;x<384;x++) {
      const a=x*cells/384+.065*Math.sin(y*Math.PI/16), b=y*cells/384+.06*Math.sin(x*Math.PI/12);
      let first=Infinity, second=Infinity, stone=sites[0];
      const ix=Math.floor(a), iy=Math.floor(b);
      for(let j=iy-1;j<=iy+1;j++) for(let i=ix-1;i<=ix+1;i++) {
        const s=sites[(j+cells)%cells*cells+(i+cells)%cells];
        const d=(i+s.x-a)**2+(j+s.y-b)**2;
        if(d<first){second=first;first=d;stone=s;}else second=Math.min(second,d);
      }
      const edge=Math.sqrt(second)-Math.sqrt(first), inset=THREE.MathUtils.smoothstep(edge,.027,.13);
      const grain=(random()-.5)*22+4*Math.sin(x*.18+y*.14)+3*Math.sin(y*.09-x*.06);
      const v=76+(stone.shade-76)*inset+grain, k=(y*384+x)*4;
      img.data[k]=v+stone.warmth*inset;img.data[k+1]=v-1;img.data[k+2]=v-5-stone.warmth*.4;img.data[k+3]=255;
    }
    ctx.putImageData(img,0,0);
  },true);
}

function makeMaterials() {
  const stone=finish('#a7a299'), asphalt=finish('#666662'), cap=finish('#a19b8e');
  const ledges=['#979a96','#aaaba5','#91948f','#a09e99'].map(c=>finish(c));
  const cloth=['#202637','#ede9df','#a2353a','#304363'].map(c=>finish(c));
  cloth.forEach(m=>{m.side=THREE.DoubleSide;});
  if(typeof document!=='undefined'){
    stone.color.set('#ffffff');stone.map=fieldstone();stone.bumpMap=stone.map;stone.bumpScale=.035;
    const random=seeded(8310);
    const granite=landmarkTexture(256,256,ctx=>{
      const img=ctx.createImageData(256,256);
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const k=(y*256+x)*4, phase=(x+2*y)*Math.PI/128;
        const folds=phase+1.8*Math.sin(y*Math.PI/64)+.9*Math.cos(x*Math.PI/32);
        const seam=Math.max(0,Math.cos(folds*3))**12;
        const tone=164+4*Math.sin(folds)+3*Math.cos(phase*2)-9*seam+38*(random()-.5);
        img.data[k]=tone+3;img.data[k+1]=tone;img.data[k+2]=tone-4;img.data[k+3]=255;
      }
      ctx.putImageData(img,0,0);
    },true);
    for(const rock of ledges){rock.map=granite;rock.bumpMap=granite;rock.bumpScale=.014;}
  }
  return {stone,asphalt,cap,ledges,cloth,metal:finish('#b6b8b1',.44,.45),bench:finish('#396054'),
    inscription:typeof document==='undefined'?undefined:lettering('ROBERT F. MURPHY OVERLOOK','#e6e0ca','bold 45px serif')};
}
let shared: ReturnType<typeof makeMaterials>;
export function* addFellsmereWalks(group: THREE.Group, city: CityData, paving: THREE.Material, options: ParkOptions) {
  const asphalt = (shared??=makeMaterials()).asphalt;
  for (const [name, faces, material] of [
    ['Fellsmere asphalt walks', data.walks.asphalt, asphalt],
    ['Fellsmere paved paths', data.walks.paving, paving],
  ] as const) {
    const surface = new DrapedSurface(city, {offset:.052, bounds:options.bounds, pace:options.pace});
    for (const rings of faces) yield* surface.add(rings as Point2[][]);
    if (!surface.stats.polygons) continue;
    const geometry = yield* surface.geometrySteps();
    if (!geometry.index?.count) { geometry.dispose(); continue; }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export function addFellsmerePark(city: CityData, pond: CityArea, options: ParkOptions) {
  const m=shared??=makeMaterials(), random=seeded(73685);
  const model=new LandmarkModel('Fellsmere Park stonework','fellsmere-park',0,0,0,0);
  const h=(x:number,z:number)=>sampleElevation(city,x,z);
  const level=waterHeight(city,pond)+WATER_SURFACE_OFFSET;
  const site=new THREE.Group();site.name='Fellsmere Park';
  const boulder=(x:number,y:number,z:number,w:number,tall:number,d:number,yaw:number)=>{
    // Weathered but fractured granite: flatter tops and irregular shoulders.
    const g=new THREE.DodecahedronGeometry(1,w>2.5?1:0), p=g.getAttribute('position');
    for(let i=0;i<p.count;i++){
      const a=p.getX(i), b=p.getY(i), c=p.getZ(i);
      p.setXYZ(i,a*(1+.13*Math.sin(5*c+z)),Math.min(.70+.12*a,b)+.08*Math.sin(4*c+x),c*(1+.16*Math.sin(4*a+x)));
    }
    g.scale(w/2,tall/2,d/2);g.rotateY(yaw);g.translate(x,y,z);
    if(w>2.5){
      // The bedrock follows the hillside into the ground even on the downhill lip.
      const base=h(x,z);
      for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+h(p.getX(i),p.getZ(i))-base);
    }
    g.computeVertexNormals();
    const uv=g.getAttribute('uv');
    for(let i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)+p.getZ(i)*.4)*.26,(p.getZ(i)-p.getY(i)*.8)*.26);
    model.append(m.ledges[Math.floor(random()*m.ledges.length)],g,true);
  };

  // Boulders along the lower terrace, the open south bank and the Fellsway edge.
  // Other reaches keep their turf, wooded banks and exposed ledge.
  const shore=pond.rings[0];
  for(let i=0;i<shore.length;i++){
    const [ax,az]=shore[i], [bx,bz]=shore[(i+1)%shore.length];
    const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz),z=(az+bz)/2, x=(ax+bx)/2;
    if(!(z>-8520 || (x>-881 && z< -8680 && z>-8795) || (x>-912 && z>-8640 && z< -8550)))continue;
    const count=Math.round(length/1.65);
    for(let k=0;k<count;k++){
      const f=(k+.5)/count, px=ax+dx*f,pz=az+dz*f;
      if(!owns(options.bounds,px,pz)||Math.hypot(px+855.2,pz+8757.8)<7)continue;
      // Slightly straddle the mapped shore to seat each block in the bank.
      boulder(px,Math.max(level-.08,h(px,pz)-.10),pz,1.55+random()*.64,.85+random()*.68,1.3+random()*.85,
        Math.atan2(-dz,dx)+(random()-.5)*.65);
    }
  }

  // A second series of ledges emerges where the west promontory narrows
  // the reservoir between its two lobes. Its inner walk stays on the lawn.
  for(const [x,z,w] of [[-905,-8670,5],[-903.3,-8665.8,6],[-903,-8661.3,6.2],
    [-903.6,-8657.5,4.8],[-904.4,-8653.6,5.4],[-905.1,-8649.4,4.3]]){
    if(owns(options.bounds,x,z))boulder(x,h(x,z)-.1,z,w,1.9,3.8,-1.32);
  }

  if(owns(options.bounds,...upper[0])){
    const vertex=(p:Point2,y:number):Vertex=>[p[0],y,p[1]];
    // Twin faces with mitered corners follow the source wall, including the
    // break for the Quarry Hill steps. UV distance continues around each bend.
    function wall(line:Point2[],width:number,top:(p:Point2)=>number,bottom:(p:Point2)=>number){
      const sides=line.map((p,i)=>{
        const prev=line[Math.max(0,i-1)],next=line[Math.min(line.length-1,i+1)];
        const len=Math.hypot(next[0]-prev[0],next[1]-prev[1]);
        const nx=-(next[1]-prev[1])/len*width/2,nz=(next[0]-prev[0])/len*width/2;
        return [[p[0]+nx,p[1]+nz],[p[0]-nx,p[1]-nz]] as [Point2,Point2];
      });
      let run=0;
      for(let i=1;i<line.length;i++){
        const [a,b]=sides[i-1],[c,d]=sides[i],lo=bottom(line[i-1]),hi=top(line[i-1]),lo2=bottom(line[i]),hi2=top(line[i]);
        const end=run+Math.hypot(c[0]-a[0],c[1]-a[1]);
        for(const [p,q,y1,y2,b1,b2,u,v] of [[a,c,hi,hi2,lo,lo2,run,end],[d,b,hi2,hi,lo2,lo,end,run]] as const){
          model.quad(m.stone,vertex(q,b2),vertex(q,y2),vertex(p,y1),vertex(p,b1),true,
            [[v/4,b2/2.8],[v/4,y2/2.8],[u/4,y1/2.8],[u/4,b1/2.8]]);
        }
        model.quad(m.cap,vertex(a,hi),vertex(c,hi2),vertex(d,hi2),vertex(b,hi),true);
        if(i===1)model.quad(m.stone,vertex(a,lo),vertex(a,hi),vertex(b,hi),vertex(b,lo),true);
        if(i===line.length-1)model.quad(m.stone,vertex(d,lo2),vertex(d,hi2),vertex(c,hi2),vertex(c,lo2),true);
        run=end;
      }
    }

    for(const line of data.pathWalls as Point2[][]) wall(line,.67,p=>h(...p)+.76,p=>h(...p)-.45);

    // The pondward arc stands above exposed bedrock. Leave both landward
    // ends open where the paved path climbs onto the observation terrace.
    const deck=20.15;
    model.cap(m.asphalt,upper,deck,true,true);
    // Feather the open back into the hillside. The northern approach is
    // almost a metre below the platform on the six-metre elevation grid.
    const join=(t:number,back:boolean):Vertex=>{
      const [first,last]=back?upperBack:[upper[0],upper[upper.length-1]];
      const x=first[0]+t*(last[0]-first[0]),z=first[1]+t*(last[1]-first[1]);
      return [x,back?h(x,z)+.06:deck,z];
    };
    for(let k=0;k<8;k++)model.quad(m.asphalt,join(k/8,false),join((k+1)/8,false),
      join((k+1)/8,true),join(k/8,true),true);
    wall(upper,.53,()=>deck+.66,p=>h(...p)-.3);
    // Interlocking granite shelves spread down the face of Quarry Hill.
    for(let i=2;i<upper.length-2;i++){
      const [x,z]=upper[i], [cx,cz]=upper[i+1];
      const len=Math.hypot(cx-x,cz-z), nx=-(cz-z)/len, nz=(cx-x)/len;
      for(let band=0;band<2;band++){
        const offset=1+band*1.85+random()*.6;
        const px=(x+cx)/2+nx*offset,pz=(z+cz)/2+nz*offset;
        boulder(px,h(px,pz)-.22,pz,6.1+random()*2.2,1.6+random()*1.35,4.1+random()*1.2,
          Math.atan2(z-cz,cx-x)+.2*random());
      }
    }

    // Lower fishing overlook joins the loop on its uphill chord and projects
    // into the pond. The low parapet has an open back facing the walkway.
    const cx=-855.2,cz=-8757.8, tx=.72,tz=.694, nx=-tz,nz=tx, apron=h(cx,cz)+.10;
    const nose=data.lowerApron as Point2[];
    model.cap(m.asphalt,nose,apron,true,true);
    wall(nose,.48,()=>apron+.44,()=>level-.55);
    const benchYaw=Math.atan2(-tz,tx);
    for(const s of [-.7,.7]) model.box(m.cap,cx+s*tx,apron+.25,cz+s*tz,.15,.5,.53,true,benchYaw);
    for(let j=0;j<4;j++)model.box(m.bench,cx+nx*j*.1,apron+.49,cz+nz*j*.1,2.05,.08,.09,false,benchYaw);
    for(let j=0;j<3;j++)model.box(m.bench,cx-nx*.12,apron+.64+j*.14,cz-nz*.12,2.05,.105,.065,false,benchYaw);

    // Three flagpoles and the memorial boulder on the upper terrace. Soft folds
    // and a little droop retain the silhouette of the flags from the far bank.
    data.flagpoles.forEach(([x,z],i)=>{
      const height=i===1?9.9:9.3;
      model.append(m.metal,new THREE.CylinderGeometry(.045,.102,height,9).translate(x,deck+height/2,z),true);
      model.append(m.cap,new THREE.SphereGeometry(.108,8,6).translate(x,deck+height,z));
      const clothPoint=(u:number,v:number):Vertex=>[x+2.25*u,deck+height-.16-1.26*v-.40*u*u,
        z+.29*Math.sin(8*u+.55*v)*u+.31*u];
      const patch=(u:number,v:number,r:number,b:number,material:THREE.Material)=>
        model.quad(material,clothPoint(u,v),clothPoint(r,v),clothPoint(r,b),clothPoint(u,b));
      for(let j=0;j<13;j++)for(let k=0;k<10;k++){
        const fabric=i===1?(k<4&&j<7?m.cloth[3]:m.cloth[j%2?1:2]):m.cloth[i===0?0:1];
        patch(k/10,j/13,(k+1)/10,(j+1)/13,fabric);
      }
    });
    const mx=-839.7,mz=-8774.1;
    boulder(mx,deck+.40,mz,1.9,1.52,1.38,-.7);
    if(m.inscription){
      const plaque=new THREE.Mesh(new THREE.PlaneGeometry(1.25,.29),m.inscription);
      plaque.rotation.y=-.78;plaque.position.set(mx-.55,deck+.58,mz+.52);site.add(plaque);
    }
  }
  for(const [i,[x,z]] of data.fountains.entries())if(owns(options.bounds,x,z))
    site.add(pondFountain(x,level,z,1977+i*53,options.mobile));
  const {group,collision}=model.build();
  if(collision.indices.length)options.onRock?.(collision.vertices,collision.indices);
  site.add(group);
  return site;
}
