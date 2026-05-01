
const fs = require('fs');
const cp = require('child_process');
const net = require('net');
const tls = require('tls');

// 1. 复制配置
fs.copyFileSync('C:\\Users\\Administrator\\clash_config.yaml', 'C:\\clash\\config.yaml');
console.log('[1] config.yaml 已复制');

// 2. 杀掉旧 mihomo 进程
try {
  cp.execSync('taskkill /F /IM mihomo-windows-amd64.exe 2>nul', {stdio: 'ignore'});
} catch(e) {}

// 3. 启动 Clash
const child = cp.spawn('C:\\clash\\mihomo-windows-amd64.exe', ['-d', 'C:\\clash'], {
  detached: true,
  stdio: ['ignore', fs.openSync('C:\\clash\\mihomo.log', 'a'), fs.openSync('C:\\clash\\mihomo.log', 'a')]
});
child.unref();
console.log('[2] Clash 已启动 PID:', child.pid);

// 4. 等待 5 秒让 Clash 初始化
setTimeout(() => {
  console.log('[3] 测试代理连接...');
  
  const sock = net.connect(7890, '127.0.0.1');
  sock.setTimeout(12000);
  
  sock.on('connect', () => {
    sock.write('CONNECT fapi.binance.com:443 HTTP/1.1\r\nHost: fapi.binance.com:443\r\n\r\n');
    
    sock.once('data', d => {
      const resp = d.toString();
      if (resp.includes('200')) {
        console.log('[4] CONNECT 成功，建立 TLS...');
        const tl = tls.connect({socket: sock, servername: 'fapi.binance.com'}, () => {
          tl.write('GET /fapi/v1/premiumIndex?symbol=BLUAIUSDT HTTP/1.1\r\nHost: fapi.binance.com\r\nConnection: close\r\n\r\n');
        });
        let body = '';
        tl.on('data', c => body += c);
        tl.on('end', () => {
          const json_part = body.split('\r\n\r\n').slice(1).join('');
          console.log('[5] Binance 数据:', json_part.slice(0, 300));
          process.exit(0);
        });
        tl.on('error', e => { console.log('TLS ERR:', e.message); process.exit(1); });
      } else {
        console.log('CONNECT 返回:', resp.slice(0, 200));
        // 读 clash 日志
        try {
          const log = fs.readFileSync('C:\\clash\\mihomo.log', 'utf8');
          console.log('Clash日志:', log.slice(-500));
        } catch(e) {}
        process.exit(1);
      }
    });
  });
  
  sock.on('error', e => {
    console.log('连接失败:', e.message);
    try {
      const log = fs.readFileSync('C:\\clash\\mihomo.log', 'utf8');
      console.log('Clash日志末尾:', log.slice(-800));
    } catch(ex) {}
    process.exit(1);
  });
  
  sock.on('timeout', () => {
    console.log('超时');
    process.exit(1);
  });
  
}, 5000);
