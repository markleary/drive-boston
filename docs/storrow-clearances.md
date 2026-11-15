# Storrow bridge and source notes

`src/simulation/low-clearance.ts` indexes intersecting upper road decks and the global footbridge profiles over the cars-only parkways. It calculates the lower pavement-to-soffit distance, merges adjacent pieces of one crossing, and rounds its clearance board down to the nearest inch. These are **game geometry clearances**, not a surveyed bridge inventory. Every catalog crossing receives a mounted board; advance diamonds are added wherever their posts can stand clear of traffic lanes. The catalog also retains Longfellow's 12-foot westbound portal to render its matching arch and board.

Longfellow's Boston approaches use the photograph's granite abutments, open-spandrel riveted steel ribs, floor joists and railings. The ribs have the same solid geometry in Rapier. The eastbound minimum is 10 feet 6 inches, from the supplied Street View photo; the retained OSM way `931384763` also has `maxheight=10'6"`. Westbound uses the retained OSM way `828869387` tag of 12 feet. Arched lane centers have 30 cm more room than the minimum; the loaded moving truck still strikes the eastbound steel.

The westbound riverside opening also includes the four-meter-wide, ground-level Dr. Paul Dudley White path (`150052469`). Its granite pier sits beyond the path, leaving both its center and edges clear beneath the arch. A Rapier regression samples the mapped corridor at one-meter intervals with pedestrian-height volumes. The two upper Longfellow sidewalk ways (`810642367`, `817775844`) belong to the existing bridge deck and are excluded from standalone park footbridge rendering; the continuous lower path is retained.

The last river span shares that pier footprint: all three steel ribs extend past the retained river-frame endpoint to steel bearing shoes on granite corbels at the pier's river face. This closes the former gap between the older river arches and the Boston portal without putting masonry in the path. Regression checks cover rendered ribs across the gap and physical contact with the supporting pier.

The Boston layer-8 source incorrectly labels eight Route 28 carriageway records “Charlesbank Road.” This must not be treated as a restriction on the separate park-side Charlesbank Road shown in the user's satellite photo. The runtime corrects **only** these verified source IDs:

| Layer-8 ID | Game road ID | Carriageway |
| --- | --- | --- |
| 8890 | `8890-0-0` | Storrow Drive West |
| 13519 | `13519-0-0` | Storrow Drive West |
| 13128 | `13128-0-0` | Storrow Drive East |
| 13129 | `13129-0-0` | Storrow Drive East |
| 13133 | `13133-0-0` | Storrow Drive West |
| 13134 | `13134-0-0` | Storrow Drive East |
| 13136 | `13136-0-0` | Storrow Drive West |
| 8541 | `8541-0-0` | Storrow Drive West |

This is supported by the cached source geometries, not just neighboring names: projected into the game's EPSG:2249 frame, the west portal center `(163.653, -1245.663)` lies 0.76 m from OSM Storrow way `828869387`, and the east portal center `(197.853, -1241.688)` lies 0.39 m from OSM Storrow way `931384763`. Both ways and tags are retained in `data-source-cache/osm-cambridge-roads.json`; layer-8 Route 28 geometry and attributes are retained in `data-source-cache/layer-8.json`. The remaining northern records follow the same parkway toward Leverett Circle: `13133` matches OSM Storrow ways `1317083682`/`8648658` (0.56–2.79 m at checked vertices), `13134` matches `931384763`/`122376136` (0.83–1.67 m), `13136` matches `122376137`/`1317083682` (0.27–2.79 m), and the short `8541` connector matches the `533641352`/`122376137` Storrow junction (0.27–0.50 m). These are geometric matches to the cached OSM carriageways; nearby Charles Street and Charles River Dam Road records are not swept into the correction. The same exact IDs drive traffic eligibility, so an unrelated road named Charlesbank remains unaffected.

Validation includes geometry-derived signs for all three parkways, upward rays against the visible/physical Longfellow ribs, ordinary-car passage in both directions, and the source-label exception. The main Storrow browser test exercises a truck strike and recovery in the complete rendered game.

## Bounded source-alias audit

A geometric audit checked **14,920 remaining unrestricted Boston source roads** against **132 named Storrow Drive, Soldiers Field Road, Memorial Drive and Embankment Road ways** across all four retained road extracts (Cambridge, Brookline, Somerville and Chelsea). Candidates had at least 60% of their length inside a four-meter buffer of those mapped centerlines. Eighteen candidates then received crossing/topology review; no further unresolved candidates remained.

Four candidates were rejected: Cambridge Street `10287-0-0`, Western Avenue `10309-0-0` and North Harvard Street `9444-0-0` are perpendicular upper bridges; Everett Street `8696-0-0` crosses the Soldiers Field carriageways. Short intersections can overlap both carriageway buffers without belonging to the parkway.

The other fourteen receive **restriction only**, preserving their source display names at boundary junctions:

| Source display name | Exact restricted IDs | Supporting OSM ways |
| --- | --- | --- |
| David G Mugar Way | `1797-0-0`, `1798-0-0`, `7601-0-0`, `13337-0-0`, `14322-0-0`, `14323-0-0`, `14324-0-0` | `817406992`, `931384763`, `630958765`, `828869387`, `1416013986`, `1416013987` |
| Charles Street | `8457-0-0`, `13137-0-0`, `13138-0-0` | `48982004`, `122376136`, `8646240` |
| Nashua Street | `9170-0-0`, `9171-0-0`, `13140-0-0` | `970407067`, `829909270`, `482011737` |
| North Beacon Street | `14372-0-0` | `8639366` (Soldiers Field Road) |

These candidates have essentially complete centerline coverage (99.87–100%). The OSM `48982004` trunk segment is named Storrow Drive but tags `hgv=yes`; the game's requested blanket NPC box-truck restriction on Storrow still applies. Genuine local Mugar records `9281-0-0`, `9282-0-0`, `7604-0-0` and `13240-0-0` remain unrestricted, as do local Charles Street and any separate Charlesbank Road. The compact candidate evidence is in [parkway-source-audit.json](./parkway-source-audit.json). This audit adds fourteen exact eligibility exceptions to the eight renamed carriageway records above; it does not broaden any name-based ban.
