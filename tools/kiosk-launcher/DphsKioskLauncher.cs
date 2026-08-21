using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("공공의료지원과 전광판")]
[assembly: AssemblyDescription("공공의료지원과 전광판 전용 실행기")]
[assembly: AssemblyCompany("공공의료지원과")]
[assembly: AssemblyProduct("공공의료지원과 전광판")]
[assembly: AssemblyCopyright("Copyright © 2026")]
[assembly: AssemblyVersion("4.2.0.0")]
[assembly: AssemblyFileVersion("4.2.0.0")]

internal static class Program
{
    private const string ProtocolPrefix = "dphskiosk://";

    [STAThread]
    private static int Main(string[] args)
    {
        string argument = args.Length > 0 ? args[0].Trim() : String.Empty;

        // 실행 중인 런처에 보내는 명령은 UI나 레지스트리를 초기화하지 않고
        // 이름 있는 커널 이벤트로 곧바로 전달합니다.
        if (argument.StartsWith(ProtocolPrefix, StringComparison.OrdinalIgnoreCase) &&
            KioskController.TrySignalExisting(ParseAction(argument)))
            return 0;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            bool silentInstall = String.Equals(argument, "--install-silent", StringComparison.OrdinalIgnoreCase);
            if (String.Equals(argument, "--self-test", StringComparison.OrdinalIgnoreCase))
                return SelfTest.Run() ? 0 : 1;

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

            string currentPath = Path.GetFullPath(Application.ExecutablePath);
            bool installedCopy = String.Equals(
                currentPath,
                Path.GetFullPath(KioskPaths.InstalledExecutable),
                StringComparison.OrdinalIgnoreCase);

            if (!installedCopy)
            {
                KioskInstallation.Install(currentPath);
                if (!silentInstall)
                {
                    MessageBox.Show(
                        "전광판 실행기를 연결했습니다.\n\n" +
                        "전광판은 다른 Edge 창과 완전히 분리된 전용 전체화면으로 실행됩니다.",
                        "전광판 연결 완료",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information);
                }
                Process.Start(new ProcessStartInfo
                {
                    FileName = KioskPaths.InstalledExecutable,
                    Arguments = "\"dphskiosk://open\"",
                    WorkingDirectory = KioskPaths.InstallDirectory,
                    UseShellExecute = true
                });
                return 0;
            }

            KioskInstallation.EnsureRegistration();
            using (KioskController controller = new KioskController(ParseAction(argument)))
                return controller.Run();
        }
        catch (Exception error)
        {
            KioskLog.Write("FATAL " + error);
            MessageBox.Show(
                "전광판 실행기를 시작하지 못했습니다.\n\n" + error.Message +
                "\n\n실행 기록: " + KioskLog.FilePath,
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
}

internal enum KioskAction
{
    Open,
    Collapse,
    Exit
}

internal enum KioskViewState
{
    Expanded,
    Collapsed
}

internal static class KioskPaths
{
    internal const string PortalUrl = "https://dphs2023.vercel.app/kiosk?launcher=1";
    internal const string PairingUrl = "https://dphs2023.vercel.app/kiosk/pair?request=";

    internal static string InstallDirectory
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DPHSKiosk");
        }
    }

    internal static string InstalledExecutable
    {
        get { return Path.Combine(InstallDirectory, "DPHS-Kiosk-Launcher.exe"); }
    }

    internal static string EdgeProfileDirectory
    {
        get { return Path.Combine(InstallDirectory, "EdgeProfile"); }
    }
}

internal static class KioskInstallation
{
    private const string ProtocolKeyPath = @"Software\Classes\dphskiosk";

    internal static void Install(string sourcePath)
    {
        Directory.CreateDirectory(KioskPaths.InstallDirectory);
        Directory.CreateDirectory(KioskPaths.EdgeProfileDirectory);

        StopInstalledLauncher();
        WindowFinder.CloseAllLegacyKioskWindows();
        WindowFinder.StopDedicatedEdgeProcesses(KioskPaths.EdgeProfileDirectory);
        Thread.Sleep(250);

        File.Copy(sourcePath, KioskPaths.InstalledExecutable, true);
        DeleteLegacyFiles();
        EnsureRegistration();
        CreateShortcuts();
        KioskLog.Write("Launcher 4.2 installed from " + sourcePath);
    }

