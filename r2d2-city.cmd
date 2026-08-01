@echo off
REM Agentropolis city server launcher
REM Set AGENTROPOLIS_HOME to your config directory (default: %USERPROFILE%\.agentropolis).
REM An already-exported value wins, so an existing deployment can point this
REM at whatever directory holds its departments.json and logs.
if not defined AGENTROPOLIS_HOME set "AGENTROPOLIS_HOME=%USERPROFILE%\.agentropolis"
"%PROGRAMFILES%\nodejs\node.exe" "%~dp0server.js" >> "%~dp0server.log" 2>&1