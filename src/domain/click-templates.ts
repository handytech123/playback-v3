import type { TimeSignature } from "./song.js";

export const CLICK_TEMPLATE_IDS = [
  "2-4-standard",
  "3-4-standard",
  "4-4-quarter",
  "4-4-eighth",
  "4-4-driving",
  "4-4-half-time",
  "6-8-full",
  "6-8-two-feel",
  "12-8-full",
  "12-8-four-feel",
] as const;

export type ClickTemplateId = typeof CLICK_TEMPLATE_IDS[number];

export interface ClickTemplateDefinition {
  readonly id: ClickTemplateId;
  readonly label: string;
  readonly meter: TimeSignature;
  /** Equally spaced template positions within one measure. */
  readonly positionsPerMeasure: number;
  /** One-based positions that produce a click. */
  readonly triggerPositions: readonly number[];
  /** Trigger positions that use the app-owned accent sound. */
  readonly accentPositions: readonly number[];
  readonly maxDurationSeconds?: number;
  readonly sourceReference: string;
}

export const CLICK_TEMPLATES: Readonly<Record<ClickTemplateId, ClickTemplateDefinition>> = {
  "2-4-standard": template("2-4-standard", "2/4 Standard", 2, 4, 2, [1, 2], [1], "2-4-standard.wav"),
  "3-4-standard": template("3-4-standard", "3/4 Standard", 3, 4, 3, [1, 2, 3], [1], "3-4-standard.wav"),
  "4-4-quarter": template("4-4-quarter", "4/4 Quarter", 4, 4, 4, [1, 2, 3, 4], [1], "4-4-quarter.wav"),
  "4-4-eighth": template("4-4-eighth", "4/4 Eighth", 4, 4, 8, [1, 2, 3, 4, 5, 6, 7, 8], [1], "4-4-eighth.wav"),
  "4-4-driving": template("4-4-driving", "4/4 Driving", 4, 4, 8, [1, 2, 3, 4, 5, 6, 7, 8], [1], "4-4-eighth.wav", 0.06),
  "4-4-half-time": template("4-4-half-time", "4/4 Half-Time", 4, 4, 4, [1, 2, 3, 4], [1, 3], "4-4-half-time.wav"),
  "6-8-full": template("6-8-full", "6/8 Full", 6, 8, 6, [1, 2, 3, 4, 5, 6], [1, 4], "6-8-full.wav"),
  "6-8-two-feel": template("6-8-two-feel", "6/8 Two Feel", 6, 8, 6, [1, 4], [1, 4], "6-8-two-feel.wav"),
  "12-8-full": template("12-8-full", "12/8 Full", 12, 8, 12, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [1, 4, 7, 10], "12-8-full.wav"),
  "12-8-four-feel": template("12-8-four-feel", "12/8 Four Feel", 12, 8, 12, [1, 4, 7, 10], [1, 4, 7, 10], "12-8-four-feel.wav"),
};

export function defaultClickTemplate(meter: TimeSignature): ClickTemplateId | null {
  const key = `${meter.numerator}/${meter.denominator}`;
  if (key === "2/4") return "2-4-standard";
  if (key === "3/4") return "3-4-standard";
  if (key === "4/4") return "4-4-quarter";
  if (key === "6/8") return "6-8-two-feel";
  if (key === "12/8") return "12-8-four-feel";
  return null;
}

export function requiredDefaultClickTemplate(meter: TimeSignature): ClickTemplateId {
  const id = defaultClickTemplate(meter);
  if (!id) throw new Error(`No click template is available for ${meter.numerator}/${meter.denominator}`);
  return id;
}

export function compatibleClickTemplates(meter: TimeSignature): readonly ClickTemplateDefinition[] {
  return CLICK_TEMPLATE_IDS.map((id) => CLICK_TEMPLATES[id]).filter(
    (value) => value.meter.numerator === meter.numerator && value.meter.denominator === meter.denominator,
  );
}

export function clickTemplate(id: ClickTemplateId, meter: TimeSignature): ClickTemplateDefinition {
  const value = CLICK_TEMPLATES[id];
  if (value.meter.numerator !== meter.numerator || value.meter.denominator !== meter.denominator) {
    throw new Error(`Click template ${id} does not match ${meter.numerator}/${meter.denominator}`);
  }
  return value;
}

function template(
  id: ClickTemplateId,
  label: string,
  numerator: number,
  denominator: number,
  positionsPerMeasure: number,
  triggerPositions: readonly number[],
  accentPositions: readonly number[],
  sourceReference: string,
  maxDurationSeconds?: number,
): ClickTemplateDefinition {
  return { id, label, meter: { numerator, denominator }, positionsPerMeasure, triggerPositions, accentPositions, sourceReference, ...(maxDurationSeconds ? { maxDurationSeconds } : {}) };
}
