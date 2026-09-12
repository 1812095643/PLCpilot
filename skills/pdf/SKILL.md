---
name: "PDF"
description: "读取 PDF 文本层并创建基础文本 PDF。"
---

# PDF

使用 `read_office_document` 读取 PDF 文本层。扫描件没有文本层时明确提示需要 OCR，
不把图片内容猜成文字。使用 `write_office_document` 创建或覆盖 PDF，可传入
`content` 或 `paragraphs`；写入前等待审批并校验目标文件未被外部修改。

当前原生生成器输出基础单页文本 PDF，适合日志、报告和中间结果；复杂排版、字体嵌入、
表单、签名和注释需要专门的 PDF 编辑流程，不能声称已经保留这些结构。
