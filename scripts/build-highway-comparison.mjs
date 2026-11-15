/** Rebuild the local evidence gallery after capture-highway-locations.mjs. */
import {readFile, writeFile} from 'node:fs/promises';
const root=new URL('../reports/highway-locations/',import.meta.url);
const sites=[
 ['01-western-avenue','Western Avenue / Soldiers Field Road',
  'Bridge deck blocked the lower road.',
  'The clearance solver treated a shared XY source vertex as a same-level junction, even though the two roads have different source levels. The underpass generator now lowers the connected lower roadway with a continuous grade and retains the bridge and its approaches.'],
 ['02-charlestown-ramp','Charlestown / I-93 Exit 20',
  'An elevated exit ended at the edge of the survey mesh.',
  'The source tail of the active exit was missing from the I-93 route inventory. The generator now follows the retained source ways from the measured survey mouth to Cambridge Street; the end-cap rule checks for an actual continuation before closing a survey end.'],
 ['03-atlantic-openings','Atlantic Avenue / Central Artery',
  'Repeated isolated holes exposed an underground bore.',
  'Terrain dips were interpreted as new portals. The profile now keeps each buried section continuously covered while preserving its existing portal approaches, then propagates corrected elevations to connected branches.'],
 ['04-south-station','South Station Connector',
  'Two elevated road ends had no continuations.',
  'The street importer omitted unnamed GIS links while retaining the named bridges they connected. Those source links now belong to the highway route inventory. Their heights match the entire shared pavement at the joins, and the return loop retains the elevated level specified by its source. The solver also rechecks dependent ramps after parent profiles change, preventing steps at their joins.'],
 ['05-i90-opening','I-90 / Exit 134A',
  'A ramp crossed a concrete enclosure around a false opening in the tunnel roof.',
  'The highway cover classifier promoted short, thinly covered sections to portals even inside an underground mainline. Enclosed spans now retain a roof; generator validation rejects isolated openings inside a bore.'],
 ['06-building-shells','Cross / Sudbury Street portals',
  'Buildings retained floating roofs and detached facade fragments.',
  'The clearance clipper removed walls independently from roofs, and triangle-component pruning discarded valid wall fragments at T-junctions. The shared render/collision geometry now retains those fragments and closes exposed roof cut edges with reveal walls, while preserving the tunnel clearance volume.'],
 ['07-leverett-width','Leverett Circle / Storrow Drive',
  'Disconnected elevated pieces overlapped and changed width abruptly.',
  'The imported survey contained duplicate lower connector components, and old approaches lifted underground source ramps to those components. The generator now retires the bounded duplicate components, uses connected source road alignments, and tapers the widths at shared joins. A height-aware curb check also removes ground curbs that were supported only by an elevated road\'s footprint.'],
 ['08-river-street','River Street / Soldiers Field Road',
  'The river bridge stood at almost the same level as the roadway beneath it.',
  'The same shared-vertex classification error affected this crossing. The lower roadway now forms a continuous underpass with clearance beneath the existing bridge slab.'],
];
const origins=[
 ['6084df3','October 31: shared-vertex exception in water-crossing levelling; predates the I-90/Storrow addition.'],
 ['79ef6ec','November 7: the original I-93 addition omitted this active tail. November 9 commit 1a608e4 subsequently capped the unfinished survey end.'],
 ['af36d86','October 30: terrain-based tunnel coverage and portal enclosures; predates the expansion.'],
 ['479d3c5','October 28: unnamed GIS roads were skipped by the street importer. The later highway inventory did not recover these two missing links.'],
 ['2aa9ec9','November 11: the short-thin-span portal rule was present in the initial I-90/Storrow implementation.'],
 ['47b10b4','October 31: shell clearance and fragment pruning; predates the expansion.'],
 ['3544e76','November 3: the Museum repair raised source approaches to disconnected survey geometry; predates the I-90/Storrow addition.'],
 ['6084df3','October 31: the same shared-vertex exception as Western Avenue.'],
];
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const checks=JSON.parse(await readFile(new URL('validation.json',root),'utf8'));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drive Boston — highway repair comparisons</title><style>
body{margin:0;background:#f3f3ee;color:#172b28;font:16px/1.6 system-ui,sans-serif}main{max-width:1800px;margin:auto;padding:28px}h1{font-size:32px;line-height:1.2}h2{font-size:23px;margin-bottom:6px}p{max-width:1000px}section{margin:40px 0 64px;border-top:1px solid #bbc5be;padding-top:18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{display:block;width:100%;border-radius:6px}figcaption{font-weight:650;margin-bottom:8px}a{color:#185f55}nav{display:flex;gap:12px;flex-wrap:wrap}li{margin:8px 0}.note{color:#56645b}code{background:#e2e7de;padding:2px 5px}@media(max-width:900px){.pair{grid-template-columns:1fr}main{padding:18px}}
</style><main><h1>Highway repairs: eight matched locations</h1>
<p>Before images were captured from pristine commit <code>8b799e1</code>. After images use the repaired local build. Each pair uses the same world coordinates, heading, vehicle mode, viewport, and aerial camera movement, with neighborhood streaming complete. Driving cameras follow the corrected road elevation. Traffic can differ between captures. Click any image to inspect it at full resolution.</p>
<nav>${sites.map(([id,title],i)=>`<a href="#${id}">${i+1}. ${esc(title)}</a>`).join('')}</nav>
<h2>Verification</h2><ul>${checks.checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul><p class="note">${esc(checks.limitations)}</p>
${sites.map(([id,title,symptom,cause],i)=>`<section id="${id}"><h2>${i+1}. ${esc(title)}</h2><p><strong>Reported:</strong> ${esc(symptom)}</p><p><strong>Cause and fix:</strong> ${esc(cause)}</p><p class="note"><strong>History:</strong> ${esc(origins[i][1])} <a href="https://github.com/markleary/drive-boston/commit/${origins[i][0]}">${origins[i][0]}</a></p><div class="pair">${['before','after'].map(phase=>`<figure><figcaption>${phase==='before'?'Before':'After'}</figcaption><a href="${phase}/${id}.png"><img loading="lazy" src="${phase}/${id}.png" alt="${phase} — ${esc(title)}"></a></figure>`).join('')}</div></section>`).join('')}
<p class="note">Reproduce images with <code>node scripts/capture-highway-locations.mjs before 4174</code> against the baseline and <code>node scripts/capture-highway-locations.mjs after 4175</code> against the repaired build. Detailed capture state and browser errors are recorded beside each image set in <code>snapshots.json</code>.</p></main></html>`;
await writeFile(new URL('index.html',root),html);
console.log('Wrote',new URL('index.html',root).pathname);
