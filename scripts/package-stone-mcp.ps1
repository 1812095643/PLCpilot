#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'stone-mcp\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$source = Join-Path $projectRoot 'stone-mcp\dist'
foreach ($relative in @('stone-mcp-server.mjs', 'bridge.py', 'data\official-api.json.gz', 'README.md')) {
    if (!(Test-Path -LiteralPath (Join-Path $source $relative) -PathType Leaf)) { throw ('缺少 MCP 构建文件：' + $relative) }
}
$outputDirectory = Join-Path $projectRoot 'output'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archive = Join-Path $outputDirectory ('PLC-Pilot-STone-MCP-' + $version + '.zip')
Compress-Archive -LiteralPath $source -DestinationPath $archive -CompressionLevel Optimal -Force
Get-Item -LiteralPath $archive | Select-Object Name,Length
