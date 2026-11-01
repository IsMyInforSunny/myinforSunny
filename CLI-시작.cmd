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
echo Starting Codex with the factchat provider. This window will stay open after exit.
echo.
if not exist "%APPDATA%\npm\codex.cmd" goto frompath
call "%APPDATA%\npm\codex.cmd" -c model_provider=factchat -m gpt-6.1-sol resume 01a195f9-e6c1-77a2-b5eb-497bebe37e34 -C "%CD%"
goto finished

:frompath
call codex -c model_provider=factchat -m gpt-6.1-sol resume 01a195f9-e6c1-77a2-b5eb-497bebe37e34 -C "%CD%"
goto finished

:finished
set "CLI_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Codex exited with code %CLI_EXIT_CODE%.
echo If startup failed, copy the error above into the chat.
exit /b %CLI_EXIT_CODE%

:failed
echo.
echo Could not open the project directory. Review the error above.
exit /b 1
