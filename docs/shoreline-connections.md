# Shoreline paths and water crossings

The natural bank uses both the mapped water boundary and the distance from ground paths. It meets the existing pavement at its terrain height before sloping to the horizontal water plane. Terrain retained under paving and the replacement bank share that boundary; bridge decks remain separate structures. Engineered quays retain vertical walls and never grow these path-supported grass banks.

Frog Pond is an engineered basin. Its apron interpolates from the level rim to the surrounding path, on a half-metre grid with shared shading normals. The underlying terrain is removed inside the apron, and the water fills the complete basin outline.

## Complete pedestrian crossings

The original park polygon clip removed portions of bridges over water. It also discarded source stair links shorter than three metres. `public/data/water-paths-source.json` retains 56 existing generic water-crossing ways from the cached OSM metro paths plus four short stair links. Crossings intersecting driving roads were excluded, leaving the separately surveyed highway footbridges in control.

Run `.venv-data/bin/python scripts/build-water-paths.py` to compile `src/data/water-paths.json`, or add `--check` to verify replay. Connected, nonbranching source ways share one complete bank-to-bank profile. Forks and loops are not guessed. Tile loading replaces the older clipped records with these source lines and clips them only at tile ownership boundaries. Render and collision consume the same resulting paths. Stored-height overrides retain priority.

At Long Wharf, the dedicated paved quay owns ground paths wholly on or immediately beside that wharf. Nearby OSM HarborWalk coordinates outside the coarse hydro seawall are reconciled to its inland side. The reported south gangway connects to that paving and a procedural floating landing based on the source landing alignment. The landing width and freeboard are visual estimates, not survey measurements. Rail openings keep the entrance clear, and the gangway crosses above the seawall cap before descending to the inland paving.

## Verification

`tests/shoreline-connections.test.mjs` checks bank support beside pavement, the entire Frog Pond rim, continuous quarter-metre collision samples across four Esplanade bridges, short stair retention, tile ownership, the Long Wharf landing, and actual walker traversal of the Hatch Shell bridge and Long Wharf gangway without jumping. The existing shoreline tests retain the Dam/Fens and submerged terrain checks. `scripts/test_water_paths.py` verifies byte-identical source replay.

Capture matching views with:

```sh
PORT=4188 LABEL=regression-after SITE=garden,frog,hatch,lagoon,long,long-low node scripts/capture-water-shores.mjs
```

The capture waits for both inspected tiles, fetches, and construction within 600 metres of the camera or target. Farther tiles may remain queued or building at the background budget and do not block screenshots of completed nearby tiles.
