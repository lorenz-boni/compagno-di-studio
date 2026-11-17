@echo off
title JARVIS - Compagno di studio
rem Avvia JARVIS su questo computer (doppio clic). Lascia aperta la finestra mentre studi.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0avvio\server.ps1"
if errorlevel 1 pause
