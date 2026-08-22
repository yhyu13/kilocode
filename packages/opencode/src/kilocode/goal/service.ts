// kilocode_change - new file
// Goal service: process-local armed state plus the durable store. Activation
// (armed/disarmed) is never persisted; it is reset on process start so a
// restored session cannot resume execution without a fresh human resume.

import type { GoalId, GoalView } from "./types"
import * as store from "./store"
import { resolveConfig } from "./config"

const armed = new Set<string>()

function armedId(view: GoalView | undefined): GoalId | undefined {
  if (!view) return undefined
  return view.id
}

/** Reject a stale or missing compare-and-set reference. */
function expect(view: GoalView | undefined, id: GoalId, revision: number): GoalView {
  if (!view) throw new Error("no current goal")
  if (view.id !== id || view.revision !== revision) {
    throw new Error(`stale goal ref; current revision is ${view.revision}`)
  }
  return view
}

export const GoalService = {
  isArmed(id: GoalId): boolean {
    return armed.has(id)
  },

  arm(id: GoalId): void {
    armed.add(id)
  },

  disarm(id: GoalId): void {
    armed.delete(id)
  },

  async get(sessionID: string): Promise<GoalView | undefined> {
    const view = await store.get(sessionID)
    const id = armedId(view)
    if (!view || !id) return view
    return { ...view, armed: armed.has(id) }
  },

  async create(
    sessionID: string,
    input: { objective: string; maxRounds?: number },
  ): Promise<GoalView> {
    const view = await store.create(sessionID, input, { defaultMaxRounds: resolveConfig().defaultMaxRounds })
    armed.add(view.id)
    return { ...view, armed: true }
  },

  async edit(
    sessionID: string,
    id: GoalId,
    revision: number,
    input: { objective?: string; maxRounds?: number },
  ): Promise<GoalView> {
    const current = await store.get(sessionID)
    expect(current, id, revision)
    const view = await store.edit(sessionID, { id, revision }, input)
    return { ...view, armed: armed.has(view.id) }
  },

  async pause(sessionID: string, id: GoalId, revision: number): Promise<GoalView> {
    const current = await store.get(sessionID)
    expect(current, id, revision)
    const view = await store.transition(sessionID, { id, revision }, "paused")
    armed.delete(view.id)
    return { ...view, armed: false }
  },

  async resume(sessionID: string, id: GoalId, revision: number): Promise<GoalView> {
    const current = await store.get(sessionID)
    const cur = expect(current, id, revision)
    if (cur.roundsStarted >= cur.maxRounds) {
      throw new Error("goal round budget exhausted; increase maxRounds before resuming")
    }
    const view = await store.transition(sessionID, { id, revision }, "active")
    armed.add(view.id)
    return { ...view, armed: true }
  },

  async complete(sessionID: string, id: GoalId, revision: number): Promise<GoalView> {
    const current = await store.get(sessionID)
    expect(current, id, revision)
    const view = await store.transition(sessionID, { id, revision }, "complete")
    armed.delete(view.id)
    return { ...view, armed: false }
  },

  async block(
    sessionID: string,
    id: GoalId,
    revision: number,
    reason: { code: string; message: string },
  ): Promise<GoalView> {
    const current = await store.get(sessionID)
    expect(current, id, revision)
    const view = await store.transition(sessionID, { id, revision }, "blocked", { blockedReason: reason })
    armed.delete(view.id)
    return { ...view, armed: false }
  },

  /** Block an active, armed goal that has exhausted its round budget. */
  async blockRoundLimit(sessionID: string): Promise<GoalView | undefined> {
    const current = await store.get(sessionID)
    if (!current) return undefined
    if (current.phase !== "active" || !armed.has(current.id)) return undefined
    if (current.roundsStarted < current.maxRounds) return undefined
    const view = await store.transition(sessionID, { id: current.id, revision: current.revision }, "blocked", {
      blockedReason: {
        code: "round-limit",
        message: `Goal reached its configured limit of ${current.maxRounds} rounds.`,
      },
    })
    armed.delete(view.id)
    return { ...view, armed: false }
  },

  /** Remove the durable goal and its process-local armed state. */
  async clear(sessionID: string): Promise<void> {
    const current = await store.get(sessionID)
    await store.clear(sessionID)
    if (current) armed.delete(current.id)
  },

  /** Reserve the next round for an active, armed goal. */
  async admitRound(sessionID: string): Promise<GoalView | undefined> {
    const current = await store.get(sessionID)
    if (!current) return undefined
    if (current.phase !== "active" || !armed.has(current.id)) return undefined
    if (current.roundsStarted >= current.maxRounds) return undefined
    const view = await store.admitRound(sessionID, { id: current.id, revision: current.revision })
    armed.add(view.id)
    return { ...view, armed: true }
  },
}
