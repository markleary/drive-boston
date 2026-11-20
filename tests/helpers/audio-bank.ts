import provenance from '../../public/audio/provenance.json' with {type:'json'};

// The fountain loads on approach. Desktop driving preloads every other shipped effect.
export const desktopDrivingSoundCount=provenance.clips.filter(clip=>clip.id!=='pond-fountain').length;
