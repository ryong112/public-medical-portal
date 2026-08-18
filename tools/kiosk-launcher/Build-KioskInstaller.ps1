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

$installerScript = Join-Path $PSScriptRoot 'Install-DphsKioskStandalone.ps1'
$launcherScript = Join-Path $PSScriptRoot 'Start-DphsKiosk.ps1'
foreach ($path in @($installerScript, $launcherScript)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "패키지 원본을 찾지 못했습니다: $path" }
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path $resolvedOutput -Parent
$buildDirectory = Join-Path $PSScriptRoot '.package'
$sourcePath = Join-Path $buildDirectory 'DphsKioskSetup.cs'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $buildDirectory) { Remove-Item -LiteralPath $buildDirectory -Recurse -Force }
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Force }

$installerBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($installerScript))
$launcherBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($launcherScript))
$source = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class DphsKioskSetup
{
    private const string InstallerBase64 = "$installerBase64";
    private const string LauncherBase64 = "$launcherBase64";

    [STAThread]
    private static int Main()
    {
        string packageDirectory = Path.Combine(Path.GetTempPath(), "DPHSKioskSetup-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(packageDirectory);
            string installerPath = Path.Combine(packageDirectory, "Install-DphsKioskStandalone.ps1");
            string launcherPath = Path.Combine(packageDirectory, "Start-DphsKiosk.ps1");
            File.WriteAllBytes(installerPath, Convert.FromBase64String(InstallerBase64));
            File.WriteAllBytes(launcherPath, Convert.FromBase64String(LauncherBase64));

            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32\\WindowsPowerShell\\v1.0\\powershell.exe");
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File \"" + installerPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process process = Process.Start(startInfo))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "공공의료지원과 전광판 설치 오류",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(packageDirectory)) Directory.Delete(packageDirectory, true); }
            catch { }
        }
    }
}
"@

[IO.File]::WriteAllText($sourcePath, $source, [Text.UTF8Encoding]::new($true))
$arguments = @(
  '/nologo',
  '/target:winexe',
  '/optimize+',
  "/out:$resolvedOutput",
  '/reference:System.dll',
  '/reference:System.Windows.Forms.dll',
  $sourcePath
)
$process = Start-Process -FilePath $compilerPath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $resolvedOutput)) {
  throw "전광판 설치 파일 생성에 실패했습니다. C# 컴파일러 종료 코드: $($process.ExitCode)"
}

Remove-Item -LiteralPath $buildDirectory -Recurse -Force
Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length, LastWriteTime
