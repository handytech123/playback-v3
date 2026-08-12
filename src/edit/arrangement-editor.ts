import { createHash, randomUUID } from "node:crypto";
import type {
  Cue,
  MusicalPosition,
  PreparedMidiEvent,
  PreparedSong,
  Region,
  StemMixSetting,
  TimeSignature,
} from "../domain/song.js";
import { preparedControl } from "../domain/song.js";
import { CLICK_TEMPLATES, requiredDefaultClickTemplate, type ClickTemplateId } from "../domain/click-templates.js";
import { positionToSeconds, secondsToMusicalPosition } from "../domain/grid.js";

export interface ArrangementSection extends Region {
  readonly sourceRegionId: string;
  readonly sourceStartSeconds: number;
  readonly sourceEndSeconds: number;
}

export interface ArrangementCue extends Cue {
  readonly id: string;
  readonly enabled: boolean;
  readonly sourceRegionId: string;
  readonly sourceLeadSeconds: number;
}

export interface ArrangementMidiEvent extends PreparedMidiEvent {
  readonly id: string;
  readonly enabled: boolean;
  readonly sourceRegionId: string;
  readonly sourceAtSeconds: number;
}

export interface AppArrangementDraft {
  readonly schemaVersion: 1;
  readonly baseSongId: string;
  readonly sourceManifestPath?: string;
  readonly sourceFingerprint?: string;
  readonly sourceArrangementId?: string;
  readonly name: string;
  readonly baseKey: string;
  readonly baseBpm: number;
  readonly selectedKey: string;
  readonly selectedBpm: number;
  readonly timeSignature: TimeSignature;
  readonly clickTemplateId: ClickTemplateId;
  readonly durationSeconds: number;
  readonly sections: readonly ArrangementSection[];
  readonly cues: readonly ArrangementCue[];
  readonly midi: readonly ArrangementMidiEvent[];
  readonly stemMix: readonly StemMixSetting[];
  readonly revision: number;
}

export type ArrangementCommand =
  | { readonly type: "rename-section"; readonly sectionId: string; readonly name: string }
  | { readonly type: "move-section"; readonly sectionId: string; readonly toIndex: number }
  | { readonly type: "duplicate-section"; readonly sectionId: string; readonly newSectionId?: string }
  | { readonly type: "delete-section"; readonly sectionId: string }
  | { readonly type: "split-section"; readonly atPosition: MusicalPosition; readonly newSectionId?: string }
  | { readonly type: "create-region-from-selection"; readonly startPosition: MusicalPosition; readonly endPosition: MusicalPosition; readonly name: string }
  | { readonly type: "trim-start"; readonly atPosition: MusicalPosition }
  | { readonly type: "trim-end"; readonly atPosition: MusicalPosition }
  | { readonly type: "set-key-tempo"; readonly key: string; readonly bpm: number }
  | { readonly type: "set-click-template"; readonly templateId: ClickTemplateId }
  | { readonly type: "set-name"; readonly name: string }
  | { readonly type: "set-section-boundary"; readonly sectionId: string; readonly edge: "start" | "end"; readonly atPosition: MusicalPosition }
  | { readonly type: "set-cue-enabled"; readonly cueId: string; readonly enabled: boolean }
  | { readonly type: "set-cue-target"; readonly cueId: string; readonly targetRegionId: string }
  | { readonly type: "set-cue-time"; readonly cueId: string; readonly atPosition: MusicalPosition }
  | { readonly type: "set-midi-enabled"; readonly eventId: string; readonly enabled: boolean };

