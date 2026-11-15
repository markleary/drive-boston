import * as THREE from 'three';
import {geometryParts} from './car.ts';
type Point=[number,number,number];

/** Original geometry from the supplied Highland Performance wheel references.
 * All coordinates are wheel-local: X is the axle, Y/Z form the wheel plane.
 * The outer graphite face sits just inside the tyre shoulder, and the hubs
 * are recessed so the sculpted spokes have a visible concave profile. */
export function createTeslaWheelGeometry(side:number,front:boolean){
  const p=geometryParts(),radius=front?.33625:.3365,width=front?.235:.275,half=width/2;
  const rim=.254,outer=half-.003,hubX=half-(front?.043:.051);
  const radial=(x:number,r:number,a:number):Point=>[side*x,Math.cos(a)*r,Math.sin(a)*r];
  const ring=(surface:'trim'|'rubber'|'chrome',r:number,tube:number,x:number,sides=4,segments=64)=>{
    const g=new THREE.TorusGeometry(r,tube,sides,segments);g.rotateY(Math.PI/2);g.translate(side*x,0,0);p.add(surface,g);
  };
  const disk=(surface:'trim'|'chrome',r:number,thickness:number,x:number,segments=48)=>{
    const g=new THREE.CylinderGeometry(r,r,thickness,segments);g.rotateZ(Math.PI/2);g.translate(side*x,0,0);p.add(surface,g);
  };

  // The tread grooves are depressions in the tyre's profile, rather than
  // bright painted rings. Rounded sidewalls retain the actual 235/275mm width.
  const tireProfile=[
    [rim,-half*.91],[.274,-half],[.302,-half*.97],[radius-.009,-half*.83],
    [radius,-half*.68],[radius,-half*.36],[radius-.003,-half*.32],[radius,-half*.28],
    [radius,-.002],[radius-.0026,0],[radius,.002],
    [radius,half*.28],[radius-.003,half*.32],[radius,half*.36],[radius,half*.68],
    [radius-.009,half*.83],[.302,half*.97],[.274,half],[rim,half*.91],
  ];
  const tyre=new THREE.LatheGeometry(tireProfile.map(([r,x])=>new THREE.Vector2(r,x)),56);tyre.rotateZ(Math.PI/2);p.add('rubber',tyre);
  // Shallow moulded sidewall bands and small tread blocks read as rubber in
  // grazing light, without spending another texture or draw call on the tyre.
  ring('rubber',.282,.00085,half-.0009,3,40);
  ring('rubber',.303,.0008,half*.967-.0008,3,40);
  for(let i=0;i<48;i++){
    const a=i/48*Math.PI*2;
    for(const sign of [-1,1]){
      const start=sign*half*.39,end=sign*half*.69,twist=sign*.023;
      p.quad('rubber',[radial(start,radius+.00025,a-.004),radial(end,radius-.0004,a+twist-.004),radial(end,radius-.0004,a+twist+.004),radial(start,radius+.00025,a+.004)]);
    }
  }

  // Full barrel and dual rolled lips behind the concave forged face. An open
  // centre lets the actual silver rotor and red caliper show between spokes.
  const barrel=new THREE.CylinderGeometry(rim-.006,rim-.012,width*.80,64,1,true);barrel.rotateZ(Math.PI/2);barrel.translate(-side*.009,0,0);p.add('trim',barrel);
  ring('trim',rim-.003,.0055,outer,5,56);
  ring('trim',rim-.016,.0035,outer-.004,4,48);
  ring('trim',rim-.009,.004,-half*.82,3,48);

  const rotorR=front?.1775:.1675,rotorX=half-.061;
  disk('chrome',rotorR,front?.025:.020,rotorX,48);
  disk('trim',.085,.027,rotorX+.001,40);
  ring('chrome',rotorR-.007,.001,rotorX+.013,3,48);
  // Fine dark radial slots and short ventilation bores keep the disc from
  // reading as a featureless bright wheel cover.
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12;
    p.quad('rubber',[radial(rotorX+.014,rotorR*.72,a-.008),radial(rotorX+.014,rotorR*.94,a+.035),radial(rotorX+.014,rotorR*.94,a+.046),radial(rotorX+.014,rotorR*.72,a+.003)]);
  }

  // Five paired swept blades with an asymmetric forged crown. Each pair
  // opens from a shared root into broad shoulders at the rolled lip, leaving
  // windows around the disc. Rear wheels have a more deeply dished hub.
  const stations=12,section=[[-1,-.008],[-1,.001],[-.78,.005],[.60,.008],[1,.002],[1,-.008]];
  for(let spoke=0;spoke<10;spoke++){
    const base=Math.floor(spoke/2)*Math.PI*2/5,branch=spoke%2?1:-1,positions:number[]=[],indices:number[]=[];
    for(let i=0;i<=stations;i++){
      const t=i/stations,r=.047+.198*t,angle=base+branch*(.10+.21*t)+.09*t*t-.012;
      const x=hubX+(outer-hubX)*Math.pow(t,.75);
      const bladeHalf=.017+.010*t*t-.002*Math.sin(t*Math.PI);
      for(const [across,depth] of section){
        const tangent=across*bladeHalf*(across>0?1.10:.90);
        positions.push(side*(x+depth),Math.cos(angle)*r-Math.sin(angle)*tangent,Math.sin(angle)*r+Math.cos(angle)*tangent);
      }
    }
    const n=section.length;
    for(let i=0;i<stations;i++)for(let j=0;j<n;j++){
      const a=i*n+j,b=i*n+(j+1)%n,c=a+n,d=b+n;
      if(side>0)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
    }
    for(let j=1;j<n-1;j++){
      const end=stations*n;
      if(side>0)indices.push(0,j,j+1,end,end+j+1,end+j);else indices.push(0,j+1,j,end,end+j,end+j+1);
    }
    const blade=new THREE.BufferGeometry();blade.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));blade.setIndex(indices);blade.computeVertexNormals();p.add('trim',blade);
  }
  disk('trim',.053,.018,hubX+.004,40);
  ring('trim',.047,.0025,hubX+.014,4,32);
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5;
    diskAt(radial(hubX+.014,.035,a),.0065,.007,'trim');
    diskAt(radial(hubX+.018,.035,a),.004,.008,'chrome');
  }
  function diskAt(position:Point,r:number,depth:number,surface:'trim'|'chrome'){
    const g=new THREE.CylinderGeometry(r,r,depth,6);g.rotateZ(Math.PI/2);g.translate(...position);p.add(surface,g);
  }
  // Tiny relief Tesla T, surrounded by the five wheel bolts.
  p.path('chrome',[radial(hubX+.017,.015,-.85),[side*(hubX+.017),.019,0],radial(hubX+.017,.015,.85)],.0017);
  p.beam('chrome',[side*(hubX+.018),.015,0],[side*(hubX+.018),-.016,0],.0018,4);
  return p.finish();
}

/** Fixed Performance caliper: a rounded cast body around the disc's trailing
 * edge, separate from the rotating wheel. Parent steering/suspension moves it. */
export function createTeslaCaliperGeometry(side:number,front:boolean){
  const half=(front?.235:.275)/2,scale=front?1:.86,shape=new THREE.Shape();
  shape.moveTo(-.041,-.100);shape.bezierCurveTo(-.049,-.090,-.054,-.040,-.049,.030);
  shape.bezierCurveTo(-.047,.091,-.026,.112,.012,.110);
  shape.bezierCurveTo(.044,.105,.050,.076,.050,.041);
  shape.lineTo(.050,-.055);shape.bezierCurveTo(.049,-.087,.034,-.111,.006,-.113);
  shape.bezierCurveTo(-.012,-.115,-.030,-.111,-.041,-.100);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.048,bevelEnabled:true,bevelSize:.005,bevelThickness:.005,bevelSegments:2,steps:1,curveSegments:6});
  geometry.scale(scale,scale,1);geometry.rotateY(Math.PI/2);
  // Outer housing is in front of the disc but behind the forged wheel face.
  geometry.translate(side*(half-.049)-(side>0?.048:0),0,front?-.144:.133);
  return geometry;
}
