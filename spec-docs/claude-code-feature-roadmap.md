# Claude Code 功能补全计划清单

基线：本机安装的 Claude Code 为 `2.1.270`，本仓库及 `dist/cli.js` 为 `2.1.88`。按 [2.1.270 行为参照基线](claude-270-reference.md) 比较两者的命令、同一代码研发任务及故障行为。本计划以恢复可验证的本地能力为目标，不以版本号或命令数量相同作为完成标准。

**平台目标：macOS、Linux、原生 Windows 均为正式支持平台。** WSL2 作为单独的 Linux 环境验证，不能替代原生 Windows；不能仅因某项功能在 macOS 可运行就勾选完成。涉及系统原生能力的项目需要分别实现或接入对应平台的后端。

**沙箱优先级：P1 支持 macOS 和 Linux 的真实命令沙箱。** 原生 Windows 的 CLI、权限及其他核心功能继续列为正式支持，但 Windows 沙箱暂不作为本阶段发布条件。WSL2 作为单独环境验证 Linux 沙箱。所有平台都不得把 [`stubs/sandbox-runtime.ts`](../stubs/sandbox-runtime.ts) 的空实现展示为已启用的隔离能力。

## 当前实施状态（2026-09-14，macOS）

- 已完成：构建不再改写 `src/`；构建进程改用跨平台参数调用；真实 `@anthropic-ai/sandbox-runtime` 已替代构建期 sandbox stub；`--version`、`--help`、`auto-mode defaults` 通过自动化冒烟测试。macOS 已验证 runtime 能初始化、生成 `sandbox-exec` 包装命令，并允许项目内写入且拒绝项目外写入。
- 已完成：Auto 模式的编译期开关、默认本地规则和 `auto-mode defaults/config/critique` 命令已接通。修复了工具循环中的两个源码构建阻断点：缺失的后台任务摘要模块不再随后台会话功能一起启用，构建时会从 `@vscode/ripgrep` 拷贝当前平台的 `rg` 到 `dist/vendor/ripgrep`，不再要求终端 PATH 安装它。当前 macOS 兼容端点的一次真实 Auto 会话连续执行两次 `Bash(npm test)` 并正常结束；另在不含系统 `rg` 的 PATH 下执行“北京天气如何”，完成 WebSearch 后正常回答。分类器故障、拒绝/降级和三平台工具执行仍未完整验收，不能据此宣称可用于无人值守开发。
- 已知阻塞：`npm run check` 仍报告大量反编译源缺失的内部模块、SDK 类型和 Bun 类型；没有通过忽略类型错误伪造成功。当前可信门禁是 `npm test`，它会重建并执行 CLI 冒烟测试。
- 部分完成：`--safe-mode` 和 `--restricted` 已有 CLI 入口；安全模式会跳过内联插件、发现的 MCP 和 slash commands，受限模式默认只保留本地文件/规划工具，并在模块加载前拒绝权限绕过。它们的设置源、文件边界和三平台工具执行仍待验收。
- 已补充：`--sandbox` / `--no-sandbox` 会为当前会话显式要求或禁用沙箱；显式要求时不可用会阻止启动，避免把未隔离执行误报为已启用。真实 Linux/Windows 行为仍待平台验收。
- 已补充：`--system-prompt-snapshot on|off` 已接入 CLI；关闭时禁用系统提示缓存，并在 QueryEngine 的每次模型请求前重建系统提示。首次请求、工具循环、压缩后的跨平台回归仍待验收。
- 已补充：后台会话子进程现在在退出时回写完成/失败状态和退出码，包含 `--version` 等快速路径；跨平台进程组回收、终端重连和文件锁仍待实机验收。
- 已补充：后台离线测试现在断言快速子进程最终进入 `completed`，并继续覆盖 `agents --json`、日志、respawn 和删除流程。
- 已补充：显式 `--no-sandbox` 会在 stderr 告知当前用户权限及文件/网络隔离均未启用，并有构建完整性断言覆盖。
- 已补充：交互式启动显式 `--no-sandbox` 时同样输出无隔离警告，`--print` 路径保持单独输出，避免静默降级。
- 已补充：显式 `--sandbox` 会把 `allowUnsandboxedCommands` 视为不可用，命令级绕过不能逃出用户明确请求的沙箱边界。
- 已补充：API 客户端支持 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY` 作为兼容回退；显式 `ANTHROPIC_*` 变量优先，且有构建测试覆盖。
- 已补充：OpenAI 兼容变量已加入受管环境过滤、GitHub Actions 子进程密钥清洗和 tmux teammate 转发，避免兼容配置在子进程链路中丢失或泄漏。
- 已补充：README 环境变量表和 `--use-env` 说明已记录 OpenAI 兼容回退、Anthropic 优先级及 `/v1` 地址格式。
- 已补充：`OPENAI_BASE_URL` 回退已同步到文件 API、API 预连接和上游代理初始化，兼容端点不会在辅助请求中回落到默认 Anthropic 地址。
- 已补充：Bash 只读环境变量规则也识别 `OPENAI_API_KEY`，兼容配置不会绕过现有敏感变量检查。
- 已补充：兼容变量测试现在断言 Anthropic 环境变量优先于 OpenAI 回退变量，防止配置优先级回归。
- 已补充：Brief 文件上传路径同样使用 `OPENAI_BASE_URL` 回退，兼容端点的附件请求与主请求保持一致。
- 已补充：状态页和 API 主机分析也识别 `OPENAI_BASE_URL`，仅设置 OpenAI 风格变量时仍能看到并记录实际端点。
- 已补充：新增 `npm run smoke` 可重复运行构建、CLI 完整性、后台会话和 macOS 沙箱冒烟门禁，本机验证 19 项通过。
- 已补充：新增 `npm run smoke:platform`，覆盖 Node 版本、Unicode/空格路径、CLI 退出码和会话目录 JSON 读写；当前 macOS arm64 已通过，其他平台需在对应环境运行。
- 已补充：新增 GitHub Actions 三平台 × Node 20/22/24 矩阵，自动运行平台冒烟和完整测试；工作流执行结果仍需 CI 环境回传。
- 已补充：构建完整性测试锁定 CI 的三操作系统和 Node 版本矩阵，防止发布门禁被意外缩减。
- 已补充：平台冒烟在原生 Windows 额外检查 `COMSPEC`、Git 和 Git Bash/WSL bash；支持通过 `CLAUDE_CODE_GIT_BASH_PATH` 指定 bash 路径。
- 已补充：新增 [平台验收矩阵](platform-validation-matrix.md)，单列 WSL2、原生 Windows、沙箱依赖和预期失败行为，作为 CI 之外的实机记录模板。
- 已补充：API 请求日志的端点字段也使用 OpenAI 回退地址，便于诊断兼容网关的实际请求路由。
- 已补充：第一方 Anthropic 地址判定同时检查 `OPENAI_BASE_URL`，仅配置 OpenAI 风格网关时不会误走第一方专用路径。
- 已补充：模型选择支持 `OPENAI_MODEL` 作为低优先级回退，显式 `--model`、会话覆盖和 `ANTHROPIC_MODEL` 始终优先。
- 已补充：启动事件和 API 日志的模型字段也记录 `OPENAI_MODEL` 回退值，兼容配置在诊断中保持可见。
- 已补充：SSH 隧道和受管设置清洗也覆盖 `OPENAI_BASE_URL`/`OPENAI_API_KEY`，防止兼容凭据被设置文件覆盖或泄漏到远端进程。
- 已补充：会话/子代理元数据写入统一使用临时文件加原子 `rename`，降低跨进程恢复时读取半写入文件的风险。
- 已补充：后台会话注册表写入改为临时文件后原子 `rename`，避免中断产生半个 JSON；构建测试覆盖该写入约束。
- 已补充：`--safe-mode`/`--bare` 现在在统一命令加载层过滤项目、用户、插件和 workflow 命令，仅保留内置 bundled skills；构建测试覆盖该过滤分支。
- 已补充：安全模式下 QueryEngine 使用默认主题，不读取用户主题设置，并有回归断言覆盖。
- 已补充：`--help` 现在明确说明安全模式扩展过滤、受限模式的默认工具集合、`--tools` 显式选择和权限绕过限制。
- 已补充：后台会话新增 `attach --follow` 增量日志跟随，会话结束后自动退出；默认 `attach` 仍保持一次性日志读取。
- 已补充：后台会话停止在 Windows 使用 `taskkill /T /F` 回收整个进程树，POSIX 继续使用进程组终止；跨平台实机仍待验收。
- 未开始：Linux、Windows、WSL2 实机矩阵；真实沙箱隔离的文件/网络执行测试。模型工具调用在 macOS fixture 已验证连续执行两次命令，其他场景仍待覆盖。后台会话已有本地注册表和离线冒烟测试，终端重连、长任务停止和三平台验证仍未完成。

## P0：建立可信的构建基线

- [ ] 记录 `2.1.88` 当前 CLI 命令、主要工作流及构建结果，建立可重复的冒烟检查；至少覆盖 `--version`、`--help`、非交互请求、文件读写权限和会话恢复。
- [x] 为 [`scripts/build.mjs`](../scripts/build.mjs) 的模块替换建立清单：构建会写入 `dist/build-manifest.json`，列出启用功能、真实 sandbox runtime、显式别名及本轮自动生成的占位模块。使用方映射仍可在后续版本补充。
- [ ] 让构建在关键运行路径仍依赖空实现时明确失败，避免仅凭 `--version` 成功就认定功能可用。沙箱接入完成前不得报告其可用；P1 完成后 macOS/Linux 沙箱路径不得再链接空实现，原生 Windows 沙箱须明确报告不支持。
- [x] 将源码准备步骤改为不改写源码；构建期兼容转换仅发生在 `build-src/`，并由自动测试比较 `src/` 指纹。
- [x] 移除构建脚本中依赖 POSIX shell 的调用方式；改用 `execFileSync` 与参数数组。仅 macOS 已运行验证，Linux/Windows 仍待干净检出验证。
- [ ] 建立三平台自动化检查矩阵，至少覆盖 Node.js 支持版本、CLI 冒烟、文件路径与编码、会话存储和错误退出码；Windows 分别检查 Git Bash 与 PowerShell 路径。WSL2 另列检查结果。

**完成标准：** 三个平台均能在干净检出上复现构建、运行冒烟检查，并清楚知道生成的 CLI 包含哪些替身。

## P0：验证核心代码研发闭环

- [ ] 已在 macOS 的隔离 fixture 验证当前配置端点、工具调用和工具结果回传：CLI 修复 `add` 的失败实现，并自行运行 `npm test`；独立复验通过。官方 Anthropic API、流式输出和 Linux/Windows 仍待单独验证。
- [ ] 已在 macOS 用真实工具完成“读取 → 精确编辑 → 执行测试 → 读取结果”的最小闭环，fixture 位于 `test/e2e-fixture/`。搜索、Git diff、Windows shell 与三平台验收仍待覆盖。
- [ ] 验证默认权限下的命令和文件修改确认、拒绝规则、工作目录边界，以及工具失败、命令退出码、超时和用户中止后的状态。
- [ ] 已在 macOS 以唯一临时会话 ID 验证两次真实请求的保存与恢复：首轮记录 `BLUE-FINCH`，`--resume` 第二轮只通过历史正确回答，并已删除测试会话记录。文件修改、工具结果与副作用去重仍待验证。
- [ ] 在 macOS、Linux、原生 Windows 分别运行同一套示例任务；Windows 明确测试 Git Bash 与 PowerShell 的可用路径，WSL2 单列。

**完成标准：** 三个平台都能在示例仓库中自主修复一个失败测试，重新运行测试通过，并留下可审查的最小 Git diff；模型/API、工具或权限任一环节失败都报告具体原因。这是“能正常用于代码开发”的必要验收，Auto、沙箱和后台会话不能替代它。

## P0：实现 Auto 权限模式

按 [Auto 模式设计](auto-mode-design.md) 实施。这是本仓库需要独立实现和验证的能力；本机新版 CLI 的行为仅作参考，不能仅凭相同的选项名称宣称与官方 Auto 模式等价。官方 Auto 模式对账号、模型和 API 提供方有适用条件；自定义 API 地址必须单独通过本项目的分类器验证。

- [x] 梳理 [`yoloClassifier.ts`](../src/utils/permissions/yoloClassifier.ts)、[`permissionSetup.ts`](../src/utils/permissions/permissionSetup.ts) 和 `TRANSCRIPT_CLASSIFIER` 功能开关；补全三份分类器提示词文件，并用 `auto-mode defaults` 自动测试覆盖非空默认规则。
- [x] 构建产物在没有 CLI 或设置覆盖时启动 Manual（`default`）；已有的交互式 `Shift+Tab` 模式循环可进入或退出 Auto，`--permission-mode` 和 `permissions.defaultMode` 可显式覆盖。Windows 在终端无法可靠传递 Shift+Tab 时回退 `Meta+M`。它不再依赖 sandbox stub。真实模型端点和 Windows 行为仍待验收。
- [x] 修复 Auto 在工具循环中提前终止的两个构建依赖：将未恢复的任务摘要模块单独关闭，并在构建时打包当前平台的 `rg`。外部兼容端点默认走文本 XML 分类器；不可解析的分类结果作为不可用处理，不计入安全拒绝阈值。macOS fixture 已实测同一 Auto 会话连续两次调用 Bash 且获得测试结果；不含系统 `rg` 的 PATH 下也完成天气搜索任务。Linux/Windows 和故障注入仍待验证。
- [ ] 已在 macOS 当前兼容端点验证 Auto 的基础权限与分类器路径：仓库内编辑和 `npm test` 获准，项目外临时文件删除被拒绝且文件保留。连续拒绝阈值、人工重试和交互降级仍待验证。
- [ ] 已验证当前配置的兼容 API 地址能使用 XML 分类器完成允许/拒绝决策；结构化 `custom` 工具分类请求会被该端点拒绝，外部 Auto 因此保留文本 XML 分类路径。官方 Anthropic API 与其他兼容端点仍待单独验证。
- [ ] 提供 `auto-mode defaults/config` 只读查看入口、决策原因与可审计记录；配置覆盖不能削弱本地硬拒绝规则。
- [ ] 在 macOS、Linux、原生 Windows 测试代码开发场景：仓库内读写和测试命令、仓库外写入、删除、推送、密钥读取、网络发送及 PowerShell/Git Bash 等价命令；同时检查沙箱开启和关闭时的决策一致性。

**完成标准：** 三平台在已验证的模型和端点下都能进入 Auto 模式，安全操作按规则自动通过，受阻操作不会被误批；分类器或端点不可用时明确降级，且不依赖沙箱。测试必须覆盖真实权限执行路径。

## P1：接入 macOS 和 Linux 真实沙箱

- [x] 核对现有 [`sandbox-adapter.ts`](../src/utils/sandbox/sandbox-adapter.ts) 与可用 sandbox runtime 的接口及版本，替换构建脚本中的沙箱别名和空实现；自动测试已验证 macOS/Linux runtime 能产生原生包装命令。运行时仍按设置启用，不因包存在就默认宣称沙箱生效。
- [ ] macOS 已验证系统沙箱后端的项目内/项目外文件写入边界；Linux 仍需验证 `bubblewrap`、`socat` 等依赖、系统权限限制及启动错误，WSL2 单独验证。
- [ ] 在 macOS、Linux 分别测试目录内写入、目录外写入拦截、网络允许/拒绝规则、子进程继承限制、违规提示及显式排除命令。
- [ ] 沙箱配置为必需但无法启动时阻止命令执行；允许降级时必须明确提示未隔离状态，并回到常规权限确认流程。

**完成标准：** macOS、Linux 的命令受到真实文件系统和网络边界约束；无法启动时不误报已启用，也不会因空实现自动批准命令。WSL2 验证结果单独记录。

## P1：确保无沙箱模式的权限边界

- [ ] 检查 [`sandbox-adapter.ts`](../src/utils/sandbox/sandbox-adapter.ts) 与 Bash/PowerShell 权限链路：沙箱未启用或不支持时，不能因为空实现返回成功而自动批准命令。
- [ ] 验证 `deny → ask → allow` 优先级、默认模式下的命令和文件写入确认、`dontAsk` 的拒绝行为，以及用户明确设置的允许规则。只读命令可能按现有规则免确认，应另行验证其分类正确。
- [ ] 在 macOS、Linux 的沙箱关闭状态及原生 Windows 上覆盖 Bash/Git Bash/PowerShell 的同等权限行为；明确提示用户命令运行在当前用户权限下，没有文件系统或网络隔离。
- [ ] 原生 Windows 若显式请求沙箱，明确报“不支持原生 Windows 沙箱”并停止该执行路径；不能静默通过空实现继续执行。Windows 的普通无沙箱模式仍可正常使用。

**完成标准：** 三个平台的无沙箱路径均通过实际命令验证权限确认和拒绝规则；Windows 不误报已启用沙箱，显式请求沙箱不会静默降级。

## P1：补充本地安全运行模式

- [ ] 实现 `--safe-mode`：已跳过内联插件、MCP 发现和 slash commands；项目/用户指令、技能、hooks、agents、输出样式和主题仍需逐项接入同一限制并验证正常认证。
- [ ] 实现 `--restricted`：已默认移除命令、代码执行和网络工具，并拒绝 `--dangerously-skip-permissions`；文件目录边界、设置源和与 `--tools`、`--add-dir`、`--settings` 的组合规则仍需端到端验证。
- [ ] 为两种模式增加 `--help` 说明与覆盖配置优先级、工具可见性、目录边界的行为检查。
- [ ] 在三平台验证目录边界与权限规则，包括 Windows 盘符、UNC 路径、大小写差异、符号链接或 junction，以及 Bash/PowerShell 对等的工具限制。

**完成标准：** 三个平台的用户都能用这两个选项隔离故障配置或限制代理能力，且限制在工具执行层生效。

## P2：后台会话与管理命令

- [ ] 已将后台 Claude 会话设计为独立的分离 Node 进程，元数据和日志保存在 `$CLAUDE_CONFIG_DIR/sessions`（默认 `~/.claude/sessions`）；它不混同于工具内部的后台 Bash 任务。worktree 恢复和文件锁尚未接入。
- [x] 已实现 `--bg`、`agents`/`ps`、`attach`、`logs`、`stop`，以及 `rm` 和 `agents --json`。`attach` 默认输出累积日志，并可用 `--follow` 持续跟随；子进程退出状态由进程内回写处理。
- [ ] 已实现 `respawn`，会在原工作目录以原参数创建新会话。删除前的 worktree 未提交改动检查仍未实现。
- [x] 已启用并接通 [`src/entrypoints/cli.tsx`](../src/entrypoints/cli.tsx) 的 `BG_SESSIONS` 分支，新增 [`src/cli/bg.ts`](../src/cli/bg.ts)；离线测试会后台运行 `--version`，确认注册、`agents --json`、日志读取、跟随、状态回写与删除，无需 API 调用。
- [ ] 分别验证 POSIX 进程组与 Windows 进程树的停止/回收、终端重新附着、文件锁、路径和日志编码；后台会话不能依赖 macOS 专有终端或仅靠 `tmux`。

**完成标准：** 三个平台的后台会话在原终端退出后仍可查看状态、读取日志、重新附着并安全停止；不把普通后台 Bash 任务误报为独立会话。

## P2：长会话体验

- [ ] 基于现有 [`autoCompact.ts`](../src/services/compact/autoCompact.ts) 增加 `--autocompact <auto|tokens>`：已支持 `auto` 或 100k–1M 整数并映射到既有窗口覆盖变量，参数范围有自动化检查；阈值实际触发和会话恢复仍待验证。
- [ ] 增加 `--system-prompt-snapshot <on|off>`，明确首次请求、继续会话和压缩后的提示词规则。
- [ ] 对长会话做回归检查：工具结果保留、上下文压缩和恢复后提示词一致性。
- [ ] 在三平台验证跨进程恢复、路径序列化、换行编码和持久化文件的原子写入。

**完成标准：** 两个选项在三平台都有可观察的行为变化，并且不会改变未指定选项时的现有默认流程。

## P3：按需恢复外部集成（代码开发非必需）

- [ ] 按实际需求选择 Bedrock、Vertex、Foundry、MCPB 和 Chrome 集成的优先顺序；逐个替换 [`stubs/generic-stub.ts`](../stubs/generic-stub.ts) 的别名，避免一次性启用全部空实现。
- [ ] 每个集成分别验证依赖安装、认证、最小请求或连接、错误提示和无凭据时的行为。仅通过模块加载不算完成。
- [ ] 检查 `vendor/` 中音频、图片、URL 和按键处理所需的原生 `.node` 文件及平台支持；缺少二进制时保持显式不可用状态。
- [ ] 为 macOS、Linux、Windows 分别核对原生二进制的架构、分发路径与加载方式；现有 URL 事件和按键包装仅支持 macOS，需要为 Linux/Windows 设计对应实现，或在发布说明中明确其功能边界。跨平台核心能力不得依赖这些 macOS 专有接口。

**完成标准：** 只有在声明支持的每个平台通过端到端验证的集成才从替身清单移除；平台特有功能的可用范围清晰可见。

## 跨平台发布验收矩阵

| 检查项 | macOS | Linux | 原生 Windows | WSL2（单列） |
| --- | --- | --- | --- | --- |
| 安装、构建、启动和 CLI 冒烟 | [ ] | [ ] | [ ] | [ ] |
| 模型调用、读改代码、运行测试的完整闭环 | [ ] | [ ] | [ ] | [ ] |
| Auto 模式的自动批准、确认、拒绝与故障降级 | [ ] | [ ] | [ ] | [ ] |
| 权限规则、`--safe-mode`、`--restricted` | [ ] | [ ] | [ ] | [ ] |
| 真实沙箱的文件与网络隔离 | [ ] | [ ] | 后续阶段 | [ ] |
| 无沙箱模式的权限确认、拒绝与状态提示 | [ ] | [ ] | [ ] | [ ] |
| 后台会话的启动、附着、停止和恢复 | [ ] | [ ] | [ ] | [ ] |
| 长会话压缩和提示词快照 | [ ] | [ ] | [ ] | [ ] |
| 已启用外部集成及原生模块 | [ ] | [ ] | [ ] | [ ] |

每项保留对应平台的运行日志和复现命令。某项缺少实现或尚未验证时保持未勾选；不以 WSL2、mock、接口加载成功或单平台结果代替验证。macOS/Linux 沙箱是 P1 验收项；原生 Windows 沙箱单独排期，不阻止 Windows 核心功能验收。

## 外部条件与暂缓项

- [ ] 原生 Windows 沙箱：待 macOS/Linux 稳定后评估独立 sandbox runtime 的 Windows alpha 后端或其他实现；只有通过文件与网络隔离及失败行为测试后才纳入正式支持。WSL2 结果不能替代此项。
- [ ] `--cloud`、远程控制、`ultrareview`：依赖服务端能力。只有获得相应接口和授权后，才制定本地客户端实现及验收方案。
- [ ] 仓库文档所述未发布内部模块：逐项核实是否仍有对应需求。无法从本机 CLI 帮助信息或旧 bundle 还原的实现，不作为本计划的必交付项。

参考：本机 `claude --help`；[`QUICKSTART.md`](../QUICKSTART.md)；[官方安装与 Windows 支持说明](https://code.claude.com/docs/en/setup)；[官方沙箱文档](https://code.claude.com/docs/en/sandboxing)；[sandbox runtime 平台说明](https://github.com/anthropics/sandbox-runtime/blob/main/README.md)；[官方权限规则文档](https://code.claude.com/docs/en/permissions)；[官方后台会话文档](https://code.claude.com/docs/en/agent-view)；[官方 Auto Mode 配置](https://code.claude.com/docs/en/auto-mode-config)。
