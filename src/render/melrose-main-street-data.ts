/** Main Street north of Foster to the Essex/Upham block. The street-view
 * addresses are camera positions. Match the actual shop rows to the Main
 * Street edge of each packaged footprint in tile 0_-12. */
export interface MainStreetShop {
  name: string;
  subline?: string;
  /** Relative frontage within this building, read left to right from outside. */
  weight: number;
  signColor: string;
  letterColor: string;
  /** Canvas colour and, for striped awnings, the alternating colour. */
  awning?: string;
  stripe?: string;
}

export interface MainStreetFrontage {
  /** Index in the original footprint. wallFrames returns this edge facing the viewer. */
  edgeIndex: number;
  style: 'mansard' | 'bank' | 'bagel' | 'oriels' | 'seafood' | 'pharmacy' | 'modern' | 'clapboard' | 'tavern' | 'shop-row' | 'eastman' | 'florist';
  /** Approximate total height from the sidewalk to the parapet or roof deck. */
  height: number;
  wallColor: string;
  trimColor: string;
  shops: readonly MainStreetShop[];
}

const cream = '#f3ebd7';
const iron = '#2b3332';
const green = '#294a3e';

export const MAIN_STREET_FRONTAGES: Readonly<Record<string, MainStreetFrontage>> = {
  // West side, from Foster north. A slate mansard on the corner gives way to
  // two low commercial fronts before Larrabee's projecting double oriels.
  'osm-way-387274224': {
    edgeIndex: 3, style: 'mansard', height: 11.1, wallColor: '#ac6957', trimColor: '#e6e0cf',
    shops: [
      { name: 'EAGLE HILL HOMES', weight: 1, signColor: cream, letterColor: '#465149' },
      { name: 'RADA', subline: 'BOUTIQUE', weight: 1, signColor: green, letterColor: cream },
      { name: 'Lilah Rose', weight: 1.1, signColor: green, letterColor: '#d6b875' },
      { name: 'Family Opticians', weight: 1, signColor: green, letterColor: cream },
    ],
  },
  'osm-way-387274212': {
    edgeIndex: 3, style: 'bank', height: 6.6, wallColor: '#9e6956', trimColor: '#c3b8a7',
    shops: [{ name: 'Santander', weight: 1, signColor: '#bb392f', letterColor: cream, awning: '#b94238' }],
  },
  'osm-way-29801911': {
    edgeIndex: 2, style: 'bagel', height: 5.4, wallColor: '#dbd3bb', trimColor: '#474942',
    shops: [{ name: 'BRUEGGER’S BAGELS', subline: 'Jamba Juice', weight: 1, signColor: '#272927', letterColor: cream, awning: '#aa6153' }],
  },
  'osm-way-387274217': {
    edgeIndex: 2, style: 'oriels', height: 11.1, wallColor: '#a65f46', trimColor: '#53615c',
    shops: [
      { name: 'EdwardJones', subline: 'INVESTMENTS', weight: 1, signColor: '#373938', letterColor: cream, awning: '#45433e' },
      { name: 'JEFF CARBONE', subline: 'INSURANCE', weight: 1, signColor: '#41443f', letterColor: cream, awning: '#45433e' },
    ],
  },
  'osm-way-387274214': {
    edgeIndex: 2, style: 'seafood', height: 5.4, wallColor: '#dddccf', trimColor: '#424a40',
    shops: [
      { name: 'TURNER’S', subline: 'SEAFOOD GRILL & MARKET', weight: 1.5, signColor: '#696d53', letterColor: cream, awning: '#943b43', stripe: '#efe4d0' },
      { name: 'TURNER’S', subline: 'OYSTER BAR', weight: 1, signColor: '#696d53', letterColor: cream, awning: '#943b43', stripe: '#efe4d0' },
    ],
  },
  'osm-way-387274210': {
    edgeIndex: 2, style: 'pharmacy', height: 5.1, wallColor: '#e0ded3', trimColor: '#51635b',
    shops: [{ name: 'CVS/pharmacy', weight: 1, signColor: '#8e463b', letterColor: cream }],
  },
  'osm-way-29842349': {
    edgeIndex: 4, style: 'modern', height: 9.5, wallColor: '#ab7b62', trimColor: '#484e46',
    shops: [
      { name: 'Reading Cooperative Bank', weight: 1, signColor: '#4a5049', letterColor: cream },
      { name: 'CAFFÈ NERO', weight: 1, signColor: '#4a5049', letterColor: cream },
    ],
  },
  'osm-way-387274222': {
    edgeIndex: 3, style: 'clapboard', height: 8.1, wallColor: '#d9d8ce', trimColor: '#4d514d',
    shops: [
      { name: '', weight: 1, signColor: '#565953', letterColor: cream },
      { name: 'LEADING EDGE', subline: 'real estate', weight: 1.5, signColor: '#375579', letterColor: cream },
      { name: 'Victoria Hill', subline: 'Wine, Spirits & Gourmet', weight: 1.25, signColor: '#3d423e', letterColor: cream },
    ],
  },

  // East side, north of the existing bespoke YMCA. Shop arrays on this side
  // run north to south for a viewer facing the windows. Fields Court is the
  // opening between the single-storey brick-and-buff row and the Eastman Block.
  'osm-way-29654052': {
    edgeIndex: 0, style: 'tavern', height: 8.35, wallColor: '#8d5442', trimColor: '#494e45',
    shops: [{ name: 'RISING EAGLE', weight: 1, signColor: '#67645a', letterColor: cream, awning: '#626567', stripe: '#c6c4ba' }],
  },
  'osm-way-387274223': {
    edgeIndex: 0, style: 'shop-row', height: 5.3, wallColor: '#c2ac91', trimColor: '#958575',
    shops: [
      { name: 'STARBUCKS COFFEE', weight: 1.1, signColor: '#3b493e', letterColor: cream },
      { name: 'TENOCH', subline: 'MEXICAN', weight: 1, signColor: '#473a36', letterColor: cream },
      { name: 'the beauty cafe', weight: 1, signColor: '#51485a', letterColor: cream },
      { name: 'btone', subline: 'FITNESS', weight: 1, signColor: '#434550', letterColor: '#72b5b0' },
    ],
  },
  'osm-way-387274215': {
    edgeIndex: 0, style: 'eastman', height: 8.55, wallColor: '#995c4d', trimColor: '#303738',
    shops: [
      { name: 'PLAZA BARBER SHOP', weight: 1.04, signColor: iron, letterColor: '#e7ce93' },
      { name: 'BIG FIN', weight: 1, signColor: '#e4e7d8', letterColor: '#345847' },
      { name: 'BUCKALEW’S', subline: 'GENERAL STORE', weight: 1.13, signColor: '#d2d3c8', letterColor: '#343c3c' },
      { name: 'PLANTED', subline: 'ORGANIC CAFE', weight: .8, signColor: cream, letterColor: '#726d4c', awning: '#344366' },
    ],
  },
  'osm-way-387274220': {
    edgeIndex: 0, style: 'florist', height: 8.6, wallColor: '#9f7054', trimColor: '#65776b',
    shops: [
      { name: 'Affairs to Remember', subline: 'FLORIST', weight: .93, signColor: '#646e61', letterColor: cream },
      { name: 'PEPPERBERRY', subline: 'FLORIST & GIFT SHOP', weight: 1, signColor: '#687568', letterColor: cream, awning: '#3d4843', stripe: '#637065' },
    ],
  },
};
