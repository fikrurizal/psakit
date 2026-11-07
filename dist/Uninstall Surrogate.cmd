@echo off
rem Removes the Surrogate add-in for the current Windows user: the registry entry and %LOCALAPPDATA%\Surrogate.
setlocal
title Uninstall Surrogate
set "SG_DIR=%LOCALAPPDATA%\Surrogate"
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; $k = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'; if (Test-Path $k) { Remove-ItemProperty -Path $k -Name '6f1d2c0a-8e57-4b7a-9a3e-2d4c1b7e9f10' -ErrorAction SilentlyContinue }; if (Test-Path -LiteralPath $env:SG_DIR) { Remove-Item -LiteralPath $env:SG_DIR -Recurse -Force }"
if errorlevel 1 (echo Surrogate could not be fully removed. The message above says why.& echo.& pause& exit /b 1)
echo Surrogate has been removed. Close and reopen Excel to finish.
echo.
pause
