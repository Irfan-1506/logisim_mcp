$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
& uv sync --frozen --directory $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& codex mcp get logisim-evolution *> $null
if ($LASTEXITCODE -eq 0) { throw 'logisim-evolution is already registered. Keep it or remove it explicitly before reinstalling.' }
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
$circuitRoot = Join-Path $projectRoot 'circuits'
& codex mcp add logisim-evolution --env "LOGISIM_WORKSPACE=$circuitRoot" -- $pythonPath -m logisim_mcp.server
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed' }
Write-Host 'Registered. Reload MCP servers or restart Codex.'
