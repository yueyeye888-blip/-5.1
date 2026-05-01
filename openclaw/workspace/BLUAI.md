# BLUAI.md — 查询 BLUAI 资金费率

## ⚠️ 重要：服务器 IP 被 Binance 限制（451），直接访问无效

**必须使用本地 Clash 代理脚本** 获取 BLUAI 数据，绝不能直接 fetch Binance API。

---

## 获取 BLUAI 实时数据（唯一正确方式）

```
C:\Tools\node22\node.exe C:\Users\administrator\fetch_bluai.js
```

输出示例：
```json
{
  "symbol": "BLUAIUSDT",
  "markPrice": "0.013849",
  "fundingRate": "0.0555%",
  "lastFundingRate_raw": "0.00055534",
  "nextFundingTime": "2026-05-01T16:00:00.000Z",
  "indexPrice": "0.013827",
  "ok": true
}
```

---

## 规则

- ✅ **永远用 `fetch_bluai.js`** 查询 BLUAI 资金费率和价格
- ❌ **绝对不要** 直接 `fetch('https://fapi.binance.com/...')` — 会返回 451 错误
- ❌ **不要尝试 OKX / Bybit / Gate.io** — BLUAI 只在 Binance 合约市场有资金费率数据
- ❌ **不要用 node -e 内联代码** 直接请求 Binance — 不走代理，同样 451

## 背景

- 服务器位于美国，Binance 屏蔽美国 IP（HTTP 451）
- 本地运行了 Clash 代理（127.0.0.1:7890），通过香港节点访问 Binance
- `fetch_bluai.js` 已配置好通过该代理请求，可正常工作
