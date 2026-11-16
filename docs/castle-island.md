# Castle Island and Pleasure Bay

Research and reference review: 16 November 2026. The user's five images establish the enclosed lagoon, sandy western/northern beach, narrow Head Island causeway, five bastions, open grassy parade ground, granite masonry, turf-covered earthworks, McKay obelisk and fishing pier. They are visual references; no photographs are distributed as textures.

## Sources and interpretation

- [Massachusetts DCR's site description](https://www.mass.gov/location-details/learn-more-about-castle-island-pleasure-bay-m-street-beach-and-carson-beach) identifies Fort Independence as a five-bastioned granite fort, built between 1834 and 1851, in a 22-acre public park connected to the mainland by roads and walkways. The game presents the public park and an accessible fort entrance; it does not simulate seasonal tour hours.
- [DCR's Castle Island trail map](https://www.mass.gov/doc/castle-island-trail-map/download) identifies the Pleasure Bay loop, Castle Island loop, beach and Sugar Bowl shade shelter. Existing mapped walking paths remain the route network.
- [The Castle Island Association's virtual tour](https://fortindependence.org/virtual-tour/) documents the single entrance, parade ground, ramp to the upper level, circular gun emplacements, display artillery, flag displays and Donald McKay monument. The model includes these architectural cues with a simplified interior and a few display guns.
- [The association's present-day structure account](https://fortindependence.org/present-day-structure/) describes the Rockport granite and restoration of the parade ground and bastions. A small procedural masonry texture supplies staggered granite courses without remote image dependencies.

The fort's horizontal plan comes from the **actual shipped Boston survey mesh**, `BOS-AQD15-29RFX-598N6` in tile `5_1`. Its metadata contains only a pentagonal hull, but its roof triangles preserve the five pointed bastions and courtyard hole. The generator unions those triangles, retains the external plan, and simplifies tiny inner facade notches. The authored model replaces that one near/far shell and the small interior magazine, leaving neighboring buildings intact.

Wall and courtyard heights, the public entrance opening, ramp, grass traverses, individual masonry courses, display guns, railings, flag, monument dimensions, pier deck/piles and shelter form are game-scale interpretations of the supplied photographs and site references, not measured restoration drawings. The fort is approximately 190 metres across. Its visible wall tops are at world y=14, and its parade ground at y=6.7. These are the game's local vertical datum, not sea-level survey measurements. Fort land is cut from the original terrain and park decal, then replaced by shared render/collision surfaces so the original DEM cannot obstruct the courtyard or gateway.

## Pleasure Bay correction

The bay was already present in the hydro outline. The combined coastal feature assigned it the **tidal harbor plane at y=-4.95**, below the broad bay DEM plateau at **y=-3.14**. The renderer clipped the buried water away, leaving apparent dry ground.

`scripts/build-castle-island.py` intersects the closed lagoon hole in the Castle Island open-space polygon with the shipped hydro. It assigns this approximately 572,347 square metre region its own `Pleasure Bay` surface, using the median of interior DEM samples for its level. Other water surfaces retain their levels. The union of all surface polygons remains the same original hydro coverage. This is a visual correction from consistent source terrain, not a tide or water-gauge model.

A water-only terrain cut removes residual grass over the basin, retaining a four-metre shoreline transition. Additional cuts remove the coarse DEM's offshore slopes beside Castle Island's sea defenses. Both rendering and terrain collision use the cuts. Beach sand is confined to the mapped dry park on the north and west banks; existing roads and walks remain above it. Shore walls follow the original hydro boundary and do not turn artificial selection-box edges into coastline.

## Regeneration and checks

Run with the project's Python environment (NumPy and Shapely):

```sh
.venv-data/bin/python scripts/build-castle-island.py
```

Run this **after** `build-water-surfaces.py` when regenerating the geographic package. Inputs are the shipped `city.json`, elevation grid and tile `5_1`; source caches and network access are unnecessary. Outputs are the revised water-surface partition in `public/data/city.json` and `src/data/castle-island.json`. Repeated generation is byte-stable.

For a staged package, pass its directory and keep the generated sidecar alongside it until installing both outputs:

```sh
.venv-data/bin/python scripts/build-castle-island.py --data-dir /tmp/boston-staging --output /tmp/boston-staging/castle-island.json
```

All three inputs then come from the staging directory; the checked-in package and runtime sidecar are untouched. Install the staged sidecar at `src/data/castle-island.json` with the matching geographic package.

```sh
npm run build
.venv-data/bin/python -m unittest discover -s scripts -p 'test_castle_island.py'
node --test tests/castle-island.test.mjs tests/waterfront.test.mjs tests/water-shores.test.mjs tests/water-level.test.mjs tests/waterfront-surfaces.test.mjs
npm run preview -- --port 4181
PORT=4181 WALK=1 node scripts/capture-castle-island.mjs
PORT=4181 MOBILE=1 node scripts/capture-castle-island.mjs
```

The capture script takes inspection views of the bay, fort, harbor facade and gateway, checks browser errors and tile/context health, and optionally walks through the entrance. Inspection cameras disable distance fog while taking their stills so the complete bay can be examined; normal gameplay fog is restored immediately. Mobile checks use browser emulation, not physical iPhone/iPad hardware.

Local verification on 16 November 2026: production build, full city-package validation, waterfront geometry validation and targeted geometry, water, shoreline and resource-lifetime checks passed. Regression checks verify that staged generation reads its own city, elevation and tile inputs without changing installed files, and that repeated tile reloads reuse landscape materials while releasing geometry. Desktop Chrome walked through the gateway and up the fort ramp; desktop and emulated mobile captures reported no browser errors, failed tiles or WebGL context losses. Fresh generation from the original water partition matches the output generated from the checked-in inputs, and a repeat run is byte-identical. All 40 coastal water partitions are valid and nonoverlapping; millimetre rounding changes the union by less than one square metre across the original approximately 51 square kilometre coastal feature.
