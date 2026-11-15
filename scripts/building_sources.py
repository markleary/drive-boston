"""Recover uncarved surveyed shells from the retained, offline source archives.

Placement and identity belong to the installed package. Reuse its normalization
audit and anchor, and reject a different source instead of seating a replacement
building on today's (possibly excavated) terrain.
"""
import csv, importlib.util, io, pathlib, zipfile
import numpy as np
import tileformat


class SurveyBuildingSources:
 def __init__(self, directory):
  self.directory=pathlib.Path(directory);self.catalog=None;self.models={}
  spec=importlib.util.spec_from_file_location('building_source_compiler',pathlib.Path(__file__).with_name('build-city.py'))
  self.compiler=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.compiler)

 def model(self, identifier, source):
  if source not in ('boston-obj','cambridge-obj'):raise ValueError(f'{identifier}: cannot restore {source!r} from survey archives; rebuild from its retained source')
  if self.catalog is None:
   self.catalog={}
   for path in sorted(self.directory.glob('*-models.zip')):
    with zipfile.ZipFile(path) as archive:
     member='catalog/catalog.csv' if path.name.startswith('CAMB') else 'catalog.csv'
     if member not in archive.namelist():continue
     for row in csv.DictReader(io.StringIO(archive.read(member).decode('utf-8-sig'))):
      self.catalog.setdefault(row['Model_ID'],(path,row))
  if identifier not in self.catalog:raise ValueError(f'{identifier}: retained survey model is missing from {self.directory}')
  if identifier not in self.models:
   path,row=self.catalog[identifier]
   with zipfile.ZipFile(path) as archive:
    if source=='boston-obj':vertices,faces=self.compiler.parse_obj(row,archive)
    else:
     raw=archive.read(f'models/{identifier}_OBJ/{identifier}_OBJ.obj').decode('utf-8','replace');vertices=[];faces=[]
     for line in raw.splitlines():
      fields=line.split()
      if not fields:continue
      if fields[0]=='v':vertices.append([float(x) for x in fields[1:4]])
      elif fields[0]=='f':
       indices=[int(x.split('/')[0]) for x in fields[1:]];indices=[i-1 if i>0 else len(vertices)+i for i in indices]
       faces.extend([indices[0],indices[k],indices[k+1]] for k in range(1,len(indices)-1))
     vertices=[[(x-self.compiler.ORIGIN[0])*self.compiler.FT,z*self.compiler.FT,-(y-self.compiler.ORIGIN[1])*self.compiler.FT] for x,y,z in vertices]
   self.models[identifier]=(np.asarray(vertices,dtype=float),np.asarray(faces,dtype=np.int64))
  return self.models[identifier]

 def restore(self, entry):
  identifier=entry['id'];audit=entry.get('norm') or {};source=entry.get('source')
  if not {'min','max','ground','catalogGround','policy'}<=audit.keys():raise ValueError(f'{identifier}: source normalization audit is missing')
  vertices,faces=self.model(identifier,source)
  root,root_faces=self.model(audit.get('root',identifier),source)
  ground=audit['catalogGround'];policy=audit['policy']
  if policy=='legacy-backbay-feet':ground*=self.compiler.FT
  else:
   if ground is None:ground=float(root[:,1].min())
   else:ground=max(ground*self.compiler.FT if source=='cambridge-obj' else ground,float(root[:,1].min()))
   ground+=self.compiler.visible_floor(root,root_faces,ground)
  bounds=[round(float(vertices[:,1].min()),4),round(float(vertices[:,1].max()),4),round(float(ground),4)]
  if bounds!=[audit['min'],audit['max'],audit['ground']]:raise ValueError(f'{identifier}: retained survey heights do not match its normalization audit')
  anchor=[round(float((vertices[:,k].min()+vertices[:,k].max())/2),3) for k in (0,2)]
  if anchor!=[entry['anchor'][0],entry['anchor'][2]]:raise ValueError(f'{identifier}: retained survey position does not match its package anchor')
  if not entry.get('structure') and self.compiler.hull(vertices[:,[0,2]].tolist())!=entry['footprint']:raise ValueError(f'{identifier}: retained survey outline differs from its package identity')
  normalized=vertices.copy();normalized[:,1]=entry['baseElevation']+np.maximum(0,vertices[:,1]-ground)
  record=tileformat.mesh_record(normalized,faces,entry['anchor'],entry['baseElevation'],repair_winding=not entry.get('structure'))
  if record is None:raise ValueError(f'{identifier}: retained survey has no visible shell')
  return record
