import * as THREE from 'three';
import {geometryParts} from './car.ts';
import {sculptBody,sculptCanopy,ellipsoid,exhaust,sportsWheel,hoodPatch,type P} from './sports-car-shapes.ts';
/** Stock A80 twin-turbo coupe: long round nose, triple-projector housings,
 * rounded fastback, eight circular rear lamp lenses and the factory hoop wing. */
export function createSupraGeometry(){
  const p=geometryParts();
  // A single surface definition anchors the panel and both supports. Keeping
  // the chord slope here prevents a tapered gap after changing wing height.
  const wingHalfWidth=.80;
  const wingPoint=(x:number,rear=false):P=>[x,.68+.055*(1-(x/wingHalfWidth)**2)+(rear?.007:0),rear?-2.10:-1.91];
  const {surface,height,rearDepth}=sculptBody(p,[[-2.2575,.75,.22],[-2.06,.86,.29],[-1.46,.905,.31],[-.80,.875,.29],[0,.85,.23],[.75,.86,.19],[1.28,.89,.17],[1.74,.86,.08],[2.10,.76,-.015],[2.2575,.60,-.10]],2.55,.32165,.3179,-.28);
  sculptCanopy(p,[[-1.86,.53,.30],[-1.37,.66,.43],[-.70,.70,.68],[-.28,.70,.70],[.18,.68,.66],[.69,.70,.32],[.84,.69,.235]],.255,true);
  for(const s of [-1,1]){
    // Solid C pillars, narrow B pillar and separate quarter windows.
    p.beam('paint',[s*.70,.27,-1.32],[s*.58,.65,-.68],.055);
    p.beam('trim',[s*.705,.27,-.40],[s*.598,.675,-.40],.018);
    p.beam('paint',[s*.70,.26,.82],[s*.57,.65,.18],.026);
    p.path('trim',[[s*.865,.23,.75],[s*.87,-.27,.60],[s*.875,-.30,-.72],[s*.88,.27,-.82]],.0035);
    p.path('paint',[[s*.87,-.33,.76],[s*.87,-.35,-.75]],.025);
    p.beam('trim',[s*.881,.22,-.65],[s*.883,.22,-.44],.012);
    p.beam('paint',[s*.72,.30,.64],[s*.91,.32,.62],.026);
    ellipsoid(p,'paint',[s*.94,.35,.62],[.10,.063,.13]);p.box('glass',[.14,.073,.009],[s*.94,.35,.501]);
    // Rear brake-cooling scoop ahead of the rear tire, not a large tuner vent.
    p.quad('trim',[[s*.883,-.10,-.67],[s*.902,-.12,-.86],[s*.90,-.29,-.91],[s*.88,-.28,-.72]]);
    p.path('paint',[[s*.884,-.09,-.67],[s*.904,-.11,-.87],[s*.902,-.30,-.92]],.013);
    p.path('trim',surface([[s*.54,0,.85],[s*.59,0,1.42],[s*.47,0,1.98]]),.003);
    // Dark rounded headlamp lenses with three distinct projector elements.
    const lamp=hoodPatch(p,[[s*.34,0,2.12],[s*.72,0,2.02],[s*.78,0,1.77],[s*.42,0,1.85]],surface);
    p.path('chrome',lamp,.004);
    for(let i=0;i<3;i++){
      const x=s*(.43+i*.118),z=2.00-i*.052;
      ellipsoid(p,'chrome',[x,height(x,z)+.018,z],[.053,.015,.066]);
      ellipsoid(p,'headlight',[x,height(x,z)+.030,z],[.038,.012,.049]);
    }
    p.quad('trim',[[s*.53,-.20,2.21],[s*.75,-.17,2.12],[s*.78,-.31,2.08],[s*.58,-.36,2.18]]);
    p.box('amber',[.12,.035,.014],[s*.64,-.14,2.19]);
    p.path('trim',[[s*.12,-.41,2.27],[s*.58,-.41,2.20],[s*.80,-.37,2.05]],.019);
    p.box('amber',[.015,.03,.07],[s*.883,.09,.91]);
    // Inset the complete lamp bank inside the tapered rear silhouette. Every
    // housing/lens vertex follows the actual body cap, not a floating flat bar.
    const rearPoint=(x:number,y:number,offset:number):P=>[s*x,y,rearDepth(s*x,y)-offset];
    const fitLens=(geometry:THREE.BufferGeometry,offset:number)=>{
      const positions=geometry.getAttribute('position');
      for(let j=0;j<positions.count;j++)positions.setZ(j,rearDepth(positions.getX(j),positions.getY(j))-offset+positions.getZ(j));
      geometry.computeVertexNormals();return geometry;
    };
    for(let j=0;j<32;j++){
      const x0=.22+j*.50/32,x1=x0+.50/32;
      const halfHeight=(x:number)=>{const d=Math.max(.275-x,x-.665,0);return .020+Math.sqrt(Math.max(0,.055**2-d*d));};
      p.quad('trim',[rearPoint(x0,.13+halfHeight(x0),.003),rearPoint(x1,.13+halfHeight(x1),.003),rearPoint(x1,.13-halfHeight(x1),.003),rearPoint(x0,.13-halfHeight(x0),.003)]);
    }
    for(const [i,x] of [.29,.415,.54,.665].entries()){
      const material=i===0?'plate':i===3?'amber':'taillight';
      const lens=new THREE.CylinderGeometry(.051,.051,.012,32);lens.rotateX(Math.PI/2);lens.translate(s*x,.13,0);p.add(material,fitLens(lens,.010));
      const ring=new THREE.TorusGeometry(.054,.003,5,32);ring.translate(s*x,.13,0);p.add('trim',fitLens(ring,.012));
      const inner=new THREE.CircleGeometry(.032,24);inner.rotateY(Math.PI);inner.translate(s*x,.13,0);p.add(material,fitLens(inner,.017));
    }
    // Wide swept wing uprights grow out of the rear quarter, with the classic
    // arched bridge high above the hatch rather than an aftermarket race wing.
    const upright:P[]=[[s*.76,.27,-1.74],wingPoint(s*.76),wingPoint(s*.76,true),[s*.70,.28,-2.12]];
    p.quad('paint',upright);p.path('paint',[...upright,upright[0]],.012);
    p.path('trim',surface([[s*.57,0,-1.78],[s*.66,0,-2.01]]),.003);
  }
  for(let i=0;i<40;i++){
    const x0=-wingHalfWidth+i*2*wingHalfWidth/40,x1=x0+2*wingHalfWidth/40;
    const front0=wingPoint(x0),front1=wingPoint(x1),rear0=wingPoint(x0,true),rear1=wingPoint(x1,true);
    const top=[front0,rear0,rear1,front1];
    const bottom=top.map(([x,y,z])=>[x,y-.014,z] as P);
    p.quad('paint',top);p.quad('paint',[...bottom].reverse());
    p.quad('paint',[front0,front1,bottom[3],bottom[0]]);
    p.quad('paint',[rear1,rear0,bottom[1],bottom[2]]);
    if(i===0)p.quad('paint',[front0,bottom[0],bottom[1],rear0]);
    if(i===39)p.quad('paint',[front1,rear1,bottom[2],bottom[3]]);
    p.beam('paint',front0,front1,.020);
    p.beam('paint',rear0,rear1,.017);
  }
  p.quad('trim',[[-.46,-.17,2.265],[.46,-.17,2.265],[.50,-.36,2.265],[-.50,-.36,2.265]]);
  for(let i=0;i<5;i++)p.box('rubber',[.87,.008,.008],[0,-.20-i*.03,2.273]);
  p.box('trim',[.335,.178,.02],[0,-.13,2.28]);
  p.box('trim',[.34,.18,.02],[0,-.09,-2.278]);
  p.path('trim',[[-.74,-.34,-2.20],[0,-.39,-2.27],[.74,-.34,-2.20]],.017);
  exhaust(p,-.60,-.30,-2.26,.075);
  p.box('taillight',[.28,.025,.016],[0,.315,-2.16]);
  // Toyota oval and rear hatch wiper, plus fine heated-glass traces.
  const logo=new THREE.TorusGeometry(.032,.004,5,24);logo.scale(1.4,.75,1);logo.rotateX(-Math.PI*.40);logo.translate(0,height(0,2.05)+.014,2.05);p.add('chrome',logo);
  p.beam('trim',[.25,.32,-1.78],[-.20,.43,-1.38],.007);
  for(let i=0;i<5;i++){const z=-1.70+i*.14,y=.34+i*.055;p.beam('trim',[-.43,y,z],[.43,y,z],.002,3);}
  return p.finish();
}
export const createSupraWheelGeometry=(side:number,front:boolean)=>sportsWheel(side,front?.32165:.3179,front?.235:.255,.2159,5,false);
