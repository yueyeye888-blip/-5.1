@echo off
rem OpenClaw Gateway (v2026.3.11)
set "HOME=C:\Users\Administrator"
set "TMPDIR=C:\Users\Administrator\AppData\Local\Temp"
set "OPENCLAW_GATEWAY_PORT=18789"
set "OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service"
set "OPENCLAW_WINDOWS_TASK_NAME=OpenClaw Gateway"
set "OPENCLAW_SERVICE_MARKER=openclaw"
set "OPENCLAW_SERVICE_KIND=gateway"
set "OPENCLAW_SERVICE_VERSION=2026.3.11"
C:\Tools\node22\node.exe C:\Tools\node22\node_modules\openclaw\dist\index.js gateway --port 18789
