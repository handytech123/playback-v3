import type { Cue, Region, SongId, TimeSignature } from "../domain/song.js";

export const SECTION_TYPES = ["start","intro","verse","pre-chorus","chorus","down-chorus","bridge","tag","turnaround","interlude","instrumental","breakdown","outro","end","other"] as const;
export type SectionType = typeof SECTION_TYPES[number];
export type MapReviewState = "draft" | "approved";

export interface EditableRegion extends Region {
  readonly sectionType: SectionType;
  readonly occurrence: number;
  readonly sourceLabel: string;
  readonly modifier: string | null;
  readonly approved: boolean;
}

export interface EditableCue extends Cue {
  readonly id: string;
  readonly enabled: boolean;
  readonly audioPath: string;
  readonly sourceLabel: string;
}

export interface OriginalSongMap {
  readonly schemaVersion: 1;
  readonly songId: SongId;
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  readonly durationSeconds: number;
  readonly reviewState: MapReviewState;
  readonly revision: number;
  readonly source: { readonly kind: "analyzer" | "reaper" | "app"; readonly path: string; readonly importedAt: string };
  readonly regions: readonly EditableRegion[];
  readonly cues: readonly EditableCue[];
}

export function renumberRegions(regions: readonly EditableRegion[]): readonly EditableRegion[] {
  const totals=new Map<SectionType,number>();for(const region of regions)totals.set(region.sectionType,(totals.get(region.sectionType)??0)+1);
  const seen=new Map<SectionType,number>();return regions.map((region)=>{const occurrence=(seen.get(region.sectionType)??0)+1;seen.set(region.sectionType,occurrence);return{...region,occurrence,name:formatRegionName(region.sectionType,occurrence,(totals.get(region.sectionType)??0)>1,region.modifier)};});
}

const aliases: readonly [RegExp, SectionType][] = [
  [/^pre[\s-]?chorus$/i,"pre-chorus"],[/^down[\s-]?chorus$/i,"down-chorus"],[/^turn[\s-]?around$/i,"turnaround"],
  [/^start$/i,"start"],[/^intro$/i,"intro"],[/^verse$/i,"verse"],[/^chorus$/i,"chorus"],[/^bridge$/i,"bridge"],
  [/^tag$/i,"tag"],[/^interlude$/i,"interlude"],[/^instrumental$/i,"instrumental"],[/^breakdown$/i,"breakdown"],[/^outro$/i,"outro"],[/^end$/i,"end"],
];

export function normalizeRegions(regions: readonly Region[]): readonly EditableRegion[] {
  return renumberRegions(regions.map((region)=>({...parseRegion(region),occurrence:1})));
}

export function formatRegionName(type:SectionType,occurrence:number,showOccurrence:boolean,modifier:string|null):string {
  const label=type==="other"?"Other":type.split("-").map((part)=>part[0]!.toUpperCase()+part.slice(1)).join(" ");
  return `${label}${showOccurrence?` ${occurrence}`:""}${modifier?` - ${modifier}`:""}`;
}

function parseRegion(region:Region):Omit<EditableRegion,"occurrence"> {
  const sourceLabel=region.name.trim(); const [structural,...modifierParts]=sourceLabel.split(/\s+-\s+/); const withoutNumber=structural!.replace(/\s*\d+\s*$/," ").trim();
  const sectionType=aliases.find(([pattern])=>pattern.test(withoutNumber))?.[1]??"other";
  return{...region,sectionType,sourceLabel,modifier:modifierParts.length?modifierParts.join(" - "):null,approved:false};
}
