# Sets the app secrets on both Railway services (web and worker) of the linked
# project c2c-saas. Run from the repo root in Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1
# With the OAuth client JSON downloaded from Google Cloud:
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -GoogleJson "C:/path/client_secret.json"
#
# Generated secrets (ENCRYPTION_KEY, AUTH_SECRET, PROVISIONING_SECRET, WEBSUB_SECRET) are set
# only when missing: changing ENCRYPTION_KEY later would make stored tokens
# unreadable. Values are never printed. Google OAuth values and the platform Gemini key are asked for when
# missing; press Enter to skip them for now. With -GoogleJson they are read
# from the downloaded client JSON instead (and replace existing values).
#
# Tracked links (Phase 5, docs/SETUP-CLOUDFLARE.md) once Cloudflare is set up:
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -BrandDomain vidrev.app
# sets BRAND_BASE_URL, LINK_FALLBACK_BASE_URL (go.) and CUSTOM_HOSTNAME_CNAME_TARGET
# (customers.) and asks for CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID.

param([string]$GoogleJson = "", [string]$BrandDomain = "")

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

foreach ($name in @("ENCRYPTION_KEY", "AUTH_SECRET", "PROVISIONING_SECRET", "WEBSUB_SECRET")) {
    if ($existing -contains $name) {
        Write-Host "keep $name (already set)"
    } else {
        Set-OnAllServices $name (New-Secret)
    }
}

if ($BrandDomain) {
    $domain = $BrandDomain.Trim().ToLower() -replace "^https?://", "" -replace "/.*$", ""
    Set-OnAllServices "BRAND_BASE_URL" "https://$domain"
    Set-OnAllServices "LINK_FALLBACK_BASE_URL" "https://go.$domain"
    Set-OnAllServices "CUSTOM_HOSTNAME_CNAME_TARGET" "customers.$domain"
    foreach ($name in @("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID")) {
        $secure = Read-Host "Paste $name (Enter to keep the current value)" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        if ($plain) { Set-OnAllServices $name $plain.Trim() } else { Write-Host "kept $name" }
    }
    Write-Host "Done. Railway redeploys with the next push to main, or redeploy both services now in the Railway dashboard."
    exit 0
}

if ($GoogleJson) {
    $client = (Get-Content -Raw -Path $GoogleJson | ConvertFrom-Json).web
    if (-not $client.client_id -or -not $client.client_secret) { throw "Not a Google web OAuth client JSON: $GoogleJson" }
    Set-OnAllServices "GOOGLE_CLIENT_ID" $client.client_id
    Set-OnAllServices "GOOGLE_CLIENT_SECRET" $client.client_secret
    Write-Host "Done. Railway redeploys with the next push to main, or redeploy both services now in the Railway dashboard."
    exit 0
}

foreach ($name in @("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GEMINI_PLATFORM_API_KEY")) {
    if ($existing -contains $name) {
        Write-Host "keep $name (already set)"
        continue
    }
    $secure = Read-Host "Paste $name (Enter to skip)" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($plain) { Set-OnAllServices $name $plain.Trim() } else { Write-Host "skipped $name" }
}

Write-Host "Done. Railway redeploys with the next push to main, or redeploy both services now in the Railway dashboard."
