import { describe, expect, test } from "bun:test"
import { goalRoundPrompt, goalWrapupPrompt } from "@/kilocode/goal/prompt"
import { normalizeObjective, normalizeMaxRounds, normalizeBlockReason, GoalId } from "@/kilocode/goal/types"
import { resolveConfig } from "@/kilocode/goal/config"
import { GoalService } from "@/kilocode/goal/service"
import { goalCommand } from "@/kilocode/goal/command"
import { closeReasonDecision, createDriveLock, evaluateDrive } from "@/kilocode/goal/admission"
import { directHuman, isGoalRound } from "@/kilocode/goal/authority"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import type * as Tool from "@/tool/tool"
import { Effect } from "effect"

describe("goal prompt", () => {
  test("round prompt re-injects the full objective", () => {
    const text = goalRoundPrompt({ objective: "ship the feature", round: 3, maxRounds: 10 })
    expect(text).toContain("<goal_round>")
    expect(text).toContain("ship the feature")
    expect(text).toContain("Round: 3/10")
  })

  test("complete wrapup asks for a closing message", () => {
    const text = goalWrapupPrompt("ship the feature")
    expect(text).toContain("<goal_complete>")
    expect(text).toContain("closing")
    expect(text).toContain("message to the user")
  })

  test("blocked wrapup carries the reason", () => {
    const text = goalWrapupPrompt("ship the feature", "missing credentials")
    expect(text).toContain("<goal_blocked>")
    expect(text).toContain("missing credentials")
  })
})

describe("goal types", () => {
  test("normalizeObjective trims and rejects empty", () => {
    expect(normalizeObjective("  build it  ")).toBe("build it")
    expect(() => normalizeObjective("   ")).toThrow()
  })

  test("normalizeMaxRounds rejects non-positive integers", () => {
    expect(normalizeMaxRounds(5)).toBe(5)
    expect(() => normalizeMaxRounds(0)).toThrow()
    expect(() => normalizeMaxRounds(1.5)).toThrow()
  })

  test("normalizeBlockReason validates code and message", () => {
    expect(normalizeBlockReason({ code: "no-credentials", message: "  missing  " })).toEqual({
      code: "no-credentials",
      message: "missing",
    })
    expect(() => normalizeBlockReason({ code: "Bad Code", message: "" })).toThrow()
  })

  test("GoalId is stable across re-branding", () => {
    const id = GoalId()
    expect(GoalId(id)).toBe(id)
  })
})

describe("goal config", () => {
  test("defaults are positive", () => {
    const cfg = resolveConfig()
    expect(cfg.defaultMaxRounds).toBeGreaterThan(0)
    expect(cfg.blockedAfterConsecutiveRounds).toBeGreaterThan(0)
  })

  test("illegal env throws at load", () => {
    const prev = process.env["KILO_GOAL_MAX_ROUNDS"]
    process.env["KILO_GOAL_MAX_ROUNDS"] = "0"
    try {
      expect(() => resolveConfig()).toThrow(/KILO_GOAL_MAX_ROUNDS/)
    } finally {
      if (prev === undefined) delete process.env["KILO_GOAL_MAX_ROUNDS"]
      else process.env["KILO_GOAL_MAX_ROUNDS"] = prev
    }
  })
})

describe("goal admission", () => {
  test("completed and omitted evaluate", () => {
    expect(closeReasonDecision("completed")).toEqual({ action: "evaluate" })
    expect(closeReasonDecision(undefined)).toEqual({ action: "evaluate" })
  })

  test("error and interrupted disarm", () => {
    expect(closeReasonDecision("error")).toEqual({ action: "disarm" })
    expect(closeReasonDecision("interrupted")).toEqual({ action: "disarm" })
  })

  test("superseded skips without disarm", () => {
    expect(closeReasonDecision("superseded")).toEqual({ action: "skip" })
  })

  test("evaluateDrive admits only idle active armed with remaining rounds", () => {
    expect(evaluateDrive({ idleType: "busy", phase: "active", armed: true, roundsStarted: 0, maxRounds: 2 })).toEqual({
      action: "skip",
    })
    expect(evaluateDrive({ idleType: "idle", phase: "paused", armed: true, roundsStarted: 0, maxRounds: 2 })).toEqual({
      action: "skip",
    })
    expect(evaluateDrive({ idleType: "idle", phase: "active", armed: false, roundsStarted: 0, maxRounds: 2 })).toEqual({
      action: "skip",
    })
    expect(evaluateDrive({ idleType: "idle", phase: "active", armed: true, roundsStarted: 2, maxRounds: 2 })).toEqual({
      action: "block-round-limit",
    })
    expect(evaluateDrive({ idleType: "idle", phase: "active", armed: true, roundsStarted: 1, maxRounds: 2 })).toEqual({
      action: "admit",
    })
  })

  test("drive lock queues one pending slot and last reason wins", () => {
    const lock = createDriveLock()
    expect(lock.begin("ses", "completed")).toBe("enter")
    expect(lock.begin("ses", "completed")).toBe("queued")
    expect(lock.begin("ses", "interrupted")).toBe("queued")
    expect(lock.isDriving("ses")).toBe(true)
    expect(lock.end("ses")).toEqual({ reason: "interrupted" })
    expect(lock.isDriving("ses")).toBe(false)
    expect(lock.end("ses")).toBeUndefined()
  })
})

