param(
    [string]$Serial = "",
    [int]$Port = 8787,
    [switch]$Uninstall
)

# Registers a per-user task at logon that restores the Car Thing's USB tunnel
# once. It is a one-shot, not a watcher: this adbd can drop the USB link when
# `adb reverse` is repeated, so nothing here polls.

$ErrorActionPreference = "Stop"
$TaskName = "DeskGadget Car Thing"
$restore = Join-Path $PSScriptRoot "restore_tunnel.ps1"
$log = Join-Path $env:LOCALAPPDATA "DeskGadget\carthing-tunnel.log"

if ($Uninstall) {
    & schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
    Write-Host "removed '$TaskName'"
    exit 0
}

if (-not (Test-Path $restore)) { throw "restore_tunnel.ps1 is missing next to this script" }

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$restore`""
if ($Serial) { $arguments += " -Serial $Serial" }
if ($Port -ne 8787) { $arguments += " -Port $Port" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT20S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::FromMinutes(5)) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "registered '$TaskName' - one tunnel attempt 20s after logon"
Write-Host "log: $log"
