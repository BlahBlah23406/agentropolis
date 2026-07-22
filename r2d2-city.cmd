@echo off
rem Agentropolis: R2-D2 Edition — live OpenClaw city view (port 8347)
rem Read-only against OpenClaw state; safe to restart anytime.
set "HOME=C:\Users\shaya"
"C:\Program Files\nodejs\node.exe" "C:\Users\shaya\.openclaw\agentropolis-r2d2\server.js" >> "C:\Users\shaya\.openclaw\agentropolis-r2d2\server.log" 2>&1
