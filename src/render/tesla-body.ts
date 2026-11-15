import * as THREE from 'three';
import {geometryParts} from './car.ts';
import type {P} from './sports-car-shapes.ts';
import {teslaCabinFootprint} from './tesla-cabin.ts';

export const TESLA_BODY={front:2.3095,rear:-2.4155,ground:-.605,roof:.826} as const;
type Parts=ReturnType<typeof geometryParts>;
export interface TeslaSurfaces {
  hood(x:number,z:number):P;
  side(side:number,y:number,z:number):P;
  front(x:number,y:number):P;
  rear(x:number,y:number):P;
}
const smooth=(a:number,b:number,x:number)=>THREE.MathUtils.smoothstep(x,a,b);
const sectionData:P[]=[
  [-2.4155,.870,.345],[-2.26,.899,.392],[-1.95,.921,.422],[-1.4375,.925,.415],
  [-1.08,.920,.385],[-.35,.906,.358],[.4,.909,.341],[.94,.918,.335],
  [1.4375,.925,.283],[1.8,.915,.220],[2.08,.902,.150],[2.3095,.885,.105],
];
const longitudinal=new THREE.CatmullRomCurve3(sectionData.map(([z,w,y])=>new THREE.Vector3(w,y,z)),false,'centripetal');
function section(z:number){
  let lo=0,hi=1;
  for(let i=0;i<20;i++){const t=(lo+hi)/2;if(longitudinal.getPoint(t).z<z)lo=t;else hi=t;}
  return longitudinal.getPoint((lo+hi)/2);
}
function profile(z:number){
  const s=section(z),wheelBulge=.035*(Math.exp(-(((z-1.4375)/.58)**2))+Math.exp(-(((z+1.4375)/.62)**2)));
  const deck=s.y,w=s.x;
  // The shoulder rolls into the doors and rocker. Multiple control stations
  // give the flank its broad concavity and a subtle lower character line.
  return new THREE.CatmullRomCurve3([
    [0,deck+.018],[.44,deck+.013],[.73,deck+.031+wheelBulge],[.90,deck+.018+wheelBulge],
    [.976,deck-.018],[1,deck-.095],[.996,Math.min(.115,deck-.15)],[.976,Math.min(-.085,deck-.24)],
    [.948,-.245],[.966,-.326],[.935,-.412],[.885,-.466],[.70,-.477],[0,-.477],
  ].map(([x,y])=>new THREE.Vector3(x*w,y,0)),false,'centripetal');
}
function minimumY(z:number){
  let y=-.477;
  for(const axle of [-1.4375,1.4375]){const d=Math.abs(z-axle),r=.371;if(d<r)y=Math.max(y,-.26875+Math.sqrt(r*r-d*d));}
  return y;
}
/** The trunk is a gently raked panel with a real recessed number-plate region.
 * The lower bumper is rounded independently; it never domes the wordmark. */
