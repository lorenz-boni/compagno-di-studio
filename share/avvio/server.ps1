# Avvia JARVIS sul proprio computer: un piccolo server web locale (solo per questo PC, non raggiungibile
# dalla rete) e apre l'app in Chrome. Usa solo componenti gia' presenti in Windows (PowerShell + .NET).
# Lascia aperta la finestra mentre studi; chiudila per spegnere JARVIS.

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$port = 8777  # sempre la stessa: il browser lega impostazioni e conversazioni a questo indirizzo
$url = "http://localhost:$port/"

function Open-Jarvis {
  if ($env:JARVIS_NO_BROWSER) { return }
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  try {
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url } else { Start-Process $url }
  } catch {
    Write-Host "Apri a mano questo indirizzo in Chrome: $url"
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  Write-Host "La porta $port e' gia' in uso: probabilmente JARVIS e' gia' acceso. Lo apro nel browser."
  Open-Jarvis
  Start-Sleep -Seconds 3
  exit
}

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.png' = 'image/png'
  '.ico' = 'image/x-icon'
  '.txt' = 'text/plain; charset=utf-8'
  '.md' = 'text/plain; charset=utf-8'
}

Write-Host ''
Write-Host '  JARVIS - Compagno di studio'
Write-Host "  Acceso su $url"
Write-Host '  Lascia aperta questa finestra mentre studi. Per spegnere JARVIS chiudila.'
Write-Host ''
Open-Jarvis

$sep = [IO.Path]::DirectorySeparatorChar
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $rel = $path.TrimStart('/').Replace('/', $sep)
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    # Solo file dentro la cartella di JARVIS
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
  }
}
