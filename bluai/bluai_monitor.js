/**
 * BLUAI Funding Rate Monitor - Node.js Version
 * 监控 BLUAIUSDT 资金费率，通过 Telegram 推送告警
 * 通过本地 Clash 代理（127.0.0.1:7890）获取 Binance 数据
 *
 * 运行方式: node bluai_monitor.js
 * 测试模式: node bluai_monitor.js test
 */

'use strict';

const net = require('net');
const tls = require('tls');

// ========================
// 配置区
// ========================
const CONFIG = {
  TELEGRAM_TOKEN:  '8320119001:AAG5EgCpxeqRbTf2Lb3-LS3KK9hXeFVxIxE',
  CHAT_ID:         '8018345095',
  SYMBOL:          'BLUAIUSDT',

  // 告警触发阈值
  ALERT_NEG_RATE:   -0.0002,    // -0.02% 触发 🚨
  ALERT_SPIKE_RATE:  0.0008,    // +0.08% 触发 ⚡
  ALERT_PRICE_DROP: -0.03,      // -3% 单周期价格跌幅触发 🔴
  ALERT_LOW_ROLL72:  0.00005,   // 72h 均值低于 0.005% 触发 ⚠️

  POLL_INTERVAL_MS:  60000,     // 轮询间隔 60秒
  SETTLE_WAIT_MS:    90000,     // 结算后等待 90秒再推送
  COOLDOWN_MS:      1800000,     // 同类告警冷却 30分钟
  HISTORY_SIZE:          18,     // 保留最近 18 条（72h）

  // 代理配置（Clash）
  PROXY_HOST: '127.0.0.1',
  PROXY_PORT: 7890,
};

// 结算小时（UTC）
const SETTLEMENT_HOURS = [0, 4, 8, 12, 16, 20];

// ========================
// 状态
// ========================
const state = {
  history: [],           // [{rate, price, ts}]
  lastAlertTs: {},       // alertType -> timestamp
  lastSettleChecked: -1, // 上次已处理的结算小时
};

