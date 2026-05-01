
const net = require('net');
const tls = require('tls');
function test() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(7890, '127.0.0.1');
    sock.setTimeout(8000);
    sock.once('connect', () => {
      sock.write('CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\n\r\n');
      let buf = '';
      sock.on('data', d => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n')) {
          if (buf.includes('200')) {
            const s = tls.connect({ socket: sock, servername: 'fapi.binance.com', rejectUnauthorized: false });
            s.once('secureConnect', () => {
              s.write('GET /fapi/v1/premiumIndex?symbol=BLUAIUSDT HTTP/1.1\r\nHost: fapi.binance.com\r\nConnection: close\r\n\r\n');
            });
            let tlsBuf = '';
            s.on('data', c => tlsBuf += c.toString());
            s.on('end', () => {
              const m = tlsBuf.match(/\{[\s\S]*\}/);
              if (m) { try { resolve(JSON.parse(m[0])); } catch(e) { reject('JSON err: '+e.message+' raw='+tlsBuf.slice(0,200)); } }
              else { reject('no JSON, raw='+tlsBuf.slice(0,300)); }
            });
            s.on('error', e => reject('tls err: '+e.message));
          } else {
            reject('CONNECT failed: '+buf.slice(0,100));
          }
          sock.removeAllListeners('data');
        }
      });
    });
    sock.on('error', e => reject('sock err: '+e.message));
    sock.on('timeout', () => reject('timeout'));
  });
}
test().then(d => console.log('SUCCESS:', JSON.stringify(d))).catch(e => console.log('FAIL:', e));
