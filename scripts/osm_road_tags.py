"""Interpret road dimensions without confusing a whole corridor with one ramp.

Widths remain prototype estimates. Imported MassGIS widths on OSM slip roads
can describe an entire right of way (30.5 m on a one-lane Memorial Drive ramp),
so explicit lane counts provide a plausibility check for link ways only.
"""
import math
import re


def width_metres(value):
 if value is None:return None
 text=str(value).strip().lower()
 imperial=re.fullmatch(r"(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*\")?",text)
 if imperial:return float(imperial[1])*.3048+float(imperial[2] or 0)*.0254
 match=re.fullmatch(r'(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|foot)?',text)
 if not match:return None
 width=float(match[1])*(.3048 if match[2] in ('ft','feet','foot') else 1)
 return width if math.isfinite(width) and width>0 else None


def lane_count(value):
 text=str(value or '').strip()
 return int(text) if re.fullmatch(r'[1-9]\d?',text) else None


def road_width(tags,default):
 width=width_metres(tags.get('width'));lanes=lane_count(tags.get('lanes'))
 if lanes and tags.get('highway','').endswith('_link') and width and width>lanes*4.5+2:
  width=None
 if width is None:width=lanes*3.3+1 if lanes else default
 return round(max(5,min(16,width)),2)


def source_layer(tags):
 """Relative topology, not a height to add blindly at every bridge endpoint."""
 text=str(tags.get('layer','0')).strip()
 return int(text) if re.fullmatch(r'[+-]?\d+',text) else 0


def bridge_source_layer(tags):
 layer=source_layer(tags)
 if tags.get('bridge') not in (None,'no') or layer>0:return layer if 'layer' in tags else 1
 return None
