---
name: "Documents"
description: "读取、创建和修改 Word 文档；优先使用 PLC Pilot 原生 Office 工具。"
---

# Documents

处理 `.docx` 时先使用 `read_office_document` 获取真实正文，再根据用户要求调用
`write_office_document`。写入动作必须等待审批，完全访问模式才会直接执行。

工具契约：`path` 使用当前工作目录内的相对路径；创建或覆盖时传入
`paragraphs` 数组或 `content` 文本。当前生成器保证可打开的 OOXML 文档和基础纯文本
段落，复杂模板、宏、批注、目录和原有样式需要保留时先说明限制。

读取失败要返回真实原因，不得把压缩包字节当作正文，也不得声称保留了未解析的复杂
格式。写入前复核目标文件的 SHA-256，检测到外部修改就停止覆盖。
