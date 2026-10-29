"""Shared legacy landmark policy for the compiler, package updater and validator."""

# These landmarks are addressed before their detailed tiles stream in. Preserve
# their historic exact-mesh far flag even when no current road crosses the hull.
KEY_BUILDING_IDS={
 'BOS-1WKHX-X382F-V5VL1','BOS-KBIA4-2XA04-WNETP','BOS-Q6TUK-T7ZG3-2SJKK',
 'BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC',
 'BOS-0HKZL-2YJWH-V1GAU','BOS-2E9SM-83L3W-UVT08','BOS-4WO5X-6OJI5-G5S26',
 'BOS-HO11N-VJBYE-3RDXF','BOS-3R76C-CGBE8-V3V1H',
}


def exact_far_collision(building):
 return building['id'] in KEY_BUILDING_IDS or building.get('collision')=='mesh'