export function teslaRearSurfaceZ(x:number,y:number){
  const corner=.34*Math.pow(Math.abs(x)/.925,5);
  const pocket=.014*(1-smooth(.40,.61,Math.abs(x)))*smooth(-.24,-.13,y)*(1-smooth(.055,.155,y));
  const bumper=.035*Math.exp(-(((y+.20)/.20)**2));
  const valance=.21*smooth(.20,.49,-y);
  const upperRoll=.060*smooth(.31,.435,y);
  return TESLA_BODY.rear+corner+.026*(y-.17)+upperRoll+pocket-bumper+valance;
}
export function teslaFrontSurfaceZ(x:number,y:number){
  const corner=.27*Math.pow(Math.abs(x)/.925,4);
  const upper=.075*smooth(-.03,.22,y),lower=.105*smooth(.27,.48,-y);
  const chin=-.021*Math.exp(-(((y+.22)/.11)**2));
  return TESLA_BODY.front-corner-upper-lower-chin;
}
function warpZ(z:number,x:number,y:number){
  // Spread each end's rounding over the quarter panel. A short blend squeezes
  // longitudinal rows together at the corners, which can fold the shoulder
  // and create the dented highlight formerly visible beside the lamps.
  const rearBlend=1-smooth(TESLA_BODY.rear,-1.48,z),frontBlend=smooth(1.43,TESLA_BODY.front,z);
  return z+rearBlend*(teslaRearSurfaceZ(x,y)-TESLA_BODY.rear)+frontBlend*(teslaFrontSurfaceZ(x,y)-TESLA_BODY.front);
}
function unwarpZ(z:number,x:number,atY:(z:number)=>number){
  let lo:number=TESLA_BODY.rear,hi:number=TESLA_BODY.front;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(warpZ(mid,x,atY(mid))<z)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function topAt(x:number,z:number){
  const curve=profile(z);let lo=0,hi=.37;
  for(let i=0;i<17;i++){const t=(lo+hi)/2;if(curve.getPoint(t).x<Math.abs(x))lo=t;else hi=t;}
  return curve.getPoint((lo+hi)/2).y;
}
function sideAt(y:number,z:number){
  const curve=profile(z);let lo=.27,hi=1;
  for(let i=0;i<17;i++){const t=(lo+hi)/2;if(curve.getPoint(t).y>y)lo=t;else hi=t;}
  return curve.getPoint((lo+hi)/2).x;
}
export const teslaSurfaces:TeslaSurfaces={
  hood(x,z){
    const edgeY=topAt(x,TESLA_BODY.front),edgeZ=teslaFrontSurfaceZ(x,edgeY);
    if(z>edgeZ){
      let lo=-.03,hi=edgeY;
      for(let i=0;i<20;i++){const y=(lo+hi)/2;if(teslaFrontSurfaceZ(x,y)>z)lo=y;else hi=y;}
      return [x,(lo+hi)/2,Math.min(z,teslaFrontSurfaceZ(x,-.03))];
    }
    const zz=unwarpZ(z,x,zz=>topAt(x,zz));return [x,topAt(x,zz),z];
  },
  side(side,y,z){
    let lo:number=TESLA_BODY.rear,hi:number=TESLA_BODY.front;
    const frontX=sideAt(y,hi),rearX=sideAt(y,lo);
    const beyondFront=z>teslaFrontSurfaceZ(frontX,y),beyondRear=z<teslaRearSurfaceZ(rearX,y);
    if(beyondFront||beyondRear){
      const face=beyondFront?teslaFrontSurfaceZ:teslaRearSurfaceZ;let a=0,b=beyondFront?frontX:rearX;
      for(let i=0;i<20;i++){const x=(a+b)/2;if((face(x,y)>z)===beyondFront)a=x;else b=x;}
      return [side*(a+b)/2,y,z];
    }
    for(let i=0;i<20;i++){const mid=(lo+hi)/2,x=sideAt(y,mid);if(warpZ(mid,x,y)<z)lo=mid;else hi=mid;}
    return [side*sideAt(y,(lo+hi)/2),y,z];
  },
  front:(x,y)=>[x,y,teslaFrontSurfaceZ(x,y)],
  rear:(x,y)=>[x,y,teslaRearSurfaceZ(x,y)],
};

export function addTeslaBody(parts:Parts){
  const vertices:number[]=[],indices:number[]=[],along=160,around=88;
  // Uniform longitudinal spacing preserves circular arch openings. Each ring
  // follows a rounded cross section, with a smooth hood-to-fender shoulder.
  for(let i=0;i<=along;i++){
    const z=THREE.MathUtils.lerp(TESLA_BODY.rear,TESLA_BODY.front,i/along),curve=profile(z);
    for(let j=0;j<around;j++){
      const right=j<=around/2,t=right?j/(around/2):(around-j)/(around/2),p=curve.getPoint(t);
      const x=p.x*(right?1:-1);let y=p.y;
      // Cut in final chassis space so bumper rounding cannot drag the arch
      // away from its fixed wheel/axle centre.
      for(let iteration=0;iteration<8;iteration++)y=Math.max(p.y,minimumY(warpZ(z,x,y)));
      vertices.push(x,y,warpZ(z,x,y));
    }
  }
  for(let i=0;i<along;i++)for(let j=0;j<around;j++){
    const a=i*around+j,b=i*around+(j+1)%around;
    const triangle=(a:number,b:number,c:number)=>{
      const x=(vertices[a*3]+vertices[b*3]+vertices[c*3])/3,z=(vertices[a*3+2]+vertices[b*3+2]+vertices[c*3+2])/3;
      const y=(vertices[a*3+1]+vertices[b*3+1]+vertices[c*3+1])/3;
      if(y>.28&&Math.abs(x)<teslaCabinFootprint(z)-.018)return;
      indices.push(a,b,c);
    };
    triangle(a,a+around,b);triangle(b,a+around,b+around);
  }
  const rearNormals:number[]=[],frontNormals:number[]=[];
  for(const front of [false,true]){
    const outer=front?along*around:0,start=vertices.length/3,steps=20;
    const face=front?teslaFrontSurfaceZ:teslaRearSurfaceZ;
    for(let ring=1;ring<steps;ring++)for(let j=0;j<around;j++){
      const t=ring/steps,x=vertices[(outer+j)*3]*t,y=-.055+(vertices[(outer+j)*3+1]+.055)*t;
      vertices.push(x,y,face(x,y));
    }
    const center=vertices.length/3;vertices.push(0,-.055,face(0,-.055));
    const normals=front?frontNormals:rearNormals;
    // Refine curved recesses where a large triangle would span the bevel and
    // make a smooth highlight look wrinkled. The interpolation error controls
    // density, so flat panels stay light while the plate pocket gains detail.
    const tri=(a:number,b:number,c:number,level=0)=>{
      const edges=[[a,b],[b,c],[c,a]] as const;
      const samples=edges.map(([u,v])=>{
        const x=(vertices[u*3]+vertices[v*3])/2,y=(vertices[u*3+1]+vertices[v*3+1])/2,z=face(x,y);
        return {x,y,z,error:Math.abs(z-(vertices[u*3+2]+vertices[v*3+2])/2)};
      });
      if(level<4&&samples.some(p=>p.error>.00065)){
        const mids=samples.map(p=>{const i=vertices.length/3;vertices.push(p.x,p.y,p.z);return i;});
        tri(a,mids[0],mids[2],level+1);tri(mids[0],b,mids[1],level+1);tri(mids[2],mids[1],c,level+1);tri(mids[0],mids[1],mids[2],level+1);return;
      }
      indices.push(...(front?[a,b,c]:[a,c,b]));
    };
    for(let j=0;j<around;j++){
      const next=(j+1)%around;tri(center,start+next,start+j);
      for(let ring=0;ring<steps-1;ring++){
        const a=start+ring*around+j,b=start+ring*around+next,c=ring===steps-2?outer+j:a+around,d=ring===steps-2?outer+next:b+around;
        tri(a,b,c);tri(b,d,c);
      }
    }
    for(let i=start;i<vertices.length/3;i++)normals.push(i);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
  const normals=g.attributes.normal,e=.0001;
  for(const [list,face,front] of [[rearNormals,teslaRearSurfaceZ,false],[frontNormals,teslaFrontSurfaceZ,true]] as const){
    const normalAt=(x:number,y:number)=>new THREE.Vector3(
      -(face(x+e,y)-face(x-e,y))/(2*e),-(face(x,y+e)-face(x,y-e))/(2*e),1,
    ).multiplyScalar(front?1:-1).normalize();
    const outer=front?along*around:0;
    // A bumper is one pressed panel. Blend its cap and flank normals across
    // their shared rim; otherwise the differing cap/shell tessellations leave
    // a scalloped highlight where two perfectly coincident surfaces meet.
    const rim=Array.from({length:around},(_,j)=>{
      const i=outer+j,inner=i+(front?-2:2)*around;
      const x=vertices[i*3],y=vertices[i*3+1];
      const n=new THREE.Vector3().fromBufferAttribute(normals,inner).add(normalAt(x,y)).normalize();
      return {x,y,n};
    });
    for(let row=0;row<4;row++)for(let j=0;j<around;j++){
      const i=outer+j+(front?-row:row)*around;
      const n=new THREE.Vector3().fromBufferAttribute(normals,i).lerp(rim[j].n,1-smooth(0,4,row)).normalize();
      normals.setXYZ(i,n.x,n.y,n.z);
    }
    for(const i of list){
      const x=vertices[i*3],y=vertices[i*3+1],n=normalAt(x,y);
      let nearest=.10,blendDistance=.10,border:THREE.Vector3|undefined;
      for(let j=0;j<around;j++){
        const a=rim[j],b=rim[(j+1)%around],dx=b.x-a.x,dy=b.y-a.y;
        const t=THREE.MathUtils.clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);
        const distance=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
        if(distance<nearest){nearest=distance;border=a.n.clone().lerp(b.n,t);blendDistance=a.y+t*dy>.18?.035:.10;}
      }
      if(border)n.lerp(border,1-smooth(0,blendDistance,nearest)).normalize();
      normals.setXYZ(i,n.x,n.y,n.z);
    }
  }
  parts.add('paint',g);
  // Dark inner arch liners are inset behind the outer fenders.
  for(const side of [-1,1])for(const axle of [-1.4375,1.4375]){
    const v:number[]=[],idx:number[]=[];
    for(let i=0;i<=48;i++)for(const inset of [.025,.20]){
      const a=i/48*Math.PI,z=axle+Math.cos(a)*.369,y=-.26875+Math.sin(a)*.369;
      v.push(side*(section(z).x-inset),y-.005,z);
    }
    for(let i=0;i<48;i++){const k=i*2;idx.push(...(side>0?[k,k+1,k+2,k+1,k+3,k+2]:[k,k+2,k+1,k+1,k+2,k+3]));}
    const liner=new THREE.BufferGeometry();liner.setAttribute('position',new THREE.Float32BufferAttribute(v,3));liner.setIndex(idx);liner.computeVertexNormals();parts.add('rubber',liner);
  }
}
