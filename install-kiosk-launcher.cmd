@echo off
setlocal
set "DPHS_SETUP=%~dp0release\DPHS-Kiosk-Setup.exe"
if not exist "%DPHS_SETUP%" (
  echo 전광판 설치 파일을 찾지 못했습니다.
  echo 먼저 tools\kiosk-launcher\Build-KioskInstaller.ps1을 실행해 주세요.
  pause
  exit /b 1
)
start "" /wait "%DPHS_SETUP%"
endlocal
