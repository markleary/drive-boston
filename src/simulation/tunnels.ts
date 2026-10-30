import type {CityData,Point2,Road} from '../types';
import {bridgeEdgeSections,deckEdge,roadProjection,roadSlabGeometry,roadWidthAt,sampleRoadElevation} from './road-surfaces.ts';
import {sampleElevation,terrainGrid} from './terrain.ts';

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
/** Street-centerline junctions need an intact, wall-free surface landing. */
export function tunnelSurfaceLandingAt(road:Road,station:number){return !!road.tunnel?.surfaceLandings?.some(([a,b])=>station>=a-.001&&station<=b+.001);}
export function tunnelPointAt(road:Road,station:number){
  const distances=tunnelStations(road);let i=1;while(i<distances.length-1&&distances[i]<station)i++;
  const a=road.points[i-1],b=road.points[i],t=Math.max(0,Math.min(1,(station-distances[i-1])/(distances[i]-distances[i-1]||1)));
  const wa=road.deckWidths?.[i-1]??road.width,wb=road.deckWidths?.[i]??road.width;
  return{x:a[0]+(b[0]-a[0])*t,y:(road.elevations?.[i-1]??0)+((road.elevations?.[i]??0)-(road.elevations?.[i-1]??0))*t,z:a[1]+(b[1]-a[1])*t,yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),width:wa+(wb-wa)*t};
}

