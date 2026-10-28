import assert from 'node:assert/strict';
import test from 'node:test';
import {streetCharacter,storefrontStreet} from '../src/render/street-character.ts';

test('Boston name lists keep their authored roles while town streets follow their OpenStreetMap class',()=>{
  assert.equal(streetCharacter('Summer Street',13.7),'commercial','downtown Summer Street is a shopping street');
  assert.equal(streetCharacter('Summer Street',13.7,'secondary'),'residential',"Somerville's Summer Street is a residential hill street despite its name and width");
  assert.equal(streetCharacter('Porter Street',13.4,'residential'),'residential');
  assert.equal(streetCharacter('Linden Avenue',7,'residential'),'residential');
  assert.equal(streetCharacter('Massachusetts Avenue',14,'primary'),'commercial');
  assert.equal(streetCharacter('Highland Avenue',12,'secondary'),'commercial','the town corridor list still applies');
  assert.equal(streetCharacter('Mystic Avenue',16,'trunk'),'commercial');
  assert.equal(streetCharacter('Unnamed ramp',8,'primary_link'),'none');
  assert.equal(streetCharacter('Unnamed service',5,'service'),'none');
  assert.equal(streetCharacter('Newbury Street',10),'commercial');
  assert.equal(streetCharacter('Marlborough Street',9),'residential');
});

test('storefronts follow the same split between Boston widths and town classes',()=>{
  assert.equal(storefrontStreet('Summer Street',13.7),true);
  assert.equal(storefrontStreet('Summer Street',13.7,'secondary'),false,'no shop fronts on the Somerville houses');
  assert.equal(storefrontStreet('Broadway',14,'secondary'),true);
  assert.equal(storefrontStreet('Mystic Avenue',16,'primary'),true);
  assert.equal(storefrontStreet('Unnamed ramp',8,'primary_link'),false);
  assert.equal(storefrontStreet('Dorchester Avenue',12),true,'a wide named Boston street keeps its frontages');
});
