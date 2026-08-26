// kilocode_change - new file
// Model-visible continuation prompt for one goal round. Re-injects the full
// objective every round so an autonomous run never drifts toward a smaller or
// easier self-declared victory.

/** Render the anti-drift continuation instruction for one admitted round. */
export function goalRoundPrompt(input: { objective: string; round: number; maxRounds: number }): string {
  return [
    "<goal_round>",
    `Objective: ${JSON.stringify(input.objective)}`,
    `Round: ${input.round}/${input.maxRounds}`,
    "",
    "Continue working toward the objective in this same session. Treat the current",
    "workspace, tool results, and durable session state as authoritative; inspect them",
    "instead of assuming earlier narration is still current. Make concrete progress and",
    "verify the result. Before claiming completion, gather evidence that the whole",
    "objective is achieved, read the current goal, and mark it complete. If work remains,",
    "leave the goal active for the next round. Blocked is allowed only after the configured",
    "minimum number of goal rounds have started (a round floor, not a same-condition streak).",
    "</goal_round>",
  ].join("\n")
}

/** Closing-message instruction after an autonomous goal reports complete/blocked. */
export function goalWrapupPrompt(objective: string, blocked?: string): string {
  const grounding =
    "Report only what earlier rounds and tool results in this session actually establish; "
    + "when a detail is not in the session, say so instead of inventing it. "
  const heading = `Objective: ${JSON.stringify(objective)}\n`
  const body = blocked === undefined
    ? [
        "<goal_complete>",
        heading,
        "The goal is marked complete and this autonomous run is ending. Write the closing",
        "message to the user now: state the outcome, summarize what was done and how it was",
        "verified, and point to the concrete results (files, commits, or other artifacts).",
        grounding,
        "Note anything the user should review or do next. Address the user directly. Do not",
        "call any more tools in this run; further work waits for the user's next instruction.",
        "</goal_complete>",
      ]
    : [
        "<goal_blocked>",
        heading,
        `Blocked: ${JSON.stringify(blocked)}`,
        "The goal is marked blocked and this autonomous run is ending. Write the closing",
        "message to the user now: state what has been completed so far, describe the concrete",
        "blocking condition and what you tried, and say exactly what you need from the user to",
        "continue.",
        grounding,
        "Address the user directly. Do not call any more tools in this run; further work",
        "waits for the user's next instruction.",
        "</goal_blocked>",
      ]
  return body.join("\n")
}
