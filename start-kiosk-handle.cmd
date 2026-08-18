@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0tools\kiosk-handle\Start-KioskHandle.ps1"
if errorlevel 1 pause
endlocal
