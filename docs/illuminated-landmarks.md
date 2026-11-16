# Schrafft Center and the CITGO sign

Research and implementation: November 16, 2026. The seven user-supplied reference images informed the architecture and lettering; none is bundled as a game texture. Textures and detail geometry are original procedural artwork. These are researched game models, not measured facade reconstructions.

## Schrafft Center, 529 Main Street, Charlestown

The [Charlestown Preservation Society's historic-resource study](https://cps-ris.org/wp-content/uploads/2020/07/529-Main-Street.pdf), reproducing the Boston Landmarks Commission study, identifies a seven-storey Art Deco factory with brick, ceramic tile and limestone, and a 160-foot clock tower. The supplied Main Street and I-93 photographs establish the narrow limestone tower piers, green spandrels, shallow arched upper windows, striped base, red/pink rooftop lettering, white illuminated clocks and American flag.

`src/data/schrafft-shell.json` retains the bundled Boston Planning survey `BOS-4I23K-1VYBA-674WJ` from tile `0_-4`, including its original facade/roof indices and millimetre-rounded vertices. Its tower reaches world y=51.131 m; this survey envelope is retained rather than rescaling the building to the historic description's rounded height. Both render and collision use that same mesh. The exact far hull is suppressed so a generic slab cannot obscure the tower when the tile unloads.

The Main Street corner is world `(174.263, -3812.411)`. The short front runs southeast; the long factory side runs northeast. Windows, masonry details and lettering follow those planes. Four clocks and signs serve the tower's four sides; hidden elevations, lettering proportions and flag size are interpretations. Clock hands are decorative, not a simulation of Boston time. The flag waves on a small subdivided mesh. Night mode illuminates the clocks, lettering, selected windows and tower trim without extra shadow-casting lights.

Boston Planning survey attribution and PDDL terms remain in [DATA_SOURCES.md](../DATA_SOURCES.md).

## CITGO, Kenmore Square

The [Boston Landmarks Commission study](https://www.boston.gov/sites/default/files/imce-uploads/2018-09/citgo_sign_subcommittee_final_draft.pdf), pp. 8–10, documents two 60-foot square faces with rounded corners, a shallow three-facet red/orange pyramid, blue lettering, and steel supports above 660 Beacon Street. Its historic lighting uses 39 horizontal white rows and 18 nested triangles in a 28-second program. Modern LEDs reproduce the earlier neon appearance. The artwork, light wipes and flashes in the game follow that description; blue lettering stays illuminated. The mode selector keeps the sign illuminated throughout game night rather than enforcing a midnight shutdown.

[CITGO's official relocation project](https://bostonyouremyhome.net/) specifies a 120-foot eastward move and 30-foot rise. The game depicts the restored installation, not the temporary dismantled state. The old rooftop marker is [OpenStreetMap node 7599402961](https://www.openstreetmap.org/node/7599402961), approximately 42.34928° N, 71.09626° W. Its city projection is `(-1766.321, 102.158)`; the new center is `(-1729.745, 102.158)`. This is an approximate placement derived from the mapped marker and announced offset, not a construction survey. OSM-derived placement is © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

The northeast/southwest-facing cabinet is 18.288 m square. Its bottom is at y=47.743 m: the old host roof (26.407 m), historic 40-foot clearance, and 30-foot rise. The restored supports reach the existing redevelopment roof at 33.935 m. All support feet are checked against that host footprint. The lattice, platforms and inset southern feet are an interpretation fitted to the packaged building, not a structural drawing of the new frame. The source building named “CITGO Sign” is deliberately retained: it describes the old host building, not a rooftop cabinet.

## Runtime and verification

Both landmarks persist independently of detailed tile residency. Material changes follow the existing day/golden/night switch. CITGO's animation updates one shader uniform; it does not upload a new canvas every frame. Phone textures are reduced and emissive colors remain visible without postprocessing. No external texture downloads or live map calls are required.

`tests/illuminated-landmarks.test.mjs` checks survey fidelity, unique far-hull selection, restored dimensions/placement, roof support and the lighting cycle. `tests/illuminated-landmarks.spec.ts` exercises travel and day/night changes, checks browser/WebGL errors, and captures both sides of CITGO plus Main Street and I-93 views of Schrafft's.

Validation on November 16: production build and type check passed; seven targeted geometry/resource tests passed; desktop travel/day/night/street-driving and emulated-phone lighting tests passed with no browser or WebGL errors. Screenshot review included both sign faces, the flag, the highway approach and the Main Street driving view. Physical phones and the live deployment were not tested.
