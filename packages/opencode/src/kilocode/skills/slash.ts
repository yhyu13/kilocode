import { Effect } from "effect"
import { ConfigMarkdown } from "@/config/markdown"
import type { Command } from "@/command"
import { SKILL_SHELL_DISABLED, SKILL_SHELL_UNTRUSTED } from "@/kilocode/skills/display"

const ARGS = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const PLACEHOLDER = /\$(\d+)/g
const QUOTE = /^["']|["']$/g
const TOKEN = /^\s*\/([^\s]+)/

export namespace SkillSlash {
  export type Info = Command.Info
  export type Get = (name: string) => Effect.Effect<Info | undefined>

  export function peel(args: string) {
    const names: string[] = []
    let rest = args
    while (true) {
      const match = rest.match(TOKEN)
      if (!match) break
      names.push(match[1])
      rest = rest.slice(match[0].length)
    }
    return { names, rest: rest.replace(/^\s+/, "") }
  }

  export function expand(template: string, args: string) {
    const raw = args.match(ARGS) ?? []
    const parsed = raw.map((arg) => arg.replace(QUOTE, ""))
    const placeholders = template.match(PLACEHOLDER) ?? []
    const last = placeholders.reduce((max, item) => Math.max(max, Number(item.slice(1))), 0)
    const withArgs = template.replaceAll(PLACEHOLDER, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= parsed.length) return ""
      if (position === last) return parsed.slice(argIndex).join(" ")
      return parsed[argIndex]
    })
    const uses = template.includes("$ARGUMENTS")
    const out = withArgs.replaceAll("$ARGUMENTS", args)
    if (placeholders.length === 0 && !uses && args.trim()) return out + "\n\n" + args
    return out
  }

  export function gate(template: string, trusted: boolean, disabled: boolean) {
    if (!trusted) return template.replace(ConfigMarkdown.SHELL_REGEX, () => SKILL_SHELL_UNTRUSTED)
    if (disabled) return template.replace(ConfigMarkdown.SHELL_REGEX, () => SKILL_SHELL_DISABLED)
    return template
  }

  export const collect = Effect.fn("SkillSlash.collect")(function* (args: string, get: Get, primary: string) {
    const peeled = peel(args)
    const cmds: Info[] = []
    const leftover: string[] = []
    const seen = new Set([primary])
    for (const [i, name] of peeled.names.entries()) {
      const extra = yield* get(name)
      if (extra?.source === "skill") {
        if (!seen.has(extra.name)) {
          seen.add(extra.name)
          cmds.push(extra)
        }
        continue
      }
      leftover.push(...peeled.names.slice(i).map((item) => "/" + item))
      break
    }
    if (peeled.rest) leftover.push(peeled.rest)
    return { cmds, rest: leftover.join(" ") }
  })

  export const render = Effect.fn("SkillSlash.render")(function* (input: {
    cmd: Info
    arguments: string
    disabled: boolean
    get: Get
  }) {
    const extra = yield* collect(input.arguments, input.get, input.cmd.name)
    const args = extra.cmds.length === 0 ? extra.rest : ""
    const primary = yield* Effect.promise(async () => input.cmd.template)
    const parts = [gate(expand(primary, args), input.cmd.trusted === true, input.disabled)]
    for (const cmd of extra.cmds) {
      const template = yield* Effect.promise(async () => cmd.template)
      parts.push(gate(expand(template, ""), cmd.trusted === true, input.disabled))
    }
    if (extra.cmds.length > 0 && extra.rest) {
      const trusted = extra.cmds.every((cmd) => cmd.trusted === true) && input.cmd.trusted === true
      parts.push(gate(extra.rest, trusted, input.disabled))
    }
    return parts.join("\n\n")
  })
}
