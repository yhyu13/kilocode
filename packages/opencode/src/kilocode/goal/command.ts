// kilocode_change - new file
// Human-facing /goal command. Rendered as a model instruction that routes the
// user's intent through the goal tools, keeping command dispatch out of the
// shared session layer.

import type { Command } from "@/command"

const GOAL_TEMPLATE = [
  "You are managing the session's durable goal.",
  "",
  "Call get_goal first to read the current state. Then act on the user's request:",
  "- create: call create_goal with the concrete objective (only for a long-running objective, not single-turn work).",
  "- status: summarize the current goal and its phase, rounds, and armed state.",
  "- pause / resume / complete / blocked: call update_goal with the exact id and revision from get_goal.",
  "- edit: call update_goal with action edit and the replacement objective and/or max_goal_rounds.",
  "",
  "Mark complete only when the objective is actually achieved. Mark blocked only after at least the configured number of goal rounds have started (a round floor, not a same-condition streak).",
].join("\n")

export function goalCommand(): Command.Info {
  return {
    name: "goal",
    description: "manage the session goal [status|create|pause|resume|complete|blocked|edit]",
    template: GOAL_TEMPLATE,
    hints: ["$ARGUMENTS"],
  }
}
