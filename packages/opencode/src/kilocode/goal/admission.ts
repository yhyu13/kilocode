// kilocode_change - new file
// Pure admission + re-entrancy helpers for the goal round driver. Kept free of
// SessionPrompt so tests can prove the idle protocol without a model.

export type GoalCloseReason = "completed" | "error" | "interrupted" | "superseded"

export type CloseDecision = { action: "skip" } | { action: "disarm" } | { action: "evaluate" }

/** Map a TurnClose reason to whether this idle may continue the goal. */
export function closeReasonDecision(reason: GoalCloseReason | undefined): CloseDecision {
  if (reason === "error" || reason === "interrupted") return { action: "disarm" }
  if (reason === "superseded") return { action: "skip" }
  return { action: "evaluate" }
}

export type AdmissionDecision =
  | { action: "skip" }
  | { action: "block-round-limit" }
  | { action: "admit" }

/** Decide whether an idle, armed, active goal may start another round. */
export function evaluateDrive(input: {
  idleType: string
  phase?: string
  armed?: boolean
  roundsStarted?: number
  maxRounds?: number
}): AdmissionDecision {
  if (input.idleType !== "idle") return { action: "skip" }
  if (input.phase !== "active" || !input.armed) return { action: "skip" }
  if ((input.roundsStarted ?? 0) >= (input.maxRounds ?? 0)) return { action: "block-round-limit" }
  return { action: "admit" }
}

/**
 * At-most-one in-flight drive per session, plus a single pending slot.
 * TurnClose of the goal turn fires while prompt() is still awaited; the
 * pending slot is how the next idle is not dropped.
 */
export function createDriveLock() {
  const driving = new Set<string>()
  const pending = new Map<string, GoalCloseReason | undefined>()

  return {
    begin(sessionID: string, reason: GoalCloseReason | undefined): "enter" | "queued" {
      if (driving.has(sessionID)) {
        pending.set(sessionID, reason)
        return "queued"
      }
      driving.add(sessionID)
      pending.delete(sessionID)
      return "enter"
    },
    end(sessionID: string): { reason: GoalCloseReason | undefined } | undefined {
      driving.delete(sessionID)
      if (!pending.has(sessionID)) return undefined
      const reason = pending.get(sessionID)
      pending.delete(sessionID)
      return { reason }
    },
    isDriving(sessionID: string): boolean {
      return driving.has(sessionID)
    },
  }
}
