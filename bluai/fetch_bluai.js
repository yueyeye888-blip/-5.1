// fetch_bluai.js - 通过本地 Clash 代理获取 BLUAI 资金费率数据
// 用法: node fetch_bluai.js
// 代理: 127.0.0.1:7890 (Clash HK 节点)

const net = require('net');
const tls = require('tls');

function fetchBluai() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(7890, '127.0.0.1');
    sock.setTimeout(10000);

    sock.once('connect', () => {
      sock.write('CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\n\r\n');
      let buf = '';
      sock.on('data', d => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n')) {
          sock.removeAllListeners('data');
          if (!buf.includes('200')) {
            reject('CONNECT failed: ' + buf.slice(0, 100));
            return;
          }
          const s = tls.connect({ socket: sock, servername: 'fapi.binance.com', rejectUnauthorized: false });
          s.once('secureConnect', () => {
            s.write('GET /fapi/v1/premiumIndex?symbol=BLUAIUSDT HTTP/1.1\r\nHost: fapi.binance.com\r\nConnection: close\r\n\r\n');
          });
          let tlsBuf = '';
          s.on('data', c => tlsBuf += c.toString());
          s.on('end', () => {
            const m = tlsBuf.match(/\{[\s\S]*\}/);
            if (m) {
              try {
                const data = JSON.parse(m[0]);
                resolve(data);
              } catch(e) {
                reject('JSON parse error: ' + e.message);
              }
            } else {
              reject('No JSON in response. Raw: ' + tlsBuf.slice(0, 300));
            }
          });
          s.on('error', e => reject('TLS error: ' + e.message));
        }
      });
    });

    sock.on('error', e => reject('Socket error: ' + e.message));
    sock.on('timeout', () => reject('Connection timeout'));
  });
}

fetchBluai().then(data => {
  const rate = (parseFloat(data.lastFundingRate) * 100).toFixed(4);
  const price = parseFloat(data.markPrice).toFixed(6);
  const nextFunding = new Date(data.nextFundingTime);
  
  console.log(JSON.stringify({
    symbol: data.symbol,
    markPrice: price,
    fundingRate: rate + '%',
    lastFundingRate_raw: data.lastFundingRate,
    nextFundingTime: nextFunding.toISOString(),
    indexPrice: data.indexPrice,
    ok: true
  }, null, 2));
}).catch(err => {
  console.error(JSON.stringify({ ok: false, error: err }));
  process.exit(1);
});
