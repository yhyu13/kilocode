# Prompt Minimum Token Guard

Add a guard that refuses to pass shallow user prompts (below a token threshold) directly to the LLM. Below threshold, either auto-enrich via the existing `enhancePrompt` small-model rewrite, or reject with a clear error.

## Decisions (confirmed with user)

- **Configurable**: both `enrich` and `reject` actions supported, one default value each.
- **Unit**: token, using the existing `Token.estimate` (4 chars ≈ 1 token). 100 tokens ≈ 400 chars.
- **Scope**: main chat prompt only, **default ON**. Subagent/task, shell, plan follow-ups are excluded.
- **Default action**: `enrich`.
- **Check cadence**: every message (not just the first).

## Verified anchors

- Main chat entry: `SessionPrompt.prompt` at `packages/opencode/src/session/prompt.ts:1393` (function body `prompt()` at :1394). It calls `createUserMessage(input)` at :1401.
- Subagent discriminator: subtask sessions carry `parentID` (`SessionInfo.parentID`, `packages/schema/src/v1/session.ts:597`); main sessions do not. The existing `title` helper already skips on `input.session.parentID` (`prompt.ts:285`).
- Token estimator: `Token.estimate = Math.round(len / 4)` at `packages/core/src/util/token.ts:5`, re-exported via `packages/opencode/src/util/token.ts:1`.
- Enrich primitive: `enhancePrompt(text): Promise<string>` at `packages/opencode/src/kilocode/enhance-prompt.ts:30`.
- Config experimental schema: `packages/core/src/v1/config/config.ts:295-341` (ConfigV1 `experimental` struct; existing Kilo flags `image_generation`, `sandbox` live here).
- Error publish precedent: `events.publish(Session.Event.Error, {...})` then `throw NamedError` for "Agent not found" at `prompt.ts:816-823`; same for "Command not found" at `prompt.ts:2256-2259`.

## Config shape

Add to ConfigV1 `experimental` struct (with `kilocode_change` markers):

```ts
prompt_min_tokens: Schema.optional(
  Schema.Union([
    Schema.Boolean, // false disables; true enables with defaults
    Schema.Struct({
      min_tokens: Schema.optional(PositiveInt),   // default 100
      action: Schema.optional(Schema.Literals("enrich", "reject")), // default "enrich"
    }),
  ]),
)
```

Resolution (absent key = enabled because default ON):

| raw value | enabled | min_tokens | action |
|---|---|---|---|
| `undefined` | true | 100 | enrich |
| `false` | false | — | — |
| `true` | true | 100 | enrich |
| object | true | `min_tokens ?? 100` | `action ?? "enrich"` |

## Implementation

### 1. New module `packages/opencode/src/kilocode/session/prompt-min-tokens.ts`

Pure, unit-testable core:

- `resolve(raw: unknown): Setting` — config resolution table above.
- `textParts(parts)` — non-synthetic `text` parts only (`type === "text" && synthetic !== true`).
- `textTokens(parts): number` — sum `Token.estimate` over `textParts`.
- `decide(input)` — pure decision: `{ kind: "pass" } | { kind: "enrich", text } | { kind: "reject", tokens, minTokens }`.
  - `pass` when: `session.parentID` set (subagent), or `textParts` empty (synthetic/attachment-only), or `tokens >= minTokens`.
- `enrichedParts(parts, text)` — replace all non-synthetic text parts with one text part carrying `text`; preserve file/agent/subtask parts and their order.

Thin `enforce` Effect (wires side effects):

- Reads `Config.Service.get()` → `resolve(cfg.experimental?.prompt_min_tokens)`.
- `pass` → return parts unchanged.
- `enrich` → `enhancePrompt(text)` (injectable, defaults to the real one), fall back to original parts on failure (log warning).
- `reject` → publish `Session.Event.Error` then throw `NamedError.Unknown` (mirrors "Agent not found").

### 2. Hook in shared file `prompt.ts` (one `kilocode_change` block)

At the top of `prompt()` after `const session = ...`:

```ts
// kilocode_change start
const guardedParts = yield* KiloPromptMinTokens.enforce({ parts: input.parts, session })
// kilocode_change end
```

Then change `createUserMessage(input)` at :1401 to `createUserMessage({ ...input, parts: guardedParts })`.

### 3. Config schema in `packages/core/src/v1/config/config.ts`

Add `prompt_min_tokens` to the `experimental` struct, marked `kilocode_change`.

### 4. Changeset

New `.changeset/prompt-min-tokens-guard.md`, package `@kilocode/cli`, `minor`.

## Tests (TDD, red → green)

`packages/opencode/test/kilocode/session/prompt-min-tokens.test.ts`:

1. `resolve`: all four raw shapes → correct `Setting`.
2. `textParts`/`textTokens`: counts only non-synthetic text; ignores file/agent/subtask/synthetic.
3. `decide`: subagent skip, empty-text skip, at-threshold pass, below-threshold enrich, below-threshold reject.
4. `enrichedParts`: replaces user text, preserves file parts order.
5. `enforce` with injected `enhance` + stubbed config/events: enrich rewrites, reject throws.

## Verification

- `bun test ./test/kilocode/session/prompt-min-tokens.test.ts` from `packages/opencode/`.
- `bun run typecheck` from `packages/opencode/`.
