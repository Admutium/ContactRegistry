param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
# Start-Process creates a separate Windows process/console lifetime. The short-lived
# Node child must not own the installer that continues after the application exits.
$arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $config.script + '"'),'-ConfigPath',('"' + $ConfigPath + '"'))
$helper = Start-Process -FilePath $config.powershell -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory ([IO.Path]::GetDirectoryName($config.powershell)) -PassThru
[IO.File]::WriteAllText((Join-Path $config.directory 'helper.pid'),[string]$helper.Id)
