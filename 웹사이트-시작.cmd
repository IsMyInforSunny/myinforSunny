@echo off
if /i "%~1"=="--run" goto run
"%ComSpec%" /d /k ""%~f0" --run"
exit /b
:run
setlocal
title inforcast - Local Website
cd /d "%~dp0."
if errorlevel 1 exit /b 1
if not exist "node_modules\vinext\dist\cli.js" goto missing
echo Local website: http://127.0.0.1:5173/
echo Keep this window open. Press Ctrl+C to stop the website.
echo Demo mode is configured in .dev.vars. No API key is required.
echo.
call npm.cmd run dev:local
set "SITE_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Website exited with code %SITE_EXIT_CODE%.
exit /b %SITE_EXIT_CODE%
:missing
echo Dependencies are not installed. Run the environment installer CMD file first.
exit /b 1
