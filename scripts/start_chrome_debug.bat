@echo off
cd /d "C:\Program Files\Google\Chrome\Application"
start chrome.exe --remote-debugging-port=9222 --remote-allow-origins=* --no-first-run --no-default-browser-check --user-data-dir="C:\Users\Administrator\chrome_debug_profile" https://www.kcex.com/zh-TW/futures/exchange/ETH_USDT
