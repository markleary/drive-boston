# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Free-roaming browser driving/flying prototype of Greater Boston (every Boston neighborhood except Roslindale, West Roxbury, Hyde Park and the Harbor Islands, plus Cambridge, Somerville, Brookline and Chelsea) built with Three.js, TypeScript, Vite, and Rapier (`@dimforge/rapier3d-compat`). All geographic data ships as static files in `public/data/` and streams in 1 km tiles; there are no runtime map services or API keys. README.md describes gameplay and scope; DATA_SOURCES.md documents data sources, licenses, coordinate conversion, and how to regenerate assets.

## Commands

Node.js 24 is expected (the node tests rely on its native TypeScript type stripping).

```sh
npm ci
npm run dev              # Vite dev server on 127.0.0.1
npm run build            # tsc --noEmit type check, then vite build to dist/
npm run preview          # serve dist/

npm run test:physics     # node --test tests/*.test.mjs (unit/physics/geometry)
npm test                 # Playwright browser tests (tests/*.spec.ts)
npm run validate:data    # .venv-data/bin/python scripts/validate-city.py on public/data
```

Single tests:

```sh
node --test tests/helicopter.test.mjs
node --test --test-name-pattern="hold altitude" tests/helicopter.test.mjs
npx playwright test tests/flight.spec.ts
npx playwright test -g "helicopter: lift"
```

Playwright uses the installed Google Chrome channel, runs serially (1 worker, 90 s timeout), and its `webServer` always runs `npm run build && npm run preview --port 4173` first, so every Playwright run includes a full production build. Browser tests drive the game through `window.__backbay` (set at the end of `boot()` in `src/main.ts`), which exposes `snapshot()`, `travelTo(x, z, yaw)` (streams the tiles around a point and places the car there) and other diagnostic hooks; extend that object when a spec needs new state.

## Architecture

