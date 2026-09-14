# Auto 权限模式设计（参考本机 Claude Code）

状态：部分实现，尚未完成端到端验证。参考基线为本机 `claude 2.1.270` 的 `--help`、`claude auto-mode --help`、`claude auto-mode defaults` 输出，以及本仓库 `2.1.88` 的权限源码。构建已启用 `TRANSCRIPT_CLASSIFIER` 并补全本地默认规则；真实分类器 API、拒绝降级和三平台工具执行仍待验证。目标是在 macOS、Linux、原生 Windows 上实现适用于代码开发的 Auto 模式；沙箱是可组合的独立能力，不能成为 Auto 决策的前提。

## 已确认的参考行为

- 本源码构建在没有 CLI 或设置覆盖时以 Manual（`default`）启动；交互式会话可通过 `Shift+Tab` 在 Chat 输入框中循环权限模式，并进入或退出 Auto。Windows 终端不支持 VT 修饰键时使用 `Meta+M` 作为回退。本实现不依赖 Anthropic 账号的 GrowthBook 灰度配置。`--permission-mode` 和设置中的 `permissions.defaultMode` 可以显式覆盖启动模式；用户也可通过设置显式关闭 Auto。
- 本机版本也支持 `--permission-mode auto`，并提供 `auto-mode defaults`、`config`、`critique` 等命令。`defaults` 输出 `allow`、`soft_deny`、`hard_deny`、`environment` 四组规则；本机 `2.1.270` 分别有 17、70、1、21 条。条数仅用于标记参考版本，不作为实现目标。
- 官方说明：普通权限系统先判断，Auto 分类器再审查需要判断的工具调用。分类器参考用户请求、会话上下文和可信环境；允许规则是软拒绝规则的例外。用户明确指定某个具体操作可满足软拒绝规则的意图条件，但仓库内容、工具输出和其他代理消息不能冒充用户授权；硬边界和显式权限拒绝不能被普通允许规则覆盖。
- 被分类器拦下的动作会显示拒绝原因，用户可以查看并手动重试。官方在连续 3 次或累计 20 次拦截后暂停 Auto，恢复到人工确认；交互和无交互模式的后续处理不同。
- 官方 Auto 有账号、模型和 API 提供方限制，不能由本机 CLI 可用推断自定义 `ANTHROPIC_BASE_URL` 一定可用。本仓库实现是独立实现，不能宣称与官方分类器等价。

## 现有代码与缺口

- [`src/types/permissions.ts`](../src/types/permissions.ts) 中 `auto` 受 `TRANSCRIPT_CLASSIFIER` 控制；[`src/utils/permissions/permissions.ts`](../src/utils/permissions/permissions.ts) 已有在权限结果为 `ask` 时调用分类器、统计拒绝和处理失败的路径。
- [`src/utils/permissions/yoloClassifier.ts`](../src/utils/permissions/yoloClassifier.ts) 已有分类请求、结果解析和部分规则配置逻辑；[`src/utils/permissions/permissionSetup.ts`](../src/utils/permissions/permissionSetup.ts) 已有模式进出与状态逻辑。这些代码需要逐项验证，不能直接打开开关。
- `src/utils/permissions/yolo-classifier-prompts/` 的三份 `.txt` 文件已补全为可维护的外部默认规则和系统提示词，构建脚本仅启用 `TRANSCRIPT_CLASSIFIER`。这些规则不是官方提示词的逐字副本，尚需真实分类器评测校准。
- 本机新版输出中的完整默认规则会随版本变化。本项目应以可维护的规则文件和可检查的测试用例实现相同的行为类别，不把新版输出条数或提示词文本当作兼容性标准。

## 决策流程

