import {geometryParts} from './car.ts';
import {sculptBody,sculptCanopy,ellipsoid,exhaust,sportsWheel,hoodPatch,type P} from './sports-car-shapes.ts';
/** 720S coupe: teardrop eye sockets, low Monocage canopy, double-skin door
 * channels, flying rear buttresses and high twin exhausts. Original geometry. */
export function create720SGeometry(){
  const p=geometryParts();
  const {surface,height,rearDepth}=sculptBody(p,[[-2.2715,.80,.19],[-2.05,.93,.25],[-1.45,.965,.29],[-.8,.93,.24],[-.20,.86,.13],[.65,.86,.10],[1.30,.94,.12],[1.70,.90,.055],[2.12,.77,-.055],[2.2715,.61,-.13]],2.67,.3238,.3455,-.24);
  sculptCanopy(p,[[-1.47,.49,.28],[-1.02,.69,.46],[-.58,.72,.63],[-.10,.71,.64],[.29,.68,.58],[.75,.68,.31],[.94,.65,.17]],.19);
  for(const s of [-1,1]){
    p.beam('trim',[s*.69,.20,-.23],[s*.60,.62,-.23],.018);
    // A narrow open channel follows the top of each door into the rear haunch.
    p.quad('trim',[[s*.80,.22,.59],[s*.89,.22,-.55],[s*.94,.32,-1.00],[s*.83,.28,-.53]]);
    p.path('paint',[[s*.80,.245,.59],[s*.88,.255,-.55],[s*.94,.34,-1.03]],.021);
    p.path('trim',[[s*.865,.16,.68],[s*.874,-.28,.43],[s*.91,-.34,-.64],[s*.94,.27,-.80]],.0035);
    p.path('paint',[[s*.90,-.28,.66],[s*.85,-.16,.05],[s*.90,.08,-.60]],.023);
    p.path('trim',[[s*.94,-.37,.96],[s*.88,-.41,.52],[s*.92,-.41,-.81]],.022);
    p.beam('paint',[s*.68,.24,.61],[s*.93,.27,.62],.023);
    ellipsoid(p,'paint',[s*.97,.30,.61],[.09,.052,.135]);p.box('glass',[.13,.066,.01],[s*.97,.30,.487]);
    // Deep black teardrop headlamp/intake recess with a thin curved LED blade.
    const eye=hoodPatch(p,[[s*.34,0,2.17],[s*.72,0,2.04],[s*.86,0,1.72],[s*.69,0,1.66],[s*.44,0,1.91]],surface);
    p.path('trim',eye,.008);
    p.path('headlight',surface([[s*.37,0,2.13],[s*.57,0,2.04],[s*.78,0,1.87]],.024),.009);
    ellipsoid(p,'headlight',[s*.73,height(s*.73,1.80)+.015,1.80],[.065,.014,.033]);
    p.path('trim',surface([[s*.26,0,2.10],[s*.39,0,1.68],[s*.50,0,1.09],[s*.62,0,.86]]),.003);
    p.quad('trim',[[s*.19,-.24,2.277],[s*.57,-.19,2.21],[s*.76,-.32,2.13],[s*.25,-.39,2.25]]);
    p.path('paint',[[s*.20,-.24,2.28],[s*.54,-.18,2.22],[s*.76,-.31,2.13]],.016);
    p.path('trim',[[s*.08,-.41,2.28],[s*.62,-.41,2.18],[s*.87,-.37,1.99]],.021);
    p.box('amber',[.025,.034,.15],[s*.928,-.09,1.64]);
    // Rear deck buttresses surround the dark engine cover.
    p.path('paint',[[s*.55,.40,-1.02],[s*.70,.33,-1.45],[s*.78,.30,-1.98]],.04);
    p.quad('trim',[[s*.46,.33,-1.18],[s*.64,.33,-1.22],[s*.70,.31,-1.82],[s*.40,.27,-1.86]]);
    p.path('taillight',[[s*.23,.13,-2.279],[s*.58,.16,-2.269],[s*.80,.21,-2.21],[s*.88,.24,-2.09]],.010);
    exhaust(p,s*.39,.005,-2.29,.074);
    // Flush lower bumper lenses, inset from its tapered corners. Both the dark
    // surround and red face follow the body cap instead of projecting flat bars.
    for(const [material,left,right,halfHeight,offset] of [
      ['trim',.42,.66,.024,.001],['taillight',.428,.652,.016,.0025],
    ] as const){
      const point=(x:number,top:boolean):P=>{
        const d=Math.max(left+.008-x,x-(right-.008),0);
        const h=halfHeight-.008+Math.sqrt(Math.max(0,.008**2-d*d));
        const y=-.28+(top?h:-h);return [s*x,y,rearDepth(s*x,y)-offset];
      };
      for(let i=0;i<24;i++){
        const x0=left+(right-left)*i/24,x1=left+(right-left)*(i+1)/24;
        const face=[point(x0,true),point(x1,true),point(x1,false),point(x0,false)];
        p.quad(material,s>0?face:face.reverse());
      }
    }
    p.box('paint',[.04,.14,.16],[s*.56,.30,-2.02]);
  }
  p.quad('trim',[[-.87,.21,-2.22],[.87,.21,-2.22],[.75,-.13,-2.29],[-.75,-.13,-2.29]]);
  for(let i=0;i<34;i++){const x=-.73+i*.044;p.beam('rubber',[x,-.09,-2.302],[x+.024,.12,-2.302],.003,3);}
  p.quad('trim',[[-.78,-.32,-2.28],[.78,-.32,-2.28],[.70,-.46,-2.15],[-.70,-.46,-2.15]]);
  for(const x of [-.65,-.35,0,.35,.65])p.box('trim',[.018,.13,.31],[x,-.40,-2.11]);
  p.box('trim',[.34,.18,.02],[0,-.23,-2.29]);
  p.box('trim',[.335,.178,.025],[0,-.27,2.281]);
  // Low deployed rear aerofoil, matching the reference's active wing profile.
  for(let i=0;i<36;i++){
    const x0=-.89+i*1.78/36,x1=x0+1.78/36;
    const y=(x:number)=>.35+.045*(x/.89)**2;
    p.quad('paint',[[x0,y(x0),-1.96],[x0,y(x0)+.018,-2.23],[x1,y(x1)+.018,-2.23],[x1,y(x1),-1.96]]);
    p.beam('paint',[x0,y(x0)+.018,-2.23],[x1,y(x1)+.018,-2.23],.014);
  }
  p.box('taillight',[.26,.012,.014],[0,.35,-2.245]);
  for(let i=0;i<9;i++)p.box('trim',[.50,.012,.026],[0,.255+i*.004,-1.40-i*.065]);
  return p.finish();
}
export const create720SWheelGeometry=(side:number,front:boolean)=>sportsWheel(side,front?.3238:.3455,front?.245:.305,front?.2413:.254,5,true);