export function createArrangementDraft(
  song: PreparedSong,
  name = `${song.song.title} Arrangement`,
): AppArrangementDraft {
  const sections: ArrangementSection[] = renumberOccurrences(sourceTimelineSections(song));
  const sourceCues = song.liveAssets?.cues.map((cue) => ({
    phrase: cue.label,
    ...(cue.position ? { position: cue.position } : {}),
    atSeconds: cue.atSeconds,
    targetRegionId: cue.targetRegionId,
  })) ?? song.cues;
  const cues = sourceCues.flatMap((source) => {
    const section = sections.find((candidate) => candidate.id === source.targetRegionId);
    if (!section) return [];
    return {
      id: `cue-${section.id}`,
      phrase: section.name,
      atSeconds: source.atSeconds,
      targetRegionId: section.id,
      enabled: true,
      sourceRegionId: section.sourceRegionId,
      sourceLeadSeconds: Math.max(0, section.startSeconds - source.atSeconds),
    } satisfies ArrangementCue;
  });
  const midi = (preparedControl(song)?.proPresenterMidi ?? []).map((event, index) => {
    const section = sectionAt(sections, event.atSeconds) ?? sections.at(-1)!;
    return {
      ...event,
      id: `midi-${index + 1}`,
      enabled: true,
      sourceRegionId: section.sourceRegionId,
      sourceAtSeconds: event.atSeconds,
    } satisfies ArrangementMidiEvent;
  });
  return withMusicalLocations({
    schemaVersion: 1,
    baseSongId: String(song.song.id),
    sourceFingerprint: arrangementSourceFingerprint(song),
    sourceArrangementId: song.arrangement?.id ?? "original-song",
    name,
    baseKey: song.selectedKey,
    baseBpm: song.selectedBpm,
    selectedKey: song.selectedKey,
    selectedBpm: song.selectedBpm,
    timeSignature: song.timeSignature,
    clickTemplateId: song.liveAssets?.click.templateId ?? requiredDefaultClickTemplate(song.timeSignature),
    durationSeconds: song.durationSeconds,
    sections,
    cues,
    midi,
    stemMix: normalizeStemMix(song.stemMix, song.stems.length),
    revision: 0,
  });
}

export function normalizeStemMix(value: readonly StemMixSetting[] | undefined, stemCount: number): readonly StemMixSetting[] {
  return Array.from({ length: stemCount }, (_, index) => {
    const source = value?.find((item) => item.index === index);
    const gain = Number(source?.gain ?? 1);
    return {
      index,
      gain: Number.isFinite(gain) ? Math.max(0, Math.min(1.25, gain)) : 1,
      muted: Boolean(source?.muted),
      solo: Boolean(source?.solo),
      iem: Boolean(source?.iem),
    };
  });
}

function arrangementSourceFingerprint(song: PreparedSong): string {
  return [
    song.cacheFingerprint,
    song.arrangement?.id ?? "original-song",
    song.arrangement?.sourceSha256 ?? "",
    song.selectedKey,
    song.selectedBpm,
    `${song.timeSignature.numerator}/${song.timeSignature.denominator}`,
  ].join("|");
}

function sourceTimelineSections(song: PreparedSong): ArrangementSection[] {
  const regions = [...song.regions].sort((a, b) => a.startSeconds - b.startSeconds);
  const sections: ArrangementSection[] = [];
  let cursor = 0;
  for (const region of regions) {
    if (region.startSeconds > cursor + 0.0001) {
      sections.push({
        id: `source-gap-${sections.length + 1}`,
        name: cursor === 0 ? "Count Off" : "Gap",
        startSeconds: cursor,
        endSeconds: region.startSeconds,
        sourceRegionId: `source-gap-${sections.length + 1}`,
        sourceStartSeconds: cursor,
        sourceEndSeconds: region.startSeconds,
      });
    }
    sections.push({
      ...region,
      sourceRegionId: region.id,
      sourceStartSeconds: region.startSeconds,
      sourceEndSeconds: region.endSeconds,
    });
    cursor = Math.max(cursor, region.endSeconds);
  }
  if (song.durationSeconds > cursor + 0.0001) {
    sections.push({
      id: `source-tail-${sections.length + 1}`,
      name: "Tail",
      startSeconds: cursor,
      endSeconds: song.durationSeconds,
      sourceRegionId: `source-tail-${sections.length + 1}`,
      sourceStartSeconds: cursor,
      sourceEndSeconds: song.durationSeconds,
    });
  }
  return sections;
}

