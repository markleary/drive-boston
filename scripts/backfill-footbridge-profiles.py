#!/usr/bin/env python3
"""Add complete profiles to split footbridges without rebuilding survey meshes.

The normal build-metro.py writer retains bridgePoints before tile clipping.
This one-time repair reconstructs them from the shipped fragments instead. It
uses only Python's standard library and preserves each DBT2 geometry payload.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import json
import pathlib
import re
import struct
import tempfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
FRAGMENT=re.compile(r'^(.*?)-(-?\d+)_(-?\d+)_(\d+)$')

def source_id(path_id,tx,tz):
    match=FRAGMENT.fullmatch(path_id)
    if not match or (int(match[2]),int(match[3]))!=(tx,tz):
        raise ValueError(f'Invalid tile fragment ID: {path_id}')
    # Keep the preceding park-area component: osm-way-123-0 and -123-1
    # can be disconnected pieces of the same OSM way.
    return match[1]

def stitch(fragments):
    """Join one unambiguous endpoint chain; never invent a missing connection."""
    if not fragments:raise ValueError('No bridge fragments')
    if len(fragments)==1:return [list(p) for p in fragments[0]]
    ends=defaultdict(list)
    for i,points in enumerate(fragments):
        if len(points)<2 or points[0]==points[-1]:raise ValueError('Closed or empty bridge fragment')
        ends[tuple(points[0])].append(i);ends[tuple(points[-1])].append(i)
    terminals=[p for p,items in ends.items() if len(items)==1]
    if len(terminals)!=2 or any(len(items)>2 for items in ends.values()):
        raise ValueError('Bridge fragments must form one non-branching open chain')
    current=min(terminals);used=set();result=[]
    while True:
        candidates=[i for i in ends[current] if i not in used]
        if not candidates:break
        if len(candidates)!=1:raise ValueError('Ambiguous bridge fragment order')
        index=candidates[0];used.add(index);points=fragments[index]
        oriented=points if tuple(points[0])==current else list(reversed(points))
        result.extend([list(p) for p in (oriented if not result else oriented[1:])]);current=tuple(oriented[-1])
    if len(used)!=len(fragments):raise ValueError('Disconnected bridge fragments')
    return result

def read_header(path):
    with gzip.open(path,'rb') as stream:
        prefix=stream.read(8)
        if len(prefix)!=8 or prefix[:4]!=b'DBT2':raise ValueError(f'{path} is not a DBT2 tile')
        length=struct.unpack_from('<I',prefix,4)[0];header=stream.read(length)
        if len(header)!=length:raise ValueError(f'{path} has a truncated header')
        return json.loads(header)

def unpack(raw):
    if len(raw)<8 or raw[:4]!=b'DBT2':raise ValueError('Invalid DBT2 tile')
    length=struct.unpack_from('<I',raw,4)[0];offset=(8+length+3)//4*4
    if offset>len(raw):raise ValueError('Truncated DBT2 tile')
    return json.loads(raw[8:8+length]),raw[offset:]

def pack(header,payload):
    encoded=json.dumps(header,separators=(',',':')).encode()
    raw=b'DBT2'+struct.pack('<I',len(encoded))+encoded
    raw+=b'\0'*((-len(raw))%4)+payload
    buffer=io.BytesIO()
    # Same portable, filename-free deterministic gzip convention as tileformat.
    with gzip.GzipFile(fileobj=buffer,mode='wb',compresslevel=9,mtime=0) as stream:stream.write(raw)
    return buffer.getvalue()

def backfill(data_dir,check=False):
    groups=defaultdict(list);headers={}
    for file in sorted((pathlib.Path(data_dir)/'tiles').glob('t_*.bin')):
        header=read_header(file);headers[file]=header
        for path in header.get('parkPaths',[]):
            if path.get('bridge'):
                groups[source_id(path['id'],header['tx'],header['tz'])].append((file,path))
    if not headers:raise ValueError(f'No DBT2 tiles found in {data_dir}')
    changed=set();split=0;fragments=0
    for identifier,entries in sorted(groups.items()):
        if len(entries)<2:continue
        split+=1;fragments+=len(entries)
        existing=[path['bridgePoints'] for _,path in entries if 'bridgePoints' in path]
        if existing and any(points!=existing[0] for points in existing):
            raise ValueError(f'Conflicting complete profiles for {identifier}')
        # Preserve authoritative profiles written by the normal data pipeline,
        # which need not include synthetic tile intersection vertices.
        points=existing[0] if existing else stitch([path['points'] for _,path in entries])
        for file,path in entries:
            if path.get('bridgePoints')!=points:path['bridgePoints']=points;changed.add(file)
    digest=hashlib.sha256()
    for file in sorted(changed):
        old=gzip.decompress(file.read_bytes());_,payload=unpack(old)
        encoded=pack(headers[file],payload);decoded_header,decoded_payload=unpack(gzip.decompress(encoded))
        if decoded_header!=headers[file] or decoded_payload!=payload:raise AssertionError(f'DBT2 roundtrip failed: {file}')
        digest.update(file.name.encode()+b'\0'+hashlib.sha256(payload).digest())
        if not check:
            with tempfile.NamedTemporaryFile(dir=file.parent,prefix=file.name+'.',delete=False) as temporary:
                temporary.write(encoded);temp_path=pathlib.Path(temporary.name)
            temp_path.replace(file)
            if unpack(gzip.decompress(file.read_bytes()))[1]!=payload:raise AssertionError(f'Geometry changed: {file}')
    return {'tiles':len(headers),'bridgeFragments':sum(map(len,groups.values())),'sourceGroups':len(groups),
            'splitGroups':split,'splitFragments':fragments,'changedTiles':len(changed),'checkOnly':check,
            'geometryPayloadsVerified':len(changed),'geometryPayloadDigest':digest.hexdigest()}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'public/data')
    parser.add_argument('--check',action='store_true',help='Report missing metadata without writing tiles; exit 1 if changes are needed')
    args=parser.parse_args();result=backfill(args.data_dir,args.check);print(json.dumps(result,indent=2))
    if args.check and result['changedTiles']:raise SystemExit(1)

if __name__=='__main__':main()
