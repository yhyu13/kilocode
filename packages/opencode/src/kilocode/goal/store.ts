// kilocode_change - new file
// Durable goal store. State is a single row keyed by session id, persisted in
// the shared Kilo database. The table is created lazily (idempotent) so no
// upstream migration is touched, and every write is compare-and-set on the
// current revision so two processes cannot silently overwrite each other.

import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { withDb } from "./runtime"
import {
  GoalId,
  normalizeBlockReason,
  normalizeMaxRounds,
  normalizeObjective,
  type CreateGoalInput,
  type EditGoalInput,
  type GoalBlockReason,
  type GoalPhase,
  type GoalRef,
  type GoalSnapshot,
  type GoalView,
} from "./types"

interface Row {
  session_id: string
  id: string
  revision: number
  objective: string
  phase: GoalPhase
  blocked_reason: string | null
  max_rounds: number
  rounds_started: number
  created_at: number
  updated_at: number
}

const PHASES: readonly GoalPhase[] = ["active", "paused", "blocked", "complete"]

function parseRow(row: Row): GoalView {
  const blockedReason = row.blocked_reason === null
    ? undefined
    : (JSON.parse(row.blocked_reason) as GoalBlockReason)
  return {
    id: GoalId(row.id),
    revision: row.revision,
    objective: row.objective,
    phase: assertPhase(row.phase),
    ...(blockedReason ? { blockedReason } : {}),
    maxRounds: row.max_rounds,
    roundsStarted: row.rounds_started,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    armed: false,
  }
}

function snapshotFromView(view: GoalView): GoalSnapshot {
  return {
    id: view.id,
    revision: view.revision,
    objective: view.objective,
    phase: view.phase,
    ...(view.blockedReason ? { blockedReason: view.blockedReason } : {}),
    maxRounds: view.maxRounds,
  }
}

function assertPhase(value: string): GoalPhase {
  if (!PHASES.includes(value as GoalPhase)) throw new TypeError(`invalid goal phase: ${value}`)
  return value as GoalPhase
}

/** Read the durable goal for a session, or undefined when none exists. */
export async function get(sessionID: string): Promise<GoalView | undefined> {
  return withDb((db) =>
    Effect.gen(function* () {
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS kilo_goal (
          session_id TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          objective TEXT NOT NULL,
          phase TEXT NOT NULL,
          blocked_reason TEXT,
          max_rounds INTEGER NOT NULL,
          rounds_started INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      const row = yield* db.get<Row>(sql`
        SELECT * FROM kilo_goal WHERE session_id = ${sessionID}
      `)
      if (!row) return undefined
      return parseRow(row)
    }),
  )
}

/** Create a goal for a session, replacing only a completed or absent goal. */
export async function create(
  sessionID: string,
  input: CreateGoalInput,
  defaults: { defaultMaxRounds: number },
): Promise<GoalView> {
  return withDb((db) =>
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(sql`
          CREATE TABLE IF NOT EXISTS kilo_goal (
            session_id TEXT PRIMARY KEY,
            id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            objective TEXT NOT NULL,
            phase TEXT NOT NULL,
            blocked_reason TEXT,
            max_rounds INTEGER NOT NULL,
            rounds_started INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `)
        const row = yield* tx.get<Row>(sql`
          SELECT * FROM kilo_goal WHERE session_id = ${sessionID}
        `)
        const current = row ? parseRow(row) : undefined
        if (current && current.phase !== "complete") {
          throw new Error(`goal already exists with phase "${current.phase}"`)
        }
        const objective = normalizeObjective(input.objective)
        const maxRounds = normalizeMaxRounds(input.maxRounds ?? defaults.defaultMaxRounds)
        const now = Date.now()
        const next: Row = {
          session_id: sessionID,
          id: GoalId(),
          revision: 1,
          objective,
          phase: "active",
          blocked_reason: null,
          max_rounds: maxRounds,
          rounds_started: 0,
          created_at: now,
          updated_at: now,
        }
        yield* tx.run(sql`
          INSERT INTO kilo_goal
            (session_id, id, revision, objective, phase, blocked_reason, max_rounds, rounds_started, created_at, updated_at)
          VALUES
            (${next.session_id}, ${next.id}, ${next.revision}, ${next.objective}, ${next.phase}, ${next.blocked_reason}, ${next.max_rounds}, ${next.rounds_started}, ${next.created_at}, ${next.updated_at})
        `)
        return parseRow(next)
      }),
      { behavior: "immediate" },
    ),
  )
}

