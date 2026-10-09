@echo off
title RetouchPDF
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Setting up for the first time, this takes a minute...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Starting RetouchPDF. Your browser will open in a moment.
echo Keep this window open while you use the editor. Close it to stop.
echo.
call npm run dev -- --open
pause
