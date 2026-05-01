
$env:HOME = "C:\Users\Administrator"
$proc = Start-Process -FilePath "C:\Tools\node22\node.exe" `
    -ArgumentList '"C:\Tools\node22\node_modules\openclaw\dist\index.js"', 'gateway', '--port', '18789' `
    -RedirectStandardOutput "C:\Users\administrator\oc_stdout.log" `
    -RedirectStandardError "C:\Users\administrator\oc_stderr.log" `
    -WindowStyle Hidden -PassThru
Write-Host "Started PID: $($proc.Id)"
