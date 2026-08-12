import { basename, extname } from "node:path";

export function isReferenceAudio(name: string) {
  return /(?:^|[_\s-])(click|cue|cues|count|guide|reference|ref)(?:$|[_\s-])/i.test(basename(name, extname(name)));
}
