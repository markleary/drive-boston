import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {geometryParts,VehicleSurface} from './car.ts';

type P=[number,number,number];
type Parts=ReturnType<typeof geometryParts>;

/** Width of the actual cabin opening, for trimming the body beneath glazing. */
export function teslaCabinFootprint(z:number){
  return z< -1.70||z>1.035?0:.817-.016*THREE.MathUtils.smoothstep(-z,1.2,1.7);
}

/** Highland glazing, painted roof rails and a restrained visible cabin.
 * All dimensions are final chassis-local metres (no secondary body lift).
 * Each pane occupies its own opening: no transparent glass over painted skin. */
export function addTeslaCabin(p:Parts){
  function path(surface:VehicleSurface,points:P[],radius:number){
    const curve=new THREE.CatmullRomCurve3(points.map(point=>new THREE.Vector3(...point)));
    const geometry=new THREE.TubeGeometry(curve,Math.max(4,Math.min(32,points.length-1)),radius,4,false);
    p.add(surface,geometry);
  }
  // [z, half width at roof edge, crown y, roof-edge y]. The roof has a broad
  // shallow crown rather than the almost vertical sides of a single canopy dome.
  const stations=[
    [-1.70,.801,.417,.411],[-1.48,.782,.497,.478],[-1.15,.747,.647,.617],
    [-.82,.707,.761,.730],[-.35,.680,.822,.785],[.08,.676,.817,.779],
    [.36,.693,.759,.725],[.66,.733,.600,.570],[.91,.775,.414,.402],[1.035,.796,.360,.357],
  ];
  const curve=new THREE.CatmullRomCurve3(stations.map(([z,w,y])=>new THREE.Vector3(w,y,z)));
  const edgeCurve=new THREE.CatmullRomCurve3(stations.map(([z,,y,edge])=>new THREE.Vector3(edge,y,z)));
  function profile(z:number){
    let low=0,high=1;
    for(let i=0;i<17;i++){const t=(low+high)/2;if(curve.getPoint(t).z<z)low=t;else high=t;}
    const t=(low+high)/2,c=curve.getPoint(t);
    return {w:c.x,y:c.y,edge:edgeCurve.getPoint(t).x};
  }
  const top=(z:number,u:number,lift=0):P=>{const c=profile(z);return [c.w*u,c.y-(c.y-c.edge)*u*u+lift,z];};
  const belt=(z:number)=>.352+.035*THREE.MathUtils.smoothstep(-z,.35,1.7);
  const lowerX=(z:number)=>.817-.016*THREE.MathUtils.smoothstep(-z,1.2,1.7);
  const sidePoint=(side:number,z:number,y:number,outset=0):P=>{
    const c=profile(z),t=THREE.MathUtils.clamp((y-belt(z))/Math.max(.005,c.edge-belt(z)),0,1);
    const x=THREE.MathUtils.lerp(lowerX(z),c.w,t)+.010*Math.sin(t*Math.PI);
    return [side*(x+outset),y,z];
  };
  const windowTop=(z:number)=>{
    const c=profile(z),rear=THREE.MathUtils.smoothstep(z,-1.48,-.95),front=THREE.MathUtils.smoothstep(1.025-z,0,.23);
    return Math.max(belt(z)+.012,THREE.MathUtils.lerp(belt(z)+.012,c.edge-.020,Math.min(rear,front)));
  };
  function grid(surface:VehicleSurface,rows:number,columns:number,point:(v:number,u:number)=>P,flip=false){
    const vertices:number[]=[],indices:number[]=[];
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++)vertices.push(...point(i/rows,j/columns));
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=i*(columns+1)+j,b=a+columns+1;
      if(flip)indices.push(a,a+1,b,b,a+1,b+1);else indices.push(a,b,a+1,b,b+1,a+1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();p.add(surface,geometry);
  }
  // Independent raked screens and two panoramic glass panels; paint replaces
  // the side edge band instead of hovering above an unbroken glass blob.
  for(const [from,to,surface] of [[-1.70,-.76,'cabinGlass'],[-.76,.30,'roofGlass'],[.30,1.035,'cabinGlass']] as const){
    grid(surface,20,22,(v,u)=>top(THREE.MathUtils.lerp(from,to,v),-.946+u*1.892));
    for(const side of [-1,1])grid('paint',20,3,(v,u)=>top(THREE.MathUtils.lerp(from,to,v),side*(.946+u*.054)),side<0);
  }
  for(const z of [-1.695,-.76,.30,1.03])path('trim',Array.from({length:25},(_,i)=>top(z,-.946+i*1.892/24,.0025)),z===-.76||z===.30?.003:.006);
  for(const side of [-1,1]){
    path('trim',Array.from({length:65},(_,i)=>top(-1.70+i*2.735/64,side*.946,.002)),.0035);
    // Side surface from belt to roof: large shaped C-pillar, narrow A-pillar
    // and a continuous painted rail following the real window silhouette.
    grid('paint',48,4,(v,u)=>{
      const z=-1.70+v*2.735,c=profile(z),lower=z< -1.48||z>.965?belt(z):Math.min(c.edge,windowTop(z));
      return sidePoint(side,z,THREE.MathUtils.lerp(lower,c.edge,u));
    },side>0);
    for(const [from,to] of [[-1.48,-.265],[-.185,.965]]){
      grid('cabinGlass',24,5,(v,u)=>{const z=THREE.MathUtils.lerp(from,to,v);return sidePoint(side,z,THREE.MathUtils.lerp(belt(z)+.012,windowTop(z),u),.001);},side>0);
    }
    // Satin B-pillar is a real gap between glazing sheets and runs into the
    // top seal; the quarter-window division leans forward near the C-pillar.
    grid('trim',4,8,(v,u)=>{const z=-.265+v*.080;return sidePoint(side,z,THREE.MathUtils.lerp(belt(z)+.007,profile(z).edge,u),.002);},side>0);
    path('trim',Array.from({length:61},(_,i)=>{const z=-1.48+i*2.445/60;return sidePoint(side,z,windowTop(z),.003);}),.006);
    path('trim',Array.from({length:61},(_,i)=>{const z=-1.48+i*2.445/60;return sidePoint(side,z,belt(z)+.008,.003);}),.008);
    path('trim',Array.from({length:13},(_,i)=>{
      const t=i/12,z=-1.19+.20*t;
      return sidePoint(side,z,THREE.MathUtils.lerp(belt(-1.19)+.015,windowTop(-.99),t),.004);
    }),.009);
    // Triangular sail at the forward window corner carries the swept mirror
    // arm. The housing is one tapered shell, not stacked rounded boxes.
    const sail:P[]=[sidePoint(side,.96,.365,.004),sidePoint(side,.77,.365,.004),sidePoint(side,.77,.440,.004)];
    const sailGeo=new THREE.BufferGeometry();sailGeo.setAttribute('position',new THREE.Float32BufferAttribute(sail.flat(),3));sailGeo.computeVertexNormals();p.add('trim',sailGeo);
    rounded('trim',[.130,.029,.061],[side*.864,.385,.793],.012,[0,side*.24,side*.16]);
    addMirror(side);
  }
  // Light rear-screen heater traces, seated on the glass rather than large
  // black tubes. They follow the screen's changing width and crown.
  for(let i=0;i<9;i++){
    const z=-1.61+i*.085;
    path('trim',Array.from({length:19},(_,j)=>top(z,-.865+j*1.73/18,.0015)),.0007);
  }
  // Wipers sit below the bonnet sightline and do not bisect the windshield.
  p.beam('trim',[-.58,.371,.997],[.02,.378,.986],.005,5);
  p.beam('trim',[.12,.371,.997],[.62,.378,.986],.005,5);

  function rounded(surface:VehicleSurface,size:P,center:P,radius:number,rotation:P=[0,0,0]){
    const geometry=new RoundedBoxGeometry(...size,1,radius);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...center);p.add(surface,geometry);
  }
  function addMirror(side:number){
    // [x, y, z, half width, half height]. A wide viewing face rolls into a
    // convex leading nose; the outer tip sweeps forward away from the driver.
    const rings=[
      [.943,.424,.669,.083,.053],[.946,.424,.703,.091,.057],
      [.948,.426,.753,.094,.057],[.951,.429,.800,.078,.046],
      [.955,.432,.831,.044,.027],[.958,.433,.846,.0002,.0002],
    ];
    const centre=new THREE.CatmullRomCurve3(rings.map(([x,y,z])=>new THREE.Vector3(x,y,z)),false,'catmullrom',.5);
    const size=new THREE.CatmullRomCurve3(rings.map(([,,z,w,h])=>new THREE.Vector3(w,h,z)),false,'catmullrom',.5);
    const round=(v:number,power:number)=>Math.sign(v)*Math.pow(Math.abs(v),power);
    const perimeter=(angle:number):[number,number]=>[
      round(Math.sin(angle),.88)*(1-.08*Math.cos(angle)),round(Math.cos(angle),.86),
    ];
    const rows=20,columns=32,vertices:number[]=[],paint:number[]=[],trim:number[]=[];
    for(let i=0;i<=rows;i++){
      const c=centre.getPoint(i/rows),s=size.getPoint(i/rows);
      for(let j=0;j<=columns;j++){
        const [u,v]=perimeter(j/columns*Math.PI*2),x=c.x+s.x*u;
        vertices.push(side*x,c.y+s.y*v,c.z+.24*(x-.943));
      }
    }
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=i*(columns+1)+j,b=a+columns+1;
      const indices=Math.cos((j+.5)/columns*Math.PI*2)>-.23?paint:trim;
      if(side>0)indices.push(a,b,a+1,b,b+1,a+1);else indices.push(a,a+1,b,b,a+1,b+1);
    }
    const shell=new THREE.BufferGeometry();shell.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    // Share continuous normals at the paint/lower-shell join so it reads as
    // an aerodynamic cap rather than a bright chamfer around a rectangular lid.
    shell.setIndex([...paint,...trim]);shell.computeVertexNormals();
    const normals=shell.getAttribute('normal');
    for(let i=0;i<=rows;i++){
      const a=i*(columns+1),b=a+columns;
      const normal=new THREE.Vector3().fromBufferAttribute(normals,a)
        .add(new THREE.Vector3().fromBufferAttribute(normals,b)).normalize();
      normals.setXYZ(a,normal.x,normal.y,normal.z);normals.setXYZ(b,normal.x,normal.y,normal.z);
    }
    for(const [surface,indices] of [['paint',paint],['trim',trim]] as const){
      const part=shell.clone();part.setIndex(indices);p.add(surface,part);
    }
    shell.dispose();
    const face=(surface:VehicleSurface,scale:number,offset:number)=>{
      const positions:number[]=[],indices:number[]=[],radial=6;
      for(let r=0;r<=radial;r++)for(let j=0;j<=columns;j++){
        const t=r/radial,[u,v]=perimeter(j/columns*Math.PI*2),x=.943+.083*u*t*scale;
        positions.push(side*x,.424+.053*v*t*scale,.669+.24*(x-.943)-offset-.003*(1-t*t));
      }
      for(let r=0;r<radial;r++)for(let j=0;j<columns;j++){
        const a=r*(columns+1)+j,b=a+columns+1;
        if(side>0)indices.push(a,b,a+1,b,b+1,a+1);else indices.push(a,a+1,b,b,a+1,b+1);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();p.add(surface,geometry);
    };
    face('trim',1,.0005);
    // A subtly convex viewing surface, inset in a narrow continuous gasket.
    face('glass',.87,.0018);
  }
  // Dark cabin tub, dashboard and console. No imagery or large textures are
  // needed for the interior silhouette seen through real tinted glazing.
  p.box('rubber',[1.47,.055,2.35],[0,-.13,-.27]);
  rounded('rubber',[1.45,.13,.27],[0,.265,.704],.045);
  p.beam('trim',[-.69,.311,.571],[.69,.311,.571],.012,8);
  p.beam('chrome',[-.675,.326,.576],[.675,.326,.576],.0015,4);
  rounded('rubber',[.26,.15,.77],[0,.008,.14],.040);
  rounded('rubber',[1.35,.16,.45],[0,.003,-.96],.035);
  // Rear occupants sit below the fastback's falling glass, not at the front
  // seat height. The head restraints retain > 5 cm clearance to the screen.
  rounded('rubber',[1.32,.41,.13],[0,.200,-1.20],.040,[-.15,0,0]);
  for(const x of [-.45,0,.45])rounded('rubber',[.205,.12,.105],[x,.437,-1.235],.028,[-.15,0,0]);
  for(const x of [-.395,.395]){
    rounded('rubber',[.44,.13,.46],[x,.008,-.11],.045);
    // Continuous sculpted sport-seat back with shoulder bolsters and inset
    // centre, followed by the narrower integrated head restraint.
    const seat=new THREE.Shape();
    seat.moveTo(-.17,-.24);seat.lineTo(-.21,.11);seat.quadraticCurveTo(-.225,.20,-.165,.235);
    seat.quadraticCurveTo(-.12,.25,-.108,.29);seat.lineTo(-.102,.365);seat.quadraticCurveTo(-.098,.393,-.067,.395);
    seat.lineTo(.067,.395);seat.quadraticCurveTo(.098,.393,.102,.365);seat.lineTo(.108,.29);
    seat.quadraticCurveTo(.12,.25,.165,.235);seat.quadraticCurveTo(.225,.20,.21,.11);seat.lineTo(.17,-.24);seat.closePath();
    const back=new THREE.ExtrudeGeometry(seat,{depth:.085,bevelEnabled:true,bevelSize:.018,bevelThickness:.018,bevelSegments:2,steps:1,curveSegments:5});
    back.translate(0,0,-.04);back.rotateX(-.15);back.translate(x,.25,-.29);p.add('rubber',back);
    rounded('rubber',[.254,.34,.027],[x,.28,-.217],.022,[-.15,0,0]);
    for(const sign of [-1,1])rounded('rubber',[.072,.38,.15],[x+sign*.180,.26,-.245],.033,[-.15,0,sign*.09]);
    path('rubber',[[x-.12,.505,-.263],[x-.065,.522,-.266],[x+.065,.522,-.266],[x+.12,.505,-.263]],.003);
  }
  for(const side of [-1,1]){
    rounded('rubber',[.065,.26,1.84],[side*.745,.12,-.21],.025);
    p.beam('trim',[side*.703,.225,.52],[side*.703,.225,-.94],.013,6);
  }
  const steering=new THREE.TorusGeometry(.132,.012,7,32);steering.rotateX(-.20);steering.translate(-.395,.349,.397);p.add('trim',steering);
  rounded('trim',[.105,.07,.035],[-.395,.349,.397],.015,[-.20,0,0]);
  p.beam('chrome',[-.510,.349,.398],[-.440,.341,.396],.005,5);
  p.beam('chrome',[-.350,.341,.396],[-.280,.349,.398],.005,5);
  p.beam('trim',[-.395,.225,.421],[-.395,.329,.401],.010,6);
  // Floating centre display: black bezel with a restrained split UI visible
  // through the front screen. It is oriented toward the driver, not the road.
  rounded('trim',[.322,.197,.019],[.015,.369,.558],.009,[-.12,0,0]);
  rounded('glass',[.301,.175,.003],[.015,.369,.546],.004,[-.12,0,0]);
  p.box('chrome',[.118,.004,.002],[-.063,.431,.533]);
  p.box('chrome',[.056,.003,.002],[-.093,.413,.536]);
  p.box('trim',[.119,.090,.002],[.084,.367,.533]);
  path('chrome',[[.044,.398,.530],[.085,.387,.530],[.094,.349,.530],[.122,.326,.530]],.0022);
  path('chrome',[[.028,.349,.530],[.066,.361,.530],[.139,.380,.530]],.0015);
  // Discreet front camera/sensor pod at the top of the windscreen.
  rounded('rubber',[.15,.035,.105],[0,.723,.375],.015,[-.25,0,0]);
}