// ========================
// 工具函数
// ========================
function log(msg) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${now}] ${msg}`);
}

function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
  try {
    await httpsPost(url, {
      chat_id: CONFIG.CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
    log(`📤 Telegram 推送成功: ${text.slice(0, 50)}...`);
  } catch (e) {
    log(`❌ Telegram 推送失败: ${e.message}`);
  }
}

function canAlert(type) {
  const now = Date.now();
  if (!state.lastAlertTs[type] || now - state.lastAlertTs[type] > CONFIG.COOLDOWN_MS) {
    state.lastAlertTs[type] = now;
    return true;
  }
  return false;
}

function pct(n) { return (n * 100).toFixed(4) + '%'; }
function fmtPrice(p) { return parseFloat(p).toFixed(6); }

// ========================
// 通过代理获取 Binance 数据
// ========================
function fetchBinanceViaProxy(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(CONFIG.PROXY_PORT, CONFIG.PROXY_HOST);
    sock.setTimeout(15000);

    sock.once('connect', () => {
      sock.write(`CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\n\r\n`);
      let buf = '';
      sock.on('data', d => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n')) {
          sock.removeAllListeners('data');
          if (!buf.includes('200')) {
            reject(new Error('CONNECT failed: ' + buf.slice(0, 100)));
            sock.destroy();
            return;
          }
          const s = tls.connect({ socket: sock, servername: 'fapi.binance.com', rejectUnauthorized: false });
          s.once('secureConnect', () => {
            s.write(`GET ${path} HTTP/1.1\r\nHost: fapi.binance.com\r\nConnection: close\r\n\r\n`);
          });
          let tlsBuf = '';
          s.on('data', c => tlsBuf += c.toString());
          s.on('end', () => {
            const m = tlsBuf.match(/\{[\s\S]*\}/);
            if (m) {
              try { resolve(JSON.parse(m[0])); }
              catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
            } else {
              reject(new Error('No JSON in response: ' + tlsBuf.slice(0, 200)));
            }
          });
          s.on('error', e => reject(new Error('TLS error: ' + e.message)));
        }
      });
    });

    sock.on('error', e => reject(new Error('Socket error: ' + e.message)));
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Connection timeout')); });
  });
}

// ========================
// 数据获取
// ========================
async function fetchFundingRate() {
  const path = `/fapi/v1/premiumIndex?symbol=${CONFIG.SYMBOL}`;
  const data = await fetchBinanceViaProxy(path);
  return {
    rate:  parseFloat(data.lastFundingRate),
    price: parseFloat(data.markPrice),
    ts:    Date.now(),
  };
}

// ========================
// 告警逻辑
// ========================
async function checkAlerts(cur) {
  const { rate, price } = cur;
  const history = state.history;

  if (rate < CONFIG.ALERT_NEG_RATE && canAlert('neg_rate')) {
    await sendTelegram(
      `🚨 <b>BLUAI 负资金费率告警</b>\n` +
      `费率: <b>${pct(rate)}</b>\n` +
      `标记价: ${fmtPrice(price)} USDT\n` +
      `⚠️ 多头需支付空头，留意价格压力`
    );
  }

  if (rate > CONFIG.ALERT_SPIKE_RATE && canAlert('spike_rate')) {
    await sendTelegram(
      `⚡ <b>BLUAI 资金费率飙升</b>\n` +
      `费率: <b>${pct(rate)}</b>\n` +
      `标记价: ${fmtPrice(price)} USDT\n` +
      `💡 极高做多热情，注意回调风险`
    );
  }

  if (history.length >= 6) {
    const avg72 = history.slice(-18).reduce((s, h) => s + h.rate, 0) / Math.min(history.length, 18);
    if (avg72 < CONFIG.ALERT_LOW_ROLL72 && canAlert('low_roll')) {
      await sendTelegram(
        `⚠️ <b>BLUAI 72h 均值费率警告</b>\n` +
        `72h 均值: <b>${pct(avg72)}</b>\n` +
        `当前费率: ${pct(rate)}\n` +
        `📉 做多意愿持续低迷`
      );
    }
  }

  if (history.length >= 1) {
    const prevPrice = history[history.length - 1].price;
    const priceDrop = (price - prevPrice) / prevPrice;
    if (priceDrop < CONFIG.ALERT_PRICE_DROP && canAlert('price_drop')) {
      await sendTelegram(
        `🔴 <b>BLUAI 价格急跌告警</b>\n` +
        `跌幅: <b>${pct(priceDrop)}</b>\n` +
        `价格: ${fmtPrice(prevPrice)} → <b>${fmtPrice(price)}</b> USDT\n` +
        `资金费率: ${pct(rate)}`
      );
    }
  }
}

// ========================
// 结算推送
// ========================
async function sendSettlementReport(cur) {
  const { rate, price } = cur;
  const history = state.history;

  let avgStr = 'N/A';
  if (history.length > 0) {
    const avg = history.slice(-6).reduce((s, h) => s + h.rate, 0) / Math.min(history.length, 6);
    avgStr = pct(avg);
  }

  let trend = '→ 持平';
  if (history.length >= 2) {
    const delta = rate - history[history.length - 1].rate;
    trend = delta > 0.0001 ? '↑ 上升' : delta < -0.0001 ? '↓ 下降' : '→ 持平';
  }

  const utcH = new Date().getUTCHours();
  await sendTelegram(
    `📊 <b>BLUAI 资金费率结算报告</b>\n` +
    `时间: UTC ${utcH}:00\n` +
    `━━━━━━━━━━━━━━\n` +
    `💰 本期费率: <b>${pct(rate)}</b>\n` +
    `📈 24h 均值: ${avgStr}\n` +
    `📉 趋势: ${trend}\n` +
    `💵 标记价: ${fmtPrice(price)} USDT\n` +
    `━━━━━━━━━━━━━━\n` +
    (rate < 0 ? '⚠️ 负费率：多头注意\n' : '') +
    (rate > 0.0005 ? '🔥 高费率：做空机会?\n' : '')
  );
}

// ========================
// 主循环
// ========================
async function tick() {
  try {
    const cur = await fetchFundingRate();
    log(`轮询: 费率=${pct(cur.rate)} 价格=${fmtPrice(cur.price)}`);

    state.history.push(cur);
    if (state.history.length > CONFIG.HISTORY_SIZE) state.history.shift();

    const utcH = new Date().getUTCHours();
    const utcMin = new Date().getUTCMinutes();
    if (SETTLEMENT_HOURS.includes(utcH) && utcMin < 2 && state.lastSettleChecked !== utcH) {
      state.lastSettleChecked = utcH;
      log(`结算时刻 UTC ${utcH}:00，等待 ${CONFIG.SETTLE_WAIT_MS / 1000}s 后推送`);
      setTimeout(async () => {
        try {
          const fresh = await fetchFundingRate();
          await sendSettlementReport(fresh);
        } catch (e) { log(`结算报告失败: ${e.message}`); }
      }, CONFIG.SETTLE_WAIT_MS);
    }

    await checkAlerts(cur);
  } catch (e) { log(`轮询错误: ${e.message}`); }
}

// ========================
// 启动
// ========================
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'test') {
    log('=== 测试模式 ===');
    log(`代理: ${CONFIG.PROXY_HOST}:${CONFIG.PROXY_PORT}`);
    log(`交易对: ${CONFIG.SYMBOL}`);
    try {
      const cur = await fetchFundingRate();
      log(`API 连接成功: 费率=${pct(cur.rate)} 价格=${fmtPrice(cur.price)}`);
      await sendTelegram(
        `🤖 BLUAI 监控启动测试\n` +
        `费率=${pct(cur.rate)}\n` +
        `价格=${fmtPrice(cur.price)} USDT`
      );
      log('Telegram 推送测试完成');
    } catch (e) {
      log(`测试失败: ${e.message}`);
    }
    return;
  }

  log('=== BLUAI 资金费率监控启动 ===');
  log(`代理: ${CONFIG.PROXY_HOST}:${CONFIG.PROXY_PORT}`);
  log(`交易对: ${CONFIG.SYMBOL}`);
  log(`轮询间隔: ${CONFIG.POLL_INTERVAL_MS / 1000}s`);
  log(`告警阈值: 负费率=${pct(CONFIG.ALERT_NEG_RATE)} 飙升=${pct(CONFIG.ALERT_SPIKE_RATE)}`);

  await sendTelegram(
    `🚀 <b>BLUAI 监控已启动</b>\n` +
    `监控: ${CONFIG.SYMBOL}\n` +
    `轮询: 每 ${CONFIG.POLL_INTERVAL_MS / 1000} 秒\n` +
    `结算时间: 每 4 小时(UTC 0/4/8/12/16/20)\n` +
    `数据源: Binance (via Clash)`
  );

  await tick();
  setInterval(tick, CONFIG.POLL_INTERVAL_MS);
}

main().catch(e => {
  log(`启动失败: ${e.message}`);
  process.exit(1);
});
