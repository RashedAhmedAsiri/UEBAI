@echo off
rem Double-click to share UEBAI from this computer with a public link anyone can open.
rem Close the window to stop sharing.
title UEBAI - online
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\share-online.ps1"
echo.
pause
