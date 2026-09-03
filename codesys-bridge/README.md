# CODESYS 只读桥接脚本

`Script Commands/plc_pilot_sync.py` 适用于 CODESYS 3.5.22（SP22）的 ScriptEngine。

脚本只读取 `projects.primary`，把当前工程路径、对象清单和 Structured Text 副本写入：

`%LOCALAPPDATA%\\PLC Pilot\\codesys-bridge\\current-project.json`

它不安装 CODESYS 插件、不创建聊天侧栏、不修改工程，也不执行下载、RUN/STOP 或在线写变量。桌面工作台会定时读取该快照，并在写入工程前要求人工审批。
