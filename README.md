<p align="center">
  <strong>PLC Pilot</strong>
</p>

<p align="center">
  连接 CODESYS、CAREL STone 与日常开发任务的本地优先 AI Agent 工作台
</p>

<p align="center">
  <a href="https://github.com/1812095643/PLCpilot/releases/latest"><img src="https://img.shields.io/github/v/release/1812095643/PLCpilot?display_name=tag&sort=semver" alt="最新版本"></a>
  <a href="https://github.com/1812095643/PLCpilot/actions/workflows/release.yml"><img src="https://github.com/1812095643/PLCpilot/actions/workflows/release.yml/badge.svg" alt="Windows 发布构建"></a>
  <a href="https://github.com/1812095643/PLCpilot/releases"><img src="https://img.shields.io/github/downloads/1812095643/PLCpilot/total" alt="下载量"></a>
</p>

PLC Pilot 是一个面向工业自动化与日常开发的 Windows 桌面 AI Agent 工作台，支持 CODESYS、CAREL STone 和自由聊天三种模式。你可以用它分析与修改控制工程、检索厂商接口，也可以处理通用编程、Office 文档和文件任务。

多服务商模型、MCP、Skills、审批、会话和诊断共用一套工作流。PLC 工程师、自动化调试工程师和软件开发者可以按任务切换模式，并通过 MCP 与 Skills 扩展工具能力。

PLC Pilot 作为独立桌面应用运行。交互结构参考 Codex 等本地 Agent 工作台，工业软件接入、审批与本机运行时由本项目维护；本项目与 OpenAI、CODESYS、CAREL 无官方隶属关系。

## 下载

