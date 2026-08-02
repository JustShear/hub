import type { DecorationMethod } from "@prisma/client";

// Centralised, decoration-method-aware quality checklist — never hardcode
// checklist items inside a UI component or scatter them per screen. Every
// method shares a common base (artwork/placement/size/garment/damage/
// quantity are always relevant); print- and embroidery-specific quality
// items are added only where they materially differ, rather than forcing
// one universal checklist onto every method.

export interface QualityChecklistItem {
  key: string;
  label: string;
}

const BASE_CHECKLIST: QualityChecklistItem[] = [
  { key: "correct_artwork", label: "Correct artwork" },
  { key: "correct_placement", label: "Correct placement" },
  { key: "correct_size", label: "Correct size" },
  { key: "correct_garment", label: "Correct garment" },
  { key: "no_visible_damage", label: "No visible damage" },
  { key: "correct_quantity", label: "Correct quantity" },
];

const METHOD_SPECIFIC_CHECKLIST: Partial<Record<DecorationMethod, QualityChecklistItem[]>> = {
  DIGITAL_PRINT_DTF: [
    { key: "correct_colours", label: "Correct colours" },
    { key: "print_quality", label: "Print quality — no cracking, peeling or misprint" },
  ],
  SCREEN_PRINT: [
    { key: "correct_colours", label: "Correct colours" },
    { key: "print_quality", label: "Print quality — no cracking, peeling or misprint" },
  ],
  EMBROIDERY: [
    { key: "correct_colours", label: "Correct thread colours" },
    { key: "embroidery_quality", label: "Embroidery quality — no loose threads or puckering" },
  ],
  UNPRINTED: [],
  OTHER: [],
};

export function getQualityChecklist(decorationMethod: DecorationMethod): QualityChecklistItem[] {
  return [...BASE_CHECKLIST, ...(METHOD_SPECIFIC_CHECKLIST[decorationMethod] ?? [])];
}

// Whether a decoration method requires a quality check at all before a
// task can complete — every method does today (including UNPRINTED, since
// "no visible damage"/"correct quantity" still apply to an unprinted
// garment), but this stays a named, single decision point rather than an
// assumption embedded in the completion-eligibility check itself.
export function requiresQualityCheck(_decorationMethod: DecorationMethod): boolean {
  return true;
}
