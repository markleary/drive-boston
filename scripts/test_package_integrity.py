import copy
import gzip
import json
import pathlib
import struct
import tempfile
import unittest

from package_integrity import validate_package


def container(magic, header, payload=b''):
 text=json.dumps(header,separators=(',',':')).encode()
 raw=magic+struct.pack('<I',len(text))+text
 return raw+b'\0'*((-len(raw))%4)+payload


class PackageIntegrityTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=pathlib.Path(self.tmp.name);(self.root/'tiles').mkdir()
  self.building={'id':'a','center':[2,2],'footprint':[[1,1],[3,1],[1,3]],'anchor':[2,0,2],'height':1,'baseElevation':0,'v':3,'f':3,'r':0}
  self.header={'tx':0,'tz':0,'size':1000,'indexBytes':2,'vertexCount':3,'buildings':[self.building]}
  self.city={k:[] for k in ('coverage','landmarkBuildings','roads','signals','landmarks','neighborhoods','parks','water','sources')}
  self.city.update(origin={'xFeet':40000,'yFeet':50000,'longitude':-71.07,'latitude':42.35},bounds={'minX':0,'maxX':6,'minZ':0,'maxZ':6},spawn={'x':4,'z':4,'yaw':0},elevation={'encoding':'int16-gzip','width':2,'height':2,'cellSize':6,'originX':0,'originZ':0,'file':'elevation.bin','source':'elevation-source.bin','scale':.01},tiles={'size':1000,'keys':['0_0'],'directory':'tiles','far':'far.bin','buildingCount':1},tunnels={'files':['tunnel.json']})
  self.json('city.json',self.city);self.json('provenance.json',{'region':'metro'})
  self.json('transit.json',{'routes':[]});self.json('tunnel.json',{'roads':[],'landmarks':[],'sources':[]})
  self.gzip('elevation.bin',b'\0'*8);self.gzip('elevation-source.bin',b'\0'*8)
  self.tile();self.far()

 def json(self,name,value):
  (self.root/name).write_text(json.dumps(value))

 def gzip(self,name,value):
  (self.root/name).write_bytes(gzip.compress(value,mtime=0))

 def tile(self,header=None,indices=(0,1,2),tail=b''):
  header=header or self.header
  positions=struct.pack('<9h',-100,0,-100,100,0,-100,-100,100,100)
  positions+=b'\0'*((-len(positions))%4)
  faces=struct.pack('<3I' if header['indexBytes']==4 else '<3H',*indices)
  self.gzip('tiles/t_0_0.bin',container(b'DBT2',header,positions+faces+tail))

 def far(self,flags=0,fragment=False,offset=0):
  record=lambda flags:struct.pack('<HHhBB6h',3,100,0,flags,0,10,10,30,10,10,30)
  records=record(flags)+(record(flags|12) if fragment else b'')
  self.gzip('far.bin',container(b'DBF2',{'size':1000,'tiles':[{'key':'0_0','offset':offset,'count':1+fragment}]},records))

 def check(self):return validate_package(self.root)

 def test_complete_package_and_both_index_widths(self):
  self.assertEqual(self.check(),{'tiles':1,'buildings':1,'triangles':1,'elevationSamples':4})
  self.header['indexBytes']=4;self.tile();self.assertEqual(self.check()['triangles'],1)

 def test_hidden_fragments_are_not_counted_as_buildings(self):
  self.far(flags=4,fragment=True);self.assertEqual(self.check()['buildings'],1)

 def test_startup_metadata_requires_numeric_fields(self):
  valid=copy.deepcopy(self.city)
  for group in ('origin','bounds','spawn'):
   for malformed in ({},None,[]):
    with self.subTest(group=group,value=malformed):
     self.city={**valid,group:malformed};self.json('city.json',self.city)
     with self.assertRaisesRegex(ValueError,f'invalid city {group}'):self.check()
   for field in valid[group]:
    with self.subTest(group=group,field=field,value='missing'):
     self.city=copy.deepcopy(valid);del self.city[group][field];self.json('city.json',self.city)
     with self.assertRaisesRegex(ValueError,f'invalid city {group}'):self.check()
    for value in (None,True,'0',float('nan'),float('inf'),10**400):
     with self.subTest(group=group,field=field,value=value):
      self.city=copy.deepcopy(valid);self.city[group][field]=value;self.json('city.json',self.city)
      with self.assertRaisesRegex(ValueError,f'invalid city {group}|non-finite JSON'):self.check()

 def test_bounds_are_ordered_and_spawn_is_inside_them(self):
  valid=copy.deepcopy(self.city)
  for field,value in (('maxX',0),('maxZ',-1),('maxX',1e39)):
   with self.subTest(field=field,value=value):
    self.city=copy.deepcopy(valid);self.city['bounds'][field]=value;self.json('city.json',self.city)
    with self.assertRaisesRegex(ValueError,'bounds order or runtime range'):self.check()
  for field,value in (('x',-1),('x',7),('z',-1),('z',7)):
   with self.subTest(field=field,value=value):
    self.city=copy.deepcopy(valid);self.city['spawn'][field]=value;self.json('city.json',self.city)
    with self.assertRaisesRegex(ValueError,'spawn is outside bounds'):self.check()

 def test_startup_collections_must_be_arrays(self):
  valid=copy.deepcopy(self.city)
  for field in ('coverage','landmarkBuildings','roads','signals','landmarks','neighborhoods','parks','water','sources'):
   with self.subTest(field=field):
    self.city={**valid,field:{}};self.json('city.json',self.city)
    with self.assertRaisesRegex(ValueError,'expected a runtime array'):self.check()
  self.city=copy.deepcopy(valid);del self.city['sources'];self.json('city.json',self.city)
  with self.assertRaisesRegex(ValueError,'city.json lacks sources'):self.check()

 def test_empty_manifest_tile_is_valid(self):
  self.city['tiles']['keys'].append('1_0');self.json('city.json',self.city)
  self.gzip('tiles/t_1_0.bin',container(b'DBT2',{'tx':1,'tz':0,'size':1000,'indexBytes':2,'vertexCount':0,'buildings':[]}))
  self.assertEqual(self.check()['tiles'],2)

 def test_missing_or_extra_tile_rejected(self):
  path=self.root/'tiles/t_0_0.bin';raw=path.read_bytes();path.unlink()
  with self.assertRaisesRegex(ValueError,'manifest differs'):self.check()
  path.write_bytes(raw);(self.root/'tiles/t_1_0.bin').write_bytes(raw)
  with self.assertRaisesRegex(ValueError,'manifest differs'):self.check()

 def test_truncated_geometry_and_unreferenced_bytes_rejected(self):
  path=self.root/'tiles/t_0_0.bin';raw=gzip.decompress(path.read_bytes())
  for corrupt in (raw[:-2],raw+b'\0\0'):
   self.gzip('tiles/t_0_0.bin',corrupt)
   with self.assertRaisesRegex(ValueError,'geometry bytes'):self.check()

 def test_out_of_range_index_rejected(self):
  self.tile(indices=(0,1,3))
  with self.assertRaisesRegex(ValueError,'index out of range'):self.check()

 def test_invalid_count_or_index_width_rejected(self):
  for field,value in (('vertexCount',4),('indexBytes',3)):
   header=copy.deepcopy(self.header);header[field]=value;self.tile(header)
   with self.assertRaisesRegex(ValueError,'count|index width'):self.check()

 def test_nonfinite_header_and_sidecar_numbers_rejected(self):
  for value in (float('nan'),float('inf')):
   header=copy.deepcopy(self.header);header['buildings'][0]['anchor'][1]=value;self.tile(header)
   with self.assertRaisesRegex(ValueError,'non-finite JSON'):self.check()
  self.tile();(self.root/'tunnel.json').write_text('{"roads":[],"landmarks":[],"sources":[],"bad":1e1000}')
  with self.assertRaisesRegex(ValueError,'non-finite JSON'):self.check()

 def test_duplicate_building_identity_rejected_across_tiles(self):
  self.city['tiles']['keys'].append('1_0');self.city['tiles']['buildingCount']=2;self.json('city.json',self.city)
  raw=gzip.decompress((self.root/'far.bin').read_bytes());length=struct.unpack_from('<I',raw,4)[0];record=raw[(8+length+3)&~3:]
  self.gzip('far.bin',container(b'DBF2',{'size':1000,'tiles':[{'key':'0_0','offset':0,'count':1},{'key':'1_0','offset':len(record),'count':1}]},record*2))
  header=copy.deepcopy(self.header);header['tx']=1;header['buildings'][0]['center']=[1002,2]
  self.tile(header);(self.root/'tiles/t_1_0.bin').write_bytes((self.root/'tiles/t_0_0.bin').read_bytes());self.tile()
  with self.assertRaisesRegex(ValueError,'duplicate.*building ID'):self.check()

 def test_grid_dimension_mismatch_rejected(self):
  self.gzip('elevation-source.bin',b'\0'*6)
  with self.assertRaisesRegex(ValueError,'elevation byte count'):self.check()

 def test_grid_origins_are_required_finite_numbers(self):
  valid=copy.deepcopy(self.city['elevation'])
  for axis in ('originX','originZ'):
   with self.subTest(axis=axis,value='missing'):
    self.city['elevation']=copy.deepcopy(valid);del self.city['elevation'][axis];self.json('city.json',self.city)
    with self.assertRaisesRegex(ValueError,'elevation origins'):self.check()
   for value in (None,True,'0',float('nan'),float('inf'),10**400):
    with self.subTest(axis=axis,value=value):
     self.city['elevation']={**valid,axis:value};self.json('city.json',self.city)
     with self.assertRaisesRegex(ValueError,'elevation origins|non-finite JSON'):self.check()
  self.city['elevation']={**valid,'originX':-12.5,'originZ':6.25};self.json('city.json',self.city)
  self.assertEqual(self.check()['elevationSamples'],4)

 def test_grid_origin_sum_must_be_finite_in_runtime_precision(self):
  self.city['elevation'].update(originX=1e308,originZ=1e308);self.json('city.json',self.city)
  with self.assertRaisesRegex(ValueError,'elevation origins'):self.check()

 def test_grid_horizontal_mesh_coordinates_must_fit_float32(self):
  valid=copy.deepcopy(self.city['elevation'])
  for axis in ('originX','originZ'):
   for origin,cell in ((1e39,6),(-1e39,6),(3e38,1e38),(0,1e308)):
    with self.subTest(axis=axis,origin=origin,cell=cell):
     self.city['elevation']={**valid,axis:origin,'cellSize':cell};self.json('city.json',self.city)
     with self.assertRaisesRegex(ValueError,'runtime terrain coordinates'):self.check()

 def test_grid_cell_size_and_scale_are_positive_finite_numbers(self):
  valid=copy.deepcopy(self.city['elevation'])
  for field in ('cellSize','scale'):
   for value in (None,True,'6',0,-1,float('inf'),10**400):
    with self.subTest(field=field,value=value):
     self.city['elevation']={**valid,field:value};self.json('city.json',self.city)
     with self.assertRaisesRegex(ValueError,'dimensions/encoding|non-finite JSON'):self.check()

 def test_finite_json_that_overflows_runtime_float32_is_rejected(self):
  header=copy.deepcopy(self.header);header['buildings'][0]['anchor'][1]=1e39;self.tile(header)
  with self.assertRaisesRegex(ValueError,'non-finite runtime positions'):self.check()
  self.tile();self.city['elevation']['scale']=1e39;self.json('city.json',self.city)
  self.gzip('elevation.bin',struct.pack('<4h',1,0,0,0))
  with self.assertRaisesRegex(ValueError,'non-finite runtime heights'):self.check()

 def test_far_count_offset_and_fragment_parent_rejected(self):
  self.city['tiles']['buildingCount']=2;self.json('city.json',self.city)
  with self.assertRaisesRegex(ValueError,'far building count'):self.check()
  self.city['tiles']['buildingCount']=1;self.json('city.json',self.city)
  self.far(offset=1)
  with self.assertRaisesRegex(ValueError,'offset/count'):self.check()
  self.far(flags=8)
  with self.assertRaisesRegex(ValueError,'orphan'):self.check()

 def test_required_sidecar_must_exist_and_have_runtime_arrays(self):
  self.json('tunnel.json',{'roads':[]})
  with self.assertRaisesRegex(ValueError,'missing runtime arrays'):self.check()
  (self.root/'tunnel.json').unlink()
  with self.assertRaises(FileNotFoundError):self.check()


if __name__=='__main__':unittest.main()
