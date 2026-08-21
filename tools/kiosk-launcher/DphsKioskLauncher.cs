using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("공공의료지원과 전광판")]
[assembly: AssemblyDescription("공공의료지원과 전광판 네이티브 실행기")]
[assembly: AssemblyCompany("공공의료지원과")]
[assembly: AssemblyProduct("공공의료지원과 전광판")]
[assembly: AssemblyCopyright("Copyright © 2026")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

internal static class Program
{
    private const string InstalledFileName = "DPHS-Kiosk-Launcher.exe";
    private const string ProtocolPrefix = "dphskiosk://";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            string argument = args.Length > 0 ? args[0].Trim() : String.Empty;

            if (String.Equals(argument, "--self-test", StringComparison.OrdinalIgnoreCase))
                return NativeWindow.SelfTest() ? 0 : 1;

            if (String.Equals(argument, "--uninstall", StringComparison.OrdinalIgnoreCase))
            {
                KioskInstallation.Uninstall();
                MessageBox.Show(
                    "전광판 연결과 바로가기를 제거했습니다.",
                    "공공의료지원과 전광판",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }

            string installedPath = KioskInstallation.InstalledExecutablePath;
            string currentPath = Path.GetFullPath(Application.ExecutablePath);
            bool isInstalledCopy = String.Equals(
                currentPath,
                Path.GetFullPath(installedPath),
                StringComparison.OrdinalIgnoreCase);

            if (!isInstalledCopy)
            {
                KioskInstallation.Install(currentPath);
                MessageBox.Show(
                    "전광판 실행기를 연결했습니다.\n\n이제 포털 또는 바탕화면의 전광판 아이콘으로 실행할 수 있습니다.",
                    "전광판 연결 완료",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);

                string forwardedArgument = argument.StartsWith(ProtocolPrefix, StringComparison.OrdinalIgnoreCase)
                    ? argument
                    : "dphskiosk://open";
                Process.Start(new ProcessStartInfo
                {
                    FileName = installedPath,
                    Arguments = Quote(forwardedArgument),
                    UseShellExecute = true,
                    WorkingDirectory = KioskInstallation.InstallDirectory
                });
                return 0;
            }

            KioskInstallation.EnsureRegistration();
            KioskAction initialAction = ParseAction(argument);
            using (KioskController controller = new KioskController(initialAction))
                return controller.Run();
        }
        catch (Exception error)
        {
            KioskLog.Write("ERROR " + error);
            MessageBox.Show(
                error.Message + "\n\n실행 기록: " + KioskLog.Path,
                "공공의료지원과 전광판 오류",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static KioskAction ParseAction(string argument)
    {
        if (argument.StartsWith("dphskiosk://collapse", StringComparison.OrdinalIgnoreCase))
            return KioskAction.Collapse;
        if (argument.StartsWith("dphskiosk://exit", StringComparison.OrdinalIgnoreCase))
            return KioskAction.Exit;
        return KioskAction.Open;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}

internal enum KioskAction
{
    Open,
    Collapse,
    Exit
}

internal static class KioskInstallation
{
    private const string ProtocolKeyPath = @"Software\Classes\dphskiosk";
    private const string ShortcutFileName = "공공의료지원과 전광판.lnk";

    internal static string InstallDirectory
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DPHSKiosk");
        }
    }

    internal static string InstalledExecutablePath
    {
        get { return Path.Combine(InstallDirectory, "DPHS-Kiosk-Launcher.exe"); }
    }

    internal static void Install(string sourcePath)
    {
        Directory.CreateDirectory(InstallDirectory);

        if (File.Exists(InstalledExecutablePath))
        {
            try
            {
                using (EventWaitHandle exitEvent = EventWaitHandle.OpenExisting(KioskController.ExitEventName))
                    exitEvent.Set();
                Thread.Sleep(600);
            }
            catch (WaitHandleCannotBeOpenedException)
            {
            }
        }

        File.Copy(sourcePath, InstalledExecutablePath, true);
        EnsureRegistration();
        CreateShortcuts();
        KioskLog.Write("Native launcher installed from " + sourcePath);
    }

    internal static void EnsureRegistration()
    {
        string command = "\"" + InstalledExecutablePath + "\" \"%1\"";

        using (RegistryKey protocol = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath))
        {
            if (protocol == null) throw new InvalidOperationException("전광판 프로토콜을 등록하지 못했습니다.");
            protocol.SetValue(null, "URL:DPHS Kiosk Launcher", RegistryValueKind.String);
            protocol.SetValue("URL Protocol", String.Empty, RegistryValueKind.String);
        }

        using (RegistryKey icon = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath + @"\DefaultIcon"))
        {
            if (icon != null) icon.SetValue(null, InstalledExecutablePath + ",0", RegistryValueKind.String);
        }

        using (RegistryKey openCommand = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath + @"\shell\open\command"))
        {
            if (openCommand == null) throw new InvalidOperationException("전광판 실행 명령을 등록하지 못했습니다.");
            openCommand.SetValue(null, command, RegistryValueKind.String);
        }
    }

    internal static void Uninstall()
    {
        try
        {
            using (EventWaitHandle exitEvent = EventWaitHandle.OpenExisting(KioskController.ExitEventName))
                exitEvent.Set();
        }
        catch (WaitHandleCannotBeOpenedException)
        {
        }

        try { Registry.CurrentUser.DeleteSubKeyTree(ProtocolKeyPath, false); }
        catch (ArgumentException) { }

        DeleteShortcut(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            ShortcutFileName));
        DeleteShortcut(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            "공공의료지원과",
            "전광판.lnk"));
        KioskLog.Write("Native launcher unregistered");
    }

    private static void CreateShortcuts()
    {
        string desktopShortcut = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            ShortcutFileName);
        CreateShortcut(desktopShortcut);

        string startMenuDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            "공공의료지원과");
        Directory.CreateDirectory(startMenuDirectory);
        CreateShortcut(Path.Combine(startMenuDirectory, "전광판.lnk"));
    }

    private static void CreateShortcut(string shortcutPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;

        object shell = null;
        object shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { InstalledExecutablePath });
            shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { "dphskiosk://open" });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { InstallDirectory });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "공공의료지원과 전광판 열기" });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { InstalledExecutablePath + ",0" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void DeleteShortcut(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

internal sealed class KioskController : IDisposable
{
    internal const string ExitEventName = @"Local\DPHS-Kiosk-Native-Exit";
    private const string MutexName = @"Local\DPHS-Kiosk-Native-Launcher";
    private const string OpenEventName = @"Local\DPHS-Kiosk-Native-Open";
    private const string CollapseEventName = @"Local\DPHS-Kiosk-Native-Collapse";
    private const string PortalUrl = "https://dphs2023.vercel.app/kiosk?launcher=1";

    private readonly KioskAction initialAction;
    private readonly Mutex mutex;
    private readonly EventWaitHandle openEvent;
    private readonly EventWaitHandle collapseEvent;
    private readonly EventWaitHandle exitEvent;
    private readonly bool ownsMutex;
    private IntPtr kioskWindow;
    private Screen targetScreen;
    private bool disposed;

    internal KioskController(KioskAction initialAction)
    {
        this.initialAction = initialAction;
        bool createdNew;
        mutex = new Mutex(true, MutexName, out createdNew);
        ownsMutex = createdNew;
        openEvent = new EventWaitHandle(false, EventResetMode.AutoReset, OpenEventName);
        collapseEvent = new EventWaitHandle(false, EventResetMode.AutoReset, CollapseEventName);
        exitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ExitEventName);
    }

    internal int Run()
    {
        if (!ownsMutex)
        {
            Signal(initialAction);
            return 0;
        }

        if (initialAction == KioskAction.Exit) return 0;

        OpenKioskWindow();
        if (initialAction == KioskAction.Collapse) CollapseKioskWindow();

        WaitHandle[] events = new WaitHandle[] { openEvent, collapseEvent, exitEvent };
        while (NativeWindow.IsWindow(kioskWindow))
        {
            int signal = WaitHandle.WaitAny(events, 350);
            if (signal == 0)
            {
                ShowKioskWindow();
                KioskLog.Write("Kiosk expanded");
            }
            else if (signal == 1)
            {
                CollapseKioskWindow();
                KioskLog.Write("Kiosk collapsed");
            }
            else if (signal == 2)
            {
                KioskLog.Write("Launcher exit requested");
                break;
            }
            else
            {
                MaintainWindowState();
            }
        }

        KioskLog.Write("Kiosk window closed; native launcher stopped");
        return 0;
    }

    private void Signal(KioskAction action)
    {
        if (action == KioskAction.Collapse) collapseEvent.Set();
        else if (action == KioskAction.Exit) exitEvent.Set();
        else openEvent.Set();
    }

    private void OpenKioskWindow()
    {
        kioskWindow = WindowFinder.FindKioskWindow();
        if (kioskWindow == IntPtr.Zero)
        {
            HashSet<IntPtr> windowsBeforeLaunch = WindowFinder.GetVisibleWindows();
            string edgePath = EdgeLocator.Find();
            KioskLog.Write("Launching Edge: " + PortalUrl);
            Process.Start(new ProcessStartInfo
            {
                FileName = edgePath,
                Arguments = "--app=\"" + PortalUrl + "\" --new-window --no-first-run",
                UseShellExecute = true
            });

            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(300);
                kioskWindow = WindowFinder.FindKioskWindow(windowsBeforeLaunch);
                if (kioskWindow != IntPtr.Zero) break;
            }
        }

        if (kioskWindow == IntPtr.Zero)
            throw new InvalidOperationException("전광판 창을 찾지 못했습니다. Edge 실행을 확인한 뒤 다시 시도해 주십시오.");

        targetScreen = GetPreferredScreen();

        // Edge가 시작 직후 창 프레임을 다시 적용할 수 있어, 초기 로딩 동안
        // 같은 무테 전체화면 상태를 반복 적용합니다. F11 키는 사용하지 않습니다.
        for (int attempt = 0; attempt < 20 && NativeWindow.IsWindow(kioskWindow); attempt++)
        {
            NativeWindow.ShowBorderless(kioskWindow, targetScreen.Bounds);
            Thread.Sleep(150);
        }

        KioskLog.Write("Kiosk ready on " + targetScreen.DeviceName);
    }

    private void ShowKioskWindow()
    {
        if (!NativeWindow.IsWindow(kioskWindow)) OpenKioskWindow();
        NativeWindow.ShowBorderless(kioskWindow, targetScreen.Bounds);
        Thread.Sleep(200);
        NativeWindow.ShowBorderless(kioskWindow, targetScreen.Bounds);
    }

    private void CollapseKioskWindow()
    {
        if (!NativeWindow.IsWindow(kioskWindow)) return;
        NativeWindow.ShowCompact(kioskWindow, targetScreen.Bounds);
        Thread.Sleep(200);
        NativeWindow.ShowCompact(kioskWindow, targetScreen.Bounds);
    }

    private void MaintainWindowState()
    {
        if (!NativeWindow.IsWindow(kioskWindow)) return;
        string title = NativeWindow.GetTitle(kioskWindow);
        bool controller = title.IndexOf("전광판 제어", StringComparison.OrdinalIgnoreCase) >= 0;
        if (!controller && !NativeWindow.IsCompact(kioskWindow) &&
            !NativeWindow.IsBorderlessAtBounds(kioskWindow, targetScreen.Bounds))
        {
            NativeWindow.ShowBorderless(kioskWindow, targetScreen.Bounds);
            KioskLog.Write("Kiosk fullscreen state restored");
        }
    }

    private static Screen GetPreferredScreen()
    {
        Screen[] screens = Screen.AllScreens;
        if (screens.Length == 0) return Screen.PrimaryScreen;
        for (int index = 0; index < screens.Length; index++)
            if (!screens[index].Primary) return screens[index];
        return screens[0];
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        openEvent.Dispose();
        collapseEvent.Dispose();
        exitEvent.Dispose();
        if (ownsMutex)
        {
            try { mutex.ReleaseMutex(); }
            catch (ApplicationException) { }
        }
        mutex.Dispose();
    }
}