export function applyArrangementCommand(
  draft: AppArrangementDraft,
  command: ArrangementCommand,
): AppArrangementDraft {
  let sections = [...draft.sections];
  let cues = [...draft.cues];
  let midi = [...draft.midi];
  let key = draft.selectedKey;
  let bpm = draft.selectedBpm;
  let name = draft.name;
  let clickTemplateId = draft.clickTemplateId;
  const oldScale = draft.baseBpm / draft.selectedBpm;

  if (command.type === "rename-section") {
    assertName(command.name);
    sections = replace(sections, command.sectionId, (section) => ({
      ...section,
      name: command.name.trim(),
    }));
  } else if (command.type === "move-section") {
    const index = sections.findIndex((section) => section.id === command.sectionId);
    if (index < 0) throw new Error("Section not found");
    if (command.toIndex < 0 || command.toIndex >= sections.length) {
      throw new Error("Section destination is outside the arrangement");
    }
    const [item] = sections.splice(index, 1);
    sections.splice(command.toIndex, 0, item!);
  } else if (command.type === "duplicate-section") {
    const index = sections.findIndex((section) => section.id === command.sectionId);
    if (index < 0) throw new Error("Section not found");
    const source = sections[index]!;
    const id = command.newSectionId ?? `app-${randomUUID()}`;
    if (sections.some((section) => section.id === id)) throw new Error("Duplicate section ID");
    sections.splice(index + 1, 0, { ...source, id });
  } else if (command.type === "delete-section") {
    if (sections.length === 1) throw new Error("An arrangement must retain at least one section");
    const before = sections.length;
    sections = sections.filter((section) => section.id !== command.sectionId);
    if (sections.length === before) throw new Error("Section not found");
  } else if (command.type === "split-section") {
    sections = splitAt(sections, positionToSeconds(command.atPosition, draft.selectedBpm, draft.timeSignature), oldScale, command.newSectionId);
  } else if (command.type === "create-region-from-selection") {
    assertName(command.name);
    sections = createFromSelection(
      sections,
      positionToSeconds(command.startPosition, draft.selectedBpm, draft.timeSignature),
      positionToSeconds(command.endPosition, draft.selectedBpm, draft.timeSignature),
      command.name.trim(),
      oldScale,
    );
  } else if (command.type === "trim-start") {
    sections = trimStart(sections, positionToSeconds(command.atPosition, draft.selectedBpm, draft.timeSignature), oldScale);
  } else if (command.type === "trim-end") {
    sections = trimEnd(sections, positionToSeconds(command.atPosition, draft.selectedBpm, draft.timeSignature), oldScale);
  } else if (command.type === "set-key-tempo") {
    if (!command.key.trim()) throw new Error("Arrangement key is required");
    if (!Number.isFinite(command.bpm) || command.bpm <= 0) {
      throw new Error("Arrangement BPM must be positive");
    }
    key = command.key.trim();
    bpm = command.bpm;
  } else if (command.type === "set-name") {
    assertName(command.name);
    name = command.name.trim();
  } else if (command.type === "set-click-template") {
    const template = CLICK_TEMPLATES[command.templateId];
    if (!template || template.meter.numerator !== draft.timeSignature.numerator || template.meter.denominator !== draft.timeSignature.denominator) {
      throw new Error(`Click template does not match ${draft.timeSignature.numerator}/${draft.timeSignature.denominator}`);
    }
    clickTemplateId = command.templateId;
  } else if (command.type === "set-section-boundary") {
    sections = setSectionBoundary(sections, command.sectionId, command.edge, positionToSeconds(command.atPosition, draft.selectedBpm, draft.timeSignature), oldScale);
  } else if (command.type === "set-cue-enabled") {
    cues = replaceCue(cues, command.cueId, (cue) => ({ ...cue, enabled: command.enabled }));
  } else if (command.type === "set-cue-target") {
    const target = sections.find((section) => section.id === command.targetRegionId);
    if (!target) throw new Error("Cue destination section was not found");
    const selected = cues.find((cue) => cue.id === command.cueId);
    if (!selected) throw new Error("Cue not found");
    const previousTarget = sections.find((section) => section.id === selected.targetRegionId)!;
    const displaced = cues.find((cue) => cue.targetRegionId === target.id && cue.id !== selected.id);
    cues = cues.map((cue) => {
      if (cue.id === selected.id) return { ...cue, phrase: target.name, targetRegionId: target.id, sourceRegionId: target.sourceRegionId, sourceLeadSeconds: Math.max(0, target.startSeconds - cue.atSeconds) / oldScale };
      if (displaced && cue.id === displaced.id) return { ...cue, phrase: previousTarget.name, targetRegionId: previousTarget.id, sourceRegionId: previousTarget.sourceRegionId, sourceLeadSeconds: Math.max(0, previousTarget.startSeconds - cue.atSeconds) / oldScale };
      return cue;
    });
  } else if (command.type === "set-cue-time") {
    const selected = cues.find((cue) => cue.id === command.cueId);
    if (!selected) throw new Error("Cue not found");
    const target = sections.find((section) => section.id === selected.targetRegionId);
    if (!target) throw new Error("Cue destination section was not found");
    const atSeconds = Math.max(0, Math.min(target.startSeconds, positionToSeconds(command.atPosition, draft.selectedBpm, draft.timeSignature)));
    cues = replaceCue(cues, command.cueId, (cue) => ({ ...cue, atSeconds, sourceLeadSeconds: Math.max(0, target.startSeconds - atSeconds) / oldScale }));
  } else if (command.type === "set-midi-enabled") {
    let found = false;
    midi = midi.map((event) => {
      if (event.id !== command.eventId) return event;
      found = true;
      return { ...event, enabled: command.enabled };
    });
    if (!found) throw new Error("MIDI event was not found");
  }

  sections = renumberOccurrences(sections);
  const scale = draft.baseBpm / bpm;
  const reflowed = reflow(sections, scale);
  const retimedCues = retimeCues(draft.sections, cues, reflowed, scale);
  const retimedMidi = retimeMidi(midi, reflowed, scale);
  return withMusicalLocations({
    ...draft,
    name,
    selectedKey: key,
    selectedBpm: bpm,
    clickTemplateId,
    durationSeconds: reflowed.at(-1)!.endSeconds,
    sections: reflowed,
    cues: retimedCues,
    midi: retimedMidi,
    revision: draft.revision + 1,
  });
}

