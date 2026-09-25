---
name: "Documents"
description: "读取、创建和修改 Word 文档；优先使用 PLC Pilot 原生 Office 工具。"
---

# Documents

处理 `.docx` 时先使用 `document_inspect` 获取真实结构和稳定对象 ID，再按用户选区调用
`document_edit`。写入动作必须等待审批，完全访问模式才会直接执行；文件工作区的人工编辑和
Agent 修改使用同一份文档版本，外部修改后不能覆盖。

工具契约：`document_inspect` 可传 `path` 首次打开，也可传 `document_id` 和 `target`；
`document_edit` 必须传 inspect 返回的 `version` 和局部操作。修改目标应是段落、运行、表格
或图片对象，不能把全文重建伪装成局部修改。

读取失败要返回真实原因，不得把压缩包字节当作正文，也不得声称保留了未解析的复杂
格式。写入前复核目标文件的 SHA-256，检测到外部修改就停止覆盖。
