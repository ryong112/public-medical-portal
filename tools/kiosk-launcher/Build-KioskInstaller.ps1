param(
  [string]$OutputPath = (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'release\DPHS-Kiosk-Setup.exe')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$compilerCandidates = @(
  (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compilerPath = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compilerPath) {
  throw 'Windows .NET Framework C# 컴파일러를 찾지 못했습니다.'
}

$sourcePath = Join-Path $PSScriptRoot 'DphsKioskLauncher.cs'
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "네이티브 실행기 원본을 찾지 못했습니다: $sourcePath"
}
$manifestPath = Join-Path $PSScriptRoot 'app.manifest'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "실행기 매니페스트를 찾지 못했습니다: $manifestPath"
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path $resolvedOutput -Parent
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$arguments = @(
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/codepage:65001',
  "/out:$resolvedOutput",
  "/win32manifest:$manifestPath",
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Management.dll',
  '/reference:System.Windows.Forms.dll',
  $sourcePath
)
$process = Start-Process -FilePath $compilerPath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $resolvedOutput)) {
  throw "순수 C# 전광판 실행기 생성에 실패했습니다. C# 컴파일러 종료 코드: $($process.ExitCode)"
}

$selfTest = Start-Process -FilePath $resolvedOutput -ArgumentList '--self-test' -Wait -PassThru
if ($selfTest.ExitCode -ne 0) {
  throw "전광판 실행기 자체 점검에 실패했습니다. 종료 코드: $($selfTest.ExitCode)"
}

Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length, LastWriteTime
Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256 | Select-Object Algorithm, Hash, Path
Get-AuthenticodeSignature -LiteralPath $resolvedOutput | Select-Object Status, StatusMessage, SignerCertificate
