#!/usr/bin/env python3
"""Check all shipped metro binaries without the exhaustive geometry replay."""
import argparse
import pathlib

from package_integrity import validate_package

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parents[1]/'public/data')
args=parser.parse_args()
result=validate_package(args.data_dir)
print('Validated package integrity: '+', '.join(f'{value:,} {key}' for key,value in result.items())+'.')
