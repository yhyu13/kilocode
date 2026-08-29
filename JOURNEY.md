# JOURNEY.md

> 项目缘起·经过·结果：给 Kilo Code 加一道「浅 prompt 拦截」——用户提示词不足 100 tokens 时不直通 LLM，默认先用现有 `enhancePrompt` 小模型改写扩写，也可配置成直接报错拒绝。这份文档记录人机来回与可复用的 vibe-coding 经验。
>
> 列含义：**ME = 用户**，**YOU = AI**。日期格式 `YYYY-MM-DD`。

## 风险与待办（高亮汇总）

- **[实现]** 云 schema overlay 未同步：`experimental.prompt_min_tokens` 已能运行时生效，但编辑器补全用的 `Kilo-Org/cloud` 仓库 `apps/web/src/app/config.json/extras.ts` 还没加这个 key，编辑器会报 `unknown property`。运行时不受影响。
- **[实现]** enrich 失败是 fail-open（改写失败原样放行原 prompt），不是 fail-closed。若小模型不可用，短 prompt 会带着原始内容直达 LLM，等于这条规则短暂失效。这是刻意的取舍（不因小模型挂掉而卡死用户），但要记住边界。
- **[实现]** 默认开启 + 每条消息都查，意味着每个短跟进（"continue""yes"）都多一次 enrich 的 LLM 往返，有额外延迟和成本。这是用户明确选的默认，不是 bug。
- **[测试]** `test/preload.ts` 的全局 `afterAll`（`AppRuntime.dispose()`）偶发超过默认超时，导致整文件报 `(fail) (unnamed) hook timed out`；与本功能无关，重跑即绿。未修，属于测试基建的已知偶发。

## Era 1 · 需求抛出（2026-08-28）

| ME | YOU |
|---|---|
| "kilcode should add prompts words number check, less than 100 tokens should pass exam, or make llm first enrich user prompt, it is a law to not pass shallow prompt to llm" | 先摸清 prompt 进 LLM 的咽喉在哪，而不是直接开写。找到唯一入口 `SessionPrompt.prompt`（`session/prompt.ts:1394`），发现 token 估算已有 `Token.estimate`（4 字符≈1 token）、改写已有 `enhancePrompt`，都是可复用的现成设施。 |

## Era 2 · 三轮澄清，消灭歧义（2026-08-28）

| ME | YOU |
|---|---|
| 第一轮选了：可配置（reject + enrich 都支持）、token 单位、仅主对话 prompt 默认开启。 | 发现"word number"和"tokens"不是一回事（100 token≈400 字符≈60-80 英文词），不猜单位，问清楚。 |
| 第二轮选了：默认 enrich、每条消息都查。 | 把"默认动作"和"查每轮还是只查首条"两个会实质改变行为的决策分开问，没有混成一个选项。 |

## Era 3 · 计划先行（2026-08-28）

| ME | YOU |
|---|---|
| （无新增指令） | 写 `plan doc`（`.kilo/plans/prompt-min-tokens-guard.md`），把决策表、文件锚点、纯函数分层、TDD 用例列全，再动手。核心结论：逻辑落在 `src/kilocode/` 新模块，共享文件 `prompt.ts` 只留一个 `kilocode_change` 调用点。 |

## Era 4 · TDD 实现，踩三个坑（2026-08-28）

| ME | YOU |
|---|---|
| （无新增指令） | 按 TDD 先写 18 个用例再实现。实现中踩三个坑，各留一条 Do-Not-Repeat：① 静态导入 `enhance-prompt.ts` 会通过 `app-runtime.ts` 绕回 `prompt.ts` 形成模块环，`Cannot access 'node' before initialization`，改用动态 import 破环；② Effect 这个版本 `catchAll` 已改名 `catch`；③ `Schema.Literals` 要传数组不是变参。 |

## Era 5 · 回归被打破，修复误伤（2026-08-28）

| ME | YOU |
|---|---|
| （无新增指令） | 跑共享 `prompt.test.ts` 发现 3 个用例超时——默认开启的 enrich 把测试里"hello""fix it"这类短 fixture 也拿去改写了，触发了真实网络 LLM 调用。定位后修两处：`noReply` 提示词跳过 guard（它根本不进 LLM）；共享测试夹具里显式 `prompt_min_tokens: false` 让会话机制测试不被新默认干扰。 |

## Era 6 · 验证与收尾（2026-08-29）

| ME | YOU |
|---|---|
| "单元测试一些什么东西 把结果和过程给我看看" | 完整展示 18 个用例分组和运行结果（18 pass / 0 fail），并解释 flaky hook 是 `preload.ts` 的 `afterAll` 偶发超时，与本功能无关。 |
| "每个 test case 的 case 是什么，为什么这样设计？" | 逐个拆解 18 个用例的场景与设计意图：纯函数优先（15/18）、副作用注入隔离、每个分支至少一个用例、边界值（恰好 400 字符=100 token）显式卡死。 |

## Era 7 · 当前（2026-08-29）

| ME | YOU |
|---|---|
| "1 update journey 2 ok push to remote" | 写本 `JOURNEY.md`，随后提交并推送到远端。 |

---

## 这个项目如何教 vibe coding with AI

### 人的工作（decide / correct / kill）

- **用一句"law"压出边界**：需求原文 "it is a law to not pass shallow prompt to llm" 一句话就把"为什么做"钉死了，后续所有取舍（默认 enrich、fail-open）都围绕这条 law 而不是围绕实现细节。
- **关键分叉必须本人拍板**：单位（token vs word）、默认动作（enrich vs reject）、查每轮 vs 只查首条，这三个分叉 AI 都停下来问了，没有默默选一个。人的价值在选，不在写。

### AI 的工作（instrument / falsify / report honestly）

- **先复用后新建**：token 估算和 prompt 改写都已存在，AI 没有重造，只写"决策 + 编排"那一层。
- **诚实上报负结果**：enrich 的 fail-open 取舍、默认开启带来的每轮额外 LLM 成本，都被写进风险与待办，没有藏。
- **回归被打破就承认并修**：3 个共享测试超时不是"跳过测试"，而是定位到误伤根因后修复，并把防护写进测试夹具。

### 可复用的规则

1. **动手前先找到"唯一咽喉"，再决定在哪插一刀**——`SessionPrompt.prompt` 是所有主对话提示词的汇聚点，插这里一处就覆盖全部入口；子代理靠 `session.parentID` 天然排除。
2. **歧义处列选项、给推荐、不默认**——三次澄清问出了 5 个决策，每个决策都落在 `plan doc` 里成为可回溯的合同。
3. **纯函数优先，副作用注入**——`resolve`/`textTokens`/`decide`/`enrichedParts` 四个纯函数占 15/18 用例；`enforce` 用注入的 `enhance`/`config`/`events` 隔离真实 LLM 和数据库。
4. **循环依赖是静态导入的暗雷**——从 session 图静态导入 `enhance-prompt.ts` 会绕回来，动态 import 一次破环。
5. **默认开启的功能，先问"会误伤谁"**——`noReply`、纯附件、系统注入、子代理这四类"本不该动"的场景，都变成 `decide` 里的显式 pass 分支和对应测试用例。

### 一句话总结

**人负责在分叉处拍板（单位、默认动作、范围），AI 负责找咽喉、复用现成设施、诚实上报取舍与回归——分工的边界就是"决策"和"执行"之间那条线。**
