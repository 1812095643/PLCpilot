#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portableDirectory = Join-Path $projectRoot 'output\PLC-Pilot-Portable'
$runtimeSource = Join-Path $projectRoot 'runtime-stage'
$releaseExecutable = Join-Path $projectRoot 'src-tauri\target\release\plc-pilot.exe'
$agentBundle = Join-Path $projectRoot 'agent-host\pi-agent-host.bundle.mjs'
# Windows PowerShell 5 默认按本地代码页读文本；JSON 含中文时必须显式使用 UTF-8。
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
$archive = Join-Path $projectRoot ('output\PLC-Pilot-Portable-' + $version + '-win-x64.zip')

# 便携包曾在安装包重建后仍保留旧 EXE；构建链现在统一复制本次 release，
# 并重建 runtime 目录，防止旧版 Python 路径和缓存混入新包。
foreach ($required in @($releaseExecutable, $agentBundle, (Join-Path $runtimeSource 'runtime-manifest.json'))) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw ('缺少构建产物：' + $required) }
}
New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
$runtimeTarget = [IO.Path]::GetFullPath((Join-Path $portableDirectory 'runtime'))
$expectedParent = (Resolve-Path -LiteralPath $portableDirectory).Path
if ([IO.Path]::GetDirectoryName($runtimeTarget) -ne $expectedParent) { throw '便携运行时路径超出输出目录。' }
if (Test-Path -LiteralPath $runtimeTarget) {
    if ((Get-Item -LiteralPath $runtimeTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw '运行时输出目录不能是链接，请更换输出目录后构建。'
    }
    Remove-Item -LiteralPath $runtimeTarget -Recurse -Force
}
Copy-Item -LiteralPath $runtimeSource -Destination $runtimeTarget -Recurse
Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $portableDirectory 'plc-pilot.exe') -Force
Copy-Item -LiteralPath $agentBundle -Destination (Join-Path $portableDirectory 'pi-agent-host.bundle.mjs') -Force
Compress-Archive -LiteralPath $portableDirectory -DestinationPath $archive -CompressionLevel Optimal -Force
Get-Item -LiteralPath $archive | Select-Object Name, Length
