// kilocode_change - new file
// Model-facing goal tools: get_goal, create_goal, update_goal. Authority is
// derived from the session transcript rather than a runtime agent registry:
// a non-synthetic user part means a direct human turn, while a synthetic
// <goal_round> message means an autonomous continuation.

import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { GoalId, type GoalBlockReason, type GoalView } from "./types"
import { GoalService } from "./service"
import { resolveConfig } from "./config"
import { goalWrapupPrompt } from "./prompt"

type GoalValue =
  | { goal: null }
  | {
    goal: {
      id: string
      revision: number
      objective: string
      phase: GoalView["phase"]
      roundsStarted: number
      maxRounds: number
      blockedReason?: GoalBlockReason
    }
    armed: boolean
  }

type GoalMeta = Record<string, never>

function value(goal: GoalView | undefined): GoalValue {
  if (!goal) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxRounds: goal.maxRounds,
      ...(goal.blockedReason ? { blockedReason: goal.blockedReason } : {}),
    },
    armed: goal.armed,
  }
}

function directHuman(ctx: Tool.Context): boolean {
  const lastUser = ctx.messages.findLast((msg) => msg.info.role === "user")
  return lastUser?.parts.some((part) => part.type === "text" && !("synthetic" in part && part.synthetic)) ?? false
}

function goalRound(ctx: Tool.Context): boolean {
  const lastUser = ctx.messages.findLast((msg) => msg.info.role === "user")
  return lastUser?.parts.some(
    (part) => part.type === "text" && part.text.includes("<goal_round>"),
  ) ?? false
}

function ref(goalID: string, revision: number) {
  if (goalID.length === 0 || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("goal_id must be non-empty and revision must be a positive integer")
  }
  return { id: GoalId(goalID), revision }
}

const GetParams = Schema.Struct({})
const CreateParams = Schema.Struct({
  objective: Schema.String,
  max_goal_rounds: Schema.optional(Schema.Number),
})
const UpdateParams = Schema.Struct({
  goal_id: Schema.String,
  revision: Schema.Number,
  action: Schema.Literals(["edit", "pause", "resume", "complete", "blocked"]),
  objective: Schema.optional(Schema.String),
  max_goal_rounds: Schema.optional(Schema.Number),
  blocked_reason: Schema.optional(Schema.String),
})

export const GetGoalTool = Tool.define<typeof GetParams, GoalMeta, never>(
  "get_goal",
  Effect.succeed({
    description:
      "Read the current session goal, including its exact id, revision, objective, phase, completed rounds, round limit, blocker reason when present, and whether another continuation is armed. Call this before updating a goal.",
    parameters: GetParams,
    execute: (_args: Schema.Schema.Type<typeof GetParams>, ctx: Tool.Context) =>
      Effect.promise(() => GoalService.get(ctx.sessionID)).pipe(
        Effect.map((goal) => ({
          title: goal ? "Current goal" : "No goal",
          output: JSON.stringify(value(goal)),
          metadata: {},
        })),
      ),
  }),
)

export const CreateGoalTool = Tool.define<typeof CreateParams, GoalMeta, never>(
  "create_goal",
  Effect.succeed({
    description:
      "Create one persisted goal for the current session when the direct human request is a long-running objective that should continue across autonomous goal rounds. Do not use this for trivial single-turn work.",
    parameters: CreateParams,
    execute: (args: Schema.Schema.Type<typeof CreateParams>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if (!directHuman(ctx)) throw new Error("create_goal requires a direct human turn")
        const goal = yield* Effect.promise(() =>
          GoalService.create(ctx.sessionID, {
            objective: args.objective,
            ...(args.max_goal_rounds !== undefined ? { maxRounds: args.max_goal_rounds } : {}),
          }),
        )
        return {
          title: "Created goal",
          output: JSON.stringify(value(goal)),
          metadata: {},
        }
      }),
  }),
)

export const UpdateGoalTool = Tool.define<typeof UpdateParams, GoalMeta, never>(
  "update_goal",
  Effect.succeed({
    description:
      "Update the exact current goal revision. edit, pause, and resume require a direct human request. During an automatic continuation of the current goal, complete and blocked are also allowed.",
    parameters: UpdateParams,
    execute: (args: Schema.Schema.Type<typeof UpdateParams>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const expected = ref(args.goal_id, args.revision)
        const current = yield* Effect.promise(() => GoalService.get(ctx.sessionID))
        const phase = current?.phase

        if (args.action === "edit" || args.action === "pause" || args.action === "resume") {
          if (!directHuman(ctx)) throw new Error(`${args.action} requires a direct human turn`)
        }

        let goal: GoalView | undefined
        if (args.action === "edit") {
          goal = yield* Effect.promise(() =>
            GoalService.edit(ctx.sessionID, expected.id, expected.revision, {
              ...(args.objective !== undefined ? { objective: args.objective } : {}),
              ...(args.max_goal_rounds !== undefined ? { maxRounds: args.max_goal_rounds } : {}),
            }),
          )
        } else if (args.action === "pause") {
          goal = yield* Effect.promise(() => GoalService.pause(ctx.sessionID, expected.id, expected.revision))
        } else if (args.action === "resume") {
          goal = yield* Effect.promise(() => GoalService.resume(ctx.sessionID, expected.id, expected.revision))
        } else if (args.action === "complete") {
          if (!directHuman(ctx) && !goalRound(ctx)) {
            throw new Error("complete requires a direct human turn or the current goal round")
          }
          goal = yield* Effect.promise(() => GoalService.complete(ctx.sessionID, expected.id, expected.revision))
        } else {
          const blocked = args.blocked_reason
          if (blocked === undefined || blocked.trim().length === 0) {
            throw new Error("blocked_reason is required with action blocked")
          }
          if (!directHuman(ctx) && !goalRound(ctx)) {
            throw new Error("blocked requires a direct human turn or the current goal round")
          }
          if (goalRound(ctx) && phase === "active"
            && (current?.roundsStarted ?? 0) < resolveConfig().blockedAfterConsecutiveRounds) {
            throw new Error(
              `blocked requires at least ${resolveConfig().blockedAfterConsecutiveRounds} consecutive goal rounds`,
            )
          }
          goal = yield* Effect.promise(() =>
            GoalService.block(ctx.sessionID, expected.id, expected.revision, {
              code: "model-reported",
              message: blocked.trim(),
            }),
          )
        }

        const terminal = goal && (goal.phase === "complete" || goal.phase === "blocked")
        return {
          title: `${args.action} goal`,
          output:
            JSON.stringify(value(goal))
            + (terminal && goal
              ? "\n\n" + goalWrapupPrompt(goal.objective, goal.blockedReason?.message)
              : ""),
          metadata: {},
        }
      }),
  }),
)
