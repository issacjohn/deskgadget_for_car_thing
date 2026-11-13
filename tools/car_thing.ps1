param(
    [string]$Serial = "",
    [int]$Port = 8787,
    [switch]$NoLaunch,
    [switch]$Autostart,
    [switch]$Reverse,
    [switch]$TrimServices,
    [switch]$DisableDeskThing,
    [switch]$EnableDeskThing,
    [switch]$Restore
)

# Installs DeskGadget on a Spotify Car Thing running DeskThing (or any Chromium
# kiosk). The client goes to /var/deskgadget (a real partition, survives a
# reboot) and the kiosk's start page is redirected to it, so the device boots
# straight into DeskGadget. Everything travels over USB.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$client = "/var/deskgadget"
$webapp = "/usr/share/qt-superbird-app/webapp"
$config = "/etc/supervisord.conf"

function Find-Device {
    $lines = & adb devices | Select-Object -Skip 1
    $ready = @()
    foreach ($line in $lines) {
        if ($line -match "^(\S+)\s+device$") { $ready += $Matches[1] }
    }
    if ($ready.Count -eq 0) {
        throw "No adb device. Connect the Car Thing over USB."
    }
    return $ready[0]
}

if (-not $Serial) { $Serial = Find-Device }
Write-Host "Car Thing: $Serial"

if ($Restore) {
    & adb -s $Serial shell "mount -o remount,rw / 2>/dev/null; cd $webapp && if [ -f index.deskthing.html ]; then mv index.deskthing.html index.html; fi"
    & adb -s $Serial shell "supervisorctl start superbird 2>/dev/null; supervisorctl restart chromium"
    Write-Host "  DeskThing restored as the start page"
    exit 0
}

if ($DisableDeskThing -or $EnableDeskThing) {
    $value = if ($DisableDeskThing) { "false" } else { "true" }
    Write-Host "  setting DeskThing helper autostart=$value"
    & adb -s $Serial shell "mount -o remount,rw / 2>/dev/null; sed -i '/^\[program:superbird\]/,/^\[program:/ s/^autostart=true/autostart=$value/; /^\[program:superbird\]/,/^\[program:/ s/^autostart=false/autostart=$value/' $config"

    if ($DisableDeskThing) {
        & adb -s $Serial shell "supervisorctl stop superbird" | Out-Null
        Write-Host "  DeskThing helper stopped; the kiosk keeps running"
    } else {
        & adb -s $Serial shell "supervisorctl start superbird" | Out-Null
        Write-Host "  DeskThing helper started again"
    }
    exit 0
}

if ($TrimServices) {
    Write-Host "  stopping the services DeskGadget does not use"
    & adb -s $Serial push (Join-Path $PSScriptRoot "trim_services.sh") "$client/trim_services.sh" | Out-Null
    & adb -s $Serial shell "sh $client/trim_services.sh"
}

Write-Host "  installing to $client"
& adb -s $Serial shell "mount -o remount,rw / 2>/dev/null; mkdir -p $client"
foreach ($file in @("index.html", "style.css", "app.js")) {
    & adb -s $Serial push (Join-Path $root $file) "$client/$file" | Out-Null
}

$installed = (& adb -s $Serial shell "grep -c deskgadget $webapp/index.html 2>/dev/null").Trim()
if ($installed -ne "1") {
    Write-Host "  redirecting the kiosk to DeskGadget at boot"
    & adb -s $Serial shell "cd $webapp && if [ -f index.html ] && [ ! -f index.deskthing.html ]; then cp index.html index.deskthing.html; fi"
    & adb -s $Serial push (Join-Path $PSScriptRoot "boot.html") "$webapp/index.html" | Out-Null
} else {
    Write-Host "  kiosk already starts DeskGadget"
}

Write-Host "  usb reverse tcp:$Port -> PC:$Port"
if ($Reverse) {
    & adb -s $Serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
    Write-Host "  tunnel requested"
} else {
    Write-Host "  leaving the tunnel alone (adb reverse can drop this device's USB link)"
    Write-Host "  use -Reverse only when the page shows a red dot"
}

if (-not $NoLaunch) {
    Write-Host "  restarting the kiosk"
    & adb -s $Serial shell "supervisorctl restart chromium" | Out-Null
}

if ($Autostart) {
    Write-Host "  registering the logon tunnel task"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "install_autostart.ps1") -Serial $Serial -Port $Port
}

Write-Host ""
Write-Host "Done. The Car Thing now boots into DeskGadget."
Write-Host "  -DisableDeskThing stops the DeskThing helper (reversible with -EnableDeskThing)."
Write-Host "  -Restore puts DeskThing back as the start page."
