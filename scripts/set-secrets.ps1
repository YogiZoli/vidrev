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
# (customers.), asks for CLOUDFLARE_API_TOKEN and looks up CLOUDFLARE_ZONE_ID with it.

#
# GoHighLevel connector (Phase 6, docs/SETUP-GHL.md) once the Private Marketplace app exists:
#   powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -Ghl
# asks for GHL_CLIENT_ID and GHL_CLIENT_SECRET (Enter keeps the current value).

param([string]$GoogleJson = "", [string]$BrandDomain = "", [switch]$Ghl)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 prefixes piped text with a byte order mark unless told not to.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
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
    $secure = Read-Host "Paste CLOUDFLARE_API_TOKEN (Enter to keep the current value)" -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($token) {
        # The zone id is looked up with the token itself, so it never has to be copied by hand.
        $zones = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$domain" -Headers @{ Authorization = "Bearer $token" }
        if (-not $zones.success -or $zones.result.Count -eq 0) { throw "The token cannot see the zone $domain. Check its Zone Resources." }
        Set-OnAllServices "CLOUDFLARE_API_TOKEN" $token
        Set-OnAllServices "CLOUDFLARE_ZONE_ID" $zones.result[0].id
    } else {
        Write-Host "kept CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID"
    }
    Write-Host "Done. Railway redeploys with the next push to main, or redeploy both services now in the Railway dashboard."
    exit 0
}

if ($Ghl) {
    foreach ($name in @("GHL_CLIENT_ID", "GHL_CLIENT_SECRET")) {
        $secure = Read-Host "Paste $name (Enter to keep the current value)" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
        if ($plain) { Set-OnAllServices $name $plain } else { Write-Host "kept $name" }
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
