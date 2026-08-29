---
"@kilocode/cli": minor
---

Guard against shallow prompts. Main-chat prompts below a minimum token count are enriched by a small model or rejected before reaching the model, configurable via `experimental.prompt_min_tokens` (default: enabled, 100 tokens, enrich).
