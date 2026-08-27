@echo off
REM ---------------------------------------------------------------------------
REM  myDEH launcher
REM
REM  Double-click for a menu, or pass a command straight through:
REM      mydei.bat login
REM      mydei.bat fetch
REM      mydei.bat serve
REM      mydei.bat export
REM      mydei.bat status
REM      mydei.bat discover
REM
REM  Runs directly on Windows — no WSL or Docker involved.
REM ---------------------------------------------------------------------------

setlocal EnableDelayedExpansion

REM Work from the script's own folder, whatever the caller's directory is.
cd /d "%~dp0"

REM Respect an already-set PORT so a busy 4800 can be worked around with
REM     set PORT=4801 && mydei.bat serve
if "%PORT%"=="" set PORT=4800

REM --- Node present? -------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo   Install it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

REM --- Dependencies installed? --------------------------------------------
if not exist "node_modules\playwright-core" (
    echo.
    echo   First run - installing dependencies...
    echo.
    REM "call" matters: npm is a .cmd, and without it this batch file would
    REM hand over control and never return to the menu.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   npm install failed.
        echo.
        pause
        exit /b 1
    )
)

REM --- Straight passthrough when given an argument ------------------------
if not "%~1"=="" (
    if /i "%~1"=="serve" goto :serve
    node cli.js %*
    exit /b %errorlevel%
)

REM --- Menu ---------------------------------------------------------------
:menu
cls
echo.
echo   ============================================
echo             myDEH  -  DEI bills
echo   ============================================
echo.
echo     1.  Dashboard          (open in browser)
echo     2.  Fetch bills        (update from myDEH)
echo     3.  Sign in            (needed first, and when the session expires)
echo     4.  Export CSV         (for Excel)
echo     5.  Status             (quick summary here)
echo     6.  Discover           (map the portal, for troubleshooting)
echo.
echo     0.  Exit
echo.
set "choice="
set /p "choice=  Choose: "

if "%choice%"=="1" goto :serve
if "%choice%"=="2" goto :fetch
if "%choice%"=="3" goto :login
if "%choice%"=="4" goto :export
if "%choice%"=="5" goto :status
if "%choice%"=="6" goto :discover
if "%choice%"=="0" exit /b 0
goto :menu

REM --- Actions ------------------------------------------------------------

:login
echo.
echo   A browser window will open. Sign in there as usual.
echo   Your password is never read or stored by this tool.
echo.
node cli.js login
echo.
pause
goto :menu

:fetch
echo.
node cli.js fetch
echo.
echo   ------------------------------------------------
set "open="
set /p "open=  Open the dashboard now? [Y/n] "
if /i "!open!"=="n" goto :menu
goto :serve

:export
echo.
node cli.js export
if exist "data\export" (
    echo.
    set "opendir="
    set /p "opendir=  Open the export folder? [Y/n] "
    if /i not "!opendir!"=="n" start "" "data\export"
)
echo.
pause
goto :menu

:status
echo.
node cli.js status
echo.
pause
goto :menu

:discover
echo.
echo   Crawls the signed-in portal and writes data\discovery.json.
echo   That file holds page structure, not your bill amounts.
echo.
node cli.js discover
echo.
pause
goto :menu

:serve
echo.
echo   Dashboard:  http://localhost:%PORT%
echo   Press Ctrl+C in this window to stop it.
echo.
REM Open the browser a couple of seconds later, once the server is listening,
REM while the server itself stays in the foreground so Ctrl+C reaches it.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:%PORT%"
node cli.js serve
echo.
echo   Server stopped.
echo.
if "%~1"=="" (
    pause
    goto :menu
)
exit /b 0
