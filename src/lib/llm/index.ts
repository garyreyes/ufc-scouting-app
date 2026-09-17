// Back-compat surface: `import { generateJson } from "../llm"` (the only
// caller today, scanFightForRumours.ts) resolves here unchanged --
// tsconfig's moduleResolution: "bundler" plus vitest's matching "@"->"./src"
// alias mean a directory import finds this index.ts the same way it found
// the single llm.ts file before Phase N split it up.
export { generateJson } from "./generateJson";
export { callModel, LlmQuotaError } from "./geminiClient";
export { MODEL_ID, QUOTA, MIN_CALL_INTERVAL_MS, DAILY_CALL_CAP } from "./models";
export { runMapReduce } from "./runMapReduce";
export { createMapReduceDeps } from "./createMapReduceDeps";
export { reserveLlmCall } from "./budget/reserveLlmCall";
export { logLlmCall } from "./budget/logLlmCall";
export { isWithinSurfaceSoftCap, isPastMinInterval, isWithinDailyCap, SURFACE_SOFT_CAPS } from "./budget/llmBudgetPolicy";
export { verifyClaims } from "./verifyClaims";
export { describeDegradation } from "./describeDegradation";
export { hashCanonicalJson } from "./promptHash";
export type {
  ModelRequest,
  ModelResponse,
  ClaimCheck,
  VerificationResult,
  Degradation,
  ReservationDecision,
} from "./types";
export type { MapReduceDeps, MapReduceOutcome, MapReduceSpec, MappedUnit } from "./runMapReduce";
