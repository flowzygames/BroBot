@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo BroBot needs Node.js 22.9 or newer. Install an LTS version from https://nodejs.org
  pause
  exit /b 1
)
node scripts\launch.js
set "BROBOT_EXIT=%ERRORLEVEL%"
echo.
echo BroBot has closed. You can close this window.
pause
exit /b %BROBOT_EXIT%
