@echo off
setlocal
if not exist "%~dp0Start-WoWCompanion.ps1" (
    echo Companion launcher was not found beside this file.
    exit /b 1
)
if not exist "%~dp0logs" mkdir "%~dp0logs"
:select_log
set "LAUNCHER_LOG=%~dp0logs\launcher-%RANDOM%-%RANDOM%.log"
if exist "%LAUNCHER_LOG%" goto select_log
type nul >"%LAUNCHER_LOG%" || exit /b 1
>"%~dp0logs\latest-launcher-log.txt" echo %LAUNCHER_LOG%
powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0Start-WoWCompanion.ps1" %* >>"%LAUNCHER_LOG%" 2>&1
exit /b %errorlevel%