type Portal={polygon:Point2[];minX:number;maxX:number;minZ:number;maxZ:number};
type TunnelVolume=Portal&{road:Road;x:number;z:number;y:number;gx:number;gz:number};
type TunnelCity=Pick<CityData,'roads'>&Partial<Pick<CityData,'bounds'|'elevation'>>;
type TunnelIndex={roads:Map<string,Road[]>;portals:Map<string,Portal[]>;portalList:Portal[];volumes:Map<string,TunnelVolume[]>;elevation?:CityData['elevation']};
const emptyRoads:Road[]=[];
const indexes=new WeakMap<Road[],TunnelIndex>();
const key=(x:number,z:number)=>`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;
/** Intersect the approach with the actual terrain triangles before testing
 * grade. Corner samples alone miss a crest inside the ramp ribbon and leave
 * a physical wedge under one wheel, especially beside graded surface roads. */
function gradeOpenings(city:TunnelCity,quad:Point2[],heights:number[]){
  const grid=terrainGrid(city as CityData),groundTriangles:Vertex[][]=[];
  if(grid){
    const {originX,originZ,cellSize:cs,width,height,heights:h}=grid;
    const x0=Math.max(0,Math.floor((Math.min(...quad.map(p=>p[0]))-originX)/cs)),x1=Math.min(width-2,Math.floor((Math.max(...quad.map(p=>p[0]))-originX)/cs));
    const z0=Math.max(0,Math.floor((Math.min(...quad.map(p=>p[1]))-originZ)/cs)),z1=Math.min(height-2,Math.floor((Math.max(...quad.map(p=>p[1]))-originZ)/cs));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const at=(i:number,j:number):Vertex=>[originX+i*cs,h[j*width+i],originZ+j*cs],a=at(x,z),b=at(x+1,z),c=at(x,z+1),d=at(x+1,z+1);
      groundTriangles.push([a,c,b],[b,c,d]);
    }
  }
  const plane=([a,b,c]:Vertex[])=>{
    const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2],det=dx*ez-dz*ex;
    const gx=((b[1]-a[1])*ez-(c[1]-a[1])*dz)/det,gz=(dx*(c[1]-a[1])-ex*(b[1]-a[1]))/det;
    return(x:number,z:number)=>a[1]+gx*(x-a[0])+gz*(z-a[2]);
  };
  const result:Point2[][]=[];
  for(const ids of [[0,1,2],[0,2,3]]){
    const triangle=ids.map(i=>quad[i]),floor=plane(ids.map(i=>[quad[i][0],heights[i],quad[i][1]]));
    if(!grid){const p=clipField(triangle,(x,z)=>.3-floor(x,z));if(p.length>=3)result.push(p);continue;}
    for(const ground of groundTriangles){
      const footprint=ground.map(p=>[p[0],p[2]] as Point2),sign=polygonSign(footprint);let polygon=triangle;
      for(let i=0;i<3&&polygon.length>=3;i++){const a=footprint[i],b=footprint[(i+1)%3];polygon=clipField(polygon,(x,z)=>sign*((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])));}
      if(polygon.length<3)continue;const surface=plane(ground);polygon=clipField(polygon,(x,z)=>surface(x,z)+.3-floor(x,z));
      if(polygon.length>=3&&polygonArea(polygon.map(([x,z])=>[x,0,z]))>1e-7)result.push(polygon);
    }
  }
  return result;
}
function index(city:TunnelCity){
  const source=city.roads??emptyRoads,cached=indexes.get(source);if(cached&&cached.elevation===city.elevation)return cached;
  const roads=new Map<string,Road[]>(),portals=new Map<string,Portal[]>(),portalList:Portal[]=[],volumes=new Map<string,TunnelVolume[]>();
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
      const crossSection=[deckEdge(road,i-1,-1,-.4),deckEdge(road,i-1,1,-.4),deckEdge(road,i,1,-.4),deckEdge(road,i,-1,-.4)],floorHeights=[road.elevations[i-1],road.elevations[i-1],road.elevations[i],road.elevations[i]];
      for(const [ia,ib,ic]of [[0,1,2],[0,2,3]]){
        const p=crossSection[ia],q=crossSection[ib],r=crossSection[ic],dx1=q[0]-p[0],dz1=q[1]-p[1],dx2=r[0]-p[0],dz2=r[1]-p[1],dy1=floorHeights[ib]-floorHeights[ia],dy2=floorHeights[ic]-floorHeights[ia],det=dx1*dz2-dx2*dz1;
        if(Math.abs(det)<1e-8)continue;
        const volume:TunnelVolume={road,polygon:[p,q,r],x:p[0],z:p[1],y:floorHeights[ia],gx:(dy1*dz2-dy2*dz1)/det,gz:(dx1*dy2-dx2*dy1)/det,minX:Math.min(p[0],q[0],r[0]),maxX:Math.max(p[0],q[0],r[0]),minZ:Math.min(p[1],q[1],r[1]),maxZ:Math.max(p[1],q[1],r[1])};
        insert(volumes,volume,volume.minX,volume.maxX,volume.minZ,volume.maxZ);
      }
      const lo=stations[i-1],hi=stations[i],steps=Math.max(1,Math.ceil((hi-lo)/4)),breaks=[...Array.from({length:steps+1},(_,j)=>lo+(hi-lo)*j/steps),...[...(road.tunnel.covered??[]),...(road.tunnel.surfaceLandings??[])].flat().filter(v=>v>lo&&v<hi)].sort((a,b)=>a-b);
      for(let j=1;j<breaks.length;j++){
        const start=breaks[j-1],end=breaks[j];if(end-start<.001)continue;if(tunnelCoveredAt(road,(start+end)/2)||tunnelSurfaceLandingAt(road,(start+end)/2))continue;
        const leftA=deckEdge(road,i-1,-1,-.3),rightA=deckEdge(road,i-1,1,-.3),leftB=deckEdge(road,i,-1,-.3),rightB=deckEdge(road,i,1,-.3);
        const lerp=(p:Point2,q:Point2,s:number):Point2=>[p[0]+(q[0]-p[0])*(s-lo)/(hi-lo),p[1]+(q[1]-p[1])*(s-lo)/(hi-lo)];
        const quad=[lerp(leftA,leftB,start),lerp(rightA,rightB,start),lerp(rightA,rightB,end),lerp(leftA,leftB,end)];
        const floor=(station:number)=>road.elevations![i-1]+(road.elevations![i]-road.elevations![i-1])*(station-lo)/(hi-lo);
        const heights=[floor(start),floor(start),floor(end),floor(end)];
        // Elevated viaduct portions leave the street below intact.
        for(const polygon of gradeOpenings(city,quad,heights)){
          // Split the convex intersection into the indexed portal triangles.
          for(let k=1;k<polygon.length-1;k++){
            const polygonPart=[polygon[0],polygon[k],polygon[k+1]];
            const [a,b,c]=polygonPart;if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-7)continue;
            const p={polygon:polygonPart,minX:Math.min(...polygonPart.map(p=>p[0])),maxX:Math.max(...polygonPart.map(p=>p[0])),minZ:Math.min(...polygonPart.map(p=>p[1])),maxZ:Math.max(...polygonPart.map(p=>p[1]))};
            insert(portals,p,p.minX,p.maxX,p.minZ,p.maxZ);portalList.push(p);
          }
        }
      }
    }
  }
  const result={roads,portals,portalList,volumes,elevation:city.elevation};indexes.set(source,result);return result;
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

/** Keep surface decoration out of excavations and level ramp landings, with
 * clearance for trunks/posts. Intact ground over a covered bore stays usable. */
export function inTunnelApproach(city:CityData,x:number,z:number){
  if(inTunnelPortal(city,x,z))return true;
  const ground=sampleElevation(city,x,z);
  for(const road of index(city).roads.get(key(x,z))??[]){
    const hit=roadProjection(road,x,z);if(hit.distance>roadWidthAt(road,x,z)/2+.8)continue;
    const stations=tunnelStations(road),station=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t,floor=sampleRoadElevation(city,road,x,z);
    if(!tunnelCoveredAt(road,station)&&floor<=ground+.8&&floor+road.tunnel!.clearance>=ground-.2)return true;
  }
  return false;
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
  const cells=index(city).volumes,vertices:number[]=[],indices:number[]=[];
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
function subtractVolume(subject:Vertex[],volume:TunnelVolume){
  if(Math.max(...subject.map(p=>p[0]))<volume.minX-1e-7||Math.min(...subject.map(p=>p[0]))>volume.maxX+1e-7||Math.max(...subject.map(p=>p[2]))<volume.minZ-1e-7||Math.min(...subject.map(p=>p[2]))>volume.maxZ+1e-7)return[subject];
  const sign=polygonSign(volume.polygon),planes:((p:Vertex)=>number)[]=volume.polygon.map((a,i)=>{const b=volume.polygon[(i+1)%volume.polygon.length];return p=>sign*((b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]));});
  const floor=(p:Vertex)=>volume.y+volume.gx*(p[0]-volume.x)+volume.gz*(p[2]-volume.z);
  planes.push(p=>p[1]-floor(p)+.5,p=>floor(p)+volume.road.tunnel!.clearance+.45-p[1]);
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
  return{quad(a:Vertex,b:Vertex,c:Vertex,d:Vertex){const n=vertices.length/3;vertices.push(...a,...b,...c,...d);indices.push(n,n+1,n+2,n,n+2,n+3);},append(mesh:TunnelMesh){const n=vertices.length/3;vertices.push(...mesh.vertices);for(const i of mesh.indices)indices.push(i+n);},result:()=>({vertices:new Float32Array(vertices),indices:new Uint32Array(indices)})};
}
function box(builder:ReturnType<typeof meshBuilder>,a:Point2,b:Point2,lowA:number,lowB:number,highA:number,highB:number,width:number){
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1,nx=-dz/length*width/2,nz=dx/length*width/2;
  const p:Vertex[]=[[a[0]-nx,lowA,a[1]-nz],[b[0]-nx,lowB,b[1]-nz],[b[0]-nx,highB,b[1]-nz],[a[0]-nx,highA,a[1]-nz],[a[0]+nx,lowA,a[1]+nz],[b[0]+nx,lowB,b[1]+nz],[b[0]+nx,highB,b[1]+nz],[a[0]+nx,highA,a[1]+nz]];
  for(const [a,b,c,d]of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])builder.quad(p[a],p[b],p[c],p[d]);
}
function sliceRoad(road:Road,start:number,end:number):Road{
  const stations=tunnelStations(road),at=[start,...stations.filter(s=>s>start+.001&&s<end-.001),end].map(s=>tunnelPointAt(road,s));
  return{...road,points:at.map(p=>[p.x,p.z]),elevations:at.map(p=>p.y),deckWidths:at.map(p=>p.width),deckTangents:undefined};
}
/** Collision and visual shell share identical walls, covered ceiling slabs,
 * terminal Jersey barriers and sealed black backwalls. Branch openings reuse
 * the road union's exposed perimeter, leaving ramp merges fully drivable. */
const tunnelViews=new WeakMap<Road[],CityData>();
function tunnelView(city:CityData){let view=tunnelViews.get(city.roads);if(!view){view={...city,roads:city.roads.filter(r=>r.tunnel)};tunnelViews.set(city.roads,view);}return view;}
export function tunnelGeometry(city:CityData,road:Road){
  const walls=meshBuilder(),roof=meshBuilder(),barriers=meshBuilder(),caps=meshBuilder();
  if(!road.tunnel||!road.elevations)return{walls:walls.result(),roof:roof.result(),barriers:barriers.result(),caps:caps.result()};
  const clearance=road.tunnel.clearance,stations=tunnelStations(road),total=stations.at(-1)!;
  for(const edge of bridgeEdgeSections(tunnelView(city),road,-.08,-.25,clearance+.4)){
    const length=Math.hypot(edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]),steps=Math.max(1,Math.ceil(length/4));
    const at=(t:number)=>{const x=edge.a[0]+(edge.b[0]-edge.a[0])*t,z=edge.a[1]+(edge.b[1]-edge.a[1])*t,y=edge.ya+(edge.yb-edge.ya)*t,hit=roadProjection(road,x,z),s=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t;return{x,z,y,s,top:tunnelCoveredAt(road,s)?y+clearance+.45:Math.max(y+.8,sampleElevation(city,x,z)+.5)};};
    const start=at(0).s,end=at(1).s,breaks=[...Array.from({length:steps+1},(_,i)=>i/steps),...(road.tunnel.surfaceLandings??[]).flat().map(s=>(s-start)/(end-start)).filter(t=>t>0&&t<1)].sort((a,b)=>a-b);
    for(let i=1;i<breaks.length;i++){
      if(tunnelSurfaceLandingAt(road,at((breaks[i-1]+breaks[i])/2).s))continue;
      const a=at(breaks[i-1]),b=at(breaks[i]);box(walls,[a.x,a.z],[b.x,b.z],a.y-.3,b.y-.3,a.top,b.top,.4);
    }
  }
  for(const [lo,hi]of road.tunnel.covered??[[0,total]]){
    const a=Math.max(0,lo),b=Math.min(total,hi);if(b-a<.01)continue;
    const section=sliceRoad(road,a,b);section.elevations=section.elevations!.map(y=>y+clearance+.45);section.bridge={id:'tunnel-roof',thickness:.45,clearanceEstimated:true};roof.append(unionRoof(city,road,roadSlabGeometry(city,section)));
  }
  for(const atStart of [true,false]){
    if(!(atStart?road.tunnel.capStart:road.tunnel.capEnd))continue;
    const p=tunnelPointAt(road,atStart?Math.min(5,total/2):Math.max(0,total-5)),nx=Math.cos(p.yaw),nz=-Math.sin(p.yaw);
    box(barriers,[p.x-nx*p.width/2,p.z-nz*p.width/2],[p.x+nx*p.width/2,p.z+nz*p.width/2],p.y,p.y,p.y+1.25,p.y+1.25,1.15);
    const c=tunnelPointAt(road,atStart?0:total),cx=Math.cos(c.yaw),cz=-Math.sin(c.yaw);
    box(caps,[c.x-cx*c.width/2,c.z-cz*c.width/2],[c.x+cx*c.width/2,c.z+cz*c.width/2],c.y-.3,c.y-.3,c.y+clearance+.45,c.y+clearance+.45,.6);
  }
  return{walls:walls.result(),roof:roof.result(),barriers:barriers.result(),caps:caps.result()};
}
