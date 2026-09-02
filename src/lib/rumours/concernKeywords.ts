import type { RumourCategory } from "./types";

// Keyword triggers for the heuristic fallback (F2's degrade-loudly path,
// ROADMAP.md's F2 note) -- deliberately narrow phrases over single words,
// so "hurt" alone (too generic -- "hurt to watch," "hurt for the loss")
// doesn't fire; the phrase has to actually read like a report.
//
// Deliberately excludes 'other': the heuristic keyword matcher has no way
// to recognise a *novel* kind of concern it wasn't given a phrase list
// for -- only the LLM path, which can actually read the sentence, is
// trusted to use 'other'. A keyword matcher reaching for 'other' on
// anything it doesn't recognise would turn it into a catch-all for random
// chatter, which is exactly the false-flag risk PRD's edge cases warn
// against.
export const CONCERN_KEYWORDS: Record<Exclude<RumourCategory, "other">, string[]> = {
  weight_cut: [
    "missed weight",
    "miss weight",
    "weight cut",
    "cutting weight",
    "weigh-in",
    "weigh in",
    "overweight",
    "hydration issue",
    "pulled from weigh",
  ],
  injury: [
    "injury",
    "injured",
    "torn acl",
    "torn mcl",
    "torn meniscus",
    "surgery",
    "out with a",
    "medical withdrawal",
    "hurt his",
    "hurt her",
  ],
  camp_change: [
    "new camp",
    "new coach",
    "switched camps",
    "switched gyms",
    "left his gym",
    "left her gym",
    "parted ways with",
    "coaching change",
    "training camp change",
  ],
  short_notice_replacement: [
    "short notice",
    "steps in for",
    "replaces",
    "pulled from the card",
    "replacement bout",
    "injury replacement",
    "off the card",
  ],
};

export const CATEGORY_LABELS: Record<RumourCategory, string> = {
  weight_cut: "weight-cut",
  injury: "injury",
  camp_change: "camp-change",
  short_notice_replacement: "short-notice-replacement",
  other: "other",
};
