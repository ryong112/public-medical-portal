param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$appDirectory = Join-Path $env:LOCALAPPDATA 'DPHSKiosk'
$installedLauncher = Join-Path $appDirectory 'Start-DphsKiosk.ps1'
$sourceLauncher = Join-Path $PSScriptRoot 'Start-DphsKiosk.ps1'
$protocolRoot = 'HKCU:\Software\Classes\dphskiosk'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Stop-PreviousKioskLauncher {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -like '*Start-DphsKiosk.ps1*'
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function New-KioskShortcut([string]$ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $powershellPath
  $shortcut.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "{0}"' -f $installedLauncher)
  $shortcut.WorkingDirectory = $appDirectory
  $shortcut.Description = '공공의료지원과 전광판 열기'
  $shortcut.IconLocation = "$powershellPath,0"
  $shortcut.Save()
}

try {
  if (-not (Test-Path -LiteralPath $sourceLauncher)) {
    throw "설치 파일 안에서 전광판 실행기를 찾지 못했습니다: $sourceLauncher"
  }

  Stop-PreviousKioskLauncher
  New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force

  $protocolCommand = ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "{1}" "%1"' -f $powershellPath, $installedLauncher)
  New-Item -Path $protocolRoot -Force | Out-Null
  Set-Item -Path $protocolRoot -Value 'URL:DPHS Kiosk Launcher'
  New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path "$protocolRoot\DefaultIcon" -Force | Out-Null
  Set-Item -Path "$protocolRoot\DefaultIcon" -Value "$powershellPath,0"
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  Set-Item -Path "$protocolRoot\shell\open\command" -Value $protocolCommand

  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '공공의료지원과 전광판.lnk'
  New-KioskShortcut -ShortcutPath $desktopShortcut

  $startMenuDirectory = Join-Path ([Environment]::GetFolderPath('Programs')) '공공의료지원과'
  New-Item -ItemType Directory -Path $startMenuDirectory -Force | Out-Null
  New-KioskShortcut -ShortcutPath (Join-Path $startMenuDirectory '전광판.lnk')

  [System.Windows.Forms.MessageBox]::Show(
    "설치가 완료되었습니다.`n`n지금 전광판을 열어 기기 승인을 요청할 수 있습니다.`n다음부터는 포털의 전광판 버튼 또는 바탕화면 바로가기를 사용해 주십시오.",
    '공공의료지원과 전광판 설치',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null

  Start-Process -FilePath $powershellPath -WindowStyle Hidden -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-STA',
    '-File', ('"{0}"' -f $installedLauncher)
  ) | Out-Null
}
catch {
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    '공공의료지원과 전광판 설치 오류',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
