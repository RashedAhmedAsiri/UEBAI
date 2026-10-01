# Shares UEBAI from this computer: builds and starts the site, opens a free Cloudflare
# tunnel to it, and prints the public https link anyone can open. Started by share-online.bat.
# Closing this window (or Ctrl+C) stops the site and the link.
# Keep this file plain ASCII: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # downloads are very slow in PowerShell 5.1 with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$tools = Join-Path $root ".tools"
New-Item -ItemType Directory -Force $tools | Out-Null
$onWindows = $env:OS -eq "Windows_NT"
$npm = if ($onWindows) { "npm.cmd" } else { "npm" }
$site = $null
$tunnel = $null

function Say([string]$text, [string]$color = "Gray") { Write-Host $text -ForegroundColor $color }

function Stop-All {
  foreach ($p in @($tunnel, $site)) {
    if ($p -and -not $p.HasExited) { try { $p.Kill() } catch {} }
  }
}

function Fail([string]$text) { Stop-All; Say ""; Say $text Red; exit 1 }

# Reads a log file that another process still has open for writing.
function Read-Log([string]$path) {
  if (-not (Test-Path $path)) { return "" }
  $stream = [IO.File]::Open($path, "Open", "Read", "ReadWrite")
  try { return (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Dispose() }
}

function Last-Lines([string]$path, [int]$count = 15) {
  ((Read-Log $path) -split "`r?`n" | Where-Object { $_ } | Select-Object -Last $count) -join "`n"
}

function Port-InUse([int]$port) {
  $client = New-Object Net.Sockets.TcpClient
  try { return $client.ConnectAsync("127.0.0.1", $port).Wait(500) } catch { return $false } finally { $client.Dispose() }
}

function Test-GeminiKey([string]$key) {
  try {
    Invoke-WebRequest "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1" -Headers @{ "x-goog-api-key" = $key } -UseBasicParsing -TimeoutSec 20 | Out-Null
    return $true
  } catch { return $false }
}

# --- 1. Node.js -------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again." }

# --- 2. AI key and visitor password (kept in .env.local, which is never uploaded to GitHub) ---
$envFile = Join-Path $root ".env.local"
function Add-EnvLine([string]$line) {
  $text = if (Test-Path $envFile) { [IO.File]::ReadAllText($envFile) } else { "" }
  if ($text -and -not $text.EndsWith("`n")) { $line = "`r`n" + $line }
  [IO.File]::AppendAllText($envFile, "$line`r`n", (New-Object Text.UTF8Encoding($false)))
}
$envText = if (Test-Path $envFile) { [IO.File]::ReadAllText($envFile) } else { "" }

if ($envText -notmatch "(?m)^[ \t]*(GEMINI_API_KEY|ANTHROPIC_API_KEY)[ \t]*=[ \t]*\S") {
  Say "To give the teachers a real AI brain, paste your Gemini API key and press Enter." Cyan
  Say "(Free from aistudio.google.com. Press Enter without a key to use demo mode.)"
  while ($true) {
    $key = (Read-Host "Gemini API key").Trim()
    if (-not $key) { break }
    if (Test-GeminiKey $key) { Add-EnvLine "GEMINI_API_KEY=$key"; Say "Key accepted." Green; break }
    Say "Google did not accept that key (or this computer is offline). Try again, or press Enter to skip." Yellow
  }
}

if ($envText -notmatch "(?m)^[ \t]*SITE_PASSWORD[ \t]*=") {
  Say ""
  Say "Anyone with the link can use the site, and every question uses your key's quota." Yellow
  Say "Type a password visitors must enter first, or press Enter for no password."
  while ($true) {
    $pw = (Read-Host "Visitor password").Trim()
    if ($pw -match '^[\p{L}\p{N}_.-]*$') { break }
    Say "Please use only letters, numbers, - _ or ." Yellow
  }
  Add-EnvLine "SITE_PASSWORD=$pw"
}

# --- 3. Install and build (only when something changed) ---------------------------------
Say ""
Say "Getting the site ready. The first time takes a few minutes..." Cyan
$lock = Get-Item (Join-Path $root "package-lock.json")
$installed = Join-Path $root "node_modules/.package-lock.json"
if (-not (Test-Path $installed) -or $lock.LastWriteTime -gt (Get-Item $installed -Force).LastWriteTime) {
  & $npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "Installing failed. Check the internet connection and run this again." }
  (Get-Item $installed -Force).LastWriteTime = Get-Date
}