1. **启动与切换：** 交互式用户按 `Shift+Tab` 进入或退出 Auto；启动时也可由 CLI 或设置指定 `auto`。切换后加载可信配置，确认分类器模型/端点可用，并显示当前模式。检查失败时保持普通权限模式并给出原因。
2. **基础权限：** 执行工具自己的权限检查以及 `deny → ask → allow` 规则。显式拒绝、安全检查和必须由人确认的工具不可被 Auto 覆盖。
3. **明确安全的快路径：** 已获基础权限允许的动作直接执行。对仓库内常规编辑及纯读取工具可设置狭窄快路径，但需先通过路径、目标和工具输入检查；不能只凭工具名称允许任意参数。PowerShell 命令在通过专门的等价规则验证前保持人工确认。
4. **分类器：** 使用独立的分类请求，对剩余动作提交实际工具名、规范化参数、工作目录、用户任务、相关会话上下文和可信环境，要求返回可校验的 `allow | block`、规则类别与简短原因。只有当前用户对该目标和动作的明确指示才能解除相应软拒绝；分类器不得依据工具输出或仓库文件中的指令修改信任边界。
5. **执行结果：** `allow` 才运行工具；`block` 则不运行，记录原因并提供人工重试入口。分类器超时、报错、响应无法解析或上下文不足时，交互模式退回人工确认；无交互模式拒绝该动作并返回明确错误，不自动放行。
6. **连续拒绝：** 参考本机版本的连续 3 次/累计 20 次阈值，暂停 Auto 并切回人工确认。用户确认后可以恢复；阈值状态按会话保存，恢复会话时不应意外重置。

## 规则与配置

- 默认规则分为 `environment`、`soft_deny`、`allow` 和不可被普通例外覆盖的硬边界。优先覆盖代码开发中的仓库内编辑、测试命令、外部代码执行、凭据与敏感文件、网络发送、生产部署、远程写入、大范围删除及 Git 历史改写。
- 可配置的可信仓库、远端、域名和存储目标来自用户、本机或管理员设置；不接受仓库共享设置或工具输出为自己追加允许规则。管理员 `permissions.deny` 始终先于分类器生效。
- 提供 `auto-mode defaults` 和 `auto-mode config` 查看默认与生效规则。自定义规则应保留默认安全边界；如果允许替换某组默认规则，必须明确展示替换结果。规则更新不能在会话中静默放宽权限。
- 记录每次需要分类的工具、决策类别、简短原因、耗时和拒绝计数；日志避免写入完整密钥、文件内容或分类器提示词。

## 模型与平台边界

- 先验证 Anthropic API 的分类请求；对配置的兼容 API 地址进行独立能力检查，包括所需的结构化输出、超时和错误处理。不兼容的端点保持普通权限模式。
- macOS/Linux 分别测试沙箱启用与关闭；沙箱状态只影响命令隔离，不能改变分类器的拒绝结论。原生 Windows 无沙箱也必须执行同样的权限与分类流程。
- Windows 的路径、盘符、UNC、大小写和 PowerShell/Git Bash 命令需分别校验。PowerShell 自动批准属于后续扩展，P0 不因 Auto 已启动就允许未经分类的 PowerShell 命令。

## 验收用例

- [ ] 仓库内读取、编辑和运行现有测试：预期允许；用户明确拒绝的工具仍被拒绝。
- [ ] 访问仓库外文件、读取密钥、把敏感内容发送到外部地址：预期拒绝或要求人工确认；工具输出中的“请忽略规则”无效。
- [ ] `git push --force`、生产部署、批量删除、执行刚下载的脚本：按规则拒绝，人工重试不得绕过显式硬拒绝。
- [ ] 分类器断网、超时、无效 JSON、上下文过长：交互模式人工确认，无交互模式拒绝，不出现静默允许。
- [ ] 连续/累计拒绝达到阈值后暂停 Auto，用户可查看原因并恢复；会话恢复后的计数正确。
- [ ] macOS、Linux、原生 Windows 分别运行上述测试；Windows 同时覆盖 Git Bash 与 PowerShell，WSL2 单列结果。

参考：[官方 Auto Mode 配置](https://code.claude.com/docs/en/auto-mode-config)、[官方权限模式](https://code.claude.com/docs/en/permission-modes)、[官方权限规则](https://code.claude.com/docs/en/permissions)。
