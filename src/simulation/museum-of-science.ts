/** The Museum of Science on the Charles River Dam: which surveyed shell is which, and where the things the survey
 * leaves out stand. Every number is measured on the packaged shells (tests/museum-of-science.test.mjs holds them to
 * the tiles); the roles and the additions are an interpretation from photographs. */
export type MuseumRole = 'tower' | 'central' | 'wing' | 'omni' | 'planetarium' | 'low' | 'garage';
export const MUSEUM_ROLES: Readonly<Record<string, MuseumRole>> = {
  'BOS-GYWWT-GRMFW-BDPV4': 'tower', 'BOS-YLT5M-NS5OF-BOBFU': 'central', 'BOS-WLXE7-971YQ-YBIKK': 'omni', 'BOS-4HD9O-X2K16-RUF3I': 'planetarium',
  'BOS-5WQE0-ZJ1UC-58DQE': 'wing', 'BOS-177NN-ZMCS8-ALVWC': 'wing', 'BOS-C10KO-VKPUD-8Q412': 'wing', 'BOS-8PR2D-3A5CL-5HYK9': 'wing', 'BOS-U24VV-4O21L-KMB7Y': 'wing', 'BOS-J4LL9-2V6LB-BADEV': 'wing', 'BOS-VB9IR-3AP1N-7LRB4': 'wing', 'BOS-PQOF7-S0SSZ-38U40': 'wing',
  'BOS-0XWQG-MTIBM-1VH4L': 'low', 'BOS-37PCR-YZ5V8-HTQFM': 'low', 'CAM_BACB6-957MC-WMSBN': 'garage',
};
export const MUSEUM = {
  /** The tower's outline and roof, and the three walls that carry the name: toward the road, toward Boston, toward Cambridge. */
  tower: {
    id: 'BOS-GYWWT-GRMFW-BDPV4', top: 37.04, centre: [324.82, -1920.43] as [number, number],
    outline: [[317.967, -1914.924], [318.249, -1921.148], [324.27, -1930.024], [330.489, -1925.805], [332.632, -1920.708], [325.323, -1909.934]] as [number, number][],
    faces: [
      { mid: [327.38, -1927.915], normal: [.5614, -.8275], length: 7.51 }, { mid: [328.978, -1915.321], normal: [.8276, .5614], length: 13.02 }, { mid: [321.26, -1925.586], normal: [-.8275, -.5614], length: 10.73 },
    ] as { mid: [number, number]; normal: [number, number]; length: number }[],
  },
  /** The planetarium's drum: the dome stands on its flat roof. */
  planetarium: { id: 'BOS-4HD9O-X2K16-RUF3I', centre: [371.16, -1852.03] as [number, number], top: 16.41, radius: 9.76 },
};
export interface MuseumTurbine { position: [number, number, number]; roof: string; mast: number; rotor: number; yaw: number; phase: number; }
/** The Wind Turbine Lab: machines of several makes on the west wing's roof, the central building and the Omni theater. */
export function museumTurbines(): MuseumTurbine[] {
  const west = 'BOS-5WQE0-ZJ1UC-58DQE', along = (t: number): [number, number, number] => [306.3 + .8286 * t - .56 * 3.2, 18.28, -1963.4 + .56 * t + .8286 * 3.2];
  return [
    { position: along(22), roof: west, mast: 9.5, rotor: 1.8, yaw: 2.3, phase: .2 }, { position: along(31), roof: west, mast: 6, rotor: 1.05, yaw: 2.5, phase: 1.1 }, { position: along(40), roof: west, mast: 6, rotor: 1.05, yaw: 2.2, phase: .5 },
    { position: along(49), roof: west, mast: 7.5, rotor: 1.4, yaw: 2.6, phase: 1.7 },
    { position: [303.5, 32.21, -1912.5], roof: 'BOS-YLT5M-NS5OF-BOBFU', mast: 6.5, rotor: 1.1, yaw: 2.4, phase: .9 }, { position: [391, 24.62, -1884.5], roof: 'BOS-WLXE7-971YQ-YBIKK', mast: 9, rotor: 1.7, yaw: 2.45, phase: .4 },
  ];
}
/** The Tyrannosaurus (OpenStreetMap node at 42.36724 N, 71.06985 W, which the package's drive covers): on the verge
 * between the dam road's sidewalk and the Museum's drive, lengthwise along it, facing the traffic from Boston.
 * `half` is its plinth: across and along. */
export function museumStatue() { return { x: 437.75, z: -1891, yaw: .657, half: [1.6, 3.6] as [number, number] }; }
