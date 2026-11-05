param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$stage = [IO.Path]::GetFullPath((Join-Path $config.directory 'unpacked'))
$backup = [IO.Path]::GetFullPath((Join-Path $config.directory 'backup'))
$config.target = [IO.Path]::GetFullPath($config.target)
$touched = New-Object System.Collections.Generic.List[string]
$parentStopped = $false
function Log([string]$message) {
  Add-Content -LiteralPath $config.log -Value "$(Get-Date -Format o) $message" -Encoding UTF8
}
function Result([string]$status, [string]$message) {
  $result = @{status=$status;message=$message;version=$config.version;log=$config.log;backup=$backup}
  $temp = $config.result + '.tmp'
  $result | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
  if ([IO.File]::Exists($config.result)) { [IO.File]::Delete($config.result) }
  [IO.File]::Move($temp, $config.result)
}
function StartApplication {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $config.target $config.exe
  $start.WorkingDirectory = $config.target
  $start.UseShellExecute = $false
  [Diagnostics.Process]::Start($start) | Out-Null
}
function CopyFile([string]$source, [string]$destination) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  for ($attempt=0; $attempt -lt 8; $attempt++) {
    try { [IO.File]::Copy($source, $destination, $true); return }
    catch { if ($attempt -eq 7) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
try {
  Log 'Preparing update before application shutdown.'
  # Treat all paths as Unicode data, never as interpolated PowerShell source.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($config.archive)
  try {
    [long]$total = 0
    foreach ($entry in $zip.Entries) {
      $relative = $entry.FullName.Replace('/', '\')
      $resolved = [IO.Path]::GetFullPath((Join-Path $stage $relative))
      if (!$resolved.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes staging folder.' }
      if ($relative.Split('\')[0] -ieq 'ContactRegistryData') { throw 'Archive must not contain user data.' }
      if (([long]$entry.ExternalAttributes -band 0xF0000000L) -eq 0xA0000000L) { throw 'Archive contains a symbolic link.' }
      $total += $entry.Length
      if ($total -gt 2147483648L) { throw 'Expanded archive is too large.' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($config.archive, $stage)
  if (!(Test-Path -LiteralPath (Join-Path $stage $config.exe) -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $stage 'resources\app.asar') -PathType Leaf)) { throw 'Incomplete application archive.' }
  $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName)
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($stage.Length + 1)
    $existing = Join-Path $config.target $relative
    if (Test-Path -LiteralPath $existing -PathType Leaf) { CopyFile $existing (Join-Path $backup $relative) }
  }
  # Verify write access while the old application can still show an error.
  $probe = Join-Path $config.target ('.update-probe-' + [guid]::NewGuid().ToString())
  [IO.File]::WriteAllText($probe, 'probe'); [IO.File]::Delete($probe)
  Log 'Archive validated, extracted and previous application backed up.'
  [IO.File]::WriteAllText($config.ready, 'ready')
  $deadline = (Get-Date).AddSeconds(120)
  while (!(Test-Path -LiteralPath $config.proceed)) {
    if ((Get-Date) -gt $deadline) { throw 'Application did not authorize shutdown.' }
    if (Test-Path -LiteralPath $config.cancel) { throw 'Update cancelled by application.' }
    Start-Sleep -Milliseconds 150
  }
  $parent = Get-Process -Id $config.pid -ErrorAction SilentlyContinue
  if ($parent) { Wait-Process -Id $config.pid -Timeout 120 }
  $parentStopped = $true
  Start-Sleep -Milliseconds 700
  Log 'Application closed. Replacing program files.'
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($stage.Length + 1)
    $touched.Add($relative)
    CopyFile $file.FullName (Join-Path $config.target $relative)
  }
  Log 'Program files replaced. Starting updated application.'
  StartApplication
  Result 'installed' 'Update installed.'
} catch {
  $failure = $_.Exception.Message
  Log ('Update failed: ' + ($_ | Out-String))
  $rollbackErrors = New-Object System.Collections.Generic.List[string]
  foreach ($relative in $touched) {
    try {
      $old = Join-Path $backup $relative
      $destination = Join-Path $config.target $relative
      if (Test-Path -LiteralPath $old -PathType Leaf) {
        # An untouched but locked file does not need replacing during rollback.
        $same = (Test-Path -LiteralPath $destination -PathType Leaf) -and ((Get-FileHash -LiteralPath $old).Hash -eq (Get-FileHash -LiteralPath $destination).Hash)
        if (!$same) { CopyFile $old $destination }
      } elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
    } catch { $rollbackErrors.Add($_.Exception.Message) }
  }
  $status = 'failed'
  if ($touched.Count -gt 0 -and $rollbackErrors.Count -eq 0) { $status = 'rolled-back' }
  if ($rollbackErrors.Count -gt 0) { $failure += '; rollback errors: ' + ($rollbackErrors -join '; ') }
  Result $status $failure
  if ($parentStopped) {
    try { StartApplication } catch { Log ('Restart failed: ' + $_.Exception.Message) }
  }
  exit 1
}
