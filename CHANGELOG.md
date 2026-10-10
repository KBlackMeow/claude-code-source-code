# 修改记录

## 2026-10-10（基于 2.1.88，未发布）

### 修复

- 显式启用 `--sandbox` 时，`sandbox.excludedCommands` 不再使 Bash 命令绕过沙箱；只有允许非沙箱命令时才应用排除规则。
- 编辑包含无效 UTF-8 或 UTF-16LE 字节的文件时明确报错，避免替换字符导致原文件内容损坏。
- 移除测试过程中重复构建 CLI 的步骤，避免并行测试读取到尚未写完的 `dist/cli.js`。

### 验证

- 新增 macOS 沙箱文件写入、符号链接越界、禁止读取及本地网络访问的实际执行测试。
- 新增离线 CLI 集成测试，覆盖读取、编辑、执行测试、会话恢复、兼容 API 529 重试、Auto 分类器故障拒绝及无效编码编辑。
- 构建完整性测试检查关键工具、沙箱及权限模块不会被自动生成的替身模块替换。
- `npm test`：31 项通过；`npm run smoke:platform`：macOS arm64 通过。

### 尚未验证

- Linux、原生 Windows、WSL2 实机行为，以及真实 API、交互式 Auto 模式和外部集成。详细计划见 [功能补全计划](spec-docs/claude-code-feature-roadmap.md)。
