/** Street character for facade and storefront detailing. The original Back Bay
 * street lists keep their authored roles; elsewhere in Boston the classification
 * falls back to the surveyed carriageway width and the street-name suffix.
 * Town streets (Cambridge, Somerville, Brookline) carry their OpenStreetMap
 * class instead of a surveyed width, and the Boston name lists do not apply to
 * them: Somerville's Summer Street is a residential hill street, not the
 * downtown shopping street of the same name. */
const COMMERCIAL=/Newbury|Boylston|Stuart|Saint James|Huntington|Tremont|Francis|Washington|Charles|Hanover|Summer|Winter|Essex|Beach|Kneeland|Harrison|Brookline|Lansdowne|Massachusetts Avenue|Cambridge Street|Harvard Street|Harvard Avenue|Broadway|Centre Street|Dorchester Avenue|Blue Hill|Columbus|Warren Street|Main Street|Prospect Street|Somerville Avenue|Highland Avenue|Elm Street|Brighton Avenue|Western Avenue|North Harvard|Meridian|Bennington|Congress|State Street|Atlantic|Causeway|Canal Street|Seaport|Northern Avenue|Boylston|Beacon Street|Bowdoin|Cambridge Street|Medford Street|Mount Auburn|Brattle|Hampshire|Columbia Road|Adams Street|Neponset|Morrissey|Talbot|Bowdoin Street|Geneva|Hyde Park Avenue|South Street|Chestnut Hill Avenue|Washington Street/;
const RESIDENTIAL=/Commonwealth|Marlborough|Beacon|Dartmouth|Clarendon|Berkeley|Exeter|Parker|Calumet|Worthington|Wigglesworth|Smith|Hillside|Fisher|Alleghany|Chestnut|Mount Vernon|Pinckney|Revere|Joy|Temple|Louisburg/;
const STOREFRONT=/Newbury|Boylston|Dartmouth|Clarendon|Berkeley|Exeter|Stuart|Saint James|Huntington|Tremont|Francis|Parker|Charles|Washington|Summer|Winter|Essex|Beach|Kneeland|Harrison|Brookline|Lansdowne/;
/** The towns' shopping and through corridors; every other named local street there is residential. */
const TOWN_COMMERCIAL=/Massachusetts Avenue|Broadway|Somerville Avenue|Highland Avenue|Elm Street|Holland Street|College Avenue|Bow Street|Washington Street|Medford Street|Mystic Avenue|McGrath Highway|Cambridge Street|Hampshire Street|Prospect Street|Main Street|Mount Auburn Street|Brattle Street|John F. Kennedy Street|Church Street|Harvard Street|Harvard Avenue|Beacon Street|Boylston Street|Commonwealth Avenue|Brighton Avenue|Memorial Drive|Concord Avenue|Huron Avenue|First Street|Third Street|Binney Street|Western Avenue|Rindge Avenue|Cypress Street|Chestnut Hill Avenue|Route 9/;
const TOWN_MAIN=/^(motorway|trunk|primary)(_link)?$/,TOWN_LOCAL=/^(secondary|tertiary|residential|unclassified|living_street)$/;
const SUFFIX=/\b(Street|Avenue|Road|Place|Terrace|Court|Way|Square|Hill|Park|Drive|Lane)$/i;
const EXCLUDED=/alley|unnamed|private|ramp|connector|access/i;
export type StreetCharacter='commercial'|'residential'|'none';
export function streetCharacter(name:string,width:number,kind?:string):StreetCharacter{
  if(kind){
    if(EXCLUDED.test(name))return 'none';
    if(TOWN_COMMERCIAL.test(name)||TOWN_MAIN.test(kind))return 'commercial';
    return TOWN_LOCAL.test(kind)&&SUFFIX.test(name)?'residential':'none';
  }
  if(COMMERCIAL.test(name))return 'commercial';
  if(RESIDENTIAL.test(name))return 'residential';
  if(EXCLUDED.test(name))return 'none';
  if(width>=12)return 'commercial';
  if(width>=7&&SUFFIX.test(name))return 'residential';
  return 'none';
}
/** Shop frontages: the authored Back Bay list plus every wide named Boston street; in the towns, the named corridors and main roads. */
export function storefrontStreet(name:string,width:number,kind?:string){
  if(kind)return !EXCLUDED.test(name)&&(TOWN_COMMERCIAL.test(name)||TOWN_MAIN.test(kind)&&SUFFIX.test(name));
  return STOREFRONT.test(name)||(width>=11&&!EXCLUDED.test(name)&&SUFFIX.test(name));
}