    internal static void EnsureRegistration()
    {
        string command = "\"" + KioskPaths.InstalledExecutable + "\" \"%1\"";
        using (RegistryKey protocol = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath))
        {
            if (protocol == null) throw new InvalidOperationException("전광판 프로토콜을 등록하지 못했습니다.");
            protocol.SetValue(null, "URL:DPHS Kiosk Launcher", RegistryValueKind.String);
            protocol.SetValue("URL Protocol", String.Empty, RegistryValueKind.String);
        }
        using (RegistryKey icon = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath + @"\DefaultIcon"))
        {
            if (icon != null) icon.SetValue(null, KioskPaths.InstalledExecutable + ",0", RegistryValueKind.String);
        }
        using (RegistryKey commandKey = Registry.CurrentUser.CreateSubKey(ProtocolKeyPath + @"\shell\open\command"))
        {
            if (commandKey == null) throw new InvalidOperationException("전광판 실행 명령을 등록하지 못했습니다.");
            commandKey.SetValue(null, command, RegistryValueKind.String);
        }
    }

    internal static void Uninstall()
    {
        KioskController.TrySignalExisting(KioskAction.Exit);
        Thread.Sleep(250);
        WindowFinder.CloseDedicatedKioskWindow(KioskPaths.EdgeProfileDirectory);
        try { Registry.CurrentUser.DeleteSubKeyTree(ProtocolKeyPath, false); }
        catch (ArgumentException) { }
        DeleteShortcut(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "공공의료지원과 전광판.lnk"));
        DeleteShortcut(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            "공공의료지원과",
            "전광판.lnk"));
        DeleteLegacyFiles();
        KioskLog.Write("Launcher unregistered");
    }

    private static void StopInstalledLauncher()
    {
        KioskController.TrySignalExisting(KioskAction.Exit);
        Thread.Sleep(350);
        Process[] processes = Process.GetProcessesByName("DPHS-Kiosk-Launcher");
        for (int index = 0; index < processes.Length; index++)
        {
            using (Process process = processes[index])
            {
                if (process.Id == Process.GetCurrentProcess().Id) continue;
                try
                {
                    string path = process.MainModule == null ? String.Empty : process.MainModule.FileName;
                    if (!String.Equals(Path.GetFullPath(path), Path.GetFullPath(KioskPaths.InstalledExecutable),
                        StringComparison.OrdinalIgnoreCase))
                        continue;
                    process.Kill();
                    process.WaitForExit(1500);
                }
                catch (InvalidOperationException) { }
                catch (System.ComponentModel.Win32Exception) { }
            }
        }
    }

    private static void DeleteLegacyFiles()
    {
        string legacyScript = Path.Combine(KioskPaths.InstallDirectory, "Start-DphsKiosk.ps1");
        try { if (File.Exists(legacyScript)) File.Delete(legacyScript); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void CreateShortcuts()
    {
        CreateShortcut(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "공공의료지원과 전광판.lnk"));
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            "공공의료지원과");
        Directory.CreateDirectory(startMenu);
        CreateShortcut(Path.Combine(startMenu, "전광판.lnk"));
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
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut,
                new object[] { KioskPaths.InstalledExecutable });
            shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut,
                new object[] { "dphskiosk://open" });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut,
                new object[] { KioskPaths.InstallDirectory });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut,
                new object[] { "공공의료지원과 전광판 열기" });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut,
                new object[] { KioskPaths.InstalledExecutable + ",0" });
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
    internal const string OpenEventName = @"Local\DPHS-Kiosk-Native-Open";
    internal const string CollapseEventName = @"Local\DPHS-Kiosk-Native-Collapse";
    internal const string ExitEventName = @"Local\DPHS-Kiosk-Native-Exit";
    private const string MutexName = @"Local\DPHS-Kiosk-Native-Launcher";

    private readonly KioskAction initialAction;
    private readonly Mutex mutex;
    private readonly EventWaitHandle openEvent;
    private readonly EventWaitHandle collapseEvent;
    private readonly EventWaitHandle exitEvent;
    private readonly bool ownsMutex;
    private bool disposed;

    internal KioskController(KioskAction initialAction)
    {
        this.initialAction = initialAction;
        bool created;
        mutex = new Mutex(true, MutexName, out created);
        ownsMutex = created;
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

        using (KioskApplicationContext context = new KioskApplicationContext(
            initialAction,
            openEvent,
            collapseEvent,
            exitEvent))
        {
            Application.Run(context);
        }
        return 0;
    }

    internal static bool TrySignalExisting(KioskAction action)
    {
        string eventName = action == KioskAction.Collapse
            ? CollapseEventName
            : action == KioskAction.Exit ? ExitEventName : OpenEventName;
        try
        {
            using (EventWaitHandle signal = EventWaitHandle.OpenExisting(eventName))
            {
                signal.Set();
                return true;
            }
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            return false;
        }
    }

    private void Signal(KioskAction action)
    {
        if (action == KioskAction.Collapse) collapseEvent.Set();
        else if (action == KioskAction.Exit) exitEvent.Set();
        else openEvent.Set();
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

internal sealed class KioskApplicationContext : ApplicationContext, IDisposable
{
    private readonly EventWaitHandle openEvent;
    private readonly EventWaitHandle collapseEvent;
    private readonly EventWaitHandle exitEvent;
    private readonly KioskControllerForm controllerForm;
    private readonly System.Windows.Forms.Timer timer;
    private readonly Screen targetScreen;
    private KioskViewState desiredState;
    private KioskViewState appliedState;
    private bool hasAppliedState;
    private IntPtr edgeWindow;
    private bool launchRequested;
    private bool edgeAttachedOnce;
    private DateTime launchStarted;
    private DateTime lastWindowSearch = DateTime.MinValue;
    private string handledWebCommand = String.Empty;
    private string openedPairRequest = String.Empty;
    private DateTime lastToggle = DateTime.MinValue;
    private bool exiting;
    private bool disposed;

    internal KioskApplicationContext(
        KioskAction initialAction,
        EventWaitHandle openEvent,
        EventWaitHandle collapseEvent,
        EventWaitHandle exitEvent)
    {
        this.openEvent = openEvent;
        this.collapseEvent = collapseEvent;
        this.exitEvent = exitEvent;
        desiredState = initialAction == KioskAction.Collapse
            ? KioskViewState.Collapsed
            : KioskViewState.Expanded;
        targetScreen = SelectTargetScreen();

        controllerForm = new KioskControllerForm();
        controllerForm.OpenRequested += delegate { SetDesiredState(KioskViewState.Expanded, "controller button"); };
        controllerForm.ToggleRequested += delegate { Toggle("F8"); };
        controllerForm.ExitRequested += ExitApplication;
        controllerForm.EnsureHandleAndHotKey();

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 40;
        timer.Tick += OnTick;
        timer.Start();

        if (desiredState == KioskViewState.Collapsed)
            controllerForm.ShowAt(GetCompactBounds(targetScreen.Bounds));
        StartEdgeIfNeeded();
    }

    private void OnTick(object sender, EventArgs eventArgs)
    {
        if (exiting) return;
        if (exitEvent.WaitOne(0))
        {
            ExitApplication();
            return;
        }

        bool collapseRequested = collapseEvent.WaitOne(0);
        bool openRequested = openEvent.WaitOne(0);
        if (collapseRequested) SetDesiredState(KioskViewState.Collapsed, "protocol");
        if (openRequested) SetDesiredState(KioskViewState.Expanded, "protocol");

        if (edgeWindow == IntPtr.Zero || !NativeWindow.IsWindow(edgeWindow))
        {
            if ((DateTime.UtcNow - lastWindowSearch).TotalMilliseconds < 180) return;
            lastWindowSearch = DateTime.UtcNow;
            edgeWindow = WindowFinder.FindDedicatedKioskWindow(KioskPaths.EdgeProfileDirectory);
            if (edgeWindow != IntPtr.Zero)
            {
                edgeAttachedOnce = true;
                hasAppliedState = false;
                KioskLog.Write("Dedicated Edge attached: hwnd=" + edgeWindow.ToInt64());
            }
            else
            {
                if (edgeAttachedOnce)
                {
                    KioskLog.Write("Dedicated Edge was closed by the user; launcher exits without reopening it");
                    ExitApplication();
                    return;
                }
                if (launchRequested && (DateTime.UtcNow - launchStarted).TotalSeconds >= 15)
                {
                    KioskLog.Write("Dedicated Edge startup timed out; launcher exits without retrying");
                    ExitApplication();
                    return;
                }
                StartEdgeIfNeeded();
                return;
            }
        }

        HandleWebCommandMarker();
        ApplyDesiredState();
    }

    private void StartEdgeIfNeeded()
    {
        // A single user action may launch Edge only once. If Edge is closed or startup fails,
        // OnTick exits this launcher instead of reopening windows in the background.
        if (launchRequested) return;
        launchRequested = true;
        launchStarted = DateTime.UtcNow;
        string edge = EdgeLocator.Find();
        Rectangle bounds = targetScreen.Bounds;
        string arguments =
            "--user-data-dir=\"" + KioskPaths.EdgeProfileDirectory + "\" " +
            "--app=\"" + KioskPaths.PortalUrl + "\" " +
            "--start-fullscreen --new-window --no-first-run --disable-session-crashed-bubble " +
            "--window-position=" + bounds.X + "," + bounds.Y + " " +
            "--window-size=" + bounds.Width + "," + bounds.Height;
        Process.Start(new ProcessStartInfo
        {
            FileName = edge,
            Arguments = arguments,
            UseShellExecute = true
        });
        KioskLog.Write("Dedicated Edge kiosk launch requested on " + targetScreen.DeviceName);
    }

    private void Toggle(string source)
    {
        if ((DateTime.UtcNow - lastToggle).TotalMilliseconds < 250) return;
        lastToggle = DateTime.UtcNow;
        SetDesiredState(
            desiredState == KioskViewState.Expanded ? KioskViewState.Collapsed : KioskViewState.Expanded,
            source);
    }

    private void SetDesiredState(KioskViewState state, string source)
    {
        if (exiting) return;
        desiredState = state;
        KioskLog.Write("Desired state=" + state + " source=" + source);
        ApplyDesiredState();
    }

    private void ApplyDesiredState()
    {
        // Apply window operations only when the desired state changes. Repeating
        // SetForegroundWindow every timer tick would steal focus from other apps.
        if (hasAppliedState && appliedState == desiredState) return;

        if (desiredState == KioskViewState.Collapsed)
        {
            if (edgeWindow != IntPtr.Zero && NativeWindow.IsWindow(edgeWindow))
                NativeWindow.Hide(edgeWindow);
            controllerForm.ShowAt(GetCompactBounds(targetScreen.Bounds));
        }
        else
        {
            controllerForm.HideController();
            if (edgeWindow != IntPtr.Zero && NativeWindow.IsWindow(edgeWindow))
                NativeWindow.ShowFullscreenWindow(edgeWindow, targetScreen.Bounds);
        }

        KioskLog.Write("Applied state=" + desiredState + " hwnd=" + edgeWindow.ToInt64());
        appliedState = desiredState;
        hasAppliedState = true;
    }

    private void HandleWebCommandMarker()
    {
        string title = NativeWindow.GetTitle(edgeWindow);
        const string pairPrefix = "DPHS_KIOSK_PAIR_";
        int pairIndex = title.IndexOf(pairPrefix, StringComparison.OrdinalIgnoreCase);
        if (pairIndex >= 0)
        {
            if (String.Equals(title, handledWebCommand, StringComparison.Ordinal)) return;
            handledWebCommand = title;
            string requestId = title.Substring(pairIndex + pairPrefix.Length).Trim();
            if (requestId.Length > 36) requestId = requestId.Substring(0, 36);
            OpenPairingRequest(requestId);
            return;
        }

        if (!String.IsNullOrEmpty(openedPairRequest) &&
            String.Equals(title, "공공의료지원과 전광판", StringComparison.Ordinal))
        {
            openedPairRequest = String.Empty;
            hasAppliedState = false;
            KioskLog.Write("Automatic kiosk approval completed");
        }

        string command = String.Empty;
        if (title.IndexOf("DPHS_KIOSK_COMMAND_COLLAPSE", StringComparison.OrdinalIgnoreCase) >= 0)
            command = "collapse";
        else if (title.IndexOf("DPHS_KIOSK_COMMAND_EXIT", StringComparison.OrdinalIgnoreCase) >= 0)
            command = "exit";

        if (String.IsNullOrEmpty(command))
        {
            handledWebCommand = String.Empty;
            return;
        }
        if (String.Equals(title, handledWebCommand, StringComparison.Ordinal)) return;
        handledWebCommand = title;
        if (command == "collapse") SetDesiredState(KioskViewState.Collapsed, "web marker");
        else ExitApplication();
    }

    private void OpenPairingRequest(string requestId)
    {
        Guid parsedRequest;
        if (!Guid.TryParse(requestId, out parsedRequest))
        {
            KioskLog.Write("Ignored an invalid kiosk pairing marker");
            return;
        }
        string normalizedRequest = parsedRequest.ToString("D");
        if (String.Equals(openedPairRequest, normalizedRequest, StringComparison.OrdinalIgnoreCase)) return;
        openedPairRequest = normalizedRequest;

        Process.Start(new ProcessStartInfo
        {
            FileName = EdgeLocator.Find(),
            Arguments = "\"" + KioskPaths.PairingUrl + Uri.EscapeDataString(normalizedRequest) + "\"",
            UseShellExecute = true
        });
        KioskLog.Write("Opened automatic approval in the existing Edge profile");
    }

    private void ExitApplication()
    {
        if (exiting) return;
        exiting = true;
        timer.Stop();
        if (edgeWindow != IntPtr.Zero && NativeWindow.IsWindow(edgeWindow))
            NativeWindow.Close(edgeWindow);
        controllerForm.CloseForExit();
        KioskLog.Write("Launcher exit completed");
        ExitThread();
    }

    private static Rectangle GetCompactBounds(Rectangle screen)
    {
        const int width = 430;
        const int height = 190;
        return new Rectangle(
            screen.X + Math.Max(0, screen.Width - width - 18),
            screen.Y + Math.Max(0, (screen.Height - height) / 2),
            width,
            height);
    }

    private static Screen SelectTargetScreen()
    {
        Screen[] screens = Screen.AllScreens;
        if (screens.Length == 0) return Screen.PrimaryScreen;
        for (int index = 0; index < screens.Length; index++)
            if (!screens[index].Primary) return screens[index];
        return screens[0];
    }

    protected override void ExitThreadCore()
    {
        if (!exiting) ExitApplication();
        base.ExitThreadCore();
    }

    public new void Dispose()
    {
        if (disposed) return;
        disposed = true;
        timer.Dispose();
        controllerForm.Dispose();
        base.Dispose();
    }
}

internal sealed class KioskControllerForm : Form
{
    private const int WmHotKey = 0x0312;
    private const int HotKeyId = 0x4450;
    private const uint ModNoRepeat = 0x4000;
    private const uint VirtualKeyF8 = 0x77;
    private bool hotKeyRegistered;
    private bool closingForExit;

    internal event Action OpenRequested;
    internal event Action ToggleRequested;
    internal event Action ExitRequested;

    internal KioskControllerForm()
    {
        Text = "전광판 제어";
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        ShowInTaskbar = true;
        TopMost = true;
        BackColor = Color.FromArgb(7, 16, 34);
        ForeColor = Color.White;
        KeyPreview = true;
        MinimumSize = new Size(430, 190);
        BuildInterface();
        KeyDown += delegate(object sender, KeyEventArgs args)
        {
            if (args.KeyCode != Keys.F8) return;
            args.Handled = true;
            if (ToggleRequested != null) ToggleRequested();
        };
    }

    internal void EnsureHandleAndHotKey()
    {
        IntPtr handle = Handle;
        hotKeyRegistered = RegisterHotKey(handle, HotKeyId, ModNoRepeat, VirtualKeyF8);
        KioskLog.Write("Global F8 registered=" + hotKeyRegistered);
    }

    internal void ShowAt(Rectangle bounds)
    {
        Bounds = bounds;
        if (!Visible) Show();
        Bounds = bounds;
        BringToFront();
        Activate();
    }

    internal void HideController()
    {
        if (Visible) Hide();
    }

    internal void CloseForExit()
    {
        closingForExit = true;
        Close();
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmHotKey && message.WParam.ToInt32() == HotKeyId)
        {
            if (ToggleRequested != null) ToggleRequested();
            return;
        }
        base.WndProc(ref message);
    }

    protected override void OnFormClosing(FormClosingEventArgs eventArgs)
    {
        if (!closingForExit)
        {
            eventArgs.Cancel = true;
            if (ExitRequested != null) ExitRequested();
            return;
        }
        base.OnFormClosing(eventArgs);
    }

    protected override void Dispose(bool disposing)
    {
        if (hotKeyRegistered)
        {
            UnregisterHotKey(Handle, HotKeyId);
            hotKeyRegistered = false;
        }
        base.Dispose(disposing);
    }

    private void BuildInterface()
    {
        TableLayoutPanel root = new TableLayoutPanel();
        root.Dock = DockStyle.Fill;
        root.Padding = new Padding(14, 12, 14, 14);
        root.ColumnCount = 1;
        root.RowCount = 3;
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.BackColor = BackColor;

        Label eyebrow = new Label();
        eyebrow.AutoSize = true;
        eyebrow.Text = "공공의료지원과 공유 현황";
        eyebrow.ForeColor = Color.FromArgb(147, 197, 253);
        eyebrow.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
        root.Controls.Add(eyebrow, 0, 0);

        Label guide = new Label();
        guide.AutoSize = true;
        guide.Text = "F8을 누르면 전체화면으로 바로 돌아갑니다.";
        guide.ForeColor = Color.FromArgb(148, 163, 184);
        guide.Font = new Font("맑은 고딕", 8.5f, FontStyle.Regular);
        root.Controls.Add(guide, 0, 1);

        TableLayoutPanel actions = new TableLayoutPanel();
        actions.Dock = DockStyle.Fill;
        actions.ColumnCount = 2;
        actions.RowCount = 1;
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 52));

        Button openButton = new Button();
        openButton.Dock = DockStyle.Fill;
        openButton.Margin = new Padding(0, 2, 8, 0);
        openButton.Text = "▣  전광판 다시 열기   ·   F8";
        openButton.Font = new Font("맑은 고딕", 10.5f, FontStyle.Bold);
        openButton.BackColor = Color.FromArgb(37, 99, 235);
        openButton.ForeColor = Color.White;
        openButton.FlatStyle = FlatStyle.Flat;
        openButton.FlatAppearance.BorderSize = 0;
        openButton.Click += delegate { if (OpenRequested != null) OpenRequested(); };
        actions.Controls.Add(openButton, 0, 0);

        Button exitButton = new Button();
        exitButton.Dock = DockStyle.Fill;
        exitButton.Margin = new Padding(0, 2, 0, 0);
        exitButton.Text = "×";
        exitButton.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
        exitButton.BackColor = Color.FromArgb(30, 41, 59);
        exitButton.ForeColor = Color.FromArgb(203, 213, 225);
        exitButton.FlatStyle = FlatStyle.Flat;
        exitButton.FlatAppearance.BorderSize = 0;
        exitButton.Click += delegate { if (ExitRequested != null) ExitRequested(); };
        actions.Controls.Add(exitButton, 1, 0);

        root.Controls.Add(actions, 0, 2);
        Controls.Add(root);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr window, int id);
}