internal static class EdgeLocator
{
    internal static string Find()
    {
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates = new string[]
        {
            Path.Combine(programFilesX86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(programFiles, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(localAppData, @"Microsoft\Edge\Application\msedge.exe")
        };

        for (int index = 0; index < candidates.Length; index++)
            if (File.Exists(candidates[index])) return candidates[index];

        throw new FileNotFoundException("Microsoft Edge를 찾지 못했습니다.");
    }
}

internal static class WindowFinder
{
    internal static IntPtr FindKioskWindow()
    {
        return FindKioskWindow(null);
    }

    internal static IntPtr FindKioskWindow(HashSet<IntPtr> preferredWindows)
    {
        IntPtr match = IntPtr.Zero;
        IntPtr preferredMatch = IntPtr.Zero;
        NativeWindow.EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (!NativeWindow.IsWindowVisible(window)) return true;
            string title = NativeWindow.GetTitle(window);
            bool titleMatches = title.IndexOf("공공의료지원과 전광판", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                title.IndexOf("전광판 제어", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!titleMatches) return true;

            match = window;
            if (preferredWindows != null && !preferredWindows.Contains(window))
            {
                preferredMatch = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return preferredMatch != IntPtr.Zero ? preferredMatch : match;
    }

    internal static HashSet<IntPtr> GetVisibleWindows()
    {
        HashSet<IntPtr> result = new HashSet<IntPtr>();
        NativeWindow.EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (NativeWindow.IsWindowVisible(window)) result.Add(window);
            return true;
        }, IntPtr.Zero);
        return result;
    }
}

internal static class NativeWindow
{
    internal delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const long WsMinimizeBox = 0x00020000L;
    private const long WsMaximizeBox = 0x00010000L;
    private const long WsSystemMenu = 0x00080000L;
    private const long WsPopup = 0x80000000L;
    private const long WsExWindowEdge = 0x00000100L;
    private const long WsExClientEdge = 0x00000200L;
    private const int SwRestore = 9;
    private const uint SwpFrameChanged = 0x0020;
    private const uint SwpShowWindow = 0x0040;
    private static readonly IntPtr HwndTopmost = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll")]
    internal static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern int GetWindowLong32(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr window, int index, int value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);

    internal static bool SelfTest()
    {
        return IntPtr.Size == 4 || IntPtr.Size == 8;
    }

    internal static string GetTitle(IntPtr window)
    {
        StringBuilder title = new StringBuilder(512);
        GetWindowText(window, title, title.Capacity);
        return title.ToString();
    }

    internal static bool IsCompact(IntPtr window)
    {
        Rect rectangle;
        return GetWindowRect(window, out rectangle) &&
               rectangle.Right - rectangle.Left <= 500 &&
               rectangle.Bottom - rectangle.Top <= 320;
    }

    internal static bool IsBorderlessAtBounds(IntPtr window, Rectangle bounds)
    {
        long style = GetStyle(window, GwlStyle);
        if ((style & (WsCaption | WsThickFrame | WsMinimizeBox | WsMaximizeBox | WsSystemMenu)) != 0)
            return false;

        Rect rectangle;
        if (!GetWindowRect(window, out rectangle)) return false;
        return Math.Abs(rectangle.Left - bounds.X) <= 2 &&
               Math.Abs(rectangle.Top - bounds.Y) <= 2 &&
               Math.Abs((rectangle.Right - rectangle.Left) - bounds.Width) <= 2 &&
               Math.Abs((rectangle.Bottom - rectangle.Top) - bounds.Height) <= 2;
    }

    internal static void ShowBorderless(IntPtr window, Rectangle bounds)
    {
        long style = GetStyle(window, GwlStyle);
        style &= ~(WsCaption | WsThickFrame | WsMinimizeBox | WsMaximizeBox | WsSystemMenu);
        style |= WsPopup;
        SetStyle(window, GwlStyle, style);

        long extendedStyle = GetStyle(window, GwlExStyle);
        extendedStyle &= ~(WsExWindowEdge | WsExClientEdge);
        SetStyle(window, GwlExStyle, extendedStyle);

        ShowWindow(window, SwRestore);
        SetWindowPos(window, HwndTopmost, bounds.X, bounds.Y, bounds.Width, bounds.Height,
            SwpFrameChanged | SwpShowWindow);
        SetForegroundWindow(window);
    }

    internal static void ShowCompact(IntPtr window, Rectangle bounds)
    {
        long style = GetStyle(window, GwlStyle);
        style &= ~WsPopup;
        style |= WsCaption | WsThickFrame | WsMinimizeBox | WsSystemMenu;
        style &= ~WsMaximizeBox;
        SetStyle(window, GwlStyle, style);

        int width = 360;
        int height = 180;
        int x = bounds.X + Math.Max(0, bounds.Width - width);
        int y = bounds.Y + Math.Max(0, (bounds.Height - height) / 2);
        ShowWindow(window, SwRestore);
        SetWindowPos(window, HwndTopmost, x, y, width, height,
            SwpFrameChanged | SwpShowWindow);
        SetForegroundWindow(window);
    }

    private static long GetStyle(IntPtr window, int index)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(window, index).ToInt64()
            : GetWindowLong32(window, index);
    }

    private static void SetStyle(IntPtr window, int index, long style)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(window, index, new IntPtr(style));
        else SetWindowLong32(window, index, unchecked((int)style));
    }
}

internal static class KioskLog
{
    private static readonly object Sync = new object();

    internal static string Path
    {
        get { return System.IO.Path.Combine(KioskInstallation.InstallDirectory, "kiosk-launcher.log"); }
    }

    internal static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(KioskInstallation.InstallDirectory);
                File.AppendAllText(
                    Path,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }
}