/** Edit objective and/or round cap without changing phase. */
export async function edit(
  sessionID: string,
  expected: GoalRef,
  input: EditGoalInput,
): Promise<GoalView> {
  return mutate(sessionID, expected, (current) => {
    if (input.objective === undefined && input.maxRounds === undefined) {
      throw new TypeError("goal edit requires objective and/or maxRounds")
    }
    return {
      ...snapshotFromView(current),
      revision: current.revision + 1,
      ...(input.objective !== undefined ? { objective: normalizeObjective(input.objective) } : {}),
      ...(input.maxRounds !== undefined ? { maxRounds: normalizeMaxRounds(input.maxRounds) } : {}),
    }
  })
}

/** Transition to a target phase, validating the transition before writing. */
export async function transition(
  sessionID: string,
  expected: GoalRef,
  phase: GoalPhase,
  opts: { blockedReason?: GoalBlockReason } = {},
): Promise<GoalView> {
  return mutate(sessionID, expected, (current) => {
    const allowed: Record<GoalPhase, readonly GoalPhase[]> = {
      active: ["paused", "blocked", "complete"],
      paused: ["active", "complete"],
      blocked: ["active", "complete"],
      complete: [],
    }
    if (!allowed[current.phase].includes(phase)) {
      throw new Error(`cannot transition goal from "${current.phase}" to "${phase}"`)
    }
    const blockedReason =
      phase === "blocked" ? normalizeBlockReason(opts.blockedReason) : undefined
    return {
      id: current.id,
      revision: current.revision + 1,
      objective: current.objective,
      phase,
      maxRounds: current.maxRounds,
      ...(blockedReason ? { blockedReason } : {}),
    }
  })
}

/** Record that one more goal round was admitted. */
export async function admitRound(sessionID: string, expected: GoalRef): Promise<GoalView> {
  return mutate(sessionID, expected, (current) => {
    if (current.phase !== "active") throw new Error("cannot admit a round on a non-active goal")
    if (current.roundsStarted >= current.maxRounds) throw new Error("goal round budget exhausted")
    return {
      ...snapshotFromView(current),
      revision: current.revision + 1,
    }
  }, { roundsStarted: (current) => current.roundsStarted + 1 })
}

/** Shared compare-and-set mutation. */
function mutate(
  sessionID: string,
  expected: GoalRef,
  build: (current: GoalView) => GoalSnapshot,
  extra?: { roundsStarted?: (current: GoalView) => number },
): Promise<GoalView> {
  return withDb((db) =>
    db.transaction((tx) =>
      Effect.gen(function* () {
        const row = yield* tx.get<Row>(sql`
          SELECT * FROM kilo_goal WHERE session_id = ${sessionID}
        `)
        const current = row ? parseRow(row) : undefined
        if (!current) throw new Error("no current goal")
        if (current.id !== expected.id || current.revision !== expected.revision) {
          throw new Error(`stale goal ref; current revision is ${current.revision}`)
        }
        const next = build(current)
        if (next.id !== current.id || next.revision !== current.revision + 1) {
          throw new Error("goal mutation must advance the current goal by one revision")
        }
        const roundsStarted = extra?.roundsStarted ? extra.roundsStarted(current) : current.roundsStarted
        const now = Math.max(Date.now(), current.updatedAt)
        yield* tx.run(sql`
          UPDATE kilo_goal SET
            revision = ${next.revision},
            objective = ${next.objective},
            phase = ${next.phase},
            blocked_reason = ${next.blockedReason ? JSON.stringify(next.blockedReason) : null},
            max_rounds = ${next.maxRounds},
            rounds_started = ${roundsStarted},
            updated_at = ${now}
          WHERE session_id = ${sessionID}
        `)
        return {
          ...next,
          roundsStarted,
          createdAt: current.createdAt,
          updatedAt: now,
          armed: false,
        } satisfies GoalView
      }),
      { behavior: "immediate" },
    ),
  )
}

/** Delete the goal row for a session. */
export async function clear(sessionID: string): Promise<void> {
  await withDb((db) =>
    db.run(sql`
      DELETE FROM kilo_goal WHERE session_id = ${sessionID}
    `),
  )
}
