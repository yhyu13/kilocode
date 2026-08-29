# JOURNEY.md

> 项目缘起·经过·结果：在 Kilo Code 这个 OpenCode 分支上，连续做了五件事——① 持久目标 agent（跨回合/重启盯住一个目标直到真正完成）；② 斜杠命令链式注入多个 skill；③ VS Code 本地/市场版切换的开发脚本；④ OpenWolf 上下文管理插件 + Claude 钩子；⑤ 浅 prompt 拦截（不足 100 token 不直通 LLM）。这份文档记录人机来回与可复用的 vibe-coding 经验。
>
> 列含义：**ME = 用户**，**YOU = AI**。日期格式 `YYYY-MM-DD`。

## 风险与待办（高亮汇总）

- **[Goal]** blocked 审计目前是「轮次下限」（同一 `blocked_reason` 达到 `KILO_GOAL_BLOCKED_AFTER` 轮），不是「同一条件连续出现」的真 streak。要做成连续计数需要 schema migration，本切片没做。提示词/tool 文案已按「轮次下限」如实写。
- **[Slash]** `session/prompt.ts` 里 skill 路径与其它 slash 命令各有一份 `$1`/`$ARGUMENTS` 展开逻辑，后续只改一处会漂移（评审给的是 SUGGESTION，未合并两份展开器）。
- **[Min-token]** 云 schema overlay 未同步：`experimental.prompt_min_tokens` 已运行时生效，但 `Kilo-Org/cloud` 仓库 `apps/web/src/app/config.json/extras.ts` 还没加 key，编辑器会报 `unknown property`。运行时不受影响。
- **[Min-token]** enrich 失败是 fail-open（改写失败原样放行原 prompt），小模型不可用时短 prompt 会带原内容直达 LLM。刻意的取舍，不是 bug。
- **[Min-token]** 默认开启 + 每条消息都查，每个短跟进（"continue""yes"）都多一次 enrich 的 LLM 往返。用户明确选的默认。
- **[测试]** `test/preload.ts` 的全局 `afterAll`（`AppRuntime.dispose()`）偶发超时，重跑即绿，属测试基建已知偶发。
- **[OpenWolf]** `.wolf/`（STATUS/cerebrum/anatomy/buglog）、`CLAUDE.md`、`AGENTS.md` 的 openwolf 标记段仍处工作区未提交状态。

## Era 1 · Goal 需求抛出（2026-08-23）

| ME | YOU |
|---|---|
| "# Goal persistence — An objective that keeps an agent working across turns, sessions, and process restarts until it is genuinely complete — never narrowed, never self-declared done early." 附上 Codex goal feature 的完整 spec（机制、反漂移合同、状态机、逃逸口、记账、harness 测试）+ "impl D:\GitRepo-AI\openwolf\docs3 in this repo" | 先读 `docs3` 的 PLAN/critic，把切片划清：OpenWolf Phase 1 已做完、不得碰本仓库；只实现 critic 指定的 kilocode-only goal-persistence 修复。核心判断是「状态可以回放，权限必须重授」——进展写进账可回放，自动续跑授权只活在当前进程。 |

## Era 2 · Goal 首版落地（2026-08-23）

| ME | YOU |
|---|---|
| （无新增指令） | 在 `src/kilocode/goal/` 落 13 个文件 + 176 行测试，共 1243 行：`store.ts`（一行表 + CAS 版本号）、`driver.ts`（空闲续跑）、`tool.ts`（`get/create/update_goal` 三工具）、`admission.ts`/`authority.ts`（谁能改：看本轮来源是不是真人话，不看血缘）、`prompt.ts`/`agent.txt`（反漂移：每轮重注入完整目标）。记账学 Codex 一行表，重启后武装集合清空学 DeepSeek Harness。 |

## Era 3 · Skill 斜杠链式注入（2026-08-25）

| ME | YOU |
|---|---|
| （需求为链式 `/skill-one /skill-two` 一次注入多个 skill） | 新建 `src/kilocode/skills/slash.ts`：`peel` 剥出连续 `/name`，`collect` 去重收集，`expand` 填 `$1`/`$ARGUMENTS` 占位，`render` 拼成多段。共享文件 `prompt.ts` 只留一个 `kilocode_change` 调用点，走分支隔离。 |

## Era 4 · Goal 空闲续跑修死（2026-08-26）

| ME | YOU |
|---|---|
| （无新增指令） | 发现空闲循环第一轮续跑后就死了：`TurnClose` 在 `prompt()` 还在 await 时就触发，锁被提前释放。修法：driver 把锁跨 turn 持有，存一个 pending `{sessionID, reason}`（后到覆盖），`prompt()` 返回后再重新驱动。同时落 critic 清单：`TurnClose.reason` 进 `driveGoal`（error/interrupted 解除武装、superseded 跳过）、create-after-complete 改为先删后插、SQL CAS `WHERE session_id AND id AND revision` 后校验写入、拒绝 `maxRounds < roundsStarted`、自动续跑通道要求 `synthetic === true`。 |

## Era 5 · 评审揪出真洞（2026-08-26 → 08-27）

| ME | YOU |
|---|---|
| "retry again"（prompt.ts 共享文件 edit 太大，要求回到小改） | 代码评审两条轴并跑，揪出三个真问题：① env 解析 `parseInt` 会收下 `1.5` 这类截断垃圾，改为非法即抛（整体正整数）；② driver 里嵌套 `try/catch` 会吞掉 `GoalService.get` 的原错，改 promise handler 记录；③ 多 skill 的 leftover `!cmd` 在 `gate()` 之后才 append，untrusted 或 kill-switch 打开时仍会被 `SessionPrompt` 执行——真 shell 门洞。三处全修 + 补测试，`96e31b0` 提交。 |

