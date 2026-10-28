/** Street character for facade and storefront detailing. The original Back Bay
 * street lists keep their authored roles; everywhere else the classification
 * falls back to the surveyed carriageway width and the street-name suffix. */
const COMMERCIAL=/Newbury|Boylston|Stuart|Saint James|Huntington|Tremont|Francis|Washington|Charles|Hanover|Summer|Winter|Essex|Beach|Kneeland|Harrison|Brookline|Lansdowne|Massachusetts Avenue|Cambridge Street|Harvard Street|Harvard Avenue|Broadway|Centre Street|Dorchester Avenue|Blue Hill|Columbus|Warren Street|Main Street|Prospect Street|Somerville Avenue|Highland Avenue|Elm Street|Brighton Avenue|Western Avenue|North Harvard|Meridian|Bennington|Congress|State Street|Atlantic|Causeway|Canal Street|Seaport|Northern Avenue|Boylston|Beacon Street|Bowdoin|Cambridge Street|Medford Street|Mount Auburn|Brattle|Hampshire|Columbia Road|Adams Street|Neponset|Morrissey|Talbot|Bowdoin Street|Geneva|Hyde Park Avenue|South Street|Chestnut Hill Avenue|Washington Street/;
const RESIDENTIAL=/Commonwealth|Marlborough|Beacon|Dartmouth|Clarendon|Berkeley|Exeter|Parker|Calumet|Worthington|Wigglesworth|Smith|Hillside|Fisher|Alleghany|Chestnut|Mount Vernon|Pinckney|Revere|Joy|Temple|Louisburg/;
const STOREFRONT=/Newbury|Boylston|Dartmouth|Clarendon|Berkeley|Exeter|Stuart|Saint James|Huntington|Tremont|Francis|Parker|Charles|Washington|Summer|Winter|Essex|Beach|Kneeland|Harrison|Brookline|Lansdowne/;
const SUFFIX=/\b(Street|Avenue|Road|Place|Terrace|Court|Way|Square|Hill|Park|Drive|Lane)$/i;
const EXCLUDED=/alley|unnamed|private|ramp|connector|access/i;
export type StreetCharacter='commercial'|'residential'|'none';
export function streetCharacter(name:string,width:number):StreetCharacter{
  if(COMMERCIAL.test(name))return 'commercial';
  if(RESIDENTIAL.test(name))return 'residential';
  if(EXCLUDED.test(name))return 'none';
  if(width>=12)return 'commercial';
  if(width>=7&&SUFFIX.test(name))return 'residential';
  return 'none';
}
/** Shop frontages: the authored Back Bay list plus every wide named street. */
export function storefrontStreet(name:string,width:number){
  return STOREFRONT.test(name)||(width>=11&&!EXCLUDED.test(name)&&SUFFIX.test(name));
}
