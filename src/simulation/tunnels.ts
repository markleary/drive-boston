import type {CityData,Point2,Road} from '../types';
import {deckEdge,deckEdgeElevation,roadProjection,roadSlabGeometry,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
import {sampleElevation} from './terrain.ts';

export interface TunnelMesh {vertices:Float32Array;indices:Uint32Array;}
type Vertex=[number,number,number];
const CELL=32;
const stationCache=new WeakMap<Road,number[]>();
export function tunnelStations(road:Road){
  let distances=stationCache.get(road);if(distances)return distances;
  distances=[0];for(let i=1;i<road.points.length;i++)distances.push(distances[i-1]+Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]));
  stationCache.set(road,distances);return distances;
}
export function tunnelCoveredAt(road:Road,station:number){return !!road.tunnel&&(road.tunnel.covered===undefined||road.tunnel.covered.some(([a,b])=>station>=a-.001&&station<=b+.001));}
export function tunnelPointAt(road:Road,station:number){
  const distances=tunnelStations(road);let i=1;while(i<distances.length-1&&distances[i]<station)i++;
  const a=road.points[i-1],b=road.points[i],t=Math.max(0,Math.min(1,(station-distances[i-1])/(distances[i]-distances[i-1]||1)));
  const wa=road.deckWidths?.[i-1]??road.width,wb=road.deckWidths?.[i]??road.width;
  return{x:a[0]+(b[0]-a[0])*t,y:(road.elevations?.[i-1]??0)+((road.elevations?.[i]??0)-(road.elevations?.[i-1]??0))*t,z:a[1]+(b[1]-a[1])*t,yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),width:wa+(wb-wa)*t};
}

