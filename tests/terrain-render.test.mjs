import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {drapedRibbon,terrainTiles,terrainGeometry} from '../src/render/terrain-ground.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';

test('render tiles preserve the collision triangles and seamless boundary normals',()=>{
  const width=13,height=10,city={bounds:{minX:0,maxX:72,minZ:0,maxZ:54},elevation:{width,height,cellSize:6,originX:0,originZ:0,heights:Array.from({length:width*height},(_,i)=>Math.sin(i%width)*2+Math.cos(Math.floor(i/width)))}},full=terrainGeometry(city),tiles=terrainTiles(city,4);
  let triangles=0;const positions=new Map();
  for(const tile of tiles){
    const p=tile.attributes.position,n=tile.attributes.normal;
    triangles+=tile.index.count/3;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),source=(z/6*width+x/6),key=`${x},${z}`;
      assert.equal(p.getY(i),full.attributes.position.getY(source));
      assert.deepEqual([n.getX(i),n.getY(i),n.getZ(i)],[full.attributes.normal.getX(source),full.attributes.normal.getY(source),full.attributes.normal.getZ(source)]);
      positions.set(key,true);
    }
    for(let i=0;i<tile.index.count;i+=3){
      const ids=[0,1,2].map(j=>tile.index.getX(i+j)),x=ids.reduce((s,j)=>s+p.getX(j),0)/3,z=ids.reduce((s,j)=>s+p.getZ(j),0)/3,y=ids.reduce((s,j)=>s+p.getY(j),0)/3;
      assert.ok(Math.abs(y-sampleElevation(city,x,z))<1e-6,'same diagonal as wheel collision surface');
    }
    tile.dispose();
  }
  assert.equal(triangles,(width-1)*(height-1)*2);assert.equal(positions.size,width*height);full.dispose();
});

test('Parker Hill road triangles follow the physical surface through crests and grades',()=>{
  const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
  const roads=city.roads.filter(r=>/Parker Hill Avenue|Calumet Street/.test(r.name));
  assert.ok(roads.length>3,'actual hilly road fixture is required');
  let triangles=0,maxError=0;
  for(const road of roads){
    const geometry=drapedRibbon(city,road.points,road.width,.045);
    const p=geometry.attributes.position,n=geometry.attributes.normal;
    for(let i=0;i<p.count;i+=3){
      const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
      const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
      maxError=Math.max(maxError,Math.abs(y-sampleElevation(city,x,z)-.045));
      assert.ok(n.getY(i)>.5,'road face must point upward, including on slopes');triangles++;
    }
    geometry.dispose();
  }
  assert.ok(triangles>1000);
  assert.ok(maxError<.03,`road cuts through terrain at a crest: ${maxError}m`);
});
