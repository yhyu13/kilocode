// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Config } from "@/config/config"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Exit } from "effect"
import { KiloPromptMinTokens } from "@/kilocode/session/prompt-min-tokens"
import { SessionID } from "@/session/schema"
import type { PromptInput } from "@/session/prompt"

const text = (s: string) => ({ type: "text", text: s })
const file = () => ({ type: "file", mime: "text/plain", url: "file:///tmp/a" })
const synthetic = (s: string) => ({ type: "text", text: s, synthetic: true })
const subtask = () => ({ type: "subtask", prompt: "x", description: "x", agent: "code" })

describe("KiloPromptMinTokens.resolve", () => {
  test("absent enables with defaults", () => {
    expect(KiloPromptMinTokens.resolve(undefined)).toEqual({
      enabled: true,
      minTokens: 100,
      action: "enrich",
    })
  })
  test("false disables", () => {
    expect(KiloPromptMinTokens.resolve(false).enabled).toBe(false)
  })
  test("true enables with defaults", () => {
    expect(KiloPromptMinTokens.resolve(true)).toEqual({ enabled: true, minTokens: 100, action: "enrich" })
  })
  test("object overrides action and threshold", () => {
    expect(KiloPromptMinTokens.resolve({ min_tokens: 20, action: "reject" })).toEqual({
      enabled: true,
      minTokens: 20,
      action: "reject",
    })
  })
  test("partial object fills defaults", () => {
    expect(KiloPromptMinTokens.resolve({ action: "reject" })).toEqual({
      enabled: true,
      minTokens: 100,
      action: "reject",
    })
  })
})

describe("KiloPromptMinTokens.textTokens", () => {
  test("sums only non-synthetic text parts", () => {
    const parts = [text("aaaa"), synthetic("ignored content"), file(), subtask()]
    expect(KiloPromptMinTokens.textTokens(parts)).toBe(1) // 4 chars / 4 = 1 token
  })
  test("empty parts is zero", () => {
    expect(KiloPromptMinTokens.textTokens([])).toBe(0)
  })
})

describe("KiloPromptMinTokens.decide", () => {
  const setting = { enabled: true, minTokens: 100, action: "enrich" as const }

  test("passes when disabled", () => {
    expect(KiloPromptMinTokens.decide({ setting: { ...setting, enabled: false }, session: {}, parts: [text("hi")] })).toEqual({
      kind: "pass",
    })
  })
  test("passes for subagent sessions", () => {
    expect(
      KiloPromptMinTokens.decide({ setting, session: { parentID: SessionID.make("ses_parent") }, parts: [text("hi")] }),
    ).toEqual({ kind: "pass" })
  })
  test("passes when no user text (synthetic/attachment only)", () => {
    expect(KiloPromptMinTokens.decide({ setting, session: {}, parts: [synthetic("x"), file()] })).toEqual({
      kind: "pass",
    })
  })
  test("passes at or above threshold", () => {
    const long = "a".repeat(400) // 100 tokens
    expect(KiloPromptMinTokens.decide({ setting, session: {}, parts: [text(long)] })).toEqual({ kind: "pass" })
  })
  test("enriches below threshold", () => {
    const decision = KiloPromptMinTokens.decide({ setting, session: {}, parts: [text("fix it")] })
    expect(decision.kind).toBe("enrich")
  })
  test("rejects below threshold when action is reject", () => {
    const decision = KiloPromptMinTokens.decide({
      setting: { ...setting, action: "reject" },
      session: {},
      parts: [text("fix it")],
    })
    expect(decision.kind).toBe("reject")
  })
})

describe("KiloPromptMinTokens.enrichedParts", () => {
  test("replaces user text with enriched text, preserves other parts in order", () => {
    const parts = [text("fix"), file(), text("it")]
    const result = KiloPromptMinTokens.enrichedParts(parts, "enriched")
    expect(result.map((p) => (p.type === "text" ? p.text : p.type))).toEqual(["enriched", "file"])
  })
  test("keeps synthetic text untouched", () => {
    const parts = [synthetic("sys"), text("fix")]
    const result = KiloPromptMinTokens.enrichedParts(parts, "enriched")
    expect(result).toEqual([{ type: "text", text: "sys", synthetic: true }, { type: "text", text: "enriched" }])
  })
})

describe("KiloPromptMinTokens.enforce", () => {
  const config = (experimental: unknown): Config.Interface =>
    ({ get: () => Effect.succeed({ experimental } as Config.Info) }) as Config.Interface

  const events = (published: unknown[]): EventV2.Interface =>
    ({ publish: (_def: unknown, data: unknown) => Effect.sync(() => published.push(data)) }) as unknown as EventV2.Interface

  test("enrich rewrites parts via injected enhance", async () => {
    const exit = await Effect.runPromiseExit(
      KiloPromptMinTokens.enforce({
        config: config({ prompt_min_tokens: { min_tokens: 10 } }),
        events: events([]),
        sessionID: SessionID.make("ses_1"),
        parts: [text("fix")] as PromptInput["parts"],
        session: {},
        enhance: async () => "much better prompt",
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([{ type: "text", text: "much better prompt" }])
    }
  })

  test("reject throws and publishes an error", async () => {
    const published: unknown[] = []
    const exit = await Effect.runPromiseExit(
      KiloPromptMinTokens.enforce({
        config: config({ prompt_min_tokens: { min_tokens: 10, action: "reject" } }),
        events: events(published),
        sessionID: SessionID.make("ses_2"),
        parts: [text("fix")] as PromptInput["parts"],
        session: {},
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(published.length).toBe(1)
  })

  test("passes unchanged when at or above threshold", async () => {
    const parts = [{ type: "text", text: "a".repeat(400) }] as PromptInput["parts"]
    const exit = await Effect.runPromiseExit(
      KiloPromptMinTokens.enforce({
        config: config({}),
        events: events([]),
        sessionID: SessionID.make("ses_3"),
        parts,
        session: {},
        enhance: async () => "should not be called",
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toEqual(parts)
  })
})
