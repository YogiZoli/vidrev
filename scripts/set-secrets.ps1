# Sets the app secrets on both Railway services (web and worker) of the linked
# project c2c-saas. Run from the repo root in Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1
#
# Generated secrets (ENCRYPTION_KEY, AUTH_SECRET, PROVISIONING_SECRET) are set
# only when missing: changing ENCRYPTION_KEY later would make stored tokens
# unreadable. Values are never printed. Google OAuth values are asked for when
# missing; press Enter to skip them for now.

$ErrorActionPreference = "Stop"
$services = @("web", "worker")

function Get-ExistingNames($service) {
    $json = railway variable list --service $service --json | Out-String
    return ($json | ConvertFrom-Json).PSObject.Properties.Name
}

function New-Secret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Set-OnAllServices($name, $value) {
    foreach ($service in $services) {
        $value | railway variable set $name --stdin --service $service --skip-deploys | Out-Null
    }
    Write-Host "set $name on web and worker"
}

$existing = Get-ExistingNames "web"

foreach ($name in @("ENCRYPTION_KEY", "AUTH_SECRET", "PROVISIONING_SECRET")) {
    if ($existing -contains $name) {
        Write-Host "keep $name (already set)"
    } else {
        Set-OnAllServices $name (New-Secret)
    }
}

foreach ($name in @("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")) {
    if ($existing -contains $name) {
        Write-Host "keep $name (already set)"
        continue
    }
    $secure = Read-Host "Paste $name (Enter to skip)" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($plain) { Set-OnAllServices $name $plain.Trim() } else { Write-Host "skipped $name" }
}

Write-Host "Done. Railway redeploys with the next push to main, or redeploy both services now in the Railway dashboard."
