import type {CityData,Point2,Road} from '../types';

/** Boston to Cambridge, including the two shore ramps. */
export const HARVARD_BRIDGE_ROADS=['15082-0-0','11255-0-0','14557-0-1','water-link-14557-0-0','14557-0-0','osm-29328400-0','osm-1329523286-0','osm-961263635-0'];
export const SMOOT_METRES=1.7018,SMOOT_TOTAL=364.4;
export const isHarvardBridgeRoad=(road:Road)=>HARVARD_BRIDGE_ROADS.includes(road.id);
export function harvardBridgeSpine(city:CityData){
  const points:Point2[]=[],elevations:number[]=[],deckWidths:number[]=[],distances:number[]=[];let length=0;
  for(const id of HARVARD_BRIDGE_ROADS){
    const road=city.roads.find(r=>r.id===id);if(!road?.elevations)return;
    const reverse=points.length?Math.hypot(road.points.at(-1)![0]-points.at(-1)![0],road.points.at(-1)![1]-points.at(-1)![1])<.02:id==='15082-0-0';
    for(let j=0;j<road.points.length;j++){
      const i=reverse?road.points.length-1-j:j,p=road.points[i],previous=points.at(-1);if(previous&&Math.hypot(p[0]-previous[0],p[1]-previous[1])<.001)continue;
      if(previous)length+=Math.hypot(p[0]-previous[0],p[1]-previous[1]);points.push(p);elevations.push(road.elevations[i]);deckWidths.push(road.deckWidths?.[i]??road.width);distances.push(length);
    }
  }
  const road:Road={id:'harvard-sidewalk-spine',name:'Harvard Bridge',points,elevations,deckWidths,width:16,oneway:0,bridge:{id:'harvard-sidewalk',thickness:.24,clearanceEstimated:true}};
  const at=(distance:number)=>{
    distance=Math.max(0,Math.min(length,distance));let i=1;while(i<distances.length-1&&distances[i]<distance)i++;
    const a=points[i-1],b=points[i],span=distances[i]-distances[i-1],t=(distance-distances[i-1])/(span||1),dx=b[0]-a[0],dz=b[1]-a[1],n=Math.hypot(dx,dz)||1;
    return{x:a[0]+dx*t,z:a[1]+dz*t,y:elevations[i-1]+(elevations[i]-elevations[i-1])*t,width:deckWidths[i-1]+(deckWidths[i]-deckWidths[i-1])*t,tx:dx/n,tz:dz/n};
  };
  return{road,length,distances,at};
}
export function smootMarkers(length:number){
  const start=Math.max(8,(length-SMOOT_TOTAL*SMOOT_METRES)/2),values=[...Array.from({length:37},(_,i)=>i*10),182.2,SMOOT_TOTAL].sort((a,b)=>a-b);
  return values.map(smoot=>({smoot,distance:start+smoot*SMOOT_METRES,label:smoot===SMOOT_TOTAL?'364.4 SMOOTS ± 1 EAR':smoot===182.2?'182.2 · HALFWAY TO HELL':`${smoot} SMOOTS`}));
}
