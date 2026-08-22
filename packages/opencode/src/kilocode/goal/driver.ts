// kilocode_change - new file
// Goal round driver. Starts exactly one autonomous continuation per idle turn
// when the durable goal is active and the process-local armed flag is set. The
// continuation re-injects the full objective as a synthetic user prompt and
// runs the normal session loop.

import { Effect } from "effect"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { GoalService } from "./service"
import { goalRoundPrompt } from "./prompt"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode.goal" })
const driving = new Set<string>()

/** Drive at most one continuation for an idle session with an armed active goal. */
export async function driveGoal(sessionID: SessionID): Promise<void> {
  if (driving.has(sessionID)) return
  driving.add(sessionID)
  try {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const idle = await AppRuntime.runPromise(
      SessionStatus.Service.use((svc) => svc.get(sessionID)),
    )
    if (idle.type !== "idle") return

    // Fail closed on an exhausted round budget: block with a stable reason
    // instead of silently stalling an armed, active goal.
    if (await GoalService.blockRoundLimit(sessionID)) return

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
    driving.delete(sessionID)
  }
}
