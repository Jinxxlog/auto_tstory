@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.20 or newer 22.x first, then reopen this file.
  pause
  exit /b 1
)
node scripts\setup.mjs
if errorlevel 1 (
  echo Installation failed. Your drafts have not been removed.
  pause
  exit /b 1
)
pause
