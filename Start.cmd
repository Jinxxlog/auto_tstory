@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.20 or newer 22.x first.
  pause
  exit /b 1
)
node scripts\launcher.mjs start --open
if errorlevel 1 (
  echo Run Doctor.cmd to check the environment.
  pause
  exit /b 1
)
