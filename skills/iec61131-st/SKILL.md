---
name: iec61131-st
description: 生成和修改 IEC 61131-3 Structured Text 时使用。
---

# IEC 61131-3 Structured Text

- 保持 CODESYS 工程现有命名、缩进、类型和命名空间约定。
- 变量声明与实现分开处理，不把声明写进实现区。
- 优先使用显式类型、枚举和功能块接口，避免魔法数字。
- 对数组、字符串和数值转换检查边界。
- 使用 `R_TRIG`、`F_TRIG`、`TON`、`TOF`、`TP` 时保持实例持久化。
- 不假设某个库已经安装；使用库功能前先读取 Library Manager 或编译诊断。
- 生成代码后必须通过目标 CODESYS 编译器验证，通用 ST 语法正确不等于目标工程可以编译。
