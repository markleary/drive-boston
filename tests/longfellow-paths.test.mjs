import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {loadTile,resolveCity} from '../src/simulation/city-tiles.ts';
import {parseTileHeader} from '../src/simulation/tile-format.ts';
import {footbridgeRoad} from '../src/simulation/footbridges.ts';
import {longfellowDeckOwnsPath} from '../src/simulation/longfellow.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const source=readJson('city.json'),city=await resolveCity(source,read),tile=await loadTile(city,0,-2,read);
const buffer=gunzipSync(readFileSync(new URL('../public/data/tiles/t_0_-2.bin',import.meta.url))),raw=parseTileHeader(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));

test('Longfellow upper sidewalk IDs never become standalone park bridges in streamed tiles',()=>{
  assert.equal(longfellowDeckOwnsPath('osm-way-810642367-0-0_-2_0'),true);
  assert.equal(longfellowDeckOwnsPath('osm-way-817775844-0-0_-2_0'),true);
  assert.equal(longfellowDeckOwnsPath('osm-way-8106423670-0'),false,'whole source IDs, not prefix collisions');
  assert.equal(tile.parkPaths.some(p=>longfellowDeckOwnsPath(p.id)),false);
  // Only the two deck-owned sources may disappear; real bridges and paths
  // retain the exact source plan, width, metadata and heights.
  assert.deepEqual(tile.parkPaths,raw.parkPaths.filter(p=>!longfellowDeckOwnsPath(p.id)));
  const appleton=tile.parkPaths.filter(p=>p.name==='Frances Appleton Bridge');
  assert.ok(appleton.some(p=>p.bridge));assert.ok(appleton.some(p=>footbridgeRoad(city,p)));
});

test('Dudley White bicycle path remains continuous at ground level under Longfellow',()=>{
  const original=raw.parkPaths.find(p=>p.id.startsWith('osm-way-150052469-')),path=tile.parkPaths.find(p=>p.id===original.id);
  assert.deepEqual(path,original);assert.equal(path.bridge,false);assert.equal(footbridgeRoad(city,path),undefined);
  const near=path.points.filter(([x,z])=>z<-1220&&z>-1280);
  assert.ok(near.length>=6);assert.ok(near.some(p=>p[1]>-1235)&&near.some(p=>p[1]<-1265),'mapped path spans both sides of the underpass');
  const next=tile.parkPaths.find(p=>p.id.startsWith('osm-way-980643138-'));
  assert.deepEqual(path.points.at(-1),next.points[0],'southern ground path connection stays intact');
});

test('whole-city path loading applies the same deck ownership correction',async()=>{
  const fixture={bounds:{minX:0,maxX:1000,minZ:-2000,maxZ:-1000},roads:[],buildings:[],landmarks:[],sources:[],parkPaths:raw.parkPaths};
  const resolved=await resolveCity(fixture,()=>{throw new Error('fixture has no external resources');});
  assert.deepEqual(resolved.parkPaths,tile.parkPaths);
});
