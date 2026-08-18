param(
  [string]$PortalUrl = 'https://dphs2023.vercel.app/?kiosk=1',
  [ValidateSet('Left', 'Right')]
  [string]$HandleSide = 'Right',
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;

public static class DphsKioskWindow
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
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

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

    public static long CaptureStyle(IntPtr hWnd)
    {
        return GetStyle(hWnd);
    }

    public static void ShowBorderless(IntPtr hWnd, Rectangle bounds)
    {
        long style = GetStyle(hWnd);
        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
        style |= WS_POPUP;
        SetStyle(hWnd, style);
        ShowWindow(hWnd, SW_SHOW);
        SetWindowPos(hWnd, HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }

    public static void Hide(IntPtr hWnd)
    {
        ShowWindow(hWnd, SW_HIDE);
    }

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
  Write-Output 'Kiosk handle validation: OK'
  exit 0
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\DPHS-Kiosk-Handle', [ref]$createdNew)
if (-not $createdNew) {
  [System.Windows.Forms.MessageBox]::Show(
    '전광판 손잡이가 이미 실행 중입니다.',
    '공공의료지원과 전광판',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  exit 0
}

$kioskTitle = '공공의료지원과 전광판'
$script:kioskHandle = [IntPtr]::Zero
$script:originalStyle = 0L
$script:boardVisible = $false
$script:targetScreen = $null
$script:handleSide = $HandleSide
$script:dragging = $false
$script:dragMoved = $false
$script:dragOffsetY = 0
$script:lastHandleTop = $null

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
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$kioskTitle*" } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}

function Get-PreferredScreen {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  if ($screens.Count -le 1) { return $screens[0] }
  return $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
}

function Open-KioskWindow {
  $existing = Get-KioskProcess
  if (-not $existing) {
    $edgePath = Get-EdgePath
    Start-Process -FilePath $edgePath -ArgumentList @("--app=$PortalUrl", '--new-window', '--start-maximized') | Out-Null

    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
      Start-Sleep -Milliseconds 350
      $existing = Get-KioskProcess
    } while (-not $existing -and [DateTime]::UtcNow -lt $deadline)
  }

  if (-not $existing) {
    throw "전광판 창을 찾지 못했습니다. Edge에서 기기 승인을 완료한 뒤 다시 실행해 주십시오."
  }

  $script:kioskHandle = [IntPtr]$existing.MainWindowHandle
  $script:originalStyle = [DphsKioskWindow]::CaptureStyle($script:kioskHandle)
  if (-not $script:targetScreen) { $script:targetScreen = Get-PreferredScreen }
  [DphsKioskWindow]::ShowBorderless($script:kioskHandle, $script:targetScreen.Bounds)
  $script:boardVisible = $true
}

function Test-KioskWindow {
  return $script:kioskHandle -ne [IntPtr]::Zero -and [DphsKioskWindow]::IsWindow($script:kioskHandle)
}

function Set-HandleAppearance {
  if (-not $script:handleButton) { return }
  if ($script:boardVisible) {
    $script:handleButton.Text = "바탕화면`n보기"
    $script:handleButton.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
  } else {
    $script:handleButton.Text = "전광판`n열기"
    $script:handleButton.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
  }
  if ($script:toggleMenuItem) {
    $script:toggleMenuItem.Text = if ($script:boardVisible) { '전광판 숨기기' } else { '전광판 표시하기' }
  }
}

function Set-HandlePosition {
  if (-not $script:handleForm -or -not $script:targetScreen) { return }
  $bounds = $script:targetScreen.Bounds
  $x = if ($script:handleSide -eq 'Left') { $bounds.Left } else { $bounds.Right - $script:handleForm.Width }
  $minimumTop = $bounds.Top + 24
  $maximumTop = $bounds.Bottom - $script:handleForm.Height - 24
  $top = if ($null -eq $script:lastHandleTop) {
    $bounds.Top + [Math]::Floor(($bounds.Height - $script:handleForm.Height) / 2)
  } else {
    [Math]::Max($minimumTop, [Math]::Min($maximumTop, [int]$script:lastHandleTop))
  }
  $script:lastHandleTop = $top
  $script:handleForm.Location = [System.Drawing.Point]::new($x, $top)
}

function Toggle-KioskWindow {
  if (-not (Test-KioskWindow)) {
    Open-KioskWindow
    Set-HandleAppearance
    return
  }

  if ($script:boardVisible) {
    [DphsKioskWindow]::Hide($script:kioskHandle)
    $script:boardVisible = $false
  } else {
    [DphsKioskWindow]::ShowBorderless($script:kioskHandle, $script:targetScreen.Bounds)
    $script:boardVisible = $true
  }
  Set-HandleAppearance
}

try {
  Open-KioskWindow

  $script:handleForm = New-Object System.Windows.Forms.Form
  $script:handleForm.Text = '공공의료지원과 전광판 손잡이'
  $script:handleForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $script:handleForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $script:handleForm.ShowInTaskbar = $false
  $script:handleForm.TopMost = $true
  $script:handleForm.Width = 48
  $script:handleForm.Height = 104
  $script:handleForm.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)

  $script:handleButton = New-Object System.Windows.Forms.Button
  $script:handleButton.Dock = [System.Windows.Forms.DockStyle]::Fill
  $script:handleButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $script:handleButton.FlatAppearance.BorderSize = 0
  $script:handleButton.ForeColor = [System.Drawing.Color]::White
  $script:handleButton.Font = New-Object System.Drawing.Font('Malgun Gothic', 9, [System.Drawing.FontStyle]::Bold)
  $script:handleButton.Cursor = [System.Windows.Forms.Cursors]::Hand
  $script:handleButton.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $script:handleForm.Controls.Add($script:handleButton)

  $toolTip = New-Object System.Windows.Forms.ToolTip
  $toolTip.SetToolTip($script:handleButton, '클릭: 전광판 숨김/복귀 · 드래그: 손잡이 위아래 이동')

  $contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
  $script:toggleMenuItem = $contextMenu.Items.Add('전광판 숨기기')
  $leftMenuItem = $contextMenu.Items.Add('손잡이를 왼쪽에 배치')
  $rightMenuItem = $contextMenu.Items.Add('손잡이를 오른쪽에 배치')
  $moveMonitorMenuItem = $contextMenu.Items.Add('다른 모니터로 이동')
  [void]$contextMenu.Items.Add('-')
  $exitMenuItem = $contextMenu.Items.Add('전광판 도우미 종료')
  $script:handleButton.ContextMenuStrip = $contextMenu

  $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
  $notifyIcon.Text = '공공의료지원과 전광판'
  $notifyIcon.Visible = $true
  $notifyIcon.ContextMenuStrip = $contextMenu

  $script:handleButton.Add_MouseDown({
    param($sender, $eventArgs)
    if ($eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $script:dragging = $true
    $script:dragMoved = $false
    $script:dragOffsetY = [System.Windows.Forms.Cursor]::Position.Y - $script:handleForm.Top
  })

  $script:handleButton.Add_MouseMove({
    if (-not $script:dragging) { return }
    $bounds = $script:targetScreen.Bounds
    $nextTop = [System.Windows.Forms.Cursor]::Position.Y - $script:dragOffsetY
    $nextTop = [Math]::Max($bounds.Top + 24, [Math]::Min($bounds.Bottom - $script:handleForm.Height - 24, $nextTop))
    if ([Math]::Abs($nextTop - $script:handleForm.Top) -gt 2) { $script:dragMoved = $true }
    $script:handleForm.Top = $nextTop
    $script:lastHandleTop = $nextTop
  })

  $script:handleButton.Add_MouseUp({
    $script:dragging = $false
  })

  $script:handleButton.Add_Click({
    if ($script:dragMoved) { $script:dragMoved = $false; return }
    try { Toggle-KioskWindow } catch {
      [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '전광판 오류') | Out-Null
    }
  })

  $script:toggleMenuItem.Add_Click({ Toggle-KioskWindow })
  $leftMenuItem.Add_Click({ $script:handleSide = 'Left'; Set-HandlePosition })
  $rightMenuItem.Add_Click({ $script:handleSide = 'Right'; Set-HandlePosition })
  $moveMonitorMenuItem.Add_Click({
    $screens = @([System.Windows.Forms.Screen]::AllScreens)
    if ($screens.Count -le 1) { return }
    $currentIndex = [Array]::IndexOf($screens, $script:targetScreen)
    $script:targetScreen = $screens[($currentIndex + 1) % $screens.Count]
    $script:lastHandleTop = $null
    if ($script:boardVisible -and (Test-KioskWindow)) {
      [DphsKioskWindow]::ShowBorderless($script:kioskHandle, $script:targetScreen.Bounds)
    }
    Set-HandlePosition
  })
  $exitMenuItem.Add_Click({ $script:handleForm.Close() })
  $notifyIcon.Add_DoubleClick({ Toggle-KioskWindow })

  $windowTimer = New-Object System.Windows.Forms.Timer
  $windowTimer.Interval = 2000
  $windowTimer.Add_Tick({
    if (-not (Test-KioskWindow)) {
      $script:boardVisible = $false
      Set-HandleAppearance
    }
  })
  $windowTimer.Start()

  $script:handleForm.Add_FormClosing({
    $windowTimer.Stop()
    $notifyIcon.Visible = $false
    if (Test-KioskWindow) {
      [DphsKioskWindow]::Restore($script:kioskHandle, $script:originalStyle, $script:targetScreen.WorkingArea)
    }
  })

  Set-HandleAppearance
  Set-HandlePosition
  [System.Windows.Forms.Application]::Run($script:handleForm)
}
catch {
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    '공공의료지원과 전광판',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
finally {
  if ($createdNew) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  $mutex.Dispose()
}
