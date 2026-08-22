import { describe, expect, test } from "bun:test"
import { goalRoundPrompt, goalWrapupPrompt } from "@/kilocode/goal/prompt"
import { normalizeObjective, normalizeMaxRounds, normalizeBlockReason, GoalId } from "@/kilocode/goal/types"
import { resolveConfig } from "@/kilocode/goal/config"
import { GoalService } from "@/kilocode/goal/service"
import { goalCommand } from "@/kilocode/goal/command"
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
