# TRADING.md — How to Execute Trades on KCEX

## ⚠️ MANDATORY RULES

1. **NEVER use built-in `browser` tools** — they always crash on this server. Using them = wrong answer.
2. **ALWAYS use shell execution** to run Node.js commands below.
3. **If a command returns error → report the error, do NOT say "success".**
4. After each trade command, **read the output** and confirm `TRADE SUCCESS` is present.
5. **⛔ NEVER manually fill form fields, click buttons, or interact with the KCEX page yourself.** The `trade` command does ALL of this automatically — checkbox, TP/SL inputs, size input, clicking 開多, confirming dialogs. You must not do any of these steps yourself.
6. **⛔ NEVER compute or enter the "notional" (名义仓位) amount yourself.** The `trade` command auto-calculates: `notional = balance × sizePct% × 100` at 100x leverage. You only pass the `sizePct` (e.g. `25` for 25%).

---

## HOW TO EXECUTE A TRADE (1 shell command — DO NOTHING ELSE)

```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade <direction> <sizePct> <tpPct> <slPct> kcex
```

- `direction`: `long` or `short`
- `sizePct`: percent of available balance to use as margin (e.g. `25` = 25%)
- `tpPct`: take profit % (e.g. `10` = 10%)
- `slPct`: stop loss % (e.g. `10` = 10%)

**This single command handles EVERYTHING automatically:**
- ✅ Reads balance
- ✅ Calculates notional = balance × sizePct% × 100 (100x leverage) — e.g. 25% of 34 USDT = 850 USDT notional
- ✅ Enables TP/SL checkbox
- ✅ Fills TP and SL input fields
- ✅ Fills size input with correct notional amount
- ✅ Clicks 開多/開空
- ✅ Confirms all dialogs

**You must NOT:**
- ❌ Open the browser
- ❌ Click anything on the page yourself
- ❌ Fill in any form fields yourself
- ❌ Calculate or enter the amount yourself (8.46 USDT margin ≠ 846 USDT notional — the command handles this)
- ❌ Call any step individually "let me fill the size field first"

---

## COMMON TRADE EXAMPLES

### 开多 25% 仓位，止盈止损各10%（100x杠杆已设置）：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade long 25 10 10 kcex
```

### 开空 50% 仓位，止盈止损各5%：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade short 50 5 5 kcex
```

### 开空 25% 仓位，止盈8%，止损5%：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade short 25 8 5 kcex
```

---

## SUCCESS INDICATORS

Command output MUST contain:
```
ORDER_CONFIRMED
TRADE SUCCESS: {"direction":"long","amount":11.66,"tp":10,"sl":10}
```

Key checks:
- `ORDER_CONFIRMED` ✅ (order confirm button was clicked)
- `TRADE SUCCESS:` ✅
- No `ERROR:` or `WARNING:` ✅

### ⚠️ HOW TO READ THE PROGRESS LOG (DO NOT MISINTERPRET)

The script prints intermediate logs — read them carefully:

```
balance: 34.88 | amount: 8.72 (25%)    ← balance and calculated size
tpsl: clicked at 644 526               ← checkbox physically clicked
TP: set:10%                            ← TP input set to 10%
SL: set:10%                            ← SL input set to 10% (POSITIVE is correct for KCEX)
focus size: cleared_val:               ← size input found and cleared
values check: {"tp":"10%","sl":"10%","sz":"8.72","cbOn":true}
   ↑ sz = the size amount (NOT null!) ↑ cbOn=true means checkbox is ON
