---
name: "Presentations"
description: "读取、创建和修改 PowerPoint 演示文稿；支持幻灯片标题和正文。"
---

# Presentations

处理 `.pptx` 时先使用 `read_office_document`，工具会按幻灯片顺序提取正文。创建或
覆盖时使用 `write_office_document` 的 `slides` 数组，每项包含 `title` 和 `body`。
生成器写出可打开的 OOXML 演示文稿，并在审批通过后原子替换目标文件。

基础实现保证文本内容和页面顺序；复杂主题、母版、图表、动画、嵌入对象和备注需要
保留时必须先读取并明确能力边界，不能伪造已经保留这些对象。