$buildId = Join-Path $root ".next/BUILD_ID"
$sources = @(Get-ChildItem (Join-Path $root "src") -Recurse -File) +
  @(Get-Item (Join-Path $root "package.json"), $lock.FullName, (Join-Path $root "next.config.ts"), (Join-Path $root "tsconfig.json"))
$newest = ($sources | Sort-Object LastWriteTime | Select-Object -Last 1).LastWriteTime
if (-not (Test-Path $buildId) -or $newest -gt (Get-Item $buildId -Force).LastWriteTime) {
  & $npm run build
  if ($LASTEXITCODE -ne 0) { Fail "Building the site failed (see the messages above)." }
}

# --- 4. Start the site (only reachable from this computer; the tunnel makes it public) ---
if (Port-InUse 3000) { Fail "Something is already using port 3000 (maybe UEBAI is open in another window). Close it and run this again." }
$siteOut = Join-Path $tools "site.log"
$siteErr = Join-Path $tools "site-errors.log"
$site = Start-Process $node.Source -ArgumentList "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000" `
  -WorkingDirectory $root -NoNewWindow -PassThru -RedirectStandardOutput $siteOut -RedirectStandardError $siteErr

$status = $null
for ($i = 0; $i -lt 60 -and -not $status; $i++) {
  if ($site.HasExited) { break }
  try { $status = Invoke-RestMethod "http://127.0.0.1:3000/api/status" -TimeoutSec 5 } catch { Start-Sleep 1 }
}
if (-not $status) { Say (Last-Lines $siteErr); Fail "The site did not start." }

# Keep the computer awake while sharing (Windows clears this when the window closes).
if ($onWindows) {
  try {
    Add-Type -Namespace UEBAI -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
    [UEBAI.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  } catch {}
}

# --- 5. Public link through a free Cloudflare quick tunnel (no account needed) -----------
$cf = Join-Path $tools $(if ($onWindows) { "cloudflared.exe" } else { "cloudflared" })
if (-not (Test-Path $cf)) {
  Say "Downloading Cloudflare's free tunnel tool (one time only)..." Cyan
  $arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "386" }
  try {
    Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe" -OutFile "$cf.part" -UseBasicParsing
    Move-Item "$cf.part" $cf -Force
  } catch { Fail "Could not download the tunnel tool. Check the internet connection and run this again." }
}

$tunnelLog = Join-Path $tools "tunnel.log"
$tunnel = Start-Process $cf -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3000" `
  -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $tools "tunnel-out.log") -RedirectStandardError $tunnelLog

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep 1
  if ($tunnel.HasExited) { break }
  $m = [regex]::Match((Read-Log $tunnelLog), "https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com")
  if ($m.Success) { $url = $m.Value }
}
if (-not $url) { Say (Last-Lines $tunnelLog); Fail "Could not open the public link. Check the internet connection and run this again." }

# The new link needs a few seconds before it answers.
for ($i = 0; $i -lt 20; $i++) {
  try { Invoke-WebRequest "$url/api/status" -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep 2 }
}
try { Set-Clipboard $url } catch {}

$ai = if ($status.live) { "on" } else { "off (demo mode: answers quote the notes)" }
$password = if ((Get-Content $envFile -Raw) -match "(?m)^[ \t]*SITE_PASSWORD[ \t]*=[ \t]*\S") { "yes" } else { "none, anyone with the link can use it" }
Say ""
Say "  ============================================================" Green
Say "   UEBAI is online. Anyone can open it with this link:" Green
Say ""
Say "     $url" White
Say ""
Say "   (Copied. Paste it anywhere to share.)"
Say "   AI: $ai"
Say "   Visitor password: $password"
Say "   To change the key or password, edit .env.local and run this again."
Say ""
Say "   Leave this window open and the computer on." Yellow
Say "   Closing this window stops the site. The link changes every start." Yellow
Say "  ============================================================" Green
Say ""
try { Start-Process $url } catch {}

try {
  while (-not $site.HasExited -and -not $tunnel.HasExited) { Start-Sleep 2 }
  if ($site.HasExited) { Say (Last-Lines $siteErr); Say "The site stopped. Run this again to restart it." Red }
  else { Say (Last-Lines $tunnelLog 5); Say "The link stopped (internet lost?). Run this again for a new link." Red }
} finally {
  Stop-All
}
