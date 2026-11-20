@echo off
title Wedding Seating Planner
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing packages, please wait...
  call npm.cmd install
)
echo Starting... your browser will open by itself. Keep this window open while you use the app.
call npm.cmd run dev -- --open
pause
