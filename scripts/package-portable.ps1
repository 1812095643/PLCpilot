#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portableDirectory = Join-Path $projectRoot 'output\PLC-Pilot-Portable'
$runtimeSource = Join-Path $projectRoot 'runtime-stage'
$releaseExecutable = Join-Path $projectRoot 'src-tauri\target\release\plc-pilot.exe'
$agentBundle = Join-Path $projectRoot 'agent-host\pi-agent-host.bundle.mjs'
$stoneSource = Join-Path $projectRoot 'stone-mcp\dist'
$patentSkillSource = Join-Path $projectRoot 'skills\patent-disclosure-skill'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
$archive = Join-Path $projectRoot ('output\PLC-Pilot-Portable-' + $version + '-win-x64.zip')

foreach ($required in @($releaseExecutable, $agentBundle, (Join-Path $runtimeSource 'runtime-manifest.json'), (Join-Path $stoneSource 'stone-mcp-server.mjs'), (Join-Path $stoneSource 'bridge.py'), (Join-Path $stoneSource 'data\official-api.json.gz'), (Join-Path $patentSkillSource 'SKILL.md'))) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw ('Missing build artifact: ' + $required) }
}
New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
$runtimeTarget = [IO.Path]::GetFullPath((Join-Path $portableDirectory 'runtime'))
$expectedParent = (Resolve-Path -LiteralPath $portableDirectory).Path
if ([IO.Path]::GetDirectoryName($runtimeTarget) -ne $expectedParent) { throw 'Portable runtime path is outside the output directory.' }
if (Test-Path -LiteralPath $runtimeTarget) {
    if ((Get-Item -LiteralPath $runtimeTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Runtime output directory cannot be a link.'
    }
    Remove-Item -LiteralPath $runtimeTarget -Recurse -Force
}
Copy-Item -LiteralPath $runtimeSource -Destination $runtimeTarget -Recurse
Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $portableDirectory 'plc-pilot.exe') -Force
Copy-Item -LiteralPath $agentBundle -Destination (Join-Path $portableDirectory 'pi-agent-host.bundle.mjs') -Force
$stoneTarget = Join-Path $portableDirectory 'stone-mcp'
New-Item -ItemType Directory -Path $stoneTarget -Force | Out-Null
Get-ChildItem -LiteralPath $stoneSource | Copy-Item -Destination $stoneTarget -Recurse -Force
$skillTarget = Join-Path $portableDirectory 'skills\patent-disclosure-skill'
New-Item -ItemType Directory -Path $skillTarget -Force | Out-Null
Get-ChildItem -LiteralPath $patentSkillSource | Copy-Item -Destination $skillTarget -Recurse -Force
@{ product = 'PLC Pilot'; version = $version; format = 1 } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $portableDirectory 'portable.json') -Encoding UTF8
$licenseTarget = Join-Path $portableDirectory 'licenses'
New-Item -ItemType Directory -Path $licenseTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'vendor\toonflow\LICENSE') -Destination (Join-Path $licenseTarget 'toonflow-LICENSE') -Force
Compress-Archive -LiteralPath $portableDirectory -DestinationPath $archive -CompressionLevel Optimal -Force
Get-Item -LiteralPath $archive | Select-Object Name, Length
