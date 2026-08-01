@echo off
REM Agentropolis city server launcher
REM Set AGENTROPOLIS_HOME to your config directory (default: %USERPROFILE%\.agentropolis)
set "AGENTROPOLIS_HOME=%USERPROFILE%\.agentropolis"
"%PROGRAMFILES%\nodejs\node.exe" "%~dp0server.js" >> "%~dp0server.log" 2>&1