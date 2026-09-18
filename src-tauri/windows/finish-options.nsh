Function PlcRememberStartup
  Push $0
  Push $1
  Push $2
  StrCpy $PlcStartupWasEnabled 0
  !if "${ARCH}" == "x64"
    SetRegView 64
  !endif
  ReadRegDWORD $PlcCreateDesktopChoice HKCU "${MANUPRODUCTKEY}" "CreateDesktopShortcut"
  ${If} ${Errors}
    StrCpy $PlcCreateDesktopChoice 1
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PLC Pilot"
  ${If} $0 != ""
    StrCpy $PlcStartupWasEnabled 1
    System::Alloc 12
    Pop $2
    System::Call 'advapi32::RegGetValueW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", w "PLC Pilot", i 0x00010008, p 0, p r2, *i 12) i.r1'
    ${If} $1 = 0
      System::Call '*$2(i .r0)'
      ${If} $0 != 2
      ${AndIf} $0 != 6
        StrCpy $PlcStartupWasEnabled 0
      ${EndIf}
    ${EndIf}
    System::Free $2
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function PlcFinishShow
  ${If} ${RebootFlag}
    Return
  ${EndIf}
  ${NSD_CreateCheckbox} 120u 130u 195u 12u "$(PlcStartWithWindows)"
  Pop $PlcStartupCheckbox
  SetCtlColors $PlcStartupCheckbox "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
  ${NSD_SetState} $PlcStartupCheckbox $PlcStartupWasEnabled
  ${NSD_SetState} $mui.FinishPage.ShowReadme $PlcCreateDesktopChoice
FunctionEnd

Function PlcFinishLeave
  ${If} $PlcStartupCheckbox = ""
    Return
  ${EndIf}
  ${NSD_GetState} $PlcStartupCheckbox $PlcStartupSelected
  ${NSD_GetState} $mui.FinishPage.ShowReadme $PlcCreateDesktopChoice
  WriteRegDWORD HKCU "${MANUPRODUCTKEY}" "CreateDesktopShortcut" $PlcCreateDesktopChoice
  ClearErrors
  ${If} $PlcStartupSelected = ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PLC Pilot" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(PlcStartupSaveError)"
      Abort
    ${EndIf}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "PLC Pilot"
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PLC Pilot"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "PLC Pilot"
  ${EndIf}
FunctionEnd
