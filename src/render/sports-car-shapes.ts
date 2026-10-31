import * as THREE from 'three';
import {geometryParts, type VehicleSurface} from './car.ts';
export type P=[number,number,number];
export type Parts=ReturnType<typeof geometryParts>;
/** Smooth metre-scale body loft with wheel wells cut into the lower shell.
 * Sections are [z, half width, deck height], sampled from the reference profiles. */
export function sculptBody(p:Parts,sections:P[],wheelbase:number,frontRadius:number,rearRadius:number,wheelY:number){
  const curve=new THREE.CatmullRomCurve3(sections.map(([z,w,y])=>new THREE.Vector3(w,y,z)));
  const sample=(z:number)=>{let l=0,h=1;for(let i=0;i<17;i++){const m=(l+h)/2;if(curve.getPoint(m).z<z)l=m;else h=m;}return curve.getPoint((l+h)/2);};
  const height=(x:number,z:number)=>{const c=sample(z),u=Math.min(1,Math.abs(x/c.x));return c.y+.10*u**4-.055*u**16;};
  const v:number[]=[],idx:number[]=[],rings=128,around=32;
  for(let i=0;i<=rings;i++){
    const c=curve.getPoint(i/rings);let bottom=-.43;
    for(const [z,r] of [[wheelbase/2,frontRadius+.025],[-wheelbase/2,rearRadius+.025]]){const d=Math.abs(c.z-z);if(d<r)bottom=Math.max(bottom,wheelY+Math.sqrt(r*r-d*d));}
    for(let j=0;j<around;j++){
      const a=j/around*Math.PI*2,u=Math.abs(Math.sin(a)),x=c.x*Math.sin(a);
      const y=Math.cos(a)>=0?c.y+.10*u**4-.055*u**16:THREE.MathUtils.lerp(bottom,c.y+.045,u**12);
      const z=c.z+Math.max(0,1-i/rings/.07)*.09*u**3-Math.max(0,(i/rings-.91)/.09)*.12*u**3;
      v.push(x,y,z);
    }
  }
  for(let i=0;i<rings;i++)for(let j=0;j<around;j++){const a=i*around+j,b=i*around+(j+1)%around;idx.push(a,a+around,b,b,a+around,b+around);}
  for(const [o,flip] of [[0,false],[rings*around,true]] as const)for(let j=1;j<around-1;j++)idx.push(o,o+(flip?j+1:j),o+(flip?j:j+1));
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();p.add('paint',g);
  // Project rear details onto the exact triangulated end cap, including its
  // rounded shoulders. Sampling only a guessed z curve leaves lights floating.
  const rearDepth=(x:number,y:number)=>{
    const ax=v[0],ay=v[1],az=v[2];
    for(let j=1;j<around-1;j++){
      const b=j*3,c=(j+1)*3,bx=v[b],by=v[b+1],cx=v[c],cy=v[c+1];
      const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(d)<1e-10)continue;
      const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/d,w=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/d,t=1-u-w;
      if(u>=-1e-7&&w>=-1e-7&&t>=-1e-7)return u*az+w*v[b+2]+t*v[c+2];
    }
    throw new Error(`Rear detail outside body silhouette at ${x}, ${y}`);
  };
  return {height,rearDepth,surface:(points:P[],offset=.008)=>points.map(([x,,z])=>[x,height(x,z)+offset,z] as P)};
}
/** Rounded canopy; optional painted crown keeps the Supra's steel roof distinct
 * from the McLaren's dark panoramic Monocage roof. */
