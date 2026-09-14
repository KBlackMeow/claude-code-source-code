# Claude Code 2.1.270 行为参照基线

本机安装的 `claude --version` 返回 `2.1.270`；本仓库 `node dist/cli.js --version` 返回 `2.1.88`。本文件将 `2.1.270` 作为可观察行为的参照，服务于[功能计划](claude-code-feature-roadmap.md)和[Auto 模式设计](auto-mode-design.md)。参照的是相同任务下的输入、输出、工具执行与故障行为，不把版本号、帮助文本或不可见的内部实现当作完成标准。

| 能力 | 2.1.270 可观察参照 | 本仓库状态 | 必须验证的差距 |
| --- | --- | --- | --- |
| 核心代码研发 | 官方描述的流程是搜索、读取、修改代码、运行测试并根据结果继续处理 | Read、Edit、Write、Bash、Glob、Grep、API 客户端已打入 `dist/cli.js`；尚未完成真实端到端验证 | 在同一示例仓库完成失败测试修复，复测通过并检查 Git diff |
| Auto 权限模式 | `--permission-mode auto`；`auto-mode defaults/config/critique`；默认规则分为 `allow`、`soft_deny`、`hard_deny`、`environment` | 权限和分类器代码存在，但 `TRANSCRIPT_CLASSIFIER` 关闭，三份分类器提示词为空占位 | 按[设计](auto-mode-design.md)验证允许、拦截、人工重试、故障回退和会话阈值 |
| 沙箱 | macOS、Linux、WSL2 的真实命令隔离；原生 Windows 不作为当前官方沙箱支持平台 | 构建别名指向空的 sandbox runtime | 先在 macOS/Linux 验证文件和网络边界；Windows 保持普通权限流程并明确报告沙箱不可用 |
| 无沙箱权限 | 默认模式按规则确认或拒绝；`--safe-mode`、`--restricted` 可控制配置及工具可见性 | 基本权限系统存在；两个新模式不在旧版 CLI 帮助中 | 验证权限优先级及两个模式在 macOS/Linux/Windows 的执行效果 |
| 后台会话 | `--bg`、`agents`、`attach`、`logs`、`stop`、`respawn` | `BG_SESSIONS` 关闭，入口引用的 `src/cli/bg.js` 缺失 | 验证会话在终端退出后可管理、恢复和安全停止 |
| 长会话控制 | `--autocompact`、`--system-prompt-snapshot` | 有压缩源码，缺少对应的新版 CLI 控制项 | 验证压缩、恢复和提示词快照行为 |
| Windows 命令 | 本机版本的帮助和官方文档支持原生 Windows，使用 Git Bash 或 PowerShell | 旧源码有 PowerShell 工具，但构建脚本含 POSIX shell 专用语法 | 在原生 Windows 构建，并运行同一研发示例任务 |

## 对照实验方法

1. 固定一个**隔离的示例仓库**，含可重现的失败测试、少量相关源码和明确的预期修复。两边使用相同用户请求、相同初始提交和尽可能相同的模型/API 条件；各自运行在独立工作副本。
2. 分别记录模型是否发出工具调用、工具参数与结果、权限决策、最终文件 diff、测试退出码、耗时和故障信息。比较行为约束，不比较生成文字是否逐字相同。
3. 对 Auto 模式额外使用纯读、仓库内编辑、仓库外写入、危险 Git 命令、敏感数据外发、分类器故障等固定用例；不在真实用户仓库或生产资源上执行破坏性测试。
4. 分平台保存结果：macOS、Linux、原生 Windows；WSL2 单列。无法在某平台运行的 2.1.270 行为可用官方文档作次级参照，但不得标成已完成实测。

## 参照的边界

- `--help` 和默认规则只能说明功能入口与公开规则，不能证明某次工具调用的实际安全性。普通代码开发的可用性以完整工具调用闭环和测试结果判定。
- 模型输出有随机性，API 服务和账号策略也可能不同；差距需先区分实现问题、模型能力和服务端限制。
- 旧仓库当前配置使用兼容 API 地址。官方 Auto 模式的提供方条件不能直接套用到该地址；本项目必须单独验证其分类器请求能力，不能仅从 2.1.270 的结果推断可用。
- 2.1.270 是本机当前基线；升级本机安装后应先记录新版本，再决定是否更新参照，避免测试中途改变对照对象。

来源：本机 `claude --version`、`claude --help`、`claude auto-mode --help`、`claude auto-mode defaults`；[官方工作流程](https://code.claude.com/docs/en/how-claude-code-works)、[权限模式](https://code.claude.com/docs/en/permission-modes)、[沙箱](https://code.claude.com/docs/en/sandboxing)、[Windows 安装说明](https://code.claude.com/docs/en/setup)。
