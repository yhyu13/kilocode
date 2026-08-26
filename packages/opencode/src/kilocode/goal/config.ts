// kilocode_change - new file
// Goal harness tunables. Kept out of the shared Config schema to avoid an
// upstream merge surface; overridable via environment variables.

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value)) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return parsed
}

export function resolveConfig() {
  return {
    defaultMaxRounds: positiveInt(process.env["KILO_GOAL_MAX_ROUNDS"], 256, "KILO_GOAL_MAX_ROUNDS"),
    blockedAfterConsecutiveRounds: positiveInt(
      process.env["KILO_GOAL_BLOCKED_AFTER"],
      3,
      "KILO_GOAL_BLOCKED_AFTER",
    ),
  }
}