当前稳定版本：[v0.1.12](https://github.com/1812095643/PLCpilot/releases/tag/v0.1.12)

- [Windows 安装版（EXE）](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/PLC-Pilot-0.1.12-x64-setup.exe)：适合大多数用户。
- [Windows 安装版（MSI）](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/PLC-Pilot-0.1.12-x64.msi)：适合组织化部署。
- [Windows 便携版（ZIP）](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/PLC-Pilot-Portable-0.1.12-win-x64.zip)：完整解压后运行，不写入系统 PATH。
- [CAREL STone MCP 独立包](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/PLC-Pilot-STone-MCP-0.1.1.zip)：需要单独运行 STone MCP 时使用。
- [更新清单](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/latest.json) · [SHA-256 校验](https://github.com/1812095643/PLCpilot/releases/download/v0.1.12/SHA256SUMS.txt)

安装版和便携版都包含精简的 Node.js、npm/npx、Python 和 pip 运行时。首次安装第三方 MCP 或 Python 依赖时仍需要网络。CODESYS、CAREL STone 和 WebView2 属于外部软件；便携版需要系统已有 WebView2，安装版可联网补装。

## 快速开始

1. 下载并安装 PLC Pilot，或完整解压便携版 ZIP。
2. 打开“设置 → 模型”，添加一个服务商 URL 和 API Key，然后获取模型并勾选要在对话框中使用的模型。
3. 在左上角选择工作模式：`CODESYS`、`自由聊天` 或 `Stone`。
4. 根据任务选择工作目录：CODESYS 模式可导入工程文件夹或 `.project` 文件，Stone 模式选择 STone 工程目录，自由聊天可直接提问或附加文件。没有选择目录时，首次发送消息会自动创建临时会话工作目录。
5. 描述任务。Agent 会先读取上下文、显示工具和命令状态；涉及写入、编译、下载或在线操作时，默认等待审批。

首次使用建议保持“审批模式”。确认工具行为和工程范围后，再在设置中显式启用“完全访问模式”。

## 三种工作模式

| 模式 | 适合场景 | 上下文与工具边界 |
| --- | --- | --- |
| `CODESYS` | 读取、分析和修改 PLC 工程 | 提供工程树、POU、Structured Text、静态诊断和已连接的 CODESYS MCP 工具 |
| `自由聊天` | 通用问答、编程和文件分析 | 不默认注入 CODESYS 或 STone 工程上下文，可使用通用 MCP 和 Skills |
| `Stone` | CAREL STone 工程和官方接口检索 | 自动启用内置 STone MCP；真实工程操作需要本机安装 STone 和相应许可 |

模式切换只改变 Agent 的上下文和工具权限，不会把其他模式的工程快照混入当前对话。

## 主要能力

### Agent 对话和长任务

- 流式输出、思考状态、工具调用、命令执行和审批状态按实际事件顺序显示。
- 支持停止当前任务、消息排队、拖拽排序、撤回编辑、立即调整方向和重试。
- 运行中按 `Enter` 排队，按 `Ctrl+Enter` 立即调整方向。
- 支持复制用户消息和完整 AI 回复、编辑并重新发送、从已完成回复 Fork，以及对选中的回复文本添加批注。
- 持久化 JSONL 会话、会话恢复、临时会话、项目会话、会话搜索、时间线跳转和上下文用量显示。
- 长任务支持上下文压缩、项目记忆、摘要和笔记；会话预览按文件变化缓存，减少历史列表重复解析。

### 模型和服务商

- 一个服务商对应一个 URL，可同时保存和启用多个服务商。
- 支持 OpenAI Responses、OpenAI 兼容 Chat Completions、Anthropic Messages 和 Ollama。
- 获取模型时支持勾选导入，并同步接口返回的显示名称、上下文长度、最大输出和思考档位。
- 每个模型可单独配置上下文长度、最大输出和思考深度；对话页可快速切换已启用模型。
- URL、模型和 Key 保存在 C 盘应用配置目录；敏感凭据使用 Windows DPAPI 保护，不写入项目文件或普通会话正文。

### CODESYS 工程闭环

- 导入工程目录或 `.project` 文件，查看工程树、POU、源文件、活动对象和诊断。
- 内置 PLC 工具包括工程快照、POU 列表、ST 源码读取、工程搜索、修改提案和诊断。
- 修改前生成真实 Diff；写入、删除、重命名、编译、下载、RUN/STOP、Force 和在线写变量遵循审批策略。
- 已连接外部 CODESYS MCP 时，按真实工具 schema 传递工程路径并读取真实编译结果。
- 没有真实 CODESYS 编译工具时，禁止把静态 IEC 结构检查冒充目标编译成功。

### Office 原生 Skills

内置 `Documents`、`Spreadsheets`、`Presentations` 和 `PDF` Skills，覆盖 Word、Excel、PowerPoint 和 PDF 的基础读取与创建。Office 工具由 Rust 原生 OOXML/PDF 生成器提供，不要求目标电脑额外安装 `openpyxl`、`python-docx`、`python-pptx` 或 `reportlab`。

复杂模板、宏、批注、目录、图表、动画、嵌入对象、表单、签名和原有复杂样式不在基础生成器的保真范围内；需要保留这些内容时，先读取并确认能力边界。

### MCP 和 Skills

设置页提供 MCP/Skills 商店、启停管理和手动配置。MCP 支持 stdio JSON-RPC、JSONL、`Content-Length` 和 Streamable HTTP；HTTP 服务可使用 SSE、Bearer Token、请求头和 `Mcp-Session-Id`。

当前 MCP 目录包含内置 STone、5 个官方/示例服务和 6 个社区服务：

- 官方/示例：Filesystem、Memory、Sequential Thinking、Everything、Puppeteer。
- 社区：Context7、CODESYS MCP Toolkit、CODESYS MCP SP21+、CODESYS MCP SP21+ 中文版、Festo CODESYS MCP、CODESYS Persistent MCP。
- CODESYS 相关社区实现会标注所需 Profile、工程目录和运行前提；点击安装后由本机真实 `npx` 或运行时获取包，不伪造安装状态。

内置 Skills 包括：

- CODESYS 工程工作流
- PLC 安全审查
- IEC 61131-3 Structured Text
- CODESYS 诊断与编译
- PLC 投运与交付
- Documents、Spreadsheets、Presentations、PDF

也可以把项目目录中的用户自定义 Skills 纳入本轮任务。高风险工具仍由 PLC Pilot 的审批模式和完全访问模式统一管理。

## CODESYS 只读桥接

如果需要读取 CODESYS 当前打开但尚未导出的工程，可以在 CODESYS 中打开：

`Tools → Scripting → Execute Script File`

执行 [`codesys-bridge/Script Commands/plc_pilot_sync.py`](codesys-bridge/Script%20Commands/plc_pilot_sync.py)。脚本会把工程路径、对象清单和 ST 文本快照写入：

`%LOCALAPPDATA%\PLC Pilot\codesys-bridge\current-project.json`

该脚本是只读兼容入口：不安装 CODESYS 插件、不创建侧边栏、不修改工程、不下载、不启动或停止控制器。真实写回和目标编译由已连接的 CODESYS MCP 完成，并继续经过 PLC Pilot 审批。

## CAREL STone MCP

[`stone-mcp/`](stone-mcp/) 是 PLC Pilot 内置的 CAREL STone MCP。它根据官方接口资料注册 Solution、Project、Target、Watch、Task、构建、测试、IronPython、帮助检索和 ST 库查询工具。

- 内置官方 API 资料检索不要求本机安装 STone。
- 真实工程打开、保存、编译、模拟器和 Watch 操作需要本机安装 CAREL STone 及相应许可。
- SToneCLI/IronPython 子进程只在当前 Agent 任务需要时启动；取消、超时和会话结束会收回进程。
- 日志默认写入 `%LOCALAPPDATA%\PLC Pilot\logs\stone-mcp`，Key、密码、Token、许可序列号和附件数据会脱敏。

详细接口映射、独立运行方式和验证边界见 [`stone-mcp/README.md`](stone-mcp/README.md)。

## 安全模型

默认访问模式是“审批模式”。以下动作在执行前会显示审批卡片：

- 文件创建、覆盖、删除、重命名和工程补丁写入
- Shell、脚本和外部命令
- CODESYS 编译、下载、连接设备、RUN/STOP、Reset、Force/Unforce 和在线写变量
- STone 工程写入、构建、下载、目标操作和 IronPython

“完全访问模式”是用户主动选择的设置，启用后允许当前已授权工具直接执行；`/plan` 计划模式始终阻止写入和在线操作。取消任务不会自动重放可能已经部分执行的写操作。

## 本机数据和日志

PLC Pilot 的配置、模型凭据、会话、草稿、更新状态和日志默认位于：

`%LOCALAPPDATA%\PLC Pilot\`

测试阶段遇到问题时，请提供 `logs` 文件夹、复现时间、操作步骤和 CODESYS/STone 版本。不要上传模型 Key、MCP Token、认证文件或完整配置文件。

## 从源码运行

### 环境

- Windows，建议使用最新 WebView2 Runtime
- Node.js 22 或兼容的 npm 环境
- Rust stable 和 Cargo
- 真实 CODESYS/CAREL STone 工程操作需要对应软件和许可

### 开发模式

```powershell
git clone https://github.com/1812095643/PLCpilot.git
cd PLCpilot
npm ci
npm run tauri:dev
```

### 常用检查

```powershell
# 前端类型检查
npx vue-tsc --noEmit -p tsconfig.app.json

# 前端构建
npm run build

# Rust 单元测试
cargo test --manifest-path src-tauri/Cargo.toml --lib

# STone MCP 测试
npm run test:stone-mcp

# 诊断协议测试
npm run test:diagnostics
```

### 本地打包

```powershell
npm run tauri:build
```

安装包会生成在 `src-tauri/target/release/bundle`，便携版和配套运行时会生成在 `output/`。发布构建还会生成签名文件、`latest.json` 和 `SHA256SUMS.txt`；不应把签名私钥提交到仓库。

## 项目结构

```text
src/                       Vue 3 桌面界面、对话流、设置和会话组件
src-tauri/src/             Rust 运行时、审批、MCP、模型、更新和本机 RPC
agent-host/                Pi Agent 宿主与长任务上下文能力
stone-mcp/                 CAREL STone MCP、官方资料和独立测试
codesys-bridge/            CODESYS 只读 ScriptEngine 桥接脚本
skills/                    内置 PLC、Office、PDF 和投运 Skills
scripts/                   Agent bundle、运行时、便携版和发布脚本
shared/                    跨运行时诊断与协议测试
```

## 发布流程

维护者发布新版本时，需要同步更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、锁文件和 `release-notes.md`，再推送与版本一致的 `v*` 标签。GitHub Actions 会执行类型检查、前端构建、Rust 测试、MCP 测试、Windows 安装包、MSI、便携包和 STone MCP 打包，并生成签名更新清单。

更新源固定为本仓库的 GitHub Release。软件内“设置 → 软件更新”和“帮助 → 检查更新”共用同一套检查、签名校验、下载、保存草稿和回滚流程。

## 兼容性边界

- 当前重点适配 CODESYS 3.5 SP21/SP22；其他版本需要以实际 Profile、ScriptEngine 和 MCP 工具 schema 验证为准。
- CODESYS 只读桥接脚本不等于原生插件；它不提供内嵌侧边栏、实时选区同步或工程写回。
- 没有安装 STone 时，可以使用官方资料检索，但不能宣称已经完成真实工程编译、模拟器、变量读写或设备验收。
- 静态 IEC 诊断、模型推理和文件生成结果都不能代替真实目标编译或现场投运验证。

## 参考与许可证

交互结构和长任务体验参考 OpenAI Codex 等本地 Agent 工作台；Agent 会话、工具循环和上下文能力复用成熟的 Pi SDK。PLC 工程扫描、审批策略、CODESYS 桥接、STone MCP 和 Windows 运行时由本项目维护。

仓库当前未在根目录声明统一的项目许可证；第三方依赖、内置 Skills、MCP 服务和 CAREL 资料分别遵循各自随附的许可证或使用条件。使用前请核对目标 MCP、CODESYS、STone 和厂商资料的许可范围。

问题反馈和功能建议请提交 [GitHub Issues](https://github.com/1812095643/PLCpilot/issues)。
