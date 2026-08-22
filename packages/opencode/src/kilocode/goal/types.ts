// kilocode_change - new file
// Pure goal-domain types for the Kilo goal harness. Kept free of host
// services (Database, Session, Effect) so the fold and tests can depend on
// them without dragging in the runtime.

/** Identifies one goal across its durable revisions. */
export type GoalId = string & { readonly __goalId: never }

/** Compare-and-set identity for one exact goal revision. */
export interface GoalRef {
  readonly id: GoalId
  readonly revision: number
}

/** Durable lifecycle phase. Activation (armed/disarmed) is process-local. */
export type GoalPhase = "active" | "paused" | "blocked" | "complete"

/** Stable machine-readable plus human-readable explanation for a blocked goal. */
export interface GoalBlockReason {
  readonly code: string
  readonly message: string
}

/** Full durable state of a goal, without the derived replay counters. */
export interface GoalSnapshot extends GoalRef {
  readonly objective: string
  readonly phase: GoalPhase
  readonly blockedReason?: GoalBlockReason
  readonly maxRounds: number
}

/** Current goal including replay counters and process-local activation. */
export interface GoalView extends GoalSnapshot {
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly armed: boolean
}

/** Input accepted when creating a goal. */
export interface CreateGoalInput {
  readonly objective: string
  readonly maxRounds?: number
}

/** Fields a goal edit may replace; at least one must be present. */
export interface EditGoalInput {
  readonly objective?: string
  readonly maxRounds?: number
}

/** Brand a raw string as a goal id. */
export function GoalId(value = `goal-${crypto.randomUUID()}`): GoalId {
  return value as GoalId
}

/** Normalize and validate an objective at the domain boundary. */
export function normalizeObjective(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("goal objective must be a non-empty string")
  }
  return value.trim()
}

/** Normalize and validate a positive safe-integer round cap. */
export function normalizeMaxRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("maxRounds must be a positive safe integer")
  }
  return value
}

/** Normalize and validate a policy-owned block reason. */
export function normalizeBlockReason(value: unknown): GoalBlockReason {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
  const code = record?.["code"]
  const message = record?.["message"]
  if (typeof code !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)
    || typeof message !== "string" || message.trim().length === 0) {
    throw new TypeError("block reason requires a lower-kebab-case code and a non-empty message")
  }
  return { code, message: message.trim() }
}
