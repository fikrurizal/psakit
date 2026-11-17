@echo off
rem Removes the PSAkit add-in for the current Windows user: the registry entry and %LOCALAPPDATA%\PSAkit.
setlocal
title Uninstall PSAkit
set "SG_DIR=%LOCALAPPDATA%\PSAkit"
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $k = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'; if (Test-Path $k) { Remove-ItemProperty -Path $k -Name 'ad7d50a6-816f-46d6-bab6-61700550e82b' -ErrorAction SilentlyContinue }; if (Test-Path -LiteralPath $env:SG_DIR) { Remove-Item -LiteralPath $env:SG_DIR -Recurse -Force }"
if errorlevel 1 (echo PSAkit could not be fully removed. The message above says why.& echo.& pause& exit /b 1)
echo PSAkit has been removed. Close and reopen Excel to finish.
echo.
pause
