param(
    [int]$Port = 8787,
    [string]$Serial = "",
    [int]$IntervalSeconds = 15,
    [string]$LogPath = "$env:LOCALAPPDATA\DeskGadget\carthing-watch.log"
)

# Keeps the adb reverse tunnel alive for the Car Thing.
#
# Caution: this firmware's adbd sometimes answers `adb reverse` with
# "protocol fault" and drops the whole USB link. So this watcher only applies
# the tunnel when `adb reverse --list` does not already show it, backs off for a
# minute after a failure, and waits for a replug after three failures in a row
# instead of reconnecting in a loop.

$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $LogPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

function Say([string]$text) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path $LogPath -Value $line
}

& adb start-server | Out-Null
Say "watching for devices (port $Port)"

$failures = 0
$cooldownUntil = Get-Date
$seen = @{}

while ($true) {
    Start-Sleep -Seconds $IntervalSeconds
    if ((Get-Date) -lt $cooldownUntil) { continue }

    $out = & adb devices 2>$null
    $online = @()
    foreach ($line in $out) {
        if ($line -match "^(\S+)\s+device$") {
            $serial = $Matches[1]
            if ($Serial -and $serial -ne $Serial) { continue }
            $online += $serial
        }
    }

    foreach ($serial in $online) {
        if (-not $seen.ContainsKey($serial)) {
            $seen[$serial] = $true
            $failures = 0
            Say "device $serial online"
        }

        $list = & adb -s $serial reverse --list 2>&1 | Out-String
        if ($list -match [regex]::Escape("tcp:$Port tcp:$Port")) {
            continue
        }

        $result = & adb -s $serial reverse "tcp:$Port" "tcp:$Port" 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) {
            $failures = 0
            Say "reverse ready for $serial"
        } else {
            $failures++
            Say "reverse failed ($failures): $($result.Trim())"
            if ($failures -ge 3) {
                Say "giving up until the device is replugged"
                $seen.Remove($serial)
                $cooldownUntil = (Get-Date).AddMinutes(10)
            } else {
                $cooldownUntil = (Get-Date).AddSeconds(60)
            }
        }
    }
}
