@echo off
if /i "%~1"=="--run" goto run
"%ComSpec%" /d /k ""%~f0" --run"
exit /b

:run
setlocal
title Digital Saessak - Codex CLI
cd /d "%~dp0."
if errorlevel 1 goto failed
echo Project: "%CD%"
echo Selecting BAZE or ChatGPT using the local credit guard.
echo This window will stay open after exit.
echo.
node "%~dp0scripts\codex-routing.mjs" start
set "CLI_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Codex exited with code %CLI_EXIT_CODE%.
echo If startup failed, copy the error above into the chat.
exit /b %CLI_EXIT_CODE%

:failed
echo Could not open the project directory.
exit /b 1