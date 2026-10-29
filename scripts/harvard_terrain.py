"""Level Memorial Drive beneath the repaired Harvard/Massachusetts overpass.

The earlier metro grader treated the upper source ways as surface streets and
pulled a narrow embankment through the lower carriageways. Repair only the
local shared grid: a level cross-section in the travel corridor, surrounded by
a harmonic transition to untouched terrain. Both its road-height anchors and
outer boundary remain outside the patch, making repeated processing identical.
"""
import math

MEMORIAL_ROADS=['osm-138789021-0','osm-138789031-0']

def sample_grid(grid,heights,p):
 w=grid['width'];cell=grid['cellSize'];fx=(p[0]-grid['originX'])/cell;fz=(p[1]-grid['originZ'])/cell;i=int(fx);j=int(fz);tx=fx-i;tz=fz-j;k=j*w+i
 a,b,c,d=[float(heights[n]) for n in [k,k+1,k+w,k+w+1]]
 return a+(b-a)*tx+(c-a)*tz if tx+tz<=1 else d+(c-d)*(1-tx)+(b-d)*(1-tz)

def repair_memorial_terrain(city,heights,apply=True):
 grid=city['elevation'];cell=grid['cellSize'];w=grid['width'];by_id={r['id']:r for r in city['roads']}
 roads=[by_id[id] for id in MEMORIAL_ROADS]
 ends=sorted([p for r in roads for p in [r['points'][0],r['points'][-1]]])
 west=[sum(p[k] for p in ends[:2])/2 for k in [0,1]];east=[sum(p[k] for p in ends[2:])/2 for k in [0,1]]
 west_y=sum(sample_grid(grid,heights,p) for p in ends[:2])/2;east_y=sum(sample_grid(grid,heights,p) for p in ends[2:])/2
 length=math.dist(west,east);ux=(east[0]-west[0])/length;uz=(east[1]-west[1])/length
 bridge=by_id['osm-86792411-0'];center=[(bridge['points'][0][k]+bridge['points'][-1][k])/2 for k in [0,1]]
 center_s=(center[0]-west[0])*ux+(center[1]-west[1])*uz
 def location(x,z):
  dx=x-west[0];dz=z-west[1];return dx*ux+dz*uz,-dx*uz+dz*ux
 def plane(s):return west_y+(east_y-west_y)*s/length
 # Include the pavement, both sidewalk strips and the complete 6 m triangles
 # that support them. The halo is outside the street and fades to fixed land.
 core_length=75;core_half=16;outer_length=100;outer_half=24
 radius=outer_length+outer_half
 i0=max(1,math.floor((center[0]-radius-grid['originX'])/cell));i1=min(w-2,math.ceil((center[0]+radius-grid['originX'])/cell))
 j0=max(1,math.floor((center[1]-radius-grid['originZ'])/cell));j1=min(grid['height']-2,math.ceil((center[1]+radius-grid['originZ'])/cell))
 values={};free=[]
 for j in range(j0,j1+1):
  for i in range(i0,i1+1):
   s,cross=location(grid['originX']+i*cell,grid['originZ']+j*cell)
   if abs(s-center_s)>=outer_length or abs(cross)>=outer_half:continue
   k=j*w+i;values[k]=plane(s)
   if abs(s-center_s)>core_length or abs(cross)>core_half:free.append(k)
 # Interior starting values depend only on the fixed anchors, never on the
 # previous patch. Four-neighbour relaxation then reads an untouched boundary.
 for _ in range(500):
  for k in free:values[k]=sum(values[n] if n in values else float(heights[n]) for n in [k-1,k+1,k-w,k+w])/4
 scale=grid.get('scale',.01);changed=[];max_change=0
 for k,y in values.items():
  y=round(y/scale)*scale;delta=abs(float(heights[k])-y)
  if delta>1e-8:changed.append(k);max_change=max(max_change,delta)
  if apply:heights[k]=y
 return {'method':'Fixed-anchor Memorial underpass plane with harmonic shoulder; upper roads excluded','roads':MEMORIAL_ROADS,'vertices':len(values),'changedVertices':len(changed),'maxChangeMeters':round(max_change,4),'coreLengthMeters':core_length*2,'coreHalfWidthMeters':core_half,'outerLengthMeters':outer_length*2,'outerHalfWidthMeters':outer_half}
