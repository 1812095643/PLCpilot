# PLC Pilot

PLC Pilot 是面向 CODESYS 3.5 系列的独立桌面 Agent 工作台，推荐使用 SP21/SP22。界面和会话交互复用 CodexUI 的成熟 Vue 组件，底层使用 Pi Agent 会话宿主；工程读取、修改审批、真实编译诊断和安全边界由本项目 Rust 运行时负责。

## 已接入能力

- Codex 风格独立桌面布局：会话栏、聊天、工程概览、Skills、命令面板（`Ctrl/Cmd+K`）、最近会话和上下文占用；不依赖 CODESYS 内嵌侧栏。
- 斜杠命令：`/help`、`/status`、`/new`、`/clear`、`/sessions`、`/rename`、`/compact`、`/scan`、`/compile`、`/diagnostics`、`/skills`、`/mcp`、`/tools`、`/model`、`/approve`、`/reject`。
- Pi Agent 宿主：持久化 JSONL 会话、流式事件、自动上下文压缩、重试和会话恢复。
- PLC Skills：内置 CODESYS 工程工作流、PLC 安全审查、IEC 61131-3 Structured Text 规则，并读取项目内用户自定义 Skills；设置页提供免费 Skill 商店和下一轮自动加载。
- PLC 内置工具：`plc__project_snapshot`、`plc__list_pous`、`plc__read_st_source`、`plc__search_project`、`plc__propose_edit`、`plc__compile_project`、`plc__diagnostics`。常用工程读取和诊断不需要另行安装 MCP。
- 可选 MCP：设置页提供至少 11 个免费 MCP 商店条目，其中包含官方 Filesystem、Memory、Sequential Thinking、Everything、Puppeteer，以及社区 Context7、CODESYS MCP Toolkit、CODESYS MCP SP21+、CODESYS MCP SP21+ 中文版、Festo CODESYS MCP、CODESYS Persistent MCP；同时支持手动配置、stdio JSON-RPC（JSONL、`Content-Length`）和 Streamable HTTP（JSON、SSE、Bearer Token、`Mcp-Session-Id`）工具发现与调用。
- 工程闭环：选择 `.project` 文件或目录，读取源对象，生成真实 unified Diff，审批后才写盘；写入补丁可在正文未被外部修改时撤回/重做。
- CODESYS Agent 闭环：每轮按需握手 MCP、读取工程/POU、按真实 schema 调用社区 CODESYS 工具、审批后写回并执行真实目标编译；同一轮复用 MCP 进程，轮次结束释放，不形成常驻后台。
- 编译诊断：优先调用已连接的外部 CODESYS 编译工具并读取真实错误/警告；没有真实编译工具时明确阻止“编译通过”结论，单独使用 `diagnostics` 才执行本地静态 IEC 61131-3 结构诊断。
- 模型接口：OpenAI Responses、Anthropic Messages、OpenAI 兼容 Chat Completions 和 Ollama。

与 PLC 无关的 browser、computer-use、Telegram、Composio、自动化等 Codex 扩展不放入初版桌面包。

## 技术栈

- Tauri 2 + Rust/Tokio：桌面窗口、本机 RPC、路径校验、内置 PLC 工具、MCP、审批和高风险操作拦截。
- Vue 3 + TypeScript + Vite：CodexUI 会话布局、工程概览、审批和诊断视图。
- `@earendil-works/pi-coding-agent`：会话持久化、工具循环、流式事件和上下文压缩。

## 本地运行

```text
npm install
npm run tauri:dev
```

Pi 宿主需要 Node.js 22.19 或更新版本。发布包内的 `pi-agent-host.bundle.mjs` 已把必要的 Pi 运行逻辑合并为单文件，不再要求安装包携带深层 `node_modules`；没有 Node.js 时，Rust Agent 会自动使用内置后备链路继续工作。

## 发布构建

```text
npm run build
npm run tauri:build
```

Windows 安装包和可执行文件会输出到 `src-tauri/target/release/bundle`。构建前会自动生成 `agent-host/pi-agent-host.bundle.mjs` 并嵌入安装包；目标机器仍需 Node.js 22.19+（或另行配置 `PLC_PILOT_NODE`），直接 EXE 是否便携取决于目标机器的 WebView2 运行时，不能把它描述为完全零依赖 portable 包。

## CODESYS 工程桥接

PLC Pilot 不在 CODESYS 内嵌聊天窗口。已保存工程可以直接在桌面工作台的“工程概览”中选择；需要读取未保存的当前工程或当前编辑器选区时，可在 CODESYS 的 `Tools` → `Scripting` → `Execute Script File` 中执行 `codesys-bridge/Script Commands/plc_pilot_sync.py`。CODESYS 工程/POU 的真实写回和目标编译通过设置页安装的社区 MCP 完成，按 Agent 任务按需启动，不常驻后台。

该脚本只读 `projects.primary`，把工程路径、对象清单和 ST 文本导出到 `%LOCALAPPDATA%\\PLC Pilot\\codesys-bridge\\current-project.json`。桌面工作台会自动同步快照。脚本不修改 CODESYS 工程，也不创建 CODESYS 插件或聊天侧栏；它是只读兼容入口，不是写回和编译主链路。

## MCP 配置

设置面板提供免费 MCP 商店和手动配置两条路径。商店当前只收录来源、许可证和包名可核验的服务，初版包含 5 个官方条目和 6 个社区条目；其中 5 个社区条目直接面向 CODESYS。点击安装会把真实 `npx -y` 启动配置写入本机，首次连接时由 npm 获取包，不使用假安装状态。收费或未核验服务不会自动加入目录。

手动配置支持 stdio、Streamable HTTP、自定义环境变量和请求头。HTTP 服务可配置 Bearer Token，内部映射为 `MCP_AUTH_TOKEN`；敏感请求头不会回显。服务连接、工具 schema、调用结果和诊断会显示在工具目录与 Agent 时间线；PLC 内置工具始终位于 `plc__` 命名空间。

工具访问默认是“审批模式”：工程写入、下载、连接设备、RUN/STOP、Force、在线写变量、脚本和凭据操作都会显示批准/拒绝卡片；用户可在重试设置页主动切换“完全访问模式”，由当前已启用工具直接执行。`/plan` 计划模式始终阻止写入和在线操作。

## 安全边界

下载、部署、RUN/STOP、Force/Unforce、Reset、在线写变量、Shell 和脚本执行默认阻止。修改、删除、重命名、安装库和覆盖工程等动作必须人工审批；批准后仍需重新编译并查看诊断结果。模型密钥、MCP Token 和敏感请求头保存在 C 盘应用目录的 Windows DPAPI 保护凭据文件，不写入项目文件、普通运行配置或会话正文。

## 本机 RPC

桌面运行时在 `%LOCALAPPDATA%\\PLC Pilot\\codesys-bridge\\desktop-endpoint.json` 写入随机令牌保护的回环端点，同时兼容以下最小 Codex 风格方法：`thread/list`、`thread/start`、`thread/read`、`thread/resume`、`turn/start`、`context/compact`。协议只服务本机 CODESYS/工具桥接，不启动浏览器、WebSocket 或远程控制服务。

## 参考实现

交互结构参考本地拉取的 OpenAI Codex 源码和开源 CodexUI；Agent 会话、Skills、压缩和工具协议沿用成熟 Pi SDK 能力，PLC 专属工程扫描、审批和高风险边界由本项目 Rust 桥接层实现。