type Portal={polygon:Point2[];minX:number;maxX:number;minZ:number;maxZ:number};
type TunnelVolume=Portal&{road:Road;x:number;z:number;y:number;gx:number;gz:number};
type TunnelCity=Pick<CityData,'roads'>&Partial<Pick<CityData,'bounds'|'elevation'>>;
type TunnelIndex={roads:Map<string,Road[]>;portals:Map<string,Portal[]>;portalList:Portal[];volumes:Map<string,TunnelVolume[]>;shellVolumes:Map<string,TunnelVolume[]>;wallVolumes:Map<string,TunnelVolume[]>;elevation?:CityData['elevation']};
const emptyRoads:Road[]=[];
const indexes=new WeakMap<Road[],TunnelIndex>();
const key=(x:number,z:number)=>`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;
function index(city:TunnelCity){
  const source=city.roads??emptyRoads,cached=indexes.get(source);if(cached&&cached.elevation===city.elevation)return cached;
  const roads=new Map<string,Road[]>(),portals=new Map<string,Portal[]>(),portalList:Portal[]=[],volumes=new Map<string,TunnelVolume[]>(),shellVolumes=new Map<string,TunnelVolume[]>(),wallVolumes=new Map<string,TunnelVolume[]>();
  const insert=<T>(cells:Map<string,T[]>,value:T,minX:number,maxX:number,minZ:number,maxZ:number)=>{
    for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++){
      const k=`${x},${z}`,list=cells.get(k)??[];if(!list.includes(value))list.push(value);cells.set(k,list);
    }
  };
  for(const road of source){
    if(!road.tunnel||!road.elevations)continue;
    const stations=tunnelStations(road);
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],margin=Math.max(road.width,road.deckWidths?.[i-1]??0,road.deckWidths?.[i]??0)/2+1;
      insert(roads,road,Math.min(a[0],b[0])-margin,Math.max(a[0],b[0])+margin,Math.min(a[1],b[1])-margin,Math.max(a[1],b[1])+margin);
      // Building clearance includes the lining margin. Shell unions use the
      // actual deck footprint, otherwise the subtraction extends beyond the
      // adjoining roof and leaves daylight slivers around every rising merge.
      // Wall cuts meet the inner wall face (edge +.08 minus .2m half-thickness);
      // clipping to the full deck makes both meeting walls erase their seam.
      for(const [cells,inset]of [[volumes,-.4],[shellVolumes,0],[wallVolumes,.12]] as const){
        const crossSection=[deckEdge(road,i-1,-1,inset),deckEdge(road,i-1,1,inset),deckEdge(road,i,-1,inset),deckEdge(road,i,1,inset)],floorHeights=[deckEdgeElevation(road,i-1,-1),deckEdgeElevation(road,i-1,1),deckEdgeElevation(road,i,-1),deckEdgeElevation(road,i,1)];
        for(const [ia,ib,ic]of [[0,1,2],[1,3,2]]){
          const p=crossSection[ia],q=crossSection[ib],r=crossSection[ic],dx1=q[0]-p[0],dz1=q[1]-p[1],dx2=r[0]-p[0],dz2=r[1]-p[1],dy1=floorHeights[ib]-floorHeights[ia],dy2=floorHeights[ic]-floorHeights[ia],det=dx1*dz2-dx2*dz1;
          if(Math.abs(det)<1e-8)continue;
          const volume:TunnelVolume={road,polygon:[p,q,r],x:p[0],z:p[1],y:floorHeights[ia],gx:(dy1*dz2-dy2*dz1)/det,gz:(dx1*dy2-dx2*dy1)/det,minX:Math.min(p[0],q[0],r[0]),maxX:Math.max(p[0],q[0],r[0]),minZ:Math.min(p[1],q[1],r[1]),maxZ:Math.max(p[1],q[1],r[1])};
          insert(cells,volume,volume.minX,volume.maxX,volume.minZ,volume.maxZ);
        }
      }
      const lo=stations[i-1],hi=stations[i],steps=Math.max(1,Math.ceil((hi-lo)/4)),breaks=[...Array.from({length:steps+1},(_,j)=>lo+(hi-lo)*j/steps),...(road.tunnel.covered??[]).flat().filter(v=>v>lo&&v<hi)].sort((a,b)=>a-b);
      for(let j=1;j<breaks.length;j++){
        const start=breaks[j-1],end=breaks[j];if(end-start<.001)continue;if(tunnelCoveredAt(road,(start+end)/2))continue;
        const leftA=deckEdge(road,i-1,-1,-.3),rightA=deckEdge(road,i-1,1,-.3),leftB=deckEdge(road,i,-1,-.3),rightB=deckEdge(road,i,1,-.3);
        const lerp=(p:Point2,q:Point2,s:number):Point2=>[p[0]+(q[0]-p[0])*(s-lo)/(hi-lo),p[1]+(q[1]-p[1])*(s-lo)/(hi-lo)];
        const quad=[lerp(leftA,leftB,start),lerp(rightA,rightB,start),lerp(rightA,rightB,end),lerp(leftA,leftB,end)];
        const floor=(station:number,side:number)=>deckEdgeElevation(road,i-1,side)+(deckEdgeElevation(road,i,side)-deckEdgeElevation(road,i-1,side))*(station-lo)/(hi-lo);
        const heights=[floor(start,-1),floor(start,1),floor(end,1),floor(end,-1)];
        // An open approach high above ground is a bridge, not an excavation.
        // Clip the opening at its actual grade crossing; short intervals also
        // follow terrain changes beneath the approach instead of cutting a
        // single broad hole under the whole Zakim viaduct.
        const polygon:Point2[]=[];let previous=quad.at(-1)!,dp=(city.elevation?sampleElevation(city as CityData,...previous):0)+.3-heights.at(-1)!;
        for(let k=0;k<quad.length;k++){
          const current=quad[k],dc=(city.elevation?sampleElevation(city as CityData,...current):0)+.3-heights[k];
          if((dp>=0)!==(dc>=0)){const t=dp/(dp-dc);polygon.push([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t]);}
          if(dc>=0)polygon.push(current);previous=current;dp=dc;
        }
        if(polygon.length<3)continue;
        // A road strip is split into convex triangles, including tight bend miters.
        for(let k=1;k<polygon.length-1;k++){
          const polygonPart=[polygon[0],polygon[k],polygon[k+1]];
          const p={polygon:polygonPart,minX:Math.min(...polygonPart.map(p=>p[0])),maxX:Math.max(...polygonPart.map(p=>p[0])),minZ:Math.min(...polygonPart.map(p=>p[1])),maxZ:Math.max(...polygonPart.map(p=>p[1]))};
          insert(portals,p,p.minX,p.maxX,p.minZ,p.maxZ);portalList.push(p);
        }
      }
    }
  }
  const result={roads,portals,portalList,volumes,shellVolumes,wallVolumes,elevation:city.elevation};indexes.set(source,result);return result;
}
function polygonSign(p:Point2[]){let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[1]-b[0]*a[1];}return Math.sign(area)||1;}
function inside(p:Point2,polygon:Point2[]){const sign=polygonSign(polygon);return polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))>=-1e-7;});}
export function hasTunnelPortals(city:TunnelCity){return !!index(city).portalList.length;}
export function tunnelPortalBoundsIntersect(city:TunnelCity,minX:number,maxX:number,minZ:number,maxZ:number){return index(city).portalList.some(p=>p.minX<=maxX&&p.maxX>=minX&&p.minZ<=maxZ&&p.maxZ>=minZ);}
export function inTunnelPortal(city:TunnelCity,x:number,z:number){return (index(city).portals.get(key(x,z))??[]).some(p=>inside([x,z],p.polygon));}

/** Returns only the bore containing the supplied height. Surface roads over a
 * tunnel stay on the surface, while saves, switches and recovery retain depth. */
export function tunnelAt(city:CityData,x:number,z:number,y:number){
  let best:ReturnType<typeof tunnelHit>|undefined;
  function tunnelHit(road:Road){const hit=roadProjection(road,x,z),stations=tunnelStations(road),station=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t,floor=sampleRoadElevation(city,road,x,z);return{road,floor,ceiling:floor+road.tunnel!.clearance,covered:tunnelCoveredAt(road,station),station};}
  for(const road of index(city).roads.get(key(x,z))??[]){
    const hit=roadProjection(road,x,z);if(hit.distance>roadWidthAt(road,x,z)/2+.15)continue;
    const candidate=tunnelHit(road);if(y<candidate.floor-.9||y>candidate.ceiling+.15)continue;
    if(!best||candidate.floor>best.floor)best=candidate;
  }
  return best;
}

function clipHalfPlane(subject:Vertex[],a:Point2,b:Point2,sign:number,keepInside:boolean){
  const result:Vertex[]=[];if(!subject.length)return result;
  const distance=(p:Vertex)=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  let previous=subject[subject.length-1],dp=distance(previous),previousInside=keepInside?dp>=-1e-8:dp<=1e-8;
  for(const current of subject){
    const dc=distance(current),currentInside=keepInside?dc>=-1e-8:dc<=1e-8;
    if(previousInside!==currentInside){const t=dp/(dp-dc);result.push([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t,previous[2]+(current[2]-previous[2])*t]);}
    if(currentInside)result.push(current);previous=current;dp=dc;previousInside=currentInside;
  }
  return result;
}
function polygonArea(p:Vertex[]){let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[2]-b[0]*a[2];}return Math.abs(area)/2;}
function subtract(subject:Vertex[],portal:Portal){
  if(Math.max(...subject.map(p=>p[0]))<=portal.minX+1e-8||Math.min(...subject.map(p=>p[0]))>=portal.maxX-1e-8||Math.max(...subject.map(p=>p[2]))<=portal.minZ+1e-8||Math.min(...subject.map(p=>p[2]))>=portal.maxZ-1e-8)return[subject];
  let remainder=subject;const result:Vertex[][]=[],sign=polygonSign(portal.polygon);
  for(let i=0;i<portal.polygon.length&&remainder.length>=3;i++){
    const a=portal.polygon[i],b=portal.polygon[(i+1)%portal.polygon.length],outside=clipHalfPlane(remainder,a,b,sign,false);
    if(outside.length>=3&&polygonArea(outside)>1e-7)result.push(outside);remainder=clipHalfPlane(remainder,a,b,sign,true);
    if(remainder.length<3||polygonArea(remainder)<1e-7)break;
  }
  return result;
}

/** Exact horizontal portal subtraction; boundary vertices retain interpolated
 * triangle heights. Shared by render and Rapier, so ramps have no grass lid,
 * oversized grid-cell holes or invisible terrain wall at the mouth. */
const clippedMeshes=new WeakMap<Uint32Array,{roads:Road[];elevation?:CityData['elevation'];vertices:Float32Array;result:TunnelMesh}>();
export function clipTunnelPortals(city:TunnelCity,vertices:Float32Array,indices:Uint32Array):TunnelMesh{
  const {portals:cells,portalList}=index(city);if(!portalList.length)return{vertices,indices};
  const cached=clippedMeshes.get(indices);if(cached&&cached.roads===city.roads&&cached.elevation===city.elevation&&cached.vertices===vertices)return cached.result;
  let minMeshX=Infinity,maxMeshX=-Infinity,minMeshZ=Infinity,maxMeshZ=-Infinity;
  for(let i=0;i<vertices.length;i+=3){minMeshX=Math.min(minMeshX,vertices[i]);maxMeshX=Math.max(maxMeshX,vertices[i]);minMeshZ=Math.min(minMeshZ,vertices[i+2]);maxMeshZ=Math.max(maxMeshZ,vertices[i+2]);}
  const relevant=portalList.filter(p=>p.minX<=maxMeshX&&p.maxX>=minMeshX&&p.minZ<=maxMeshZ&&p.maxZ>=minMeshZ);
  if(!relevant.length)return{vertices,indices};
  const minPortalX=Math.min(...relevant.map(p=>p.minX)),maxPortalX=Math.max(...relevant.map(p=>p.maxX)),minPortalZ=Math.min(...relevant.map(p=>p.minZ)),maxPortalZ=Math.max(...relevant.map(p=>p.maxZ));
  let changed=false;const output=Array.from(vertices),triangles:number[]=[];
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3;
    const minX=Math.min(vertices[ia],vertices[ib],vertices[ic]),maxX=Math.max(vertices[ia],vertices[ib],vertices[ic]),minZ=Math.min(vertices[ia+2],vertices[ib+2],vertices[ic+2]),maxZ=Math.max(vertices[ia+2],vertices[ib+2],vertices[ic+2]);
    if(maxX<minPortalX||minX>maxPortalX||maxZ<minPortalZ||minZ>maxPortalZ){triangles.push(indices[i],indices[i+1],indices[i+2]);continue;}
    const candidates=new Set<Portal>();
    for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)for(const p of cells.get(`${x},${z}`)??[])if(p.minX<=maxX&&p.maxX>=minX&&p.minZ<=maxZ&&p.maxZ>=minZ)candidates.add(p);
    if(!candidates.size){triangles.push(indices[i],indices[i+1],indices[i+2]);continue;}
    const original:Vertex[]=[ia,ib,ic].map(n=>[vertices[n],vertices[n+1],vertices[n+2]]);
    let parts=[original];for(const portal of candidates){parts=parts.flatMap(part=>subtract(part,portal));changed=true;}
    for(const polygon of parts)for(let j=1;j<polygon.length-1;j++){
      const a=polygon[0],b=polygon[j],c=polygon[j+1];if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))<1e-7)continue;
      const start=output.length/3;output.push(...a,...b,...c);triangles.push(start,start+1,start+2);
    }
  }
  const result=changed?{vertices:new Float32Array(output),indices:new Uint32Array(triangles)}:{vertices,indices};
  clippedMeshes.set(indices,{roads:city.roads,elevation:city.elevation,vertices,result});
  clippedMeshes.set(result.indices,{roads:city.roads,elevation:city.elevation,vertices:result.vertices,result});
  return result;
}

function clipField(points:Point2[],value:(x:number,z:number)=>number){
  const out:Point2[]=[];if(!points.length)return out;
  let previous=points.at(-1)!,dp=value(...previous);
  for(const current of points){const dc=value(...current);if((dp>=0)!==(dc>=0)){const t=dp/(dp-dc);out.push([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t]);}if(dc>=0)out.push(current);previous=current;dp=dc;}
  return out;
}
/** The lower ceiling ends where a rising branch's interior begins. Otherwise
 * a mainline's complete roof slab would cut across a perfectly open ramp merge. */
function unionRoof(city:CityData,road:Road,mesh:TunnelMesh):TunnelMesh{
  const cells=index(city).shellVolumes,vertices:number[]=[],indices:number[]=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const original:Vertex[]=[0,1,2].map(j=>{const n=mesh.indices[i+j]*3;return[mesh.vertices[n],mesh.vertices[n+1],mesh.vertices[n+2]];});
    const [a,b,c]=original,minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]),minZ=Math.min(a[2],b[2],c[2]),maxZ=Math.max(a[2],b[2],c[2]),candidates=new Set<TunnelVolume>();
    for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)for(const volume of cells.get(`${x},${z}`)??[])if(volume.road!==road&&volume.minX<=maxX&&volume.maxX>=minX&&volume.minZ<=maxZ&&volume.maxZ>=minZ)candidates.add(volume);
    const dx1=b[0]-a[0],dz1=b[2]-a[2],dy1=b[1]-a[1],dx2=c[0]-a[0],dz2=c[2]-a[2],dy2=c[1]-a[1],det=dx1*dz2-dx2*dz1;
    let parts=[original];
    if(Math.abs(det)<1e-8){
      // Slab side faces are narrow; remove only those embedded in the other
      // bore's interior. The exposed exterior edge remains closed.
      const x=(a[0]+b[0]+c[0])/3,y=(a[1]+b[1]+c[1])/3,z=(a[2]+b[2]+c[2])/3;
      if([...candidates].some(v=>{const floor=v.y+v.gx*(x-v.x)+v.gz*(z-v.z);return inside([x,z],v.polygon)&&y>floor+.05&&y<floor+v.road.tunnel!.clearance-.05;}))parts=[];
    }else{
      const gx=(dy1*dz2-dy2*dz1)/det,gz=(dx1*dy2-dx2*dy1)/det;
      for(const v of candidates){
        const difference=(x:number,z:number)=>a[1]+gx*(x-a[0])+gz*(z-a[2])-(v.y+v.gx*(x-v.x)+v.gz*(z-v.z));
        let polygon=clipField(v.polygon,(x,z)=>difference(x,z)-.05);
        polygon=clipField(polygon,(x,z)=>v.road.tunnel!.clearance-.05-difference(x,z));
        if(polygon.length<3)continue;
        const opening={polygon,minX:Math.min(...polygon.map(p=>p[0])),maxX:Math.max(...polygon.map(p=>p[0])),minZ:Math.min(...polygon.map(p=>p[1])),maxZ:Math.max(...polygon.map(p=>p[1]))};
        parts=parts.flatMap(part=>subtract(part,opening));
      }
    }
    for(const part of parts)for(let j=1;j<part.length-1;j++)if(area3([part[0],part[j],part[j+1]])>1e-7){const n=vertices.length/3;vertices.push(...part[0],...part[j],...part[j+1]);indices.push(n,n+1,n+2);}
  }
  return{vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}

function clipPlane3(subject:Vertex[],value:(p:Vertex)=>number,keepInside:boolean){
  const out:Vertex[]=[];if(!subject.length)return out;
  let previous=subject.at(-1)!,dp=value(previous),before=keepInside?dp>=-1e-8:dp<=1e-8;
  for(const current of subject){const dc=value(current),now=keepInside?dc>=-1e-8:dc<=1e-8;if(before!==now){const t=dp/(dp-dc);out.push([previous[0]+(current[0]-previous[0])*t,previous[1]+(current[1]-previous[1])*t,previous[2]+(current[2]-previous[2])*t]);}if(now)out.push(current);previous=current;dp=dc;before=now;}
  return out;
}
function area3(p:Vertex[]){
  if(p.length<3)return 0;const a=p[0];let x=0,y=0,z=0;
  for(let i=1;i<p.length-1;i++){const b=p[i],c=p[i+1],bx=b[0]-a[0],by=b[1]-a[1],bz=b[2]-a[2],cx=c[0]-a[0],cy=c[1]-a[1],cz=c[2]-a[2];x+=by*cz-bz*cy;y+=bz*cx-bx*cz;z+=bx*cy-by*cx;}
  return Math.hypot(x,y,z)/2;
}
function subtractVolume(subject:Vertex[],volume:TunnelVolume,floorMargin=.5,roofMargin=.45){
  if(Math.max(...subject.map(p=>p[0]))<volume.minX-1e-7||Math.min(...subject.map(p=>p[0]))>volume.maxX+1e-7||Math.max(...subject.map(p=>p[2]))<volume.minZ-1e-7||Math.min(...subject.map(p=>p[2]))>volume.maxZ+1e-7)return[subject];
  const sign=polygonSign(volume.polygon),planes:((p:Vertex)=>number)[]=volume.polygon.map((a,i)=>{const b=volume.polygon[(i+1)%volume.polygon.length];return p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]));});
  const floor=(p:Vertex)=>volume.y+volume.gx*(p[0]-volume.x)+volume.gz*(p[2]-volume.z);
  planes.push(p=>p[1]-floor(p)+floorMargin,p=>floor(p)+volume.road.tunnel!.clearance+roofMargin-p[1]);
  if(planes.some(plane=>subject.every(p=>plane(p)<-1e-7)))return[subject];
  let remainder=subject;const result:Vertex[][]=[];
  for(const plane of planes){const outside=clipPlane3(remainder,plane,false);if(area3(outside)>1e-7)result.push(outside);remainder=clipPlane3(remainder,plane,true);if(area3(remainder)<1e-7)break;}
  return result;
}
/** Finite 3D clearance subtraction for an explicitly selected surveyed shell
 * whose catalog datum closes a mapped tunnel. Callers choose the building;
 * this never globally hides buildings or clips anything above the bore roof.
 * The aperture includes .4m per side, .5m below floor and .45m over ceiling,
 * enough to meet the shared concrete lining without exposing triangle edges. */
export function clipTunnelClearance(city:CityData,vertices:Float32Array,indices:Uint32Array):TunnelMesh{
  const cells=index(city).volumes;if(!cells.size)return{vertices,indices};
  const output=Array.from(vertices),triangles:number[]=[];let changed=false;
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3,ib=indices[i+1]*3,ic=indices[i+2]*3,minX=Math.min(vertices[ia],vertices[ib],vertices[ic]),maxX=Math.max(vertices[ia],vertices[ib],vertices[ic]),minZ=Math.min(vertices[ia+2],vertices[ib+2],vertices[ic+2]),maxZ=Math.max(vertices[ia+2],vertices[ib+2],vertices[ic+2]),candidates=new Set<TunnelVolume>();
    for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)for(const v of cells.get(`${x},${z}`)??[])if(v.minX<=maxX&&v.maxX>=minX&&v.minZ<=maxZ&&v.maxZ>=minZ)candidates.add(v);
    if(!candidates.size){triangles.push(indices[i],indices[i+1],indices[i+2]);continue;}
    const original:Vertex[]=[ia,ib,ic].map(n=>[vertices[n],vertices[n+1],vertices[n+2]]);let parts:Vertex[][]=[original];
    for(const volume of candidates)parts=parts.flatMap(part=>subtractVolume(part,volume));
    if(parts.length===1&&parts[0]===original){triangles.push(indices[i],indices[i+1],indices[i+2]);continue;}
    changed=true;
    for(const part of parts)for(let j=1;j<part.length-1;j++)if(area3([part[0],part[j],part[j+1]])>1e-7){const n=output.length/3;output.push(...part[0],...part[j],...part[j+1]);triangles.push(n,n+1,n+2);}
  }
  return changed?{vertices:new Float32Array(output),indices:new Uint32Array(triangles)}:{vertices,indices};
}

function meshBuilder(){
  const vertices:number[]=[],indices:number[]=[];
  return{triangle(a:Vertex,b:Vertex,c:Vertex){const n=vertices.length/3;vertices.push(...a,...b,...c);indices.push(n,n+1,n+2);},quad(a:Vertex,b:Vertex,c:Vertex,d:Vertex){const n=vertices.length/3;vertices.push(...a,...b,...c,...d);indices.push(n,n+1,n+2,n,n+2,n+3);},append(mesh:TunnelMesh){const n=vertices.length/3;vertices.push(...mesh.vertices);for(const i of mesh.indices)indices.push(i+n);},result:()=>({vertices:new Float32Array(vertices),indices:new Uint32Array(indices)})};
}
function box(builder:ReturnType<typeof meshBuilder>,a:Point2,b:Point2,lowA:number,lowB:number,highA:number,highB:number,width:number){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1,nx=-dz/length*width/2,nz=dx/length*width/2;
  const p:Vertex[]=[[a[0]-nx,lowA,a[1]-nz],[b[0]-nx,lowB,b[1]-nz],[b[0]-nx,highB,b[1]-nz],[a[0]-nx,highA,a[1]-nz],[a[0]+nx,lowA,a[1]+nz],[b[0]+nx,lowB,b[1]+nz],[b[0]+nx,highB,b[1]+nz],[a[0]+nx,highA,a[1]+nz]];
  for(const [a,b,c,d]of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])builder.quad(p[a],p[b],p[c],p[d]);
}
function tunnelEdgeAt(road:Road,station:number,side:number){
  const stations=tunnelStations(road);let i=1;while(i<stations.length-1&&stations[i]<station)i++;
  const t=(station-stations[i-1])/(stations[i]-stations[i-1]||1),a=deckEdge(road,i-1,side),b=deckEdge(road,i,side);
  return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,y:deckEdgeElevation(road,i-1,side)+(deckEdgeElevation(road,i,side)-deckEdgeElevation(road,i-1,side))*t};
}
function sliceStations(road:Road,start:number,end:number){return[start,...tunnelStations(road).filter(s=>s>start+.001&&s<end-.001),end];}
function sliceRoad(road:Road,start:number,end:number):Road{
  const samples=sliceStations(road,start,end),at=samples.map(s=>tunnelPointAt(road,s)),edges=samples.map(s=>[tunnelEdgeAt(road,s,-1),tunnelEdgeAt(road,s,1)]),direction=(i:number):Point2=>[edges[i][1].z-edges[i][0].z,edges[i][0].x-edges[i][1].x];
  return{...road,points:at.map(p=>[p.x,p.z]),elevations:at.map(p=>p.y),deckEdgeElevations:edges.map(([a,b])=>[a.y,b.y]),deckWidths:edges.map(([a,b])=>Math.hypot(a.x-b.x,a.z-b.z)),deckTangents:{start:direction(0),end:direction(edges.length-1)}};
}
function roofSlab(city:CityData,road:Road,start:number,end:number){
  const section=sliceRoad(road,start,end),rise=road.tunnel!.clearance+.45,samples=sliceStations(road,start,end);
  section.elevations=section.elevations!.map(y=>y+rise);section.deckEdgeElevations=section.deckEdgeElevations!.map(([a,b])=>[a+rise,b+rise]);section.bridge={id:'tunnel-roof',thickness:.45,clearanceEstimated:true};
  const mesh=roadSlabGeometry(city,section),count=samples.length*2;
  // Splitting a curved road must retain the original ribbon edges. Recomputing
  // neighbor-averaged tangents on the shorter slice shifts the first inner bend.
  for(let i=0;i<samples.length;i++)for(const side of [-1,1]){
    const p=tunnelEdgeAt(road,samples[i],side),n=i*2+(side<0?0:1);
    for(const offset of [n,count+n]){mesh.vertices[offset*3]=p.x;mesh.vertices[offset*3+2]=p.z;}
  }
  return mesh;
}
/** Subtract only the other bore's interior, rather than dropping a complete
 * wall whenever the two floors are within one clearance of one another. The
 * remaining upper wall seals different-height roofs and retains the railing
 * above an open excavation beside a surface entrance. */
function unionWalls(city:CityData,road:Road,mesh:TunnelMesh):TunnelMesh{
  const cells=index(city).wallVolumes,output=meshBuilder();
  for(let i=0;i<mesh.indices.length;i+=3){
    const triangle:Vertex[]=[0,1,2].map(j=>{const n=mesh.indices[i+j]*3;return[mesh.vertices[n],mesh.vertices[n+1],mesh.vertices[n+2]];});
    const minX=Math.min(...triangle.map(p=>p[0])),maxX=Math.max(...triangle.map(p=>p[0])),minZ=Math.min(...triangle.map(p=>p[2])),maxZ=Math.max(...triangle.map(p=>p[2])),candidates=new Set<TunnelVolume>();
    for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)for(const v of cells.get(`${x},${z}`)??[])if(v.road!==road&&v.minX<=maxX&&v.maxX>=minX&&v.minZ<=maxZ&&v.maxZ>=minZ)candidates.add(v);
    let parts=[triangle];for(const volume of candidates)parts=parts.flatMap(part=>subtractVolume(part,volume,.3,0));
    for(const part of parts)for(let j=1;j<part.length-1;j++)if(area3([part[0],part[j],part[j+1]])>1e-7)output.triangle(part[0],part[j],part[j+1]);
  }
  return output.result();
}
/** Collision and visual shell share identical walls, covered ceiling slabs,
 * guarded portal headers, terminal Jersey barriers and sealed black backwalls. */
export function tunnelGeometry(city:CityData,road:Road){
  const walls=meshBuilder(),roof=meshBuilder(),barriers=meshBuilder(),headers=meshBuilder(),caps=meshBuilder();
  if(!road.tunnel||!road.elevations)return{walls:walls.result(),roof:roof.result(),barriers:barriers.result(),caps:caps.result()};
  const clearance=road.tunnel.clearance,stations=tunnelStations(road),total=stations.at(-1)!;
  const surfaceTerminal=(s:number)=>{const p=tunnelPointAt(road,s);return !tunnelCoveredAt(road,s)&&Math.abs(p.y-sampleElevation(city,p.x,p.z))<.6;};
  const openStart=!road.tunnel.capStart&&surfaceTerminal(0),openEnd=!road.tunnel.capEnd&&surfaceTerminal(total);
  for(let i=1;i<road.points.length;i++)for(const side of [-1,1]){
    const start=deckEdge(road,i-1,side,-.08),end=deckEdge(road,i,side,-.08),ya=deckEdgeElevation(road,i-1,side),yb=deckEdgeElevation(road,i,side),lo=stations[i-1],hi=stations[i];
    const steps=Math.max(1,Math.ceil((hi-lo)/4)),breaks=[...Array.from({length:steps+1},(_,j)=>lo+(hi-lo)*j/steps),...(road.tunnel.covered??[]).flat().filter(s=>s>lo&&s<hi)].sort((a,b)=>a-b);
    for(let j=1;j<breaks.length;j++){
      const covered=tunnelCoveredAt(road,(breaks[j-1]+breaks[j])/2),at=(s:number)=>{
        const t=(s-lo)/(hi-lo),x=start[0]+(end[0]-start[0])*t,z=start[1]+(end[1]-start[1])*t,y=ya+(yb-ya)*t,ground=sampleElevation(city,x,z);
        let top=covered?y+clearance+.45:Math.max(y+.8,ground+.8);
        const terminal=Math.min(openStart?s:Infinity,openEnd?total-s:Infinity),outsideA=deckEdge(road,i-1,side,-.7),outsideB=deckEdge(road,i,side,-.7);
        const outsideX=outsideA[0]+(outsideB[0]-outsideA[0])*t,outsideZ=outsideA[1]+(outsideB[1]-outsideA[1])*t;
        // Surface streets meet these source endpoints at an angle. Lower the
        // last few metres of parapet into a curb only where ground exists on
        // the other side; keep the full guard beside another deep excavation.
        if(!covered&&terminal<12&&Math.abs(y-ground)<.4&&!inTunnelPortal(city,outsideX,outsideZ))top=y+.08+.72*Math.min(1,terminal/12);
        return{x,z,y,top};
      };
      const a=at(breaks[j-1]),b=at(breaks[j]);if(breaks[j]-breaks[j-1]>.001)box(walls,[a.x,a.z],[b.x,b.z],a.y-.3,b.y-.3,a.top,b.top,.4);
    }
  }
  for(const [lo,hi]of road.tunnel.covered??[[0,total]]){
    const a=Math.max(0,lo),b=Math.min(total,hi);if(b-a<.01)continue;
    roof.append(unionRoof(city,road,roofSlab(city,road,a,b)));
    // A portal below surface grade needs a retaining face above its roof and
    // a surface-height parapet across the back of the excavation. Its bottom
    // starts at the ceiling, so the full driving opening remains unobstructed.
    for(const s of [a,b]){
      if(s<.01||s>total-.01)continue;
      const slice=sliceRoad(road,s,Math.min(total,s+.01)),left=deckEdge(slice,0,-1,-.3),right=deckEdge(slice,0,1,-.3),yl=deckEdgeElevation(slice,0,-1)+clearance,yr=deckEdgeElevation(slice,0,1)+clearance;
      const topL=sampleElevation(city,...left)+.8,topR=sampleElevation(city,...right)+.8;
      if(topL>yl+.1&&topR>yr+.1)box(headers,left,right,yl,yr,topL,topR,.65);
    }
  }
  barriers.append(unionWalls(city,road,headers.result()));
  for(const atStart of [true,false]){
    if(!(atStart?road.tunnel.capStart:road.tunnel.capEnd))continue;
    const p=tunnelPointAt(road,atStart?Math.min(5,total/2):Math.max(0,total-5)),nx=Math.cos(p.yaw),nz=-Math.sin(p.yaw);
    box(barriers,[p.x-nx*p.width/2,p.z-nz*p.width/2],[p.x+nx*p.width/2,p.z+nz*p.width/2],p.y,p.y,p.y+1.25,p.y+1.25,1.15);
    const c=tunnelPointAt(road,atStart?0:total),cx=Math.cos(c.yaw),cz=-Math.sin(c.yaw);
    box(caps,[c.x-cx*c.width/2,c.z-cz*c.width/2],[c.x+cx*c.width/2,c.z+cz*c.width/2],c.y-.3,c.y-.3,c.y+clearance+.45,c.y+clearance+.45,.6);
  }
  return{walls:unionWalls(city,road,walls.result()),roof:roof.result(),barriers:barriers.result(),caps:caps.result()};
}
