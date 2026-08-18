param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$appDirectory = Join-Path $env:LOCALAPPDATA 'DPHSKiosk'
$installedLauncher = Join-Path $appDirectory 'Start-DphsKiosk.ps1'
$installedBootstrap = Join-Path $appDirectory 'DPHS-Kiosk-Launcher.exe'
$sourceLauncher = Join-Path $PSScriptRoot 'Start-DphsKiosk.ps1'
$sourceBootstrap = Join-Path $PSScriptRoot 'DPHS-Kiosk-Launcher.exe'
$protocolRoot = 'HKCU:\Software\Classes\dphskiosk'

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
  $shortcut.TargetPath = $installedBootstrap
  $shortcut.Arguments = ''
  $shortcut.WorkingDirectory = $appDirectory
  $shortcut.Description = '공공의료지원과 전광판 열기'
  $shortcut.IconLocation = "$installedBootstrap,0"
  $shortcut.Save()
}

try {
  foreach ($sourcePath in @($sourceLauncher, $sourceBootstrap)) {
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "설치 파일 안에서 전광판 실행기를 찾지 못했습니다: $sourcePath"
    }
  }

  Stop-PreviousKioskLauncher
  New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force
  Copy-Item -LiteralPath $sourceBootstrap -Destination $installedBootstrap -Force

  $protocolCommand = ('"{0}" "%1"' -f $installedBootstrap)
  New-Item -Path $protocolRoot -Force | Out-Null
  Set-Item -Path $protocolRoot -Value 'URL:DPHS Kiosk Launcher'
  New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path "$protocolRoot\DefaultIcon" -Force | Out-Null
  Set-Item -Path "$protocolRoot\DefaultIcon" -Value "$installedBootstrap,0"
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  Set-Item -Path "$protocolRoot\shell\open\command" -Value $protocolCommand

  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '공공의료지원과 전광판.lnk'
  New-KioskShortcut -ShortcutPath $desktopShortcut

  $startMenuDirectory = Join-Path ([Environment]::GetFolderPath('Programs')) '공공의료지원과'
  New-Item -ItemType Directory -Path $startMenuDirectory -Force | Out-Null
  New-KioskShortcut -ShortcutPath (Join-Path $startMenuDirectory '전광판.lnk')

  [System.Windows.Forms.MessageBox]::Show(
    '공공의료지원과 공유 문서함 전광판과 연결되었습니다.',
    '전광판 연결 완료',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
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
