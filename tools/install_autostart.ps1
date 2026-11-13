param(
    [string]$Serial = "",
    [int]$Port = 8787,
    [switch]$Uninstall
)

# Registers the adb-reverse watcher as a per-user task at logon, so the Car
# Thing finds the PC server again after every reboot or replug.

$ErrorActionPreference = "Stop"
$TaskName = "DeskGadget Car Thing"
$watch = Join-Path $PSScriptRoot "watch_adb.ps1"
$log = Join-Path $env:LOCALAPPDATA "DeskGadget\carthing-watch.log"

if ($Uninstall) {
    & schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like "*watch_adb.ps1*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "removed '$TaskName'"
    exit 0
}

if (-not (Test-Path $watch)) { throw "watch_adb.ps1 is missing next to this script" }

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watch`""
if ($Serial) { $arguments += " -Serial $Serial" }
if ($Port -ne 8787) { $arguments += " -Port $Port" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

# start it now, without waiting for the next logon
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*watch_adb.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName $TaskName

Write-Host "registered '$TaskName' - adb reverse is kept alive for the Car Thing"
Write-Host "log: $log"
