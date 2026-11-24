// Size-chart helpers. Charts are stored in cm; the UI shows cm or inches. Labels are English dictionary keys (show with t()).

import { translateAny, type MsgKey } from "./i18n";

export type Unit = "cm" | "in";
export const CM_PER_IN = 2.54;

export const DIMENSIONS: Record<string, MsgKey> = {
  height: "Height",
  bust: "Bust",
  underbust: "Underbust",
  chest: "Chest",
  waist: "Waist",
  hip: "Hip",
  torso_girth: "Torso girth",
  neck: "Neck",
  sleeve: "Sleeve / arm length",
  inseam: "Inseam",
  foot_length: "Foot length",
  foot_width: "Foot width",
};

export const GARMENT_DIMENSIONS: Record<string, string[]> = {
  dress: ["bust", "waist", "hip", "height"],
  bodysuit: ["bust", "waist", "hip", "torso_girth"],
  top: ["bust", "waist"],
  bottom: ["waist", "hip", "inseam"],
  shoes: ["foot_length", "foot_width"],
  other: ["bust", "waist", "hip"],
};

export const GARMENT_LABEL: Record<string, MsgKey> = {
  dress: "Dress", bodysuit: "Bodysuit / leotard", top: "Top / shirt", bottom: "Skirt / trousers", shoes: "Shoes", other: "Other",
};

/** Standard measuring instructions shown to customers. */
export const HOW_TO_MEASURE: Record<string, MsgKey> = {
  height: "Stand straight against a wall without shoes; measure from the floor to the top of your head.",
  bust: "Around the fullest part of the bust, keeping the tape level under the arms. Wear the bra you will dance in.",
  underbust: "Around the rib cage directly under the bust.",
  chest: "Around the fullest part of the chest, under the arms, with the tape level.",
  waist: "Around your natural waist - the narrowest point, usually just above the belly button. Keep one finger under the tape.",
  hip: "Around the fullest part of the hips and seat, feet together.",
  torso_girth: "From the top of one shoulder, down the front, through the legs and up the back to the same shoulder (for bodysuits and leotards).",
  neck: "Around the base of the neck, where a collar sits.",
  sleeve: "From the shoulder point, over a slightly bent elbow, to the wrist bone.",
  inseam: "From the crotch down the inside of the leg to the floor, without shoes.",
  foot_length: "Stand on paper with your heel against a wall; mark the tip of your longest toe and measure heel to mark. Measure both feet and use the longer one.",
  foot_width: "Around or across the widest part of the foot (the ball), standing with weight on it - follow the chart's convention.",
};

/** A chart's own label for a measurement wins (in the chosen language when it is a standard name); otherwise the standard name. */
export const dimLabel = (d: string, labels?: Record<string, string>) =>
  translateAny(labels?.[d] ?? DIMENSIONS[d] ?? d.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

export const fromCm = (v: number, unit: Unit) => (unit === "in" ? v / CM_PER_IN : v);
export const toCm = (v: number, unit: Unit) => (unit === "in" ? v * CM_PER_IN : v);

function fmtNum(v: number, unit: Unit): string {
  const x = fromCm(v, unit);
  const r = unit === "in" ? Math.round(x * 4) / 4 : Math.round(x * 10) / 10; // inches to the nearest 1/4
  return String(r);
}

export function fmtRange(r: [number, number] | undefined, unit: Unit): string {
  if (!r) return "–";
  const [lo, hi] = r;
  return lo === hi ? fmtNum(lo, unit) : `${fmtNum(lo, unit)}–${fmtNum(hi, unit)}`;
}

export function fmtLen(v: number, unit: Unit): string {
  return `${fmtNum(v, unit)} ${unit}`;
}

/** Parse "82-86", "82–86", "82 to 86" or "84" (in the given unit). Returns null when blank, undefined when invalid. */
export function parseRange(text: string): [number, number] | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(/\s*(?:-|–|—|to|~)\s*/i).filter(Boolean).map(Number);
  if (!parts.length || parts.length > 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return undefined;
  const [a, b = a] = parts;
  return [Math.min(a, b), Math.max(a, b)];
}
