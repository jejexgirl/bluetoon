@echo off
rem Double-click to run BlueToon on http://localhost:8080 (the dashboard and YouTube playback need the server).
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
if not exist data\auth.json (
  echo First start: choose the dashboard password ^(at least 12 characters, a long phrase is best^).
  set /p INITIAL_PASSWORD=Password: 
)
start "" http://localhost:8080
node server\main.mjs
pause