- `src/main.ts` is the single orchestrator: `boot()` fetches `city.json`, resolves its sidecars (`resolveCity()` in `src/simulation/city-tiles.ts` decodes the gzip int16 elevation grid, the DBF2 far-building hulls and the building index), wires UI callbacks, builds the world, physics, traffic, transit, pedestrians, helicopter, and audio, then runs the render loop. Simulation advances on a fixed 60 Hz step independent of the Three.js view.
- **Shared terrain is the foundation.** `prepareRoadTerrain()` (`src/simulation/road-grading.ts`) levels the street corridor (pavement plus the `WALK` sidewalk allowance on each side) across its width, drops a side-hill street toward its lower edge instead of banking it, and protects surveyed building bases outside the corridor. The metro package ships that result precomputed by `scripts/grade-terrain.mjs` (`city.elevation.graded`, raw grid kept in `elevation-source.bin`); `main.ts` only grades in-process for a legacy whole-city `city.json`. Rendering, Rapier collision, traffic, pedestrians, sidewalks, and helicopter clearance all query the same grid via `sampleElevation()` / `sampleDriveSurface()` (`src/simulation/terrain.ts`, `road-surfaces.ts`), so any terrain or road-surface change affects all of them. Never run `buildTerrainGeometryData()` or `prepareRoadTerrain()` on the full 2774 x 3039 metro grid in a test; use `windowCity()` from `tests/helpers/metro-city.mjs`.
- **Street surfaces follow the curbs, not the width guess.** Road widths in `city.json` are name/class assumptions; the curbs are a survey (Boston GIS layer 6) or, in the towns, synthetic lines with filleted corners. `scripts/build-street-surfaces.py` (library `scripts/street_surfaces.py`) measures the roadway between the curbs at 1 m stations and writes per-tile `pavements` (left/right edge polylines in centimetres from the tile origin, sidewalk-inventory presence per side), `sidewalks` (Boston Sidewalk Inventory polygons, brick flagged), `islands` (closed curb faces to fill with concrete) and `driveways` (OpenStreetMap service roads measured to the curbs the same way, surface lots from `data-source-cache/osm-metro-driveways.json`, plus the curb faces they enter, dissolved into asphalt fills), plus `pavedWidth` on measured roads. `tile-builder.ts` drapes the asphalt between those edges (`drapedStripInto`), draws a 2.9 m sidewalk band only on sides without an inventory polygon, and falls back to the constant-width ribbons for roads without a record (decks). Street furniture, walkers, parked cars, storefront setbacks and traffic lane offsets use `pavedWidth ?? width` (a one-way class avenue gets its second lane only where the measured roadway is at least 6.5 m wide).
- **Streaming.** `city.buildings` holds only the buildings of loaded tiles. `src/render/tile-streaming.ts` loads 1 km DBT2 tiles (`src/simulation/tile-format.ts`) within about 1.1 km of the player and runs `src/render/tile-builder.ts` as a generator (buildings and colliders, street furniture, curbs, park paths, signals) spread across frames, paced by a per-frame deadline (`src/render/pacing.ts`; the detail builders yield between buildings and small parts accumulate through `src/render/geometry-writer.ts` instead of per-part geometries); `src/render/far-city.ts` draws every hull from `far.bin` (`src/simulation/far-format.ts`: flags landmark, exact-mesh, hidden, fragment) as boxes plus a coarse terrain sheet, hidden per chunk while its detailed tile is built. Landmark modules address buildings through `city.landmarkBuildings` before their tiles stream in; `buildingAt()` answers from the far index whether or not a tile is loaded.
- `src/physics/vehicle.ts` (`DrivingPhysics`) owns the Rapier world: raycast car, terrain trimesh, building colliders, bridge decks/barriers. Traffic and transit add bodies to this same world; the helicopter (`src/simulation/helicopter.ts`) uses it for clearance queries.
- `src/render/window-interiors.ts` injects the parallax window-interior shader into the façade materials through `onBeforeCompile`; its `windowGrid()` also drives the canvas painter in `materials.ts`, so the two stay aligned by construction. Near windows show rooms, far windows fall back to the painted texture and emissive map, and the wall below tile row zero (a neighborhood profile's raised ground floor) is drawn as foundation with basement lights rather than the texture's wrapped window row.
- `src/render/world.ts` builds the static world (terrain, roads, parks, water, far city) and, for a metro package, starts the tile streamer; `src/render/tile-geometry.ts` turns a tile's quantized shell into the same non-indexed, UV-stabilized geometry the old GLB path produced. Landmark-specific modules (`prudential.ts`, `state-house.ts`, `fenway-park.ts`, `metro-landmarks.ts`, etc.) select a building by its source ID or `landmark` tag, split its shell for custom materials, and may add extra colliders. Fenway, the Prudential complex, 145 Dartmouth, the BUMC ambulatory care center, NEXUS in Allston, the Logan terminals and the Zakim Bridge use exact mesh collision (`src/simulation/building-collisions.ts`). Buildings whose convex hull crosses a ground-level road also carry generated `collision: "mesh"` metadata. BUMC has a verified passage correction in `scripts/building_passages.py`; exact collision alone did not remove its source walls. Other buildings use convex footprints. A tile building flagged `structure` (the Zakim) gets no foundation skirt and carries a token footprint.
- `src/simulation/` is non-visual logic (roads, signals, traffic, transit, activity density, audio); `src/render/` builds meshes; `src/ui/` is DOM interface plus Canvas minimap/atlas.
- World coordinates are meters: X increases east, Z increases south, Y is height above a local datum (not sea level). Conversion from State Plane feet is documented in DATA_SOURCES.md.

### Node-test constraint on `src/`

`tests/*.test.mjs` import `src/**/*.ts` directly under plain Node (no bundler). Any module reachable from those tests must:
- use explicit `.ts` extensions on relative runtime imports (extensionless `import type` is fine since it is erased),
- use only erasable TypeScript syntax (no enums, namespaces, or constructor parameter properties),
- avoid Vite-only features such as `import.meta.env` at module load.

`main.ts` and pure render modules use extensionless imports because only Vite loads them.

## Data pipeline

`public/data/city.json`, `elevation.bin`, `elevation-source.bin`, `far.bin`, `tiles/*.bin`, `provenance.json`, `transit.json`, and `src/data/fenway-detail.json` are generated by scripts in `scripts/` and checked in. Raw downloads go to the ignored `data-source-cache/`. `scripts/tileformat.py` and `src/simulation/tile-format.ts` must stay in sync (DBT2 tiles; `scale` per building when the 1 cm step overflows int16).

```sh
python3 -m venv .venv-data
.venv-data/bin/pip install -r scripts/requirements.txt
.venv-data/bin/python scripts/fetch-metro-sources.py --source-dir data-source-cache   # once
.venv-data/bin/python scripts/build-metro.py --output-dir /tmp/boston-staging
node scripts/grade-terrain.mjs --data-dir /tmp/boston-staging        # offline road grading (about two minutes, 10 workers)
mkdir -p /tmp/boston-baseline
git archive 20856dfb6688e2d350af6fd13e1b2e2550ba8d8d public/data | tar -x -C /tmp/boston-baseline
.venv-data/bin/python scripts/merge-metro-extension.py --data-dir /tmp/boston-staging --base-data /tmp/boston-baseline/public/data --baseline-commit 20856dfb6688e2d350af6fd13e1b2e2550ba8d8d
.venv-data/bin/python scripts/build-chelsea-bridges.py --data-dir /tmp/boston-staging
.venv-data/bin/python scripts/build-tobin-bridge.py --data-dir /tmp/boston-staging
.venv-data/bin/python scripts/building_clearance_package.py --data-dir /tmp/boston-staging
.venv-data/bin/python scripts/build-chelsea-places.py --data-dir /tmp/boston-staging
.venv-data/bin/python scripts/build-street-surfaces.py --data-dir /tmp/boston-staging --source-dir data-source-cache
.venv-data/bin/python scripts/validate-city.py --data-dir /tmp/boston-staging
```

The chain is reproducible: two runs from the same cache write byte-identical tiles, `far.bin`, both elevation grids, `city.json` and `provenance.json` (deterministic gzip headers, chunk-ordered seam blending, no timing in the manifest), so `.venv-data/bin/python scripts/compare-metro.py /tmp/boston-staging public/data` lists exactly what a script or source change touched. Copy a validated staging directory over `public/data/` (keep `transit.json`, `road-structures-source.json`, and `bridge-spans-source.json`), then rerun `scripts/build-fenway-detail.py` and `scripts/build-transit.py`, which read the installed package (see DATA_SOURCES.md). `build-city.py` still builds the legacy single-GLB central package for comparison; the runtime keeps that whole-city path working. Audio clips in `public/audio/` come from `node scripts/generate-audio.mjs --generate` (needs `ELEVENLABS_API_KEY` in `.env`; never overwrites existing clips).

## Deployment

Hosted on GitHub Pages at https://markleary.github.io/drive-boston/, published by `.github/workflows/deploy.yml`: every push to `main` runs `npm ci` and `npm run build` on Node 24 and deploys `dist/` with `actions/deploy-pages` (the Pages source is GitHub Actions, not a branch; the old `gh-pages` branch is unused). The workflow does not run the test suites, so run them before merging. `vite.config.ts` uses `base: './'` so the build works under a repository subpath.

## Conventions

- Source code is written in a compact, dense style (many statements per line, minimal whitespace); match the surrounding style when editing.
- README.md and DATA_SOURCES.md contain precise counts and claims (building totals, destination count, data sizes, test coverage descriptions). Update them when a change alters those facts.
