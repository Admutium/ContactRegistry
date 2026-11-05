# Verify that the exact Node launcher continues installing after its parent exits.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('registry-node-parent-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($root) | Out-Null
$unicode = -join ([char[]](0x041A,0x043E,0x043D,0x0442,0x0430,0x043A,0x0442,0x044B))
$dir = Join-Path $root ($unicode + " [space] O'Brien")
$target = Join-Path $dir 'application'
$payload = Join-Path $dir 'payload'
$work = Join-Path $dir 'work'
$profile = Join-Path $dir 'profile'
foreach($folder in @($target,$payload,$work,$profile,(Join-Path $target 'resources'),(Join-Path $payload 'resources'),(Join-Path $target 'ContactRegistryData'))) { [IO.Directory]::CreateDirectory($folder) | Out-Null }
$marker = Join-Path $dir 'new-version-started.txt'
$env:CONTACTREGISTRY_INSTALL_TEST_MARKER = $marker
$type = 'NodeLaunch' + [guid]::NewGuid().ToString('N')
$code = @"
using System; using System.IO;
public class $type { public static void Main() { File.WriteAllText(Environment.GetEnvironmentVariable("CONTACTREGISTRY_INSTALL_TEST_MARKER"), "new"); } }
"@
$assembly = Join-Path $root 'new.exe'
Add-Type -TypeDefinition $code -OutputAssembly $assembly -OutputType ConsoleApplication
[IO.File]::Move($assembly,(Join-Path $payload 'ContactRegistry.exe'))
[IO.File]::WriteAllText((Join-Path $target 'ContactRegistry.exe'),'old exe')
[IO.File]::WriteAllText((Join-Path $target 'resources\app.asar'),'old asar')
[IO.File]::WriteAllText((Join-Path $payload 'resources\app.asar'),'new asar')
$data = Join-Path $target 'ContactRegistryData\contacts.sqlite'
[IO.File]::WriteAllText($data,'CONTACTS PRESERVED')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path $work 'update.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($payload,$archive)
$options = @{directory=$work;archive=$archive;target=$target;exe='ContactRegistry.exe';version='test';userData=$profile}
$launch = Join-Path $root 'launch.json'
[IO.File]::WriteAllText($launch,($options | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
$worker = Join-Path $root 'worker.cjs'
$source = @'
const fs=require('node:fs');
const options=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
require(process.argv[3]).prepare(options).then(async prepared=>{await prepared.proceed();process.exit(0);}).catch(error=>{fs.writeFileSync(options.directory+'/worker-error.txt',String(error.stack));process.exit(1);});
'@
[IO.File]::WriteAllText($worker,$source)
$module = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src\installer.cjs'))
$arguments = '"' + $worker + '" "' + $launch + '" "' + $module + '"'
$parent = Start-Process node.exe -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $root 'node-stderr.txt') -RedirectStandardOutput (Join-Path $root 'node-stdout.txt')
# Start-Process returns a lazy Process object; retain its handle before it exits
# so .NET can retrieve the actual exit code instead of a missing value.
$null = $parent.Handle
try {
  $deadline=(Get-Date).AddSeconds(45)
  $resultFile=Join-Path $work 'result.json'
  $errorFile=Join-Path $work 'worker-error.txt'
  while (!(Test-Path -LiteralPath $resultFile) -or !(Test-Path -LiteralPath $marker)) {
    if(Test-Path -LiteralPath $errorFile){throw ([IO.File]::ReadAllText($errorFile))}
    if((Get-Date) -gt $deadline){throw 'Node-parent exit did not lead to completed update and application restart.'}
    Start-Sleep -Milliseconds 100
  }
  $result=Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if($result.status -ne 'installed'){throw ($result | ConvertTo-Json)}
  $parent.WaitForExit(5000) | Out-Null
  if(!$parent.HasExited -or $parent.ExitCode -ne 0){throw ("Parent did not exit cleanly after readiness: exited=$($parent.HasExited), code=$($parent.ExitCode)")}
  if([IO.File]::ReadAllText($data) -ne 'CONTACTS PRESERVED'){throw 'Contact database changed.'}
  Write-Output 'PASS: actual Node parent exits; PowerShell survives, installs and starts new application; contacts preserved.'
} catch {
  $detail=($_ | Out-String)
  foreach($file in @((Join-Path $profile 'last-update.log'),(Join-Path $profile 'last-update-launch.log'),(Join-Path $root 'node-stderr.txt'))) {
    if(Test-Path -LiteralPath $file){$detail+="`n$file`n"+[IO.File]::ReadAllText($file)}
  }
  throw $detail
} finally {
  if(!$parent.HasExited){Stop-Process -Id $parent.Id -ErrorAction SilentlyContinue}
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
