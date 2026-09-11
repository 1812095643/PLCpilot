# CAREL STone MCP（PLC Pilot）

根据用户提供的 `CAREL-STone-Agent-MCP-API-全集.json` 实现，调用 CAREL 的原生 SToneCLI/IronPython；MCP 协议复用官方 TypeScript SDK。不是 CAREL 发布的 MCP 产品。

## 覆盖范围

| 官方接口范围 | 本实现 |
| --- | --- |
| Solution、Project、Target、Watch、Task 的 33 个方法 | 逐一注册独立工具，参数、位置顺序、默认值和返回值保留官方语义 |
| Solution、Project、ProjectConfiguration、Target、Task 属性 | 5 个 inspect 工具完整读取文档字段；配置名称解析为官方对象 |
| Project 可写属性、ProjectConfiguration 的 18 个字段 | 两个属性修改工具，修改后由 Save 保存 |
| build、automatic-test、unit-tests | 真实 CLI 调用、真实退出码；JUnit/Cobertura 报告及覆盖率门槛 |
| export-workspace、iron-python、许可硬件 ID、在线/离线激活 | 5 个 CLI 工具，支持文档中的参数 |
| 控制器 ST 系统库 | 54 个命名空间、1,138 个条目，包括全部重载、参数方向、类型、返回值、示例和原文 |
| 官方帮助和库页面 | 72 个帮助页、54 个库页面；全文检索、分页详情、MCP resources 和工作流 prompt |

共 **53 个 MCP 工具**。控制器系统库是在 ST 应用中使用的库，官方资料没有为这些函数提供电脑端远程协议，因此通过 `stone_api_search` / `stone_api_get` 获取准确用法，再编写工程代码并真实编译运行；没有伪装成 1,138 个可远程执行的函数。

资料版本：2026-09-11；原始 JSON SHA256：`67266d84084a63aa490859e2fd5ffe3da485d3648fa0bf7ba376922f342a0c50`。`data/official-api.json` 保留原始文件；发布时仅 gzip 压缩，不裁剪接口。来源路径是证据标识，运行不依赖原来的 `D:\Data`。

## 使用

在 PLC Pilot 的「设置 → MCP 服务」安装 **CAREL STone（内置）**，即可发现全部工具，不需要联网安装 npm 包。

工程自动化需要在 Windows 安装 CAREL STone 及相应许可。默认检查 CAREL 安装目录和 PATH；自定义目录可编辑该 MCP 的环境变量：

```json
{
  "STONE_CLI_PATH": "C:\\Program Files (x86)\\CAREL\\STone\\SToneCLI.exe"
}
```

API 文档检索不需要 STone、许可证或控制器。不要把普通 Python 配置成 SToneCLI；STone 自带 IronPython 3.4 和 `stone` 对象，应用内置 CPython 不是其替代品。

## 独立客户端

仓库根目录执行 `npm ci`、`npm run build:stone-mcp`。将 `stone-mcp/dist` 整个目录复制到目标电脑，用 Node 22+ 或 PLC Pilot 包内的 `runtime/node/node.exe` 启动 `stone-mcp-server.mjs`。客户端 stdio 配置示例（替换为实际绝对路径）：

```json
{
  "mcpServers": {
    "carel-stone": {
      "command": "C:\\PLC-Pilot-Portable\\runtime\\node\\node.exe",
      "args": ["C:\\PLC-Pilot-Portable\\stone-mcp\\stone-mcp-server.mjs"],
      "env": { "STONE_CLI_PATH": "C:\\Program Files (x86)\\CAREL\\STone\\SToneCLI.exe" }
    }
  }
}
```

## 工程自动工作流

