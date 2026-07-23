@echo off
REM Double-clickable launcher for Windows. Runs setup.ps1 (bypassing the
REM PowerShell execution-policy prompt) from this folder.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
