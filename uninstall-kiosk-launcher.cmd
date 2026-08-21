@echo off
setlocal
set "DPHS_INSTALL_DIR=%LOCALAPPDATA%\DPHSKiosk"
set "DPHS_LAUNCHER=%DPHS_INSTALL_DIR%\DPHS-Kiosk-Launcher.exe"
if exist "%DPHS_LAUNCHER%" (
  start "" /wait "%DPHS_LAUNCHER%" --uninstall
  del /q "%DPHS_LAUNCHER%" 2>nul
  rmdir "%DPHS_INSTALL_DIR%" 2>nul
) else (
  echo 설치된 전광판 실행기가 없습니다.
  pause
)
endlocal
