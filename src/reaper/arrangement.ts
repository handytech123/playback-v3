import type { MusicalPosition, Region, SongId, StemMixSetting, TimeSignature } from "../domain/song.js";
import type { ClickTemplateId } from "../domain/click-templates.js";

export interface ReaperMarker { readonly index:number;readonly name:string;readonly atSeconds:number; }
export interface ArrangementCue { readonly phrase:string;readonly position?:MusicalPosition;readonly atSeconds:number;readonly targetRegionId:string; }
export interface ArrangementMediaItem { readonly trackName:string;readonly positionSeconds:number;readonly lengthSeconds:number;readonly sourcePath:string|null;readonly sourceOffsetSeconds:number;readonly playRate:number; }
export interface ProPresenterMidiEvent { readonly position?:MusicalPosition;readonly atSeconds:number;readonly status:number;readonly channel:number;readonly data1:number;readonly data2:number;readonly kind:"note-on"|"note-off"|"control-change"|"other"; }
export interface ArrangementVersion {
  readonly schemaVersion:1;readonly id:string;readonly songId:SongId;readonly name:string;readonly sourceType:"reaper-import"|"app-edit";
  readonly sourcePath:string;readonly sourceSha256:string;readonly importedAt:string;readonly selectedKey:string|null;readonly selectedBpm:number;
  readonly timeSignature:TimeSignature;readonly durationSeconds:number;readonly regions:readonly Region[];readonly cueMarkers:readonly ArrangementCue[];
  readonly stemMix?: readonly StemMixSetting[];
  readonly clickTemplateId?: ClickTemplateId;
  readonly markers:readonly ReaperMarker[];readonly mediaItems:readonly ArrangementMediaItem[];readonly proPresenterMidi:readonly ProPresenterMidiEvent[];
  readonly slidesTrackName:string|null;readonly warnings:readonly string[];
}

export interface ArrangementDifference { readonly field:string;readonly original:unknown;readonly arrangement:unknown; }
export interface ArrangementImportPreview { readonly arrangement:ArrangementVersion;readonly differences:readonly ArrangementDifference[];readonly defaultAction:"import-as-new-version"; }
