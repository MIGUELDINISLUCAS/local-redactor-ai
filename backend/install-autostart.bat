@echo off
REM Install "start the backend automatically at login" (Windows).
REM Double-click this once, after you've run setup.bat at least once.
setlocal
set "DIR=%~dp0"
schtasks /Create /TN "LocalRedactorBackend" /TR "\"%DIR%setup.bat\"" /SC ONLOGON /RL LIMITED /F
if %errorlevel%==0 (
  echo.
  echo Auto-start installed. The backend will start when you log in.
  echo To remove it later, run:  schtasks /Delete /TN "LocalRedactorBackend" /F
) else (
  echo Could not create the scheduled task.
)
pause