function withMusicalLocations<T extends AppArrangementDraft>(draft: T): T {
  const locate = (seconds:number) => secondsToMusicalPosition(seconds, draft.selectedBpm, draft.timeSignature);
  return {
    ...draft,
    sections: draft.sections.map(section => ({ ...section, startPosition: locate(section.startSeconds), endPosition: locate(section.endSeconds) })),
    cues: draft.cues.map(cue => ({ ...cue, position: locate(cue.atSeconds) })),
    midi: draft.midi.map(event => ({ ...event, position: locate(event.atSeconds) })),
  };
}

export function arrangementFingerprint(draft: AppArrangementDraft): string {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}

export function validateArrangementDraft(draft: AppArrangementDraft): readonly string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push("Arrangement name is missing");
  if (!draft.selectedKey.trim()) issues.push("Arrangement key is missing");
  if (!Number.isFinite(draft.selectedBpm) || draft.selectedBpm <= 0) issues.push("Arrangement BPM is invalid");
  const clickTemplate = CLICK_TEMPLATES[draft.clickTemplateId];
  if (!clickTemplate || clickTemplate.meter.numerator !== draft.timeSignature.numerator || clickTemplate.meter.denominator !== draft.timeSignature.denominator) issues.push("Arrangement click template is invalid");
  if (!draft.sections.length) issues.push("Arrangement has no sections");
  const ids = new Set<string>();
  for (const [index, section] of draft.sections.entries()) {
    if (ids.has(section.id)) issues.push(`Duplicate section ID: ${section.id}`);
    else ids.add(section.id);
    if (!section.name.trim()) issues.push(`Section ${index + 1} has no name`);
    if (section.sourceEndSeconds <= section.sourceStartSeconds) issues.push(`Empty source slice: ${section.name}`);
    if (section.endSeconds <= section.startSeconds) issues.push(`Empty timeline section: ${section.name}`);
    if (index === 0 && Math.abs(section.startSeconds) > 0.0001) issues.push("Arrangement does not start at zero");
    if (index > 0 && Math.abs(draft.sections[index - 1]!.endSeconds - section.startSeconds) > 0.0001) {
      issues.push(`Gap or overlap before ${section.name}`);
    }
  }
  const finalEnd = draft.sections.at(-1)?.endSeconds ?? 0;
  if (Math.abs(finalEnd - draft.durationSeconds) > 0.0001) issues.push("Arrangement duration does not match its sections");
  for (const cue of draft.cues) {
    const target = draft.sections.find((section) => section.id === cue.targetRegionId);
    if (!target || cue.atSeconds < 0 || cue.atSeconds > draft.durationSeconds) issues.push(`Invalid cue: ${cue.phrase}`);
    else if (cue.phrase !== target.name) issues.push(`Cue ${cue.phrase} does not announce ${target.name}`);
  }
  for (const event of draft.midi) {
    if (event.atSeconds < 0 || event.atSeconds > draft.durationSeconds) issues.push(`Invalid MIDI event at ${event.atSeconds}`);
  }
  return issues;
}

