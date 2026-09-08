#requires -Version 5.1
param([Parameter(Mandatory = $true)][string]$JobPath)
$ErrorActionPreference = 'Stop'
$jobRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$logPath = Join-Path $jobRoot 'update.log'
$ownedEntries = @('plc-pilot.exe', 'pi-agent-host.bundle.mjs', 'runtime', 'portable.json')
$movedOld = New-Object 'System.Collections.Generic.List[string]'
$movedNew = New-Object 'System.Collections.Generic.List[string]'
$newProcess = $null
$job = $null
$replacementStarted = $false

function Assert-NoLink([string]$Path) {
    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw ('更新目录不能是符号链接：' + $Path)
    }
}

function Save-Result([string]$Status, [string]$Message) {
    @{ status = $Status; message = $Message; version = $job.version; date = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $job.result -Encoding UTF8
}

try {
    # 所有移动/删除目标均由经过验证的绝对程序路径加固定条目组成；不接受通配符或外部项目目录。
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
    $replacementStarted = $true
    foreach ($name in $ownedEntries) {
        $old = Join-Path $target $name
        if (Test-Path -LiteralPath $old) {
            # 防病毒扫描可能短暂持有 EXE；有限重试后进入回滚，绝不强制终止其他进程。
            for ($attempt = 0; ; $attempt++) {
                try { Move-Item -LiteralPath $old -Destination (Join-Path $backup $name); break }
                catch { if ($attempt -ge 9) { throw }; Start-Sleep -Milliseconds 500 }
            }
            $movedOld.Add($name)
        }
        Move-Item -LiteralPath (Join-Path $source $name) -Destination $old
        $movedNew.Add($name)
    }
    Save-Result 'success' ('已更新至 ' + $job.version)
    $newProcess = Start-Process -FilePath (Join-Path $target 'plc-pilot.exe') -WorkingDirectory $target -WindowStyle Hidden -PassThru
    if ($newProcess.WaitForExit(3000)) { throw '新版本启动后立即退出，正在恢复旧版本。' }
    # 只清理本次随机目录；用户自行放在便携目录中的其他文件和全部 AppData 数据均保持原位。
    Remove-Item -LiteralPath $jobRoot -Recurse -Force -ErrorAction SilentlyContinue
} catch {
    $message = $_.Exception.Message
    $message | Add-Content -LiteralPath $logPath -Encoding UTF8
    if ($replacementStarted) {
        try {
            if ($newProcess -and !$newProcess.HasExited) { Stop-Process -Id $newProcess.Id; $newProcess.WaitForExit(10000) | Out-Null }
            foreach ($name in $movedNew) { Remove-Item -LiteralPath (Join-Path $target $name) -Recurse -Force }
            foreach ($name in $movedOld) { Move-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $target $name) }
            Save-Result 'error' ('更新未完成，已恢复旧版本：' + $message)
            Start-Process -FilePath (Join-Path $target 'plc-pilot.exe') -WorkingDirectory $target -WindowStyle Hidden
        } catch {
            ('恢复过程需要处理：' + $_.Exception.Message + '；旧程序保留于 ' + $backup) | Add-Content -LiteralPath $logPath -Encoding UTF8
            if ($job) { Save-Result 'error' ('请从 ' + $backup + ' 恢复旧程序；详情见 ' + $logPath) }
        }
    }
    exit 1
}
