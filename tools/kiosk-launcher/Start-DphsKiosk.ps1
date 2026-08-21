param(
  [string]$ProtocolUri = 'dphskiosk://open',
  [string]$PortalUrl = 'https://dphs2023.vercel.app/kiosk?launcher=1',
  [ValidateRange(10, 120)]
  [int]$WindowWaitSeconds = 30,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public static class DphsKioskNativeWindow
{
    private const int GWL_STYLE = -16;
    private const long WS_CAPTION = 0x00C00000L;
    private const long WS_THICKFRAME = 0x00040000L;
    private const long WS_MINIMIZEBOX = 0x00020000L;
    private const long WS_MAXIMIZEBOX = 0x00010000L;
    private const long WS_SYSMENU = 0x00080000L;
    private const long WS_POPUP = 0x80000000L;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    private static long GetStyle(IntPtr hWnd)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_STYLE).ToInt64() : GetWindowLong32(hWnd, GWL_STYLE);
    }

    private static void SetStyle(IntPtr hWnd, long style)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, GWL_STYLE, new IntPtr(style));
        else SetWindowLong32(hWnd, GWL_STYLE, unchecked((int)style));
    }

    public static long CaptureStyle(IntPtr hWnd) { return GetStyle(hWnd); }

    public static void ShowBorderless(IntPtr hWnd, Rectangle bounds)
    {
        long style = GetStyle(hWnd);
        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
        style |= WS_POPUP;
        SetStyle(hWnd, style);
        ShowWindow(hWnd, SW_SHOW);
        SetWindowPos(hWnd, HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        SetForegroundWindow(hWnd);
    }

    public static void Hide(IntPtr hWnd) { ShowWindow(hWnd, SW_HIDE); }

    public static void Restore(IntPtr hWnd, long style, Rectangle bounds)
    {
        SetStyle(hWnd, style);
        ShowWindow(hWnd, SW_SHOW);
        SetWindowPos(hWnd, HWND_NOTOPMOST, bounds.X + 40, bounds.Y + 40,
            Math.Max(640, bounds.Width - 80), Math.Max(480, bounds.Height - 80),
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
}
'@

if ($ValidateOnly) {
  Write-Output 'DPHS kiosk launcher validation: OK'
  exit 0
}

$logPath = Join-Path $PSScriptRoot 'kiosk-launcher.log'
function Write-KioskLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\DPHS-Kiosk-Launcher', [ref]$createdNew)
$openEvent = [System.Threading.EventWaitHandle]::new($false, [System.Threading.EventResetMode]::AutoReset, 'Local\DPHS-Kiosk-Open')

if (-not $createdNew) {
  $openEvent.Set() | Out-Null
  $openEvent.Dispose()
  $mutex.Dispose()
  exit 0
}

$script:kioskHandle = [IntPtr]::Zero
$script:targetScreen = $null

function Get-EdgePath {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  $command = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'Microsoft Edge를 찾지 못했습니다.'
}

function Get-KioskProcess {
  return Get-Process -Name msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*공공의료지원과 전광판*' } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}

function Get-PreferredScreen {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  if ($screens.Count -le 1) { return $screens[0] }
  $secondary = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
  if ($secondary) { return $secondary }
  return $screens[0]
}

function Test-KioskWindow {
  return $script:kioskHandle -ne [IntPtr]::Zero -and [DphsKioskNativeWindow]::IsWindow($script:kioskHandle)
}

function Open-KioskWindow {
  $existing = Get-KioskProcess
  if (-not $existing) {
    $knownHandles = @(Get-Process -Name msedge -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      ForEach-Object { $_.MainWindowHandle.ToInt64() })
    $edgePath = Get-EdgePath
    Write-KioskLog "Launching Edge: $PortalUrl"
    Start-Process -FilePath $edgePath -ArgumentList @("--app=$PortalUrl", '--new-window') | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds($WindowWaitSeconds)
    do {
      Start-Sleep -Milliseconds 350
      $existing = Get-KioskProcess
      if (-not $existing) {
        $existing = Get-Process -Name msedge -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowHandle -ne 0 -and $knownHandles -notcontains $_.MainWindowHandle.ToInt64() } |
          Sort-Object StartTime -Descending |
          Select-Object -First 1
      }
    } while (-not $existing -and [DateTime]::UtcNow -lt $deadline)
  }

  if (-not $existing) {
    throw '전광판 창을 찾지 못했습니다. Edge에서 기기 승인을 완료한 뒤 다시 실행해 주십시오.'
  }

  $script:kioskHandle = [IntPtr]$existing.MainWindowHandle
  if (-not $script:targetScreen) { $script:targetScreen = Get-PreferredScreen }
  # Edge가 시작 직후 한 번 창 프레임을 다시 적용하는 경우가 있어
  # 초기 로딩 동안 여러 번 borderless 상태를 고정합니다.
  1..20 | ForEach-Object {
    [DphsKioskNativeWindow]::ShowBorderless($script:kioskHandle, $script:targetScreen.Bounds)
    Start-Sleep -Milliseconds 150
  }
  Write-KioskLog "Kiosk ready: $($script:targetScreen.DeviceName)"
}

function Show-KioskWindow {
  if (-not (Test-KioskWindow)) { Open-KioskWindow }
  else {
    1..8 | ForEach-Object {
      [DphsKioskNativeWindow]::ShowBorderless($script:kioskHandle, $script:targetScreen.Bounds)
      Start-Sleep -Milliseconds 120
    }
  }
}

try {
  Write-KioskLog "START protocol=$ProtocolUri"
  Open-KioskWindow
  while (Test-KioskWindow) {
    if ($openEvent.WaitOne(500)) {
      Show-KioskWindow
      Write-KioskLog 'Kiosk expanded'
    }
  }
  Write-KioskLog 'Kiosk window closed; launcher stopped'
}
catch {
  Write-KioskLog "ERROR $($_.Exception.Message)"
  [System.Windows.Forms.MessageBox]::Show(
    "$($_.Exception.Message)`n`n실행 기록: $logPath",
    '공공의료지원과 전광판',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
finally {
  $openEvent.Dispose()
  if ($createdNew) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}