export class ArrangementEditorHistory {
  private past: AppArrangementDraft[] = [];
  private future: AppArrangementDraft[] = [];
  constructor(private current: AppArrangementDraft) {}
  get draft() { return this.current; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  execute(command: ArrangementCommand) {
    this.past.push(this.current);
    this.current = applyArrangementCommand(this.current, command);
    this.future = [];
    return this.current;
  }
  undo() {
    const value = this.past.pop();
    if (!value) throw new Error("Nothing to undo");
    this.future.push(this.current);
    return (this.current = value);
  }
  redo() {
    const value = this.future.pop();
    if (!value) throw new Error("Nothing to redo");
    this.past.push(this.current);
    return (this.current = value);
  }
  replace(draft: AppArrangementDraft) {
    this.current = draft;
    this.past = [];
    this.future = [];
    return this.current;
  }
}

function reflow(sections: readonly ArrangementSection[], scale = 1): ArrangementSection[] {
  let at = 0;
  return sections.map((section) => {
    const duration = (section.sourceEndSeconds - section.sourceStartSeconds) * scale;
    const result = { ...section, startSeconds: at, endSeconds: at + duration };
    at += duration;
    return result;
  });
}

function setSectionBoundary(
  sections: readonly ArrangementSection[],
  sectionId: string,
  edge: "start" | "end",
  atSeconds: number,
  scale: number,
): ArrangementSection[] {
  if (!Number.isFinite(atSeconds)) throw new Error("Region boundary is invalid");
  const index = sections.findIndex(section => section.id === sectionId);
  if (index < 0) throw new Error("Section not found");
  const leftIndex = edge === "start" ? index - 1 : index;
  const rightIndex = leftIndex + 1;
  if (leftIndex < 0) throw new Error("The arrangement must begin at 1.1; trim the song start to change it");
  if (rightIndex >= sections.length) throw new Error("Use Trim End to change the final song boundary");
  const left = sections[leftIndex]!;
  const right = sections[rightIndex]!;
  const minimum = Math.max(0.001, (60 / 400) * scale);
  if (atSeconds <= left.startSeconds + minimum || atSeconds >= right.endSeconds - minimum) {
    throw new Error("A region boundary must leave playable audio on both sides");
  }
  const delta = (atSeconds - left.endSeconds) / scale;
  const nextLeft = { ...left, sourceEndSeconds: left.sourceEndSeconds + delta };
  const nextRight = { ...right, sourceStartSeconds: right.sourceStartSeconds + delta };
  if (nextLeft.sourceEndSeconds <= nextLeft.sourceStartSeconds || nextRight.sourceEndSeconds <= nextRight.sourceStartSeconds) {
    throw new Error("That boundary would create an empty region");
  }
  return sections.map((section, itemIndex) => itemIndex === leftIndex ? nextLeft : itemIndex === rightIndex ? nextRight : section);
}

function retimeCues(
  oldSections: readonly ArrangementSection[],
  cues: readonly ArrangementCue[],
  next: readonly ArrangementSection[],
  scale: number,
): ArrangementCue[] {
  return next.flatMap((section) => {
    const existing = cues.find((cue) => cue.targetRegionId === section.id);
    const source = existing ?? cues.find((cue) => cue.sourceRegionId === section.sourceRegionId);
    if (!source) return [];
    const oldTarget = source
      ? oldSections.find((item) => item.id === source.targetRegionId)
      : undefined;
    const sourceLead = source.sourceLeadSeconds ?? (
      oldTarget ? Math.max(0, oldTarget.startSeconds - source.atSeconds) / scale : 0
    );
    return {
      id: existing?.id ?? `cue-${section.id}`,
      phrase: section.name,
      atSeconds: Math.max(0, section.startSeconds - sourceLead * scale),
      targetRegionId: section.id,
      enabled: source?.enabled ?? true,
      sourceRegionId: section.sourceRegionId,
      sourceLeadSeconds: sourceLead,
    };
  });
}

function retimeMidi(
  events: readonly ArrangementMidiEvent[],
  sections: readonly ArrangementSection[],
  scale: number,
): ArrangementMidiEvent[] {
  const templates = new Map<string, ArrangementMidiEvent>();
  for (const event of events) {
    const key = `${event.sourceRegionId}:${event.sourceAtSeconds}:${event.status}:${event.data1}:${event.data2}`;
    if (!templates.has(key)) templates.set(key, event);
  }
  const result: ArrangementMidiEvent[] = [];
  for (const section of sections) {
    for (const template of templates.values()) {
      if (
        template.sourceRegionId !== section.sourceRegionId ||
        template.sourceAtSeconds < section.sourceStartSeconds ||
        template.sourceAtSeconds >= section.sourceEndSeconds
      ) continue;
      const existing = events.find((event) =>
        event.id.startsWith(`${section.id}:`) &&
        event.sourceAtSeconds === template.sourceAtSeconds &&
        event.status === template.status &&
        event.data1 === template.data1 &&
        event.data2 === template.data2,
      );
      result.push({
        ...template,
        enabled: existing?.enabled ?? template.enabled,
        id: `${section.id}:${template.sourceAtSeconds}:${template.status}:${template.data1}`,
        atSeconds: section.startSeconds + (template.sourceAtSeconds - section.sourceStartSeconds) * scale,
      });
    }
  }
  return result.sort((a, b) => a.atSeconds - b.atSeconds);
}

function splitAt(
  sections: readonly ArrangementSection[],
  at: number,
  scale: number,
  newSectionId = `app-${randomUUID()}`,
): ArrangementSection[] {
  if (!Number.isFinite(at)) throw new Error("Split position is invalid");
  const index = sections.findIndex((section) => at > section.startSeconds + 0.0001 && at < section.endSeconds - 0.0001);
  if (index < 0) throw new Error("Split must be inside a section");
  const source = sections[index]!;
  const sourceSplit = source.sourceStartSeconds + (at - source.startSeconds) / scale;
  const left = { ...source, endSeconds: at, sourceEndSeconds: sourceSplit };
  const right = {
    ...source,
    id: newSectionId,
    startSeconds: at,
    sourceStartSeconds: sourceSplit,
  };
  return [...sections.slice(0, index), left, right, ...sections.slice(index + 1)];
}

function createFromSelection(
  sections: readonly ArrangementSection[],
  start: number,
  end: number,
  name: string,
  scale: number,
): ArrangementSection[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("Selection must have a start before its end");
  const containing = sections.find((section) => start >= section.startSeconds && end <= section.endSeconds);
  if (!containing) throw new Error("Create Region currently requires a selection inside one source section");
  let result = [...sections];
  if (start > containing.startSeconds + 0.0001) result = splitAt(result, start, scale);
  if (end < containing.endSeconds - 0.0001) result = splitAt(result, end, scale);
  const selected = result.find((section) => Math.abs(section.startSeconds - start) < 0.0001 && Math.abs(section.endSeconds - end) < 0.0001);
  if (!selected) throw new Error("Selection could not be aligned to a region");
  return replace(result, selected.id, (section) => ({ ...section, name }));
}

function trimStart(sections: readonly ArrangementSection[], at: number, scale: number): ArrangementSection[] {
  if (!Number.isFinite(at) || at < 0 || at >= sections.at(-1)!.endSeconds) throw new Error("Trim start is outside the arrangement");
  return sections
    .filter((section) => section.endSeconds > at)
    .map((section, index) => index === 0 && section.startSeconds < at
      ? { ...section, sourceStartSeconds: section.sourceStartSeconds + (at - section.startSeconds) / scale }
      : section);
}

function trimEnd(sections: readonly ArrangementSection[], at: number, scale: number): ArrangementSection[] {
  if (!Number.isFinite(at) || at <= 0 || at > sections.at(-1)!.endSeconds) throw new Error("Trim end is outside the arrangement");
  return sections
    .filter((section) => section.startSeconds < at)
    .map((section, index, array) => index === array.length - 1 && section.endSeconds > at
      ? { ...section, sourceEndSeconds: section.sourceStartSeconds + (at - section.startSeconds) / scale }
      : section);
}

function replace(
  items: ArrangementSection[],
  id: string,
  change: (section: ArrangementSection) => ArrangementSection,
): ArrangementSection[] {
  let found = false;
  const result = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return change(item);
  });
  if (!found) throw new Error("Section not found");
  return result;
}

