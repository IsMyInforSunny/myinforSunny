@echo off
setlocal
cd /d "%~dp0."
node scripts\codex-routing.mjs status
echo.
echo Open the BAZE usage page and enter MONTHLY credits only.
echo Leave used credits blank to exit. Do not enter an API key.
start "" "https://app.baze.co/dashboard/account/my-page?tab=usage"
set "BAZE_USED="
set "BAZE_LIMIT="
set "BAZE_RENEWAL="
set /p "BAZE_USED=Monthly used credits: "
if not defined BAZE_USED exit /b 0
set /p "BAZE_LIMIT=Monthly credit limit: "
set /p "BAZE_RENEWAL=Next renewal date (YYYY-MM-DD): "
powershell.exe -NoProfile -Command "& node scripts/codex-routing.mjs record --used $env:BAZE_USED --limit $env:BAZE_LIMIT --renewal $env:BAZE_RENEWAL; exit $LASTEXITCODE"
set "ROUTING_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %ROUTING_EXIT_CODE%
