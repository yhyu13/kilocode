import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SkillSlash } from "../../../src/kilocode/skills/slash"
import { SKILL_SHELL_DISABLED, SKILL_SHELL_UNTRUSTED } from "../../../src/kilocode/skills/display"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

function cmd(name: string, source: "skill" | "command", template: string, trusted = true): SkillSlash.Info {
  return { name, source, template, trusted, hints: [] }
}

const get = (items: SkillSlash.Info[]): SkillSlash.Get => (name) =>
  Effect.succeed(items.find((item) => item.name === name || `${item.name}:skill` === name))

describe("SkillSlash.peel", () => {
  test("collects consecutive slash tokens", () => {
    expect(SkillSlash.peel("/tdd leftover")).toEqual({ names: ["tdd"], rest: "leftover" })
    expect(SkillSlash.peel("/tdd /review do it")).toEqual({ names: ["tdd", "review"], rest: "do it" })
    expect(SkillSlash.peel("/review:skill")).toEqual({ names: ["review:skill"], rest: "" })
    expect(SkillSlash.peel("plain")).toEqual({ names: [], rest: "plain" })
  })
})

describe("SkillSlash.expand", () => {
  test("appends leftover text when the template has no placeholders", () => {
    expect(SkillSlash.expand("Use TDD.", "cover the bug")).toBe("Use TDD.\n\ncover the bug")
  })

  test("fills $ARGUMENTS", () => {
    expect(SkillSlash.expand("Do $ARGUMENTS", "this")).toBe("Do this")
  })
})

describe("SkillSlash.gate", () => {
  test("replaces live shell placeholders for untrusted skills", () => {
    expect(SkillSlash.gate("Run !`printf hi`", false, false)).toBe(`Run ${SKILL_SHELL_UNTRUSTED}`)
  })

  test("replaces live shell placeholders when the kill switch is on", () => {
    expect(SkillSlash.gate("Run !`printf hi`", true, true)).toBe(`Run ${SKILL_SHELL_DISABLED}`)
  })

  test("leaves live placeholders for trusted skills", () => {
    expect(SkillSlash.gate("Run !`printf hi`", true, false)).toBe("Run !`printf hi`")
  })
})

describe("SkillSlash.collect", () => {
  it.effect("collects extra skills and leftover text", () =>
    Effect.gen(function* () {
      const extra = yield* SkillSlash.collect(
        "/tdd leftover",
        get([cmd("tdd", "skill", "TDD.")]),
        "goal",
      )
      expect(extra.cmds.map((item) => item.name)).toEqual(["tdd"])
      expect(extra.rest).toBe("leftover")
    }),
  )

  it.effect("skips a duplicate of the primary skill", () =>
    Effect.gen(function* () {
      const extra = yield* SkillSlash.collect("/goal", get([cmd("goal", "skill", "Goal.")]), "goal")
      expect(extra.cmds).toEqual([])
      expect(extra.rest).toBe("")
    }),
  )

  it.effect("stops at a non-skill slash token", () =>
    Effect.gen(function* () {
      const extra = yield* SkillSlash.collect(
        "/tdd /init leftover",
        get([cmd("tdd", "skill", "TDD."), cmd("init", "command", "Init.")]),
        "goal",
      )
      expect(extra.cmds.map((item) => item.name)).toEqual(["tdd"])
      expect(extra.rest).toBe("/init leftover")
    }),
  )

  it.effect("resolves a :skill suffix", () =>
    Effect.gen(function* () {
      const extra = yield* SkillSlash.collect(
        "/review:skill",
        get([cmd("review", "skill", "Review.")]),
        "goal",
      )
      expect(extra.cmds.map((item) => item.name)).toEqual(["review"])
    }),
  )
})

describe("SkillSlash.render", () => {
  it.effect("passes leftover text as arguments when only one skill is invoked", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Do $ARGUMENTS"),
        arguments: "this",
        disabled: false,
        get: get([]),
      })
      expect(out).toBe("Do this")
    }),
  )

  it.effect("concatenates extra skill templates and leftover text", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Goal."),
        arguments: "/tdd leftover",
        disabled: false,
        get: get([cmd("tdd", "skill", "TDD.")]),
      })
      expect(out).toBe("Goal.\n\nTDD.\n\nleftover")
    }),
  )

  it.effect("gates extra untrusted skills independently of the primary", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Goal !`printf a`", true),
        arguments: "/proj",
        disabled: false,
        get: get([cmd("proj", "skill", "Proj !`printf b`", false)]),
      })
      expect(out).toBe(`Goal !\`printf a\`\n\nProj ${SKILL_SHELL_UNTRUSTED}`)
    }),
  )

  it.effect("gates leftover shell when the kill switch is on", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Goal."),
        arguments: "/tdd leftover !`whoami`",
        disabled: true,
        get: get([cmd("tdd", "skill", "TDD.")]),
      })
      expect(out).toBe(`Goal.\n\nTDD.\n\nleftover ${SKILL_SHELL_DISABLED}`)
    }),
  )

  it.effect("gates leftover shell when an extra skill is untrusted", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Goal."),
        arguments: "/proj leftover !`whoami`",
        disabled: false,
        get: get([cmd("proj", "skill", "Proj.", false)]),
      })
      expect(out).toBe(`Goal.\n\nProj.\n\nleftover ${SKILL_SHELL_UNTRUSTED}`)
    }),
  )

  it.effect("leaves leftover shell live when every skill is trusted", () =>
    Effect.gen(function* () {
      const out = yield* SkillSlash.render({
        cmd: cmd("goal", "skill", "Goal."),
        arguments: "/tdd leftover !`whoami`",
        disabled: false,
        get: get([cmd("tdd", "skill", "TDD.")]),
      })
      expect(out).toBe("Goal.\n\nTDD.\n\nleftover !`whoami`")
    }),
  )
})
