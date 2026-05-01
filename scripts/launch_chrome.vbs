Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Program Files\Google\Chrome\Application\chrome.exe"" --remote-debugging-port=9222 --remote-allow-origins=* --no-first-run --no-default-browser-check https://www.kcex.com/zh-TW/futures/exchange/ETH_USDT", 1, False
