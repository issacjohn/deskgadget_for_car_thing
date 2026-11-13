param(
    [string]$Serial = "",
    [int]$Port = 8787,
    [int]$WaitSeconds = 90,
    [string]$LogPath = "$env:LOCALAPPDATA\DeskGadget\carthing-tunnel.log"
)

# Restores the USB tunnel for the Car Thing once, at logon.
#
# It deliberately does not poll: this firmware's adbd can answer `adb reverse`
# with "protocol fault" and drop the whole USB link, so retrying is what breaks
# it. One attempt per logon is enough - the adb server keeps the mapping and
# re-applies it when the device reconnects.

$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $LogPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

function Say([string]$text) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    Add-Content -Path $LogPath -Value $line
}

& adb start-server | Out-Null
Say "waiting up to ${WaitSeconds}s for a device"

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$serial = ""
while (-not $serial -and (Get-Date) -lt $deadline) {
    foreach ($line in (& adb devices 2>$null)) {
        if ($line -match "^(\S+)\s+device$") {
            $candidate = $Matches[1]
            if (-not $Serial -or $candidate -eq $Serial) { $serial = $candidate; break }
        }
    }
    if (-not $serial) { Start-Sleep -Seconds 3 }
}

if (-not $serial) {
    Say "no device; nothing to do"
    exit 0
}

$list = & adb -s $serial reverse --list 2>&1 | Out-String
if ($list -match [regex]::Escape("tcp:$Port tcp:$Port")) {
    Say "tunnel already present for $serial"
    exit 0
}

$result = & adb -s $serial reverse "tcp:$Port" "tcp:$Port" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    Say "tunnel ready for $serial"
} else {
    Say "tunnel failed for ${serial}: $($result.Trim())"
    Say "replug the Car Thing or run tools\car_thing.ps1"
}
