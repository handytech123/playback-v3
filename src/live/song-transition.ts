export type SongTransitionType="cue-next"|"stay-in-song"|"auto-link"|"overlap"|"crossfade";

export interface SongTransitionPlan{
  readonly fromSongIndex:number;
  readonly toSongIndex:number;
  readonly type:SongTransitionType;
  readonly durationSeconds:number;
  readonly continuePad:boolean;
}

export interface SongTransitionSettings{readonly overlapSeconds:number;readonly crossfadeSeconds:number;}
export const DEFAULT_SONG_TRANSITION_SETTINGS:SongTransitionSettings={overlapSeconds:5,crossfadeSeconds:5};

export function normalizeSongTransitionSettings(value:Partial<SongTransitionSettings>|null|undefined):SongTransitionSettings{
  const clamp=(candidate:unknown,fallback:number)=>Math.max(.5,Math.min(5,Number.isFinite(Number(candidate))?Number(candidate):fallback));
  return{overlapSeconds:clamp(value?.overlapSeconds,DEFAULT_SONG_TRANSITION_SETTINGS.overlapSeconds),crossfadeSeconds:clamp(value?.crossfadeSeconds,DEFAULT_SONG_TRANSITION_SETTINGS.crossfadeSeconds)};
}

export const DEFAULT_SONG_TRANSITION:Readonly<Pick<SongTransitionPlan,"type"|"continuePad">>={type:"cue-next",continuePad:true};

export function transitionDuration(type:SongTransitionType,outgoingLastSectionSeconds:number,incomingFirstSectionSeconds:number,settings:SongTransitionSettings=DEFAULT_SONG_TRANSITION_SETTINGS):number{
  const normalized=normalizeSongTransitionSettings(settings);
  if(type==="crossfade")return normalized.crossfadeSeconds;
  if(type==="overlap")return Math.max(0,Math.min(normalized.overlapSeconds,outgoingLastSectionSeconds,incomingFirstSectionSeconds));
  return 0;
}

export function validateSongTransition(plan:SongTransitionPlan,songCount:number):void{
  if(!Number.isInteger(plan.fromSongIndex)||!Number.isInteger(plan.toSongIndex)||plan.fromSongIndex<0||plan.toSongIndex!==plan.fromSongIndex+1||plan.toSongIndex>=songCount)throw new Error("Song transition must connect adjacent confirmed songs");
  if(!Number.isFinite(plan.durationSeconds)||plan.durationSeconds<0||plan.durationSeconds>5)throw new Error("Song transition duration must be between 0 and 5 seconds");
  const expectedTimed=plan.type==="crossfade"||plan.type==="overlap";
  if(expectedTimed&&plan.durationSeconds<=0)throw new Error(`${plan.type} requires a positive transition duration`);
  if(!expectedTimed&&plan.durationSeconds!==0)throw new Error(`${plan.type} cannot have an overlap duration`);
}
