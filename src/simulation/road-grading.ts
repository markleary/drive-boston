import type {CityData,Point2,Road} from '../types';

export interface RoadGradingStats {
  roads:number; changedVertices:number; maxCut:number; maxFill:number; elapsedMs:number;
}
const prepared=new WeakMap<CityData,RoadGradingStats>();
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(t:number)=>{t=clamp(t,0,1);return t*t*(3-2*t);};
type Profile={road:Road;points:Point2[];stations:number[];heights:number[];length:number;start:Node;end:Node};
type Node={x:number;z:number;height:number;ends:{profile:Profile;reverse:boolean}[];pinned:boolean};

/** A one-time roadbed correction of a cloned DEM. All terrain queries, rendered
 * triangles, sidewalks and Rapier continue to consume the same regular grid.
 * This is a game approximation; the original elevation source is untouched. */
export function prepareRoadTerrain(city:CityData):RoadGradingStats{
  const previous=prepared.get(city);if(previous)return previous;
  const began=performance.now(),grid=city.elevation;
  const stats:RoadGradingStats={roads:0,changedVertices:0,maxCut:0,maxFill:0,elapsedMs:0};
  if(!grid||!city.roads?.length){prepared.set(city,stats);return stats;}
  const raw=grid.heights;
  const sample=(x:number,z:number)=>{
    const fx=clamp((x-grid.originX)/grid.cellSize,0,grid.width-1),fz=clamp((z-grid.originZ)/grid.cellSize,0,grid.height-1);
    const i=Math.min(grid.width-2,Math.floor(fx)),j=Math.min(grid.height-2,Math.floor(fz)),tx=fx-i,tz=fz-j,k=j*grid.width+i;
    const a=raw[k],b=raw[k+1],c=raw[k+grid.width],d=raw[k+grid.width+1];
    return tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
  };
  const nodes=new Map<string,Node>(),profiles:Profile[]=[];
  const node=(point:Point2)=>{
    const key=`${Math.round(point[0]*10)},${Math.round(point[1]*10)}`;
    let n=nodes.get(key);if(!n){n={x:point[0],z:point[1],height:sample(...point),ends:[],pinned:false};nodes.set(key,n);}return n;
  };
  for(const road of city.roads){
    if(road.elevations||road.points.length<2)continue;
    const points:Point2[]=[road.points[0]],stations=[0];let length=0;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.max(1,Math.ceil(distance/4));
      if(distance<.01)continue;
      for(let j=1;j<=count;j++){points.push([a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count]);stations.push(length+distance*j/count);}length+=distance;
    }
    if(length<1)continue;
    const profile:Profile={road,points,stations,heights:points.map(p=>sample(...p)),length,start:node(points[0]),end:node(points.at(-1)!)};
    profile.start.ends.push({profile,reverse:false});profile.end.ends.push({profile,reverse:true});profiles.push(profile);
  }
  // A bridge endpoint at ground level is a hard datum, not a second ordinary
  // road to flatten into the lower surface. Keep the two structure levels apart.
  for(const road of city.roads){if(!road.elevations)continue;
    for(const [i,level]of [[0,road.startLevel],[road.points.length-1,road.endLevel]]){
      if(level!==0)continue;const n=node(road.points[i!]);n.height=road.elevations[i!];n.pinned=true;
    }
  }
  // Shared junction anchors use local centerline samples. Median filtering
  // rejects a single DEM pit without importing banks beside the street.
  for(const n of nodes.values())if(!n.pinned&&n.ends.length>1){
    const values=[n.height,n.height];
    for(const {profile:p,reverse}of n.ends){
      const hs=p.heights,ss=p.stations;
      for(let i=0;i<ss.length;i++){const d=reverse?p.length-ss[i]:ss[i];if(d>=5&&d<=12)values.push(hs[i]);}
    }
    values.sort((a,b)=>a-b);n.height=values[Math.floor(values.length/2)];
  }
  // Short source links can span a DEM edge. Reconcile their shared anchors
  // across the graph before interpolation, instead of introducing a local ramp.
  for(let pass=0;pass<12;pass++)for(const p of profiles){
    const delta=p.end.height-p.start.height,limit=p.length*.2;
    if(Math.abs(delta)<=limit||p.start.pinned&&p.end.pinned)continue;
    const excess=(Math.abs(delta)-limit)*Math.sign(delta);
    if(p.start.pinned)p.end.height-=excess;
    else if(p.end.pinned)p.start.height+=excess;
    else{p.start.height+=excess/2;p.end.height-=excess/2;}
  }
  for(const p of profiles){
    const source=p.heights,filtered=source.map((_,i)=>{
      let sum=0,weight=0;
      for(let j=Math.max(0,i-10);j<Math.min(source.length,i+11);j++){
        const distance=Math.abs(p.stations[j]-p.stations[i]);if(distance>20)continue;
        const w=Math.exp(-distance*distance/100);sum+=source[j]*w;weight+=w;
      }
      return sum/weight;
    });
    const startCorrection=p.start.height-filtered[0],endCorrection=p.end.height-filtered.at(-1)!;
    const meanGrade=Math.abs(p.end.height-p.start.height)/p.length;
    p.heights=filtered.map((h,i)=>{
      const s=p.stations[i],t=s/p.length;
      const corrected=h+startCorrection*(1-t)+endCorrection*t;
      // Broadly sloping streets retain their measured climb. Level junction
      // approaches only on gentle streets, where a plateau will not concentrate
      // a whole hill's descent into a short, unnaturally steep middle section.
      const reach=meanGrade<.04?Math.min(14,p.length*.24):0;
      const a=p.start.ends.length>2&&reach?1-smooth(s/reach):0;
      const b=p.end.ends.length>2&&reach?1-smooth((p.length-s)/reach):0;
      return corrected*(1-a-b)+p.start.height*a+p.end.height*b;
    });
    // Limit local dips in the smoothed centerline while retaining shared ends.
    for(let pass=0;pass<10;pass++){
      for(let i=1;i<p.heights.length-1;i++){const limit=(p.stations[i]-p.stations[i-1])*.2;p.heights[i]=clamp(p.heights[i],p.heights[i-1]-limit,p.heights[i-1]+limit);}
      for(let i=p.heights.length-2;i>0;i--){const limit=(p.stations[i+1]-p.stations[i])*.2;p.heights[i]=clamp(p.heights[i],p.heights[i+1]-limit,p.heights[i+1]+limit);}
    }
  }
  const count=raw.length,heights=Array.from(raw),best=new Float32Array(count);best.fill(Infinity);
  const roadDistance=new Float32Array(count);roadDistance.fill(Infinity);
  const weighted=new Float64Array(count),weights=new Float64Array(count),influence=new Float32Array(count);
  // Grade only the pavement and a short blending shoulder. A wide flat apron
  // would cut into sloping yards and raise ground through surveyed houses; the
  // triangle constraints below handle cells straddling an oblique road edge.
  for(const p of profiles){
    const core=p.road.width/2+.5,shoulder=6,radius=core+shoulder;
    for(let i=1;i<p.points.length;i++){
      const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
      if(length2<.001)continue;
      const ix0=clamp(Math.floor((Math.min(a[0],b[0])-radius-grid.originX)/grid.cellSize),0,grid.width-1),ix1=clamp(Math.ceil((Math.max(a[0],b[0])+radius-grid.originX)/grid.cellSize),0,grid.width-1);
      const iz0=clamp(Math.floor((Math.min(a[1],b[1])-radius-grid.originZ)/grid.cellSize),0,grid.height-1),iz1=clamp(Math.ceil((Math.max(a[1],b[1])+radius-grid.originZ)/grid.cellSize),0,grid.height-1);
      for(let j=iz0;j<=iz1;j++)for(let k=ix0;k<=ix1;k++){
        const x=grid.originX+k*grid.cellSize,z=grid.originZ+j*grid.cellSize,t=clamp(((x-a[0])*dx+(z-a[1])*dz)/length2,0,1),distance=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);if(distance>radius)continue;
        const index=j*grid.width+k;roadDistance[index]=Math.min(roadDistance[index],distance-p.road.width/2);const normalized=distance/(p.road.width/2+2.9);
        // Nearest centerline owns the roadbed. Blend only nearly tied profiles
        // at their shared junction rather than averaging across whole blocks.
        if(normalized<best[index]-.03){best[index]=normalized;weighted[index]=0;weights[index]=0;influence[index]=0;}
        if(normalized>best[index]+.03)continue;
        const h=p.heights[i-1]+(p.heights[i]-p.heights[i-1])*t,w=1/(.05+Math.abs(normalized-best[index]));
        weighted[index]+=h*w;weights[index]+=w;influence[index]=Math.max(influence[index],1-smooth((distance-core)/shoulder));
      }
    }
  }
  for(let i=0;i<count;i++)if(weights[i])heights[i]=raw[i]+(weighted[i]/weights[i]-raw[i])*influence[i];

  type Constraint={indices:number[];weights:number[];limit:number;divisor:number;target?:number};
  const triangleWeights=(x:number,z:number)=>{
    const fx=clamp((x-grid.originX)/grid.cellSize,0,grid.width-1),fz=clamp((z-grid.originZ)/grid.cellSize,0,grid.height-1);
    const i=Math.min(grid.width-2,Math.floor(fx)),j=Math.min(grid.height-2,Math.floor(fz)),tx=fx-i,tz=fz-j,k=j*grid.width+i;
    return tx+tz<=1?{indices:[k,k+1,k+grid.width],weights:[1-tx-tz,tx,tz]}:{indices:[k+grid.width+1,k+grid.width,k+1],weights:[tx+tz-1,1-tx,1-tz]};
  };

  // Preserve source ground under buildings without reseating their fixed models.
  // Every footprint receives fill ceilings, while low-rise yards may be cut
  // modestly to meet the road. Fixed building models keep their surveyed bases;
  // foundation skirts bridge a cut instead of burying the facade with road fill.
  const protections:{indices:number[];weights:number[];target:number;lower:number;upper:number;divisor:number}[]=[];
  for(const b of city.buildings??[]){
    const samples:Point2[]=[b.center];
    const area=Math.abs(b.footprint.reduce((sum,p,i)=>{const q=b.footprint[(i+1)%b.footprint.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;

    for(let i=0;i<b.footprint.length;i++){
      const a=b.footprint[i],next=b.footprint[(i+1)%b.footprint.length],parts=Math.max(1,Math.ceil(Math.hypot(next[0]-a[0],next[1]-a[1])/4));
      for(let j=0;j<parts;j++){
        const x=a[0]+(next[0]-a[0])*j/parts,z=a[1]+(next[1]-a[1])*j/parts;
        samples.push([x,z]);
      }
    }
    for(const p of samples){
      const q=triangleWeights(...p),distance=q.indices.reduce((s,id,j)=>s+Math.max(-10,Math.min(20,roadDistance[id]))*q.weights[j],0);if(distance<1)continue;
      const divisor=q.weights.reduce((s,w)=>s+w*w,0);protections.push({...q,target:sample(...p),lower:p===b.center?-Infinity:b.height<20&&area<1000?-.5:-Infinity,upper:p===b.center?.15:Math.max(.2,(b.baseElevation??sample(...p))+.25-sample(...p)),divisor});
    }
  }
  const protect=()=>{for(const c of protections){const value=c.indices.reduce((s,id,j)=>s+heights[id]*c.weights[j],0)-c.target,error=value-clamp(value,c.lower,c.upper);if(Math.abs(error)<.0001)continue;c.indices.forEach((id,j)=>heights[id]-=error/c.divisor*c.weights[j]*.1);}};
  const crossfalls:Constraint[]=[],grades:Constraint[]=[],curves:Constraint[]=[];
  const gradientKeys=new Set<string>();
  // A line crosses grid rows, columns and the shared diagonal. Constrain the
  // actual plane in every crossed triangle, not an average between road edges.
  const gradientLine=(a:Point2,b:Point2,limit:number,target:Constraint[])=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.001)return;
    let ux=dx/length,uz=dz/length;if(ux<0||ux===0&&uz<0){ux=-ux;uz=-uz;}
    const breaks=[0,1];
    for(const [start,delta,origin]of [[a[0],dx,grid.originX],[a[1],dz,grid.originZ],[a[0]+a[1],dx+dz,grid.originX+grid.originZ]]){
      if(Math.abs(delta)<.000001)continue;
      const low=Math.min(start,start+delta),high=Math.max(start,start+delta);
      for(let n=Math.floor((low-origin)/grid.cellSize)+1;n*grid.cellSize+origin<high;n++)breaks.push((n*grid.cellSize+origin-start)/delta);
    }
    breaks.sort((a,b)=>a-b);
    for(let n=1;n<breaks.length;n++){
      if(breaks[n]-breaks[n-1]<.00001)continue;
      const t=(breaks[n]+breaks[n-1])/2,fx=clamp((a[0]+dx*t-grid.originX)/grid.cellSize,0,grid.width-1),fz=clamp((a[1]+dz*t-grid.originZ)/grid.cellSize,0,grid.height-1);
      const i=Math.min(grid.width-2,Math.floor(fx)),j=Math.min(grid.height-2,Math.floor(fz)),k=j*grid.width+i,upper=fx-i+fz-j>1;
      const key=`${k}:${upper?1:0}:${Math.round(ux*10000)}:${Math.round(uz*10000)}:${limit}`;if(gradientKeys.has(key))continue;gradientKeys.add(key);
      const indices=upper?[k+grid.width+1,k+grid.width,k+1]:[k,k+1,k+grid.width];
      const coefficients=(upper?[ux+uz,-ux,-uz]:[-ux-uz,ux,uz]).map(v=>v/grid.cellSize),divisor=coefficients.reduce((s,v)=>s+v*v,0);
      target.push({indices,weights:coefficients,divisor,limit});
    }
  };
  const crossfall=(center:Point2,dx:number,dz:number,width:number)=>{
    const length=Math.hypot(dx,dz);if(length<.1)return;const nx=-dz/length*width/2,nz=dx/length*width/2;
    gradientLine([center[0]-nx,center[1]-nz],[center[0]+nx,center[1]+nz],.003,crossfalls);
  };
  for(const p of profiles){
    for(let i=0;i<p.points.length;i++){
      const center=p.points[i],a=p.points[Math.max(0,i-1)],b=p.points[Math.min(p.points.length-1,i+1)];crossfall(center,b[0]-a[0],b[1]-a[1],p.road.width);
    }
    for(let i=1;i<p.points.length;i++){
      const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[1]-a[1],parts=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.5));
      for(let j=0;j<=parts;j++)crossfall([a[0]+dx*j/parts,a[1]+dz*j/parts],dx,dz,p.road.width);
    }
  }
  for(const p of profiles){
    const ps=p.road.points,normal=(i:number)=>{const a=ps[Math.max(0,i-1)],b=ps[Math.min(ps.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;return [-dz/l,dx/l];};
    for(let i=1;i<ps.length;i++){const a=ps[i-1],b=ps[i],dx=b[0]-a[0],dz=b[1]-a[1],parts=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.5)),na=normal(i-1),nb=normal(i);
      for(let j=0;j<=parts;j++){const t=j/parts,nx=na[0]+(nb[0]-na[0])*t,nz=na[1]+(nb[1]-na[1])*t;crossfall([a[0]+dx*t,a[1]+dz*t],nz,-nx,p.road.width);}
    }
  }
  for(const p of profiles)for(let i=1;i<p.points.length;i++)gradientLine(p.points[i-1],p.points[i],.18,grades);
  // Keep the vertical shape of the smoothed road profile during crossfall
  // refinement; otherwise the terrain solver can invent a short dip or crest.
  for(const p of profiles){
    const at=(s:number)=>{let i=1;while(i<p.stations.length-1&&p.stations[i]<s)i++;const a=p.points[i-1],b=p.points[i],t=(s-p.stations[i-1])/(p.stations[i]-p.stations[i-1]);return{...triangleWeights(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t),height:p.heights[i-1]+(p.heights[i]-p.heights[i-1])*t};};
    for(let s=3;s<p.length-3;s+=3){
      const left=Math.min(12,s),right=Math.min(12,p.length-s),terms=new Map<number,number>();let target=0;
      for(const [q,f]of [[at(s),1],[at(s-left),-right/(left+right)],[at(s+right),-left/(left+right)]] as const){q.indices.forEach((id,j)=>terms.set(id,(terms.get(id)??0)+q.weights[j]*f));target+=q.height*f;}
      const indices=[...terms.keys()],weights=[...terms.values()],divisor=weights.reduce((sum,w)=>sum+w*w,0);if(divisor<.000001)continue;
      curves.push({indices,weights,divisor,target,limit:.12*left*right/144});
    }
  }
  // A regular grid can straddle competing road ribbons at a curve or junction.
  // Reconcile source-building elevations with grade and crossfall constraints on
  // its actual triangle planes; the existing mesh topology stays intact. Soft
  // constraints avoid isolated spikes where a coarse cell touches both a house
  // and a narrow street.
  for(let pass=0;pass<140;pass++){protect();for(const constraints of [curves,crossfalls,grades])for(const constraint of constraints){
    const value=constraint.indices.reduce((sum,id,j)=>sum+heights[id]*constraint.weights[j],0)-(constraint.target??0),error=value-clamp(value,-constraint.limit,constraint.limit);
    if(Math.abs(error)<.0001)continue;
    const correction=error/constraint.divisor*(constraints===curves?.2:.55);
    constraint.indices.forEach((id,j)=>{heights[id]-=correction*constraint.weights[j];});
  }
  }
  // Resolve isolated remaining banks and facade fill without insisting that
  // every nearby sloping yard retain its exact source elevation.
  for(let pass=0;pass<120;pass++){
    for(const c of protections){const value=c.indices.reduce((s,id,j)=>s+heights[id]*c.weights[j],0)-c.target,error=Math.max(0,value-c.upper);if(error>.0001)c.indices.forEach((id,j)=>heights[id]-=error/c.divisor*c.weights[j]*.8);}
    for(const set of [curves,crossfalls,grades])for(const c of set){const limit=set===crossfalls?.018:set===grades?.2:c.limit*1.5,value=c.indices.reduce((s,id,j)=>s+heights[id]*c.weights[j],0)-(c.target??0),error=value-clamp(value,-limit,limit);if(Math.abs(error)<.0001)continue;c.indices.forEach((id,j)=>heights[id]-=error/c.divisor*c.weights[j]*(set===curves?.3:.8));}
  }
  // Safety bounds take precedence over soft profile matching at a tight hill
  // junction. Only remaining outliers move during this final reconciliation.
  for(let pass=0;pass<80;pass++){
    for(const c of protections){const value=c.indices.reduce((s,id,j)=>s+heights[id]*c.weights[j],0)-c.target,error=Math.max(0,value-c.upper);if(error>.0001)c.indices.forEach((id,j)=>heights[id]-=error/c.divisor*c.weights[j]*.8);}
    for(const set of [crossfalls,grades])for(const c of set){const limit=set===crossfalls?.045:.21,value=c.indices.reduce((s,id,j)=>s+heights[id]*c.weights[j],0),error=value-clamp(value,-limit,limit);if(Math.abs(error)<.0001)continue;c.indices.forEach((id,j)=>heights[id]-=error/c.divisor*c.weights[j]*.8);}
  }
  // Finally pin the actual interpolation triangles at every surface-level
  // bridge arrival, including endpoints that are absent from the ordinary-road
  // graph. A broad radial correction avoids a one-cell seam at the ramp toe.
  const pins=[...nodes.values()].filter(n=>n.pinned).map(n=>{
    const interpolation=triangleWeights(n.x,n.z),radius=Math.max(14,grid.cellSize*2),indices:number[]=[],weights:number[]=[];
    const ix0=clamp(Math.floor((n.x-radius-grid.originX)/grid.cellSize),0,grid.width-1),ix1=clamp(Math.ceil((n.x+radius-grid.originX)/grid.cellSize),0,grid.width-1);
    const iz0=clamp(Math.floor((n.z-radius-grid.originZ)/grid.cellSize),0,grid.height-1),iz1=clamp(Math.ceil((n.z+radius-grid.originZ)/grid.cellSize),0,grid.height-1);
    for(let z=iz0;z<=iz1;z++)for(let x=ix0;x<=ix1;x++){
      const distance=Math.hypot(grid.originX+x*grid.cellSize-n.x,grid.originZ+z*grid.cellSize-n.z);if(distance>=radius)continue;
      indices.push(z*grid.width+x);weights.push(1-smooth(distance/radius));
    }
    const scale=interpolation.indices.reduce((sum,id,j)=>sum+interpolation.weights[j]*(weights[indices.indexOf(id)]??0),0);
    return{...n,interpolation,indices,weights,scale};
  });
  for(let pass=0;pass<20;pass++)for(const pin of pins){
    const y=pin.interpolation.indices.reduce((sum,id,j)=>sum+heights[id]*pin.interpolation.weights[j],0),correction=(pin.height-y)/pin.scale;
    if(Math.abs(correction)<.000001)continue;pin.indices.forEach((id,j)=>{heights[id]+=correction*pin.weights[j];});
  }
  for(let i=0;i<count;i++){
    const difference=heights[i]-raw[i];if(Math.abs(difference)>.001)stats.changedVertices++;
    stats.maxCut=Math.max(stats.maxCut,-difference);stats.maxFill=Math.max(stats.maxFill,difference);
  }
  city.elevation={...grid,heights};stats.roads=profiles.length;stats.elapsedMs=performance.now()-began;prepared.set(city,stats);return stats;
}