describe("goal authority", () => {
  test("direct human is non-synthetic user text", () => {
    expect(
      directHuman([{ info: { role: "user" }, parts: [{ type: "text", text: "go", synthetic: false }] }]),
    ).toBe(true)
    expect(
      directHuman([{ info: { role: "user" }, parts: [{ type: "text", text: "<goal_round>", synthetic: true }] }]),
    ).toBe(false)
  })

  test("quoted goal_round tag in human text is not a goal round", () => {
    expect(
      isGoalRound([{ info: { role: "user" }, parts: [{ type: "text", text: "see <goal_round>", synthetic: false }] }]),
    ).toBe(false)
    expect(
      isGoalRound([{ info: { role: "user" }, parts: [{ type: "text", text: "<goal_round>", synthetic: true }] }]),
    ).toBe(true)
  })
})

describe("goal service", () => {
  test("create arms, complete disarms, and durable state persists", async () => {
    const session = "goal-test-session"
    const created = await GoalService.create(session, { objective: "ship it" })
    expect(created.phase).toBe("active")
    expect(created.armed).toBe(true)
    expect(GoalService.isArmed(created.id)).toBe(true)

    const read = await GoalService.get(session)
    expect(read?.objective).toBe("ship it")

    const done = await GoalService.complete(session, created.id, created.revision)
    expect(done.phase).toBe("complete")
    expect(GoalService.isArmed(done.id)).toBe(false)
  })

  test("rejects stale revisions", async () => {
    const session = "goal-stale-session"
    const created = await GoalService.create(session, { objective: "ship it" })
    await expect(GoalService.complete(session, created.id, 999)).rejects.toThrow()
  })

  test("resume clears a previous block reason", async () => {
    const session = "goal-resume-session"
    const created = await GoalService.create(session, { objective: "ship it" })
    const blocked = await GoalService.block(session, created.id, created.revision, {
      code: "model-reported",
      message: "missing credentials",
    })
    expect(blocked.blockedReason?.code).toBe("model-reported")

    const resumed = await GoalService.resume(session, blocked.id, blocked.revision)
    expect(resumed.phase).toBe("active")
    expect(resumed.blockedReason).toBeUndefined()
    expect(resumed.armed).toBe(true)
  })

  test("paused goal cannot be directly blocked", async () => {
    const session = "goal-paused-block-session"
    const created = await GoalService.create(session, { objective: "ship it" })
    const paused = await GoalService.pause(session, created.id, created.revision)
    await expect(
      GoalService.block(session, paused.id, paused.revision, { code: "model-reported", message: "x" }),
    ).rejects.toThrow()
  })

  test("round-limit blocking is idempotent and armed-aware", async () => {
    const session = "goal-round-limit-session"
    const created = await GoalService.create(session, { objective: "ship it", maxRounds: 1 })
    // A single admitted round exhausts the budget.
    const admitted = await GoalService.admitRound(session)
    expect(admitted?.roundsStarted).toBe(1)

    const blocked = await GoalService.blockRoundLimit(session)
    expect(blocked?.phase).toBe("blocked")
    expect(blocked?.blockedReason?.code).toBe("round-limit")

    // A second call is a no-op (no active armed goal remains).
    expect(await GoalService.blockRoundLimit(session)).toBeUndefined()
  })

  test("clear removes durable and process-local state", async () => {
    const session = "goal-clear-session"
    const created = await GoalService.create(session, { objective: "ship it" })
    await GoalService.clear(session)
    expect(await GoalService.get(session)).toBeUndefined()
    expect(GoalService.isArmed(created.id)).toBe(false)
  })

  test("create after complete replaces the row", async () => {
    const session = "goal-create-after-complete"
    const first = await GoalService.create(session, { objective: "first" })
    await GoalService.complete(session, first.id, first.revision)
    const second = await GoalService.create(session, { objective: "second" })
    expect(second.objective).toBe("second")
    expect(second.id).not.toBe(first.id)
    expect(second.phase).toBe("active")
    expect(second.revision).toBe(1)
    expect(second.armed).toBe(true)
  })

  test("complete is terminal", async () => {
    const session = "goal-complete-terminal"
    const created = await GoalService.create(session, { objective: "ship it" })
    const done = await GoalService.complete(session, created.id, created.revision)
    await expect(GoalService.pause(session, done.id, done.revision)).rejects.toThrow()
    await expect(GoalService.resume(session, done.id, done.revision)).rejects.toThrow()
  })

  test("edit rejects maxRounds below rounds already started", async () => {
    const session = "goal-edit-maxrounds"
    await GoalService.create(session, { objective: "ship it", maxRounds: 3 })
    await GoalService.admitRound(session)
    const second = await GoalService.admitRound(session)
    expect(second?.roundsStarted).toBe(2)
    await expect(GoalService.edit(session, second!.id, second!.revision, { maxRounds: 1 })).rejects.toThrow()
  })
})

describe("goal command", () => {
  test("exposes a /goal command", () => {
    const cmd = goalCommand()
    expect(cmd.name).toBe("goal")
    expect(cmd.hints).toContain("$ARGUMENTS")
    expect(typeof cmd.template).toBe("string")
    expect(cmd.template).toContain("get_goal")
  })
})

describe("goal tool wiring", () => {
  const def = (id: string): Tool.Def => ({
    id,
    description: id,
    parameters: {} as Tool.Def["parameters"],
    execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
  })

  test("goal tools are emitted when the registry receives them", () => {
    const tools = {
      recall: def("recall"),
      managerModels: def("agent_manager_models"),
      memory: def("kilo_memory_recall"),
      save: def("kilo_memory_save"),
      manager: def("agent_manager"),
      process: def("background_process"),
      chart: def("chart"),
      image: def("generate_image"),
      notify: def("notify_user"),
      send: def("send_file"),
      getGoal: def("get_goal"),
      createGoal: def("create_goal"),
      updateGoal: def("update_goal"),
    }
    const ids = KiloToolRegistry.extra(tools, {}).map((tool) => tool.id)
    expect(ids).toContain("get_goal")
    expect(ids).toContain("create_goal")
    expect(ids).toContain("update_goal")
  })
})
