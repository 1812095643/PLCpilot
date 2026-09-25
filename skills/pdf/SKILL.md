---
name: "PDF"
description: "读取 PDF 文本层并创建基础文本 PDF。"
---

# PDF

使用 `document_inspect` 读取 PDF 页面和文字/图片对象。扫描件没有文本层时明确提示需要 OCR，
不把图片内容猜成文字。文字和图片局部修改使用 `document_edit`；写入前等待审批并校验
目标文件未被外部修改。OfficeCLI 不处理 PDF，始终使用 PLC Pilot 原生引擎。

当前原生生成器输出基础单页文本 PDF，适合日志、报告和中间结果；复杂排版、字体嵌入、
表单、签名和注释需要专门的 PDF 编辑流程，不能声称已经保留这些结构。