export function sculptCanopy(p:Parts,sections:P[],edge:number,paintRoof=false){
  const curve=new THREE.CatmullRomCurve3(sections.map(([z,w,y])=>new THREE.Vector3(w,y,z)));
  const point=(t:number,u:number):P=>{const c=curve.getPoint(t);return [c.x*u,edge+(c.y-edge)*Math.sqrt(Math.max(0,1-u**8)),c.z];};
  const v:number[]=[],idx:number[]=[],rings=64,across=32;
  for(let i=0;i<=rings;i++)for(let j=0;j<=across;j++)v.push(...point(i/rings,j/across*2-1));
  for(let i=0;i<rings;i++)for(let j=0;j<across;j++){const a=i*(across+1)+j,b=a+across+1;idx.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();p.add('glass',g);
  for(const side of [-1,1]){
    p.path('trim',sections.map(([z,w])=>[side*w,edge+.004,z]),.012);
    p.path('paint',Array.from({length:49},(_,i)=>{const a=point(i/48,side*.84);a[1]+=.008;return a;}),paintRoof?.014:.012);
  }
  if(paintRoof){
    // Only the level crown is metal; keep both raked screens and side windows.
    for(let i=0;i<rings;i++){
      const c=curve.getPoint((i+.5)/rings);if(c.z<-.60||c.z>.13)continue;
      for(let j=0;j<20;j++){
        const u0=-.82+j*1.64/20,u1=u0+1.64/20;
        p.quad('paint',[point(i/rings,u0),point((i+1)/rings,u0),point((i+1)/rings,u1),point(i/rings,u1)].map(([x,y,z])=>[x,y+.009,z]));
      }
    }
  }
}
export function ellipsoid(p:Parts,surface:VehicleSurface,center:P,size:P){const g=new THREE.SphereGeometry(1,16,8);g.scale(...size);g.translate(...center);p.add(surface,g);}
export function exhaust(p:Parts,x:number,y:number,z:number,r=.065){
  const tube=new THREE.CylinderGeometry(r,r,.15,24,1,true);tube.rotateX(Math.PI/2);tube.translate(x,y,z);p.add('chrome',tube);
  const hole=new THREE.CircleGeometry(r*.84,24);hole.rotateY(Math.PI);hole.translate(x,y,z-.078);p.add('trim',hole);
}
export function sportsWheel(side:number,radius:number,width:number,rim:number,spokes:number,split:boolean){
  const p=geometryParts(),half=width/2,face=side*(half+.006);
  const tire=new THREE.LatheGeometry([new THREE.Vector2(rim,-half),new THREE.Vector2(radius-.018,-half),new THREE.Vector2(radius,-half*.72),new THREE.Vector2(radius,half*.72),new THREE.Vector2(radius-.018,half),new THREE.Vector2(rim,half)],48);tire.rotateZ(Math.PI/2);p.add('rubber',tire);
  for(const x of [-width*.25,width*.25]){const g=new THREE.TorusGeometry(radius-.001,.0025,4,48);g.rotateY(Math.PI/2);g.translate(x,0,0);p.add('trim',g);}
  for(const r of [rim,rim-.014]){const g=new THREE.TorusGeometry(r,.007,5,48);g.rotateY(Math.PI/2);g.translate(face,0,0);p.add('chrome',g);}
  const rotor=new THREE.CylinderGeometry(rim*.8,rim*.8,.018,40);rotor.rotateZ(Math.PI/2);rotor.translate(side*(half-.035),0,0);p.add('chrome',rotor);
  for(let i=0;i<24;i++){const a=i/24*Math.PI*2;const g=new THREE.CircleGeometry(.005,5);g.rotateY(side*Math.PI/2);g.translate(side*(half-.024),Math.cos(a)*rim*.64,Math.sin(a)*rim*.64);p.add('trim',g);}
  for(let i=0;i<spokes;i++)for(const offset of split?[-.085,.085]:[0]){const a=i/spokes*Math.PI*2;p.beam('chrome',[face,Math.cos(a)*.052,Math.sin(a)*.052],[face-side*.018,Math.cos(a+offset)*rim*.96,Math.sin(a+offset)*rim*.96],split?.009:.025,6);}
  const hub=new THREE.CylinderGeometry(split?.042:.067,split?.042:.067,.025,24);hub.rotateZ(Math.PI/2);hub.translate(face,0,0);p.add('chrome',hub);
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const bolt=new THREE.SphereGeometry(.006,6,4);bolt.translate(face+side*.016,Math.cos(a)*.03,Math.sin(a)*.03);p.add('trim',bolt);}
  return p.finish();
}

/** Curved inset lens patch, conforming to the hood instead of a flat decal. */
export function hoodPatch(p:Parts,outline:P[],surface:(points:P[],offset?:number)=>P[],material:VehicleSurface='trim'){
  const curve=new THREE.CatmullRomCurve3(outline.map(a=>new THREE.Vector3(...a)),true,'centripetal');
  const edge=surface(curve.getPoints(48).map(a=>a.toArray() as P),.012);
  const center=surface([outline.reduce((a,b)=>a.map((v,i)=>v+b[i]/outline.length) as P,[0,0,0] as P)],.012)[0];
  const v:number[]=[];for(let i=0;i<48;i++)v.push(...center,...edge[i],...edge[i+1]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();p.add(material,g);
  return edge;
}