CDP mouse_click 開多 at { x: 704, y: 662 }
[1] ORDER_CONFIRMED
TRADE SUCCESS: {"direction":"long","amount":8.72,"tp":10,"sl":10}
```

**CRITICAL NOTES:**
1. **`sz` in `values check` IS the size** — `sz:"8.72"` means 8.72 USDT was entered. Do NOT call it null.
2. **SL shows positive (e.g. `10%`) — this is CORRECT.** KCEX takes the stop-loss as a positive yield percentage and applies it as a loss limit. Do NOT say it should be `-10%`.
3. **Position closing immediately after open = TP/SL triggered = NORMAL SUCCESS.** At 100x leverage, a 10% TP triggers when ETH moves just 0.1%. If `當前倉位(0)` is seen seconds after `TRADE SUCCESS`, it means the take-profit was hit profitably. The trade DID succeed.
4. **Do NOT report failure if `TRADE SUCCESS:` is in the output.** Check the balance change instead.
5. **`止盈/止損倉位--/--` in the position row is NORMAL — DO NOT treat as failure.** TP/SL are submitted as plan orders (`stopLossPrice`/`takeProfitPrice` in the API request). KCEX shows them as separate plan 委托 orders, not inline on the position row. The `--/--` display is expected. Confirmed working by API intercept: the API call DOES include `stopLossPrice` and `takeProfitPrice` fields.
6. **You may see a second modal warning: `止盈觸發價格距離訂單價格較近，有可能會被立即觸發`** — This is a risk notice that TP price is close (because 10% return at 100x = only 0.1% price movement). The bot automatically clicks 確認 on it. This is normal and expected behavior.
7. **`amount` in `TRADE SUCCESS:` is NOTIONAL position value (100x leverage applied).** For a 5% trade with 31 USDT balance: notional = 31 × 5% × 100 = 155 USDT. This is correct.

---

## IF ORDER FAILS

1. Check if Chrome is running: `schtasks /Query /TN "StartChromeDebug"`
2. Restart Chrome if needed: `schtasks /Run /TN "StartChromeDebug"` then wait 8 seconds
3. Reload KCEX page: `C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js navigate https://www.kcex.com/zh-TW/futures/exchange/ETH_USDT kcex` then wait 5 seconds
4. Retry the trade command

---

## CLOSE POSITION (平仓)

Currently, close position is done manually or by setting TP/SL which triggers automatically.
To check current position:
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "document.body.textContent.match(/\u5f53\u524d\u5009\u4f4d\(.+?\)/)?.[0]" kcex
```


---

## HOW TO EXECUTE A TRADE (2 shell commands)

### Step 1 — Set parameters:
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "window.TRADE_PARAMS={direction:'long',pct:25,tp:10,sl:10}" kcex
```

### Step 2 — Execute (opens position + auto-confirms):
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js js_file C:\Users\Administrator\trade.js kcex
```

---

## PARAMETER REFERENCE

| Param | Type | Example | Meaning |
|-------|------|---------|---------|
| `direction` | string | `'long'` or `'short'` | 开多(看涨) or 开空(看跌) |
| `pct` | number | `25` | 仓位占可用余额的百分比 |
| `tp` | number | `10` | 止盈收益率 % |
| `sl` | number | `10` | 止损收益率 % |
| `leverage` | number | `100` | 可选，设置杠杆倍数 |
| `closeAll` | boolean | `true` | 一键平仓 |

---

## COMMON TRADE EXAMPLES

### 开多 25% 仓位，100x杠杆，止盈止损各10%：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "window.TRADE_PARAMS={direction:'long',pct:25,tp:10,sl:10,leverage:100}" kcex
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js js_file C:\Users\Administrator\trade.js kcex
```

### 开空 50% 仓位，5% 止盈止损：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "window.TRADE_PARAMS={direction:'short',pct:50,tp:5,sl:5}" kcex
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js js_file C:\Users\Administrator\trade.js kcex
```

### 一键平仓：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "window.TRADE_PARAMS={closeAll:true}" kcex
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js js_file C:\Users\Administrator\trade.js kcex
```

### 查看当前仓位/余额：
```
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js js_file C:\Users\Administrator\inspect_tpsl.js kcex
```

---

## SUCCESS INDICATORS

After running trade.js, output should show:
```json
{
  "done": true,
  "direction": "long",
  "amount": 11.74,
  "log": ["...", "confirm clicked: 確 認"]
}
```

Key checks:
- `"done": true` ✅
- `log` contains `"confirm clicked"` ✅
- No `"error"` field ✅

If Chrome is not running, start it first:
```
schtasks /Run /TN "StartChromeDebug"
```
Wait 8 seconds, then retry.