1. `stone_environment` 检查运行前提；`stone_api_search` 获取接口依据。
2. `stone_solution_open` 建立本次会话；新工程先 `stone_solution_create_new_solution`，再以返回的 `solutionPath` 调用 Open。
3. `stone_solution_inspect` / `stone_project_inspect` 读取项目与配置。修改源文件后可通过 `stone_project_add_file` 引入项目；其他修改使用对应方法和属性工具。
4. `stone_solution_save` 持久化，再 `stone_solution_build`，检查 `result.IsSuccessful`、`Errors`、`Warnings` 和 `Messages`。
5. 用户要求目标操作时，启动模拟器或指定目标。`Download` 要求本会话编译通过，并先断开已有连接；下载后可创建 Watch，使用返回的 `watchId` 读写变量。
6. CLI 测试使用独立进程，先保存并 `stone_solution_close`。`stone_cli_unit_tests` 的 `-c` 是覆盖率报告路径，不是项目配置。只有此次实际更新的报告会回传，旧报告不会冒充新结果。

`stone_cli_iron_python` 执行用户自备脚本，支持 `scriptArgs`；脚本通过官方注入的 `stone` 使用全部 API。该入口具有本机和设备访问能力，属于需审批的操作。

## 会话、取消和权限

- IronPython 子进程仅在首次工程调用时启动，保持到本次 MCP 会话关闭。同一会话串行操作，工程、配置和 Watch 不会因一次工具返回而丢失。
- 私有通信只监听 `127.0.0.1`，使用每次随机凭证，握手后关闭监听入口。标准输出仅用于 MCP；厂商输出经独立通道返回。
- 取消/超时收回 CLI 子进程树；不自动重放可能已部分执行的写操作。重新连接后必须重新打开工程与建立 Watch。跨会话的工程变更必须显式 Save。
- 参数使用 JSON Schema 校验和位置参数传递，不将用户字符串拼为 Shell 或 Python。只允许官方白名单对象/属性；本机文件输入检查实际路径。
- MCP annotations 标记读写性质，PLC Pilot 从同一工具目录生成审批策略。工程修改、构建、设备操作和许可激活进入既有批准/拒绝流程；完全访问模式沿用用户选择。独立 MCP 客户端需要实施自己的审批策略。
- 命令超时默认 90 秒，可用 `timeoutMs` 配置至 1 小时；进度通知用于支持长调用。输出超长会明确标记，报告保留完整文件路径。

## 测试阶段日志

默认自动写入 `%LOCALAPPDATA%\PLC Pilot\logs\stone-mcp`，不提供页面入口；PLC Pilot 的桌面与 Agent 日志分别在同级 `desktop`、`agent-host` 目录。独立 MCP 也会记录文件日志，目录可用 `PLC_PILOT_LOG_DIR` 指定。目录不可写时回退到 `%TEMP%\PLC Pilot\logs`。

记录初始化、工具名称与参数、官方返回、错误堆栈、SToneCLI/IronPython 输出、进程退出、中断和超时。每条记录有时间、软件版本、进程、运行编号和请求编号。MCP/Agent 文件达到约 10 MB 时轮转，各保留最近 20 份；桌面日志按日期轮转，保留 14 份。超长字段会保留首尾并明确标记截断，Key、密码、令牌、许可序列号和附件数据会过滤。

出现问题时，复制整个 logs 文件夹并记录复现时间、操作步骤和 STone 版本即可；不要复制认证或模型配置文件。日志只保存在本机，不自动上传。

## 验证边界

本开发机未安装 STone。本轮可验证：全量目录覆盖、官方参数映射、真实 stdio MCP 初始化/发现/检索/资源读取、错误路径、进程取消与独立 bundle 启动。**不能据此宣称已经通过 CAREL 实际工程编译、模拟器、变量读写或设备测试。**

安装 STone 后的验收顺序：创建隔离测试工程 → 添加 ST 文件 → 保存 → Build 检查官方诊断 → 启动模拟器 → Download → Watch 读写 → 运行单元测试与覆盖率报告。不要用生产控制器验证写入、清除或恢复操作。
