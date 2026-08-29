// kilocode_change - new file
import { Token } from "@/util/token"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { PromptInput } from "@/session/prompt"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "prompt-min-tokens" })

export namespace KiloPromptMinTokens {
  export const DEFAULT_MIN_TOKENS = 100

  export type Action = "enrich" | "reject"

  export interface Setting {
    enabled: boolean
    minTokens: number
    action: Action
  }

  export type PartLike = { type: string; text?: string; synthetic?: boolean; [key: string]: unknown }

  export function resolve(raw: unknown): Setting {
    if (raw === false) return { enabled: false, minTokens: DEFAULT_MIN_TOKENS, action: "enrich" }
    if (raw === true || raw === undefined || raw === null) {
      return { enabled: true, minTokens: DEFAULT_MIN_TOKENS, action: "enrich" }
    }
    const obj = raw as { min_tokens?: number; action?: Action }
    return {
      enabled: true,
      minTokens: obj.min_tokens ?? DEFAULT_MIN_TOKENS,
      action: obj.action ?? "enrich",
    }
  }

  export function textParts(parts: readonly PartLike[]): PartLike[] {
    return parts.filter((part) => part.type === "text" && part.synthetic !== true)
  }

  export function textTokens(parts: readonly PartLike[]): number {
    return textParts(parts).reduce((total, part) => total + Token.estimate(part.text ?? ""), 0)
  }

  export type Decision =
    | { kind: "pass" }
    | { kind: "enrich"; text: string }
    | { kind: "reject"; tokens: number; minTokens: number }

  export function decide(input: {
    setting: Setting
    session: Pick<Session.Info, "parentID">
    parts: readonly PartLike[]
    noReply?: boolean
  }): Decision {
    if (!input.setting.enabled) return { kind: "pass" }
    if (input.noReply) return { kind: "pass" }
    if (input.session.parentID) return { kind: "pass" }
    const texts = textParts(input.parts)
    if (texts.length === 0) return { kind: "pass" }
    const tokens = textTokens(input.parts)
    if (tokens >= input.setting.minTokens) return { kind: "pass" }
    const text = texts.map((part) => part.text ?? "").join("\n")
    if (input.setting.action === "reject") {
      return { kind: "reject", tokens, minTokens: input.setting.minTokens }
    }
    return { kind: "enrich", text }
  }

  export function enrichedParts(parts: readonly PartLike[], text: string): PartLike[] {
    const kept = parts.filter((part) => !(part.type === "text" && part.synthetic !== true))
    const firstTextIndex = parts.findIndex((part) => part.type === "text" && part.synthetic !== true)
    const enriched: PartLike = { type: "text", text }
    const result = [...kept]
    result.splice(firstTextIndex === -1 ? 0 : firstTextIndex, 0, enriched)
    return result
  }

  export const enforce = (input: {
    config: Config.Interface
    events: EventV2.Interface
    sessionID: SessionID
    parts: PromptInput["parts"]
    session: Pick<Session.Info, "parentID">
    noReply?: boolean
    enhance?: (text: string) => Promise<string>
  }): Effect.Effect<PromptInput["parts"]> =>
    Effect.gen(function* () {
      const cfg = yield* input.config.get()
      const setting = resolve(cfg.experimental?.prompt_min_tokens)
      const decision = decide({ setting, session: input.session, parts: input.parts, noReply: input.noReply })
      if (decision.kind === "pass") return input.parts
      if (decision.kind === "reject") {
        const error = new NamedError.Unknown({
          message: `Prompt is too short (${decision.tokens} tokens, minimum ${decision.minTokens}). Please provide more detail about what you want.`,
        })
        yield* input.events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const enhance =
        input.enhance ?? (async (text: string) => (await import("@/kilocode/enhance-prompt")).enhancePrompt(text))
      const enriched = yield* Effect.tryPromise(() => enhance(decision.text)).pipe(
        Effect.catch((cause) => {
          log.warn("prompt enrichment failed, passing original prompt through", {
            error: cause instanceof Error ? cause.message : String(cause),
          })
          return Effect.succeed(undefined)
        }),
      )
      if (enriched === undefined) return input.parts
      return enrichedParts(input.parts, enriched) as PromptInput["parts"]
    })
}
