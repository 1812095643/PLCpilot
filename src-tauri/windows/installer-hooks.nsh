!include "${__FILEDIR__}\generated\installer-language.nsh"

Var PlcStartupCheckbox
Var PlcStartupWasEnabled
Var PlcStartupSelected
Var PlcCreateDesktopChoice

!macro NSIS_HOOK_POSTINSTALL
  ${If} $PlcStartupWasEnabled = 1
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PLC Pilot" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PLC Pilot"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "PLC Pilot"
  ${EndIf}
!macroend