## Era 6 · 开发脚本 + OpenWolf 插件（2026-08-28）

| ME | YOU |
|---|---|
| （需求：本地版与市场版扩展切换、OpenWolf 上下文管理接入） | 落 `dev-scripts/{dev-local,use-marketplace,revert-marketplace,watch}.ps1`（本地 build 专用 dev 窗口，不干扰正常 VS Code 的市场版）；落 `.kilo/plugin/openwolf/`（anatomy/fs/session/pre-read/post-write/stop 等 9 文件）做上下文管理，配 `.claude/` 命令与钩子；同步更新 `docs/zhihu-goal/` 文章和 `interview-prep.md`。 |

## Era 7 · 浅 prompt 拦截（2026-08-28 → 08-29）

| ME | YOU |
|---|---|
| "kilcode should add prompts words number check, less than 100 tokens should pass exam, or make llm first enrich user prompt, it is a law to not pass shallow prompt to llm" | 先摸清咽喉：唯一入口 `SessionPrompt.prompt`（`session/prompt.ts:1394`），token 估算已有 `Token.estimate`、改写已有 `enhancePrompt`，全可复用。 |
| 澄清三轮：可配置（reject+enrich 都支持）、token 单位、仅主对话默认开启；默认 enrich、每条消息都查。 | 把「word vs token」「默认动作」「查每轮还是首条」三个会实质改变行为的决策分开问，不默默选定。 |
| （无新增指令） | 写 plan doc 再动手，逻辑全落 `src/kilocode/session/prompt-min-tokens.ts`，共享 `prompt.ts` 只留一个 `kilocode_change` 调用点。TDD 先写 18 用例，实现踩三坑各留 Do-Not-Repeat：静态导入 `enhance-prompt.ts` 会绕 `app-runtime.ts` 成模块环 → 动态 import；Effect 这版 `catchAll` 已改 `catch`；`Schema.Literals` 传数组非变参。 |
| （无新增指令） | 跑共享 `prompt.test.ts` 破 3 用例——默认 enrich 把 "hello" 短 fixture 也拿去改写触发真网络。修：`noReply` 跳过 guard（不进 LLM）、共享夹具显式 `prompt_min_tokens: false`。 |
| "单元测试一些什么东西 把结果和过程给我看看" / "每个 test case 的 case 是什么，为什么这样设计？" | 展示 18 用例全绿，逐个拆解设计意图：纯函数优先（15/18）、副作用注入、边界值（恰好 400 字符=100 token）显式卡死。 |

## Era 8 · 当前（2026-08-29）

| ME | YOU |
|---|---|
| "我们对kilo修改了什么，update journey" | 把这份 JOURNEY 从「只记浅 prompt 拦截」扩成「整个分支五件事」的完整历史，并汇总风险与待办。 |

---

## 这个项目如何教 vibe coding with AI

### 人的工作（decide / correct / kill）

- **用一句 law 压出边界**：min-token 需求原文 "it is a law to not pass shallow prompt to llm" 一句话钉死「为什么做」，后续 enrich/fail-open 取舍都围着这条 law 转。
- **关键分叉必须本人拍板**：token vs word、enrich vs reject、查每轮 vs 首条，三个分叉 AI 都停下来问了，没默默选。
- **"retry again" 是最高杠杆的纠偏**：AI 想在共享文件 `prompt.ts` 里写一大段，用户一句"retry again"逼它回到最小改动——一个短语变成永久约束（共享文件只动一处）。

### AI 的工作（instrument / falsify / report honestly）

- **先复用后新建**：token 估算、`enhancePrompt`、Codex 的一行表记账，都是现成设施，AI 没重造。
- **评审当 falsify 工具用**：goal 与 slash 两个功能都跑了两轴并行评审，真揪出 env 截断、嵌套 catch、leftover `!cmd` 门洞三个本会漏掉的 bug，没把评审当走过场。
- **诚实上报负结果**：blocked 审计是「轮次下限」不是「同条件 streak」、enrich fail-open、每轮额外 LLM 成本，全写进风险与待办，没藏。

### 可复用的规则

1. **动手前先找「唯一咽喉」**——`SessionPrompt.prompt` 是所有主对话提示词汇聚点，插一处覆盖全部入口；子代理靠 `session.parentID` 天然排除。
2. **状态可以回放，权限必须重授**——进展写进一行表可回放；「这进程还准不准自动续」只活在内存，重启一律解除武装。这是 goal 功能的定义句。
3. **歧义列选项、给推荐、不默认**——三次澄清问出 5 个决策，每个都落进 plan doc 成可回溯合同。
4. **共享文件只留一个 `kilocode_change` 调用点**——逻辑全进 `src/kilocode/`，上游文件插一刀就完，为合并上游时把 diff 压到最小。
5. **纯函数优先，副作用注入**——min-token 四个纯函数占 15/18 用例；goal 的 harness 测试证明的是状态机迁移，不靠真模型跑。
6. **循环依赖是静态导入的暗雷**——从 session 图静态导入 `enhance-prompt.ts` 会绕回来，动态 import 一次破环。
7. **评审结果必须回填修复，不能只写报告**——env 截断、嵌套 catch、shell 门洞三个 finding 全部在下一提交落地并补测试。

### 一句话总结

**人负责在分叉处拍板、用一句 law 压边界、用 "retry again" 逼最小改动；AI 负责找咽喉、复用现成设施、把评审当 falsify 工具跑出真 bug 再修——分工的边界就是「决策」和「执行」之间那条线。**
