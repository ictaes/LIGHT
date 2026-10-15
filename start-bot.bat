@echo off
REM Starts the LIGHT bot and the win-log feeder in two windows.
REM Put this file in the territorial-discord-bot folder (next to feeder.js and the build folder).
cd /d "%~dp0"
start "LIGHT bot" cmd /k "cd build && node PointManager.js"
timeout /t 5 /nobreak >nul
start "LIGHT feeder" cmd /k "node feeder.cjs"
