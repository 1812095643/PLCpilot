---
name: "Presentations"
description: "读取、创建和修改 PowerPoint 演示文稿；支持幻灯片标题和正文。"
---

# Presentations

处理 `.pptx` 时先使用 `document_inspect`，按幻灯片和对象读取真实结构。文字修改使用
`document_edit` 的 `replace_text` 操作；图片和对象必须使用稳定对象 ID，写入在审批后原子完成。

基础实现保证文本内容和页面顺序；复杂主题、母版、图表、动画、嵌入对象和备注需要
保留时必须先读取并明确能力边界，不能伪造已经保留这些对象。
