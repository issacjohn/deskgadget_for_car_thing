param(
    [string]$Serial = "",
    [int]$Port = 8787,
    [switch]$NoLaunch
)

# Loads DeskGadget (System + Media) onto a Spotify Car Thing that is running
# DeskThing or any Chromium kiosk. Everything happens over USB: adb reverse
# gives the device a route to the PC, no Wi-Fi needed.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Find-Device {
    $lines = & adb devices | Select-Object -Skip 1
    $ready = @()
    foreach ($line in $lines) {
        if ($line -match "^(\S+)\s+device$") { $ready += $Matches[1] }
    }
    if ($ready.Count -eq 0) {
        throw "No adb device. Connect the Car Thing over USB and enable adb."
    }
    return $ready[0]
}

if (-not $Serial) { $Serial = Find-Device }

Write-Host "Car Thing: $Serial"

Write-Host "  usb reverse tcp:$Port -> PC:$Port"
& adb -s $Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "adb reverse failed. Replug the device and try again."
}

Write-Host "  pushing the client to /tmp/deskgadget"
& adb -s $Serial shell "mkdir -p /tmp/deskgadget"
foreach ($file in @("index.html", "style.css", "app.js")) {
    & adb -s $Serial push (Join-Path $root $file) "/tmp/deskgadget/$file" | Out-Null
}

$url = "file:///tmp/deskgadget/index.html"
if ($NoLaunch) {
    Write-Host "  pushed. Open $url in the kiosk when ready."
    exit 0
}

Write-Host "  pointing the kiosk at $url"
& adb -s $Serial forward tcp:2222 tcp:2222 | Out-Null
Start-Sleep -Milliseconds 400

function Get-Target {
    $json = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:2222/json/list" -TimeoutSec 6).Content
    $pages = $json | ConvertFrom-Json
    return $pages | Select-Object -First 1
}

function Navigate([string]$targetUrl) {
    $target = Get-Target
    if (-not $target) { throw "Chromium did not expose a page on port 2222." }
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
    $message = '{"id":1,"method":"Page.navigate","params":{"url":"' + $targetUrl + '"}}'
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $segment = New-Object "System.ArraySegment[byte]" -ArgumentList @(,$bytes)
    $ws.SendAsync($segment, "Text", $true, [Threading.CancellationToken]::None).Wait()
    Start-Sleep -Milliseconds 700
    $ws.Dispose()
}

try {
    Navigate $url
    Write-Host "  done - System and Media are live on the Car Thing"
    Write-Host "  reboot returns it to DeskThing; rerun this script to load it again"
} catch {
    Write-Host "  could not reach the kiosk: $($_.Exception.Message)"
    Write-Host "  open $url in its browser manually"
}
