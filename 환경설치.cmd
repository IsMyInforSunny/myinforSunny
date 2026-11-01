@echo off
if /i "%~1"=="--run" goto run
"%ComSpec%" /d /k ""%~f0" --run"
exit /b
:run
setlocal
title inforcast - Local Environment Setup
cd /d "%~dp0."
if errorlevel 1 exit /b 1
echo Installing locked dependencies in this project.
echo Existing source files and .dev.vars are preserved.
call npm.cmd --cache .sites-runtime\npm-cache run install:ci
if errorlevel 1 exit /b 1
call npm.cmd run db:local
if errorlevel 1 exit /b 1
echo.
echo Setup completed. Run the website launcher CMD file to view the site.
exit /b 0
