@echo off
set "HOME=C:\Users\Administrator"
start /B "openclaw" "C:\Tools\node22\node.exe" "C:\Tools\node22\node_modules\openclaw\dist\index.js" gateway --port 18789 > C:\Users\Administrator\oc_stdout.log 2> C:\Users\Administrator\oc_stderr.log