function replaceCue(
  items: ArrangementCue[],
  id: string,
  change: (cue: ArrangementCue) => ArrangementCue,
): ArrangementCue[] {
  let found = false;
  const result = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return change(item);
  });
  if (!found) throw new Error("Cue not found");
  return result;
}

function sectionAt(sections: readonly ArrangementSection[], at: number) {
  return sections.find((section, index) => at >= section.startSeconds && (at < section.endSeconds || index === sections.length - 1));
}

function renumberOccurrences(sections: readonly ArrangementSection[]): ArrangementSection[] {
  const parsed = sections.map((section) => ({ section, match: section.name.trim().match(/^(Intro|Verse|Pre[- ]Chorus|Chorus|Bridge|Tag|Turnaround|Interlude|Instrumental|Breakdown|Outro|End)(?:\s+\d+)?$/i) }));
  const totals = new Map<string, number>();
  for (const item of parsed) if (item.match) { const key = item.match[1]!.toLowerCase().replace("-", " "); totals.set(key, (totals.get(key) ?? 0) + 1); }
  const seen = new Map<string, number>();
  return parsed.map(({ section, match }) => {
    if (!match) return section;
    const key = match[1]!.toLowerCase().replace("-", " "), total = totals.get(key) ?? 1;
    if (total < 2) return section;
    const occurrence = (seen.get(key) ?? 0) + 1; seen.set(key, occurrence);
    const canonical = key.split(" ").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
    return { ...section, name: `${canonical} ${occurrence}` };
  });
}

function assertName(value: string) {
  if (!value.trim()) throw new Error("Arrangement name must not be empty");
}
