// kilocode_change - new file
// Live authority for goal tools. A non-synthetic user text part is a direct
// human turn. The autonomous channel is a synthetic <goal_round> part — quoting
// the tag in human text does not grant it.

export type AuthorityPart = {
  type: string
  text?: string
  synthetic?: boolean
}

export type AuthorityMessage = {
  info: { role: string }
  parts: readonly AuthorityPart[]
}

/** True when the last user message includes a non-synthetic text part. */
export function directHuman(messages: readonly AuthorityMessage[]): boolean {
  const lastUser = messages.findLast((msg) => msg.info.role === "user")
  return lastUser?.parts.some((part) => part.type === "text" && !part.synthetic) ?? false
}

/** True when the last user message is a synthetic goal-round continuation. */
export function isGoalRound(messages: readonly AuthorityMessage[]): boolean {
  const lastUser = messages.findLast((msg) => msg.info.role === "user")
  return (
    lastUser?.parts.some(
      (part) =>
        part.type === "text"
        && part.synthetic === true
        && typeof part.text === "string"
        && part.text.includes("<goal_round>"),
    ) ?? false
  )
}
