@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [RT7] Gateway Diagnostic Scanner
where node >nul 2>nul || (echo [ERROR] Node.js not found.& pause & exit /b 1)
start "" http://127.0.0.1:8090
node server.js
pause