internal static class EdgeLocator
{
    internal static string Find()
    {
        string[] candidates = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Microsoft\Edge\Application\msedge.exe")
        };
        for (int index = 0; index < candidates.Length; index++)
            if (File.Exists(candidates[index])) return candidates[index];
        throw new FileNotFoundException("Microsoft Edge를 찾지 못했습니다.");
    }
}

internal static class WindowFinder
{
    internal static IntPtr FindDedicatedKioskWindow(string profileDirectory)
    {
        HashSet<uint> processIds = GetDedicatedEdgeProcessIds(profileDirectory);
        if (processIds.Count == 0) return IntPtr.Zero;
        IntPtr visibleMatch = IntPtr.Zero;
        IntPtr hiddenMatch = IntPtr.Zero;
        NativeWindow.EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            if (!NativeWindow.IsWindow(window)) return true;
            if (!processIds.Contains(NativeWindow.GetProcessId(window))) return true;
            if (!String.Equals(NativeWindow.GetClassName(window), "Chrome_WidgetWin_1", StringComparison.Ordinal))
                return true;
            string title = NativeWindow.GetTitle(window);
            if (title.IndexOf("공공의료지원과 전광판", StringComparison.OrdinalIgnoreCase) >= 0 ||
                title.IndexOf("DPHS_KIOSK_COMMAND_", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                if (NativeWindow.IsWindowVisible(window))
                {
                    visibleMatch = window;
                    return false;
                }
                if (hiddenMatch == IntPtr.Zero) hiddenMatch = window;
                return true;
            }
            return true;
        }, IntPtr.Zero);
        if (visibleMatch != IntPtr.Zero) return visibleMatch;
        return hiddenMatch;
    }

    internal static void CloseDedicatedKioskWindow(string profileDirectory)
    {
        IntPtr window = FindDedicatedKioskWindow(profileDirectory);
        if (window != IntPtr.Zero) NativeWindow.Close(window);
    }

    internal static void CloseAllLegacyKioskWindows()
    {
        NativeWindow.EnumWindows(delegate(IntPtr window, IntPtr parameter)
        {
            string title = NativeWindow.GetTitle(window);
            if (String.Equals(title, "공공의료지원과 전광판", StringComparison.OrdinalIgnoreCase) ||
                String.Equals(title, "전광판 제어", StringComparison.OrdinalIgnoreCase) ||
                title.StartsWith("DPHS_KIOSK_COMMAND_", StringComparison.OrdinalIgnoreCase))
                NativeWindow.Close(window);
            return true;
        }, IntPtr.Zero);
    }

    internal static void StopDedicatedEdgeProcesses(string profileDirectory)
    {
        HashSet<uint> processIds = GetDedicatedEdgeProcessIds(profileDirectory);
        foreach (uint processId in processIds)
        {
            try
            {
                using (Process process = Process.GetProcessById((int)processId))
                {
                    process.Kill();
                    process.WaitForExit(1200);
                }
            }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
    }

    private static HashSet<uint> GetDedicatedEdgeProcessIds(string profileDirectory)
    {
        HashSet<uint> result = new HashSet<uint>();
        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedge.exe'"))
            using (ManagementObjectCollection processes = searcher.Get())
            {
                foreach (ManagementObject process in processes)
                {
                    string commandLine = Convert.ToString(process["CommandLine"]);
                    if (commandLine.IndexOf(profileDirectory, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    result.Add(Convert.ToUInt32(process["ProcessId"]));
                }
            }
        }
        catch (ManagementException error)
        {
            KioskLog.Write("Dedicated Edge query failed: " + error.Message);
        }
        return result;
    }
}

internal static class NativeWindow
{
    internal delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    private const int SwHide = 0;
    private const int SwShow = 5;
    private const uint SwpShowWindow = 0x0040;
    private const uint WmClose = 0x0010;
    private static readonly IntPtr HwndTop = IntPtr.Zero;

    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll")]
    internal static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    internal static string GetTitle(IntPtr window)
    {
        StringBuilder title = new StringBuilder(512);
        GetWindowText(window, title, title.Capacity);
        return title.ToString();
    }

    internal static string GetClassName(IntPtr window)
    {
        StringBuilder className = new StringBuilder(128);
        GetClassName(window, className, className.Capacity);
        return className.ToString();
    }

    internal static uint GetProcessId(IntPtr window)
    {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        return processId;
    }

    internal static void Hide(IntPtr window)
    {
        if (IsWindow(window)) ShowWindow(window, SwHide);
    }

    internal static void ShowFullscreenWindow(IntPtr window, Rectangle bounds)
    {
        if (!IsWindow(window)) return;
        ShowWindow(window, SwShow);
        SetWindowPos(window, HwndTop, bounds.X, bounds.Y, bounds.Width, bounds.Height, SwpShowWindow);
        BringWindowToTop(window);
        SetForegroundWindow(window);
    }

    internal static void Close(IntPtr window)
    {
        if (IsWindow(window)) PostMessage(window, WmClose, IntPtr.Zero, IntPtr.Zero);
    }
}

internal static class SelfTest
{
    internal static bool Run()
    {
        return (IntPtr.Size == 4 || IntPtr.Size == 8) &&
               !String.IsNullOrWhiteSpace(KioskPaths.EdgeProfileDirectory) &&
               typeof(Form).Assembly != null &&
               typeof(ManagementObjectSearcher).Assembly != null;
    }
}

internal static class KioskLog
{
    private static readonly object Sync = new object();

    internal static string FilePath
    {
        get { return Path.Combine(KioskPaths.InstallDirectory, "kiosk-launcher.log"); }
    }

    internal static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(KioskPaths.InstallDirectory);
                File.AppendAllText(
                    FilePath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }
}
