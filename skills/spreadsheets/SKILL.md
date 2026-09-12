---
name: "Spreadsheets"
description: "读取、创建和修改 Excel 工作簿；支持多工作表、行列数据和基础类型。"
---

# Spreadsheets

处理 `.xlsx` 时先使用 `read_office_document` 读取每个工作表的真实内容；写入使用
`write_office_document`，通过 `sheets` 数组传入 `name` 和 `rows` 二维数组。单元格支持
文本、数字、布尔值和空值，生成真实 OOXML ZIP，不依赖 openpyxl、pandas 或用户电脑的
Python 环境。

任何覆盖都必须先经过审批；写入前工具会校验文件 SHA-256。公式、宏、外部链接、复杂
样式和透视表不在基础生成器的保真范围内，不能把简单数据写入描述成完整保留原工作簿。
