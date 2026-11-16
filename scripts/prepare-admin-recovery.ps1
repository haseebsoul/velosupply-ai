$ErrorActionPreference = 'Stop'

$envPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\backend\.env'))
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw 'backend/.env was not found. Copy backend/.env.example to backend/.env and configure Atlas first.'
}

$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
}
finally {
    $rng.Dispose()
}
$secret = [Convert]::ToBase64String($bytes)

$source = [System.IO.File]::ReadAllText($envPath)
$lines = $source -split "\r?\n"
$updatedLines = New-Object System.Collections.Generic.List[string]
$found = $false

foreach ($line in $lines) {
    if ($line -match '^\s*ADMIN_RECOVERY_KEY\s*=') {
        $updatedLines.Add('ADMIN_RECOVERY_KEY=' + $secret)
        $found = $true
    }
    else {
        $updatedLines.Add($line)
    }
}
if (-not $found) {
    $updatedLines.Add('ADMIN_RECOVERY_KEY=' + $secret)
}

$updated = [string]::Join([Environment]::NewLine, $updatedLines)
$tempPath = $envPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
$encoding = New-Object System.Text.UTF8Encoding($false)
try {
    [System.IO.File]::WriteAllText($tempPath, $updated, $encoding)
    Move-Item -LiteralPath $tempPath -Destination $envPath -Force
}
finally {
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
}

Write-Host 'A fresh one-time ADMIN_RECOVERY_KEY was written to backend/.env. Its value was not displayed.'
