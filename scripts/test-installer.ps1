# Runs with Windows PowerShell 5.1 in CI. No administrator privileges or real contacts.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('registry-installer-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($root) | Out-Null
$installer = Join-Path $PSScriptRoot '..\src\install-update.ps1'
$unicode = -join ([char[]](0x041A,0x043E,0x043D,0x0442,0x0430,0x043A,0x0442,0x044B))
function Assert($condition, [string]$message) { if (!$condition) { throw $message } }
function WaitFile([string]$file, [int]$seconds=30) {
  $end = (Get-Date).AddSeconds($seconds)
  while (!(Test-Path -LiteralPath $file)) { if ((Get-Date) -gt $end) { throw "Timed out waiting for $file" }; Start-Sleep -Milliseconds 100 }
}
function Scenario([string]$name, [bool]$lockFile, [bool]$invalidArchive) {
  $dir = Join-Path $root ($unicode + " [space] O'Brien " + $name)
  $target = Join-Path $dir 'application'
  $payload = Join-Path $dir 'payload'
  $work = Join-Path $dir 'work'
  foreach($folder in @($target,$payload,$work,(Join-Path $target 'resources'),(Join-Path $payload 'resources'),(Join-Path $target 'ContactRegistryData'))) { [IO.Directory]::CreateDirectory($folder) | Out-Null }
  $marker = Join-Path $dir 'started.txt'
  $env:CONTACTREGISTRY_INSTALL_TEST_MARKER = $marker
  foreach($version in @('old','new')) {
    $destination = if($version -eq 'old'){$target}else{$payload}
    $type = 'Launch' + [guid]::NewGuid().ToString('N')
    $code = @"
using System; using System.IO;
public class $type {
  public static void Main() {
    File.WriteAllText(Environment.GetEnvironmentVariable("CONTACTREGISTRY_INSTALL_TEST_MARKER"), "$version");
  }
}
"@
    Add-Type -TypeDefinition $code -OutputAssembly (Join-Path $destination 'ContactRegistry.exe') -OutputType ConsoleApplication
    [IO.File]::WriteAllText((Join-Path $destination 'resources\app.asar'),$version)
  }
  $data = Join-Path $target 'ContactRegistryData\contacts.sqlite'
  [IO.File]::WriteAllText($data,'CONTACTS MUST REMAIN UNCHANGED')
  if ($invalidArchive) { [IO.File]::Delete((Join-Path $payload 'ContactRegistry.exe')) }
  $archive = Join-Path $work 'update.zip'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($payload,$archive)
  $parent = Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 90' -PassThru -WindowStyle Hidden
  $config = @{directory=$work;archive=$archive;target=$target;exe='ContactRegistry.exe';version='test';pid=$parent.Id;ready=(Join-Path $work 'ready');proceed=(Join-Path $work 'proceed');cancel=(Join-Path $work 'cancel');result=(Join-Path $work 'result.json');log=(Join-Path $dir 'update.log')}
  $configPath = Join-Path $work 'config.json'
  $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
  $scriptPath = Join-Path $work 'install.ps1'
  [IO.File]::WriteAllText($scriptPath,[IO.File]::ReadAllText($installer),(New-Object Text.UTF8Encoding($true)))
  $locked = $null
  if($lockFile) { $locked=[IO.File]::Open((Join-Path $target 'resources\app.asar'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read) }
  $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $scriptPath + '" -ConfigPath "' + $configPath + '"'
  $helper = Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $dir 'stderr.txt') -RedirectStandardOutput (Join-Path $dir 'stdout.txt')
  try {
    if($invalidArchive) {
      WaitFile $config.result
      Assert (!(Test-Path -LiteralPath $config.ready)) 'Invalid archive was marked ready'
      Assert (!$parent.HasExited) 'Parent was stopped during failed preparation'
    } else {
      WaitFile $config.ready
      Assert (!$parent.HasExited) 'Parent stopped before readiness acknowledgment'
      [IO.File]::WriteAllText($config.proceed,'install')
      Stop-Process -Id $parent.Id
      WaitFile $config.result
      WaitFile $marker
    }
    $helper.WaitForExit(30000) | Out-Null
    $result = Get-Content -LiteralPath $config.result -Raw -Encoding UTF8 | ConvertFrom-Json
    $expected = if($invalidArchive){'failed'}elseif($lockFile){'rolled-back'}else{'installed'}
    Assert ($result.status -eq $expected) ("Expected $expected, got " + ($result | ConvertTo-Json))
    if(!$invalidArchive) { Assert ([IO.File]::ReadAllText($marker) -eq $(if($lockFile){'old'}else{'new'})) 'Wrong application restarted' }
    Assert ([IO.File]::ReadAllText($data) -eq 'CONTACTS MUST REMAIN UNCHANGED') 'User data changed'
    Write-Output "PASS: $name (Unicode, spaces, brackets, apostrophe, readiness, data preservation)"
  } catch {
    $detail = "Scenario $name failed: $($_ | Out-String)"
    foreach($logFile in @($config.log,(Join-Path $dir 'stderr.txt'),(Join-Path $dir 'stdout.txt'))) {
      if(Test-Path -LiteralPath $logFile) { $detail += "`n$logFile`n" + [IO.File]::ReadAllText($logFile) }
    }
    throw $detail
  } finally {
    if($locked){$locked.Dispose()}
    if(!$parent.HasExited){Stop-Process -Id $parent.Id -ErrorAction SilentlyContinue}
    if(!$helper.HasExited){Stop-Process -Id $helper.Id -ErrorAction SilentlyContinue}
  }
}
try {
  Scenario 'successful-update' $false $false
  Scenario 'locked-file-rollback' $true $false
  Scenario 'invalid-archive' $false $true
} catch {
  $annotation = ($_ | Out-String).Replace('%','%25').Replace("`r",'%0D').Replace("`n",'%0A')
  [Console]::WriteLine('::error title=Windows installer regression::' + $annotation)
  if($env:GITHUB_STEP_SUMMARY){Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ('```text' + "`n" + ($_ | Out-String) + "`n" + '```') -Encoding UTF8}
  throw
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
