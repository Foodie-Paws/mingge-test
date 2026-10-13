@echo off
chcp 65001 >nul
title 命格体质测评网站
cd /d "%~dp0%"
"C:\Users\lenovo\.local\share\TeleAgent\runtimes\python\python.exe" "%~dp0app.py"
pause
