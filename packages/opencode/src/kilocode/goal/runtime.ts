// kilocode_change - new file
// Lazy Effect runtimes for the Kilo goal harness. Mirrors the PlanFollowup
// runtime pattern: the goal store resolves the shared database through the app
// runtime instead of threading a new service through the shared node graph.

import { makeRuntime } from "@/effect/run-service"
import { lazy } from "@/util/lazy"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"

const database = lazy(() => makeRuntime(Database.Service, AppNodeBuilder.build(Database.node)))

export type Db = Database.Interface["db"]

/** Run an Effect that needs the shared database and returns its result. */
export function withDb<A>(run: (db: Db) => Effect.Effect<A, unknown>): Promise<A> {
  return database().runPromise((svc) => Effect.orDie(run(svc.db)))
}
