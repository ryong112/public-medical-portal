@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0tools\kiosk-launcher\Install-DphsKioskProtocol.ps1" -ProjectRoot "%~dp0" -Uninstall
if errorlevel 1 pause
endlocal
