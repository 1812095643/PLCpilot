#requires -Version 5.1
param([Parameter(Mandatory = $true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
$jobRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$logPath = Join-Path $jobRoot 'update.log'
$ownedEntries = @('plc-pilot.exe', 'pi-agent-host.bundle.mjs', 'runtime', 'portable.json')
$backedUp = New-Object 'System.Collections.Generic.List[string]'
$newProcess = $null
$job = $null
$replacementStarted = $false
$parentExited = $false

function Assert-NoLink([string]$Path) {
    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw ('更新目录不能是符号链接：' + $Path)
    }
}

function Copy-ProgramEntry([string]$SourcePath, [string]$TargetPath) {
    Assert-NoLink $SourcePath
    Assert-NoLink $TargetPath
    if (Test-Path -LiteralPath $SourcePath -PathType Container) {
        # 实机验证中 PowerShell 5 对整个 runtime 改名持续返回访问拒绝，而逐文件复制可用。
        # 因此先完整备份四个程序条目，再用 Windows 自带 Robocopy 同步。任何复制问题都恢复
        # 已完成的备份，不依赖目录改名，也不把项目/配置目录交给同步器。
        # /E /PURGE 同步内容但保留目标目录 ACL；/XJ 排除连接，/IS 强制校正同尺寸同时间文件。
        $robocopy = Join-Path $env:SystemRoot 'System32/robocopy.exe'
        & $robocopy $SourcePath $TargetPath /E /PURGE /COPY:DAT /DCOPY:DAT /XJ /IS /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw ('运行时复制未完成，Robocopy 返回 ' + $LASTEXITCODE) }
    } else {
        Copy-Item -LiteralPath $SourcePath -Destination $TargetPath -Force
    }
}

function Save-Result([string]$Status, [string]$Message) {
    @{ status = $Status; message = $Message; version = $job.version; date = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $job.result -Encoding UTF8
}

try {
    # 删除与覆盖只发生在已验证的绝对程序目录中，且目标来自固定四项清单。
    if ([IO.Path]::GetFullPath($JobPath) -ne (Join-Path $jobRoot 'job.json')) { throw '更新任务文件不在辅助程序目录。' }
    $job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $target = [IO.Path]::GetFullPath($job.target)
    $source = [IO.Path]::GetFullPath($job.source)
    if ($target -eq [IO.Path]::GetPathRoot($target) -or [IO.Path]::GetDirectoryName($target) -ne [IO.Path]::GetDirectoryName($jobRoot)) { throw '程序与更新暂存目录不在同一父目录。' }
    if (![IO.Path]::GetFileName($jobRoot).StartsWith('.plc-pilot-update-') -or $source -ne (Join-Path $jobRoot 'PLC-Pilot-Portable')) { throw '更新暂存目录不正确。' }
    Assert-NoLink $jobRoot
    Assert-NoLink $target
    Assert-NoLink $source
    if (!(Test-Path -LiteralPath (Join-Path $target 'portable.json') -PathType Leaf)) { throw '目标不是 PLC Pilot 便携目录。' }
    foreach ($name in $ownedEntries) {
        Assert-NoLink (Join-Path $target $name)
        Assert-NoLink (Join-Path $source $name)
        if (!(Test-Path -LiteralPath (Join-Path $source $name))) { throw ('新版本缺少：' + $name) }
    }
    $backup = Join-Path $jobRoot 'rollback'
    New-Item -ItemType Directory -Path $backup | Out-Null
    $parentProcess = Get-Process -Id $job.pid -ErrorAction SilentlyContinue
    if ($parentProcess -and [IO.Path]::GetFullPath($parentProcess.Path) -ne (Join-Path $target 'plc-pilot.exe')) { throw '待退出进程与程序目录不匹配。' }
    New-Item -ItemType File -Path (Join-Path $jobRoot 'ready') | Out-Null
    if ($parentProcess -and !$parentProcess.WaitForExit(90000)) { throw '当前程序尚未退出，已取消替换。' }
    $parentExited = $true
    foreach ($name in $ownedEntries) {
        $old = Join-Path $target $name
        if (Test-Path -LiteralPath $old) {
            Copy-ProgramEntry $old (Join-Path $backup $name)
            $backedUp.Add($name)
        }
    }
    $replacementStarted = $true
    foreach ($name in $ownedEntries) { Copy-ProgramEntry (Join-Path $source $name) (Join-Path $target $name) }
    Save-Result 'success' ('已更新至 ' + $job.version)
    $newProcess = Start-Process -FilePath (Join-Path $target 'plc-pilot.exe') -WorkingDirectory $target -WindowStyle Hidden -PassThru
    if ($newProcess.WaitForExit(3000)) { throw '新版本启动后立即退出，正在恢复旧版本。' }
    Remove-Item -LiteralPath $jobRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
} catch {
    $message = $_.Exception.Message
    $message | Add-Content -LiteralPath $logPath -Encoding UTF8
    if ($parentExited) {
        try {
            if ($newProcess -and !$newProcess.HasExited) { Stop-Process -Id $newProcess.Id; $newProcess.WaitForExit(10000) | Out-Null }
            if ($replacementStarted) {
                foreach ($name in $ownedEntries) {
                    if ($backedUp.Contains($name)) { Copy-ProgramEntry (Join-Path $backup $name) (Join-Path $target $name) }
                    elseif (Test-Path -LiteralPath (Join-Path $target $name)) { Remove-Item -LiteralPath (Join-Path $target $name) -Recurse -Force }
                }
            }
            Save-Result 'error' ('更新未完成，已保留或恢复旧版本：' + $message)
            Start-Process -FilePath (Join-Path $target 'plc-pilot.exe') -WorkingDirectory $target -WindowStyle Hidden
        } catch {
            ('恢复过程需要处理：' + $_.Exception.Message + '；旧程序保留于 ' + $backup) | Add-Content -LiteralPath $logPath -Encoding UTF8
            if ($job) { Save-Result 'error' ('请从 ' + $backup + ' 恢复旧程序；详情见 ' + $logPath) }
        }
    }
    exit 1
}
