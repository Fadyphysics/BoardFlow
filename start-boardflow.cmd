@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
    echo BoardFlow requires Node.js and npm. Install Node.js 22 or newer, then try again.
    pause
    exit /b 1
)
call npm start
if errorlevel 1 pause
