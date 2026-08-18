param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

$protocolRoot = 'HKCU:\Software\Classes\dphskiosk'

try {
  if ($Uninstall) {
    if (Test-Path -LiteralPath $protocolRoot) {
      Remove-Item -LiteralPath $protocolRoot -Recurse -Force
    }
    [System.Windows.Forms.MessageBox]::Show(
      '전광판 실행기 연결을 제거했습니다.',
      '공공의료지원과 전광판',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    exit 0
  }

  $launcherPath = Join-Path ([System.IO.Path]::GetFullPath($ProjectRoot)) 'tools\kiosk-launcher\Start-DphsKiosk.ps1'
  if (-not (Test-Path -LiteralPath $launcherPath)) {
    throw "전광판 실행 파일을 찾지 못했습니다: $launcherPath"
  }

  $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $command = ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "{1}" "%1"' -f $powershellPath, $launcherPath)

  New-Item -Path $protocolRoot -Force | Out-Null
  Set-Item -Path $protocolRoot -Value 'URL:DPHS Kiosk Launcher'
  New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path "$protocolRoot\DefaultIcon" -Force | Out-Null
  Set-Item -Path "$protocolRoot\DefaultIcon" -Value "$powershellPath,0"
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  Set-Item -Path "$protocolRoot\shell\open\command" -Value $command

  [System.Windows.Forms.MessageBox]::Show(
    "전광판 실행기가 이 PC에 연결되었습니다.`n`n이제 포털의 전광판 아이콘을 누르면 됩니다.`nEdge가 처음 한 번 실행 허용을 물으면 '항상 허용'을 선택해 주십시오.",
    '공공의료지원과 전광판',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}
catch {
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    '전광판 실행기 연결 오류',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
