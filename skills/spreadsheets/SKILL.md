---
name: "Spreadsheets"
description: "读取、创建和修改 Excel 工作簿；支持多工作表、行列数据和基础类型。"
---

# Spreadsheets

处理 `.xlsx` 时先使用 `document_inspect` 读取工作表和稳定单元格 ID；写入使用
`document_edit` 的 `set_cell` 操作，传入 `sheet`、`address`、`value` 或 `formula`。真实
OOXML 局部修改不依赖 openpyxl、pandas 或用户电脑的 Python 环境；选择 OfficeCLI 时才由
OfficeCLI 处理其支持的公式和单元格能力。

任何覆盖都必须先经过审批；写入前工具会校验文件 SHA-256。公式、宏、外部链接、复杂
样式和透视表不在基础生成器的保真范围内，不能把简单数据写入描述成完整保留原工作簿。
