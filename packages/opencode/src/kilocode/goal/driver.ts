// kilocode_change - new file
// Goal round driver. Starts exactly one autonomous continuation per idle turn
// when the durable goal is active and the process-local armed flag is set. The
// continuation re-injects the full objective as a synthetic user prompt and
// runs the normal session loop.
//
// TurnClose of the goal turn fires while prompt() is still awaited. The
// re-entrancy lock therefore holds across prompt() and records one pending
// slot so the next idle is not dropped.

import { Effect } from "effect"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { GoalService } from "./service"
import { goalRoundPrompt } from "./prompt"
import { closeReasonDecision, createDriveLock, evaluateDrive, type GoalCloseReason } from "./admission"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode.goal" })
const lock = createDriveLock()

/** Drive at most one continuation for an idle session with an armed active goal. */
export async function driveGoal(sessionID: SessionID, reason?: GoalCloseReason): Promise<void> {
  if (lock.begin(sessionID, reason) === "queued") return
  try {
    const close = closeReasonDecision(reason)
    if (close.action === "skip") return
    if (close.action === "disarm") {
      const current = await GoalService.get(sessionID)
      if (current) GoalService.disarm(current.id)
      return
    }

    const { AppRuntime } = await import("@/effect/app-runtime")
    const idle = await AppRuntime.runPromise(
      SessionStatus.Service.use((svc) => svc.get(sessionID)),
    )

    const snapshot = await GoalService.get(sessionID)
    const decision = evaluateDrive({
      idleType: idle.type,
      phase: snapshot?.phase,
      armed: snapshot?.armed,
      roundsStarted: snapshot?.roundsStarted,
      maxRounds: snapshot?.maxRounds,
    })
    if (decision.action === "skip") return
    if (decision.action === "block-round-limit") {
      await GoalService.blockRoundLimit(sessionID)
      return
    }

    const goal = await GoalService.admitRound(sessionID)
    if (!goal) return

    const { SessionPrompt } = await import("@/session/prompt")
    await AppRuntime.runPromise(
      SessionPrompt.Service.use((svc) =>
        Effect.orDie(
          svc.prompt({
            sessionID,
            agent: "goal",
            parts: [
              {
                type: "text",
                text: goalRoundPrompt({
                  objective: goal.objective,
                  round: goal.roundsStarted,
                  maxRounds: goal.maxRounds,
                }),
                synthetic: true,
              },
            ],
          }),
        ),
      ),
    )
  } catch (err) {
    log.warn("goal round failed", { sessionID, err })
    try {
      const goal = await GoalService.get(sessionID)
      if (goal) GoalService.disarm(goal.id)
    } catch (disarmErr) {
      log.warn("could not disarm failed goal", { sessionID, err: disarmErr })
    }
  } finally {
    const pending = lock.end(sessionID)
    if (pending) {
      void driveGoal(sessionID, pending.reason).catch((err) =>
        log.warn("goal driver failed", { sessionID, err }),
      )
    }
  }
}
