# Windows Server Backup — 216.36.112.65

备份时间: 2026-05-01

## 服务器信息

| 项目 | 内容 |
|------|------|
| IP | 216.36.112.65 |
| OS | Windows Server 2022 |
| 用户 | administrator |
| Node.js | v22.22.1 (`C:\\Tools\\node22\\`) |
| Clash | mihomo v1.19.10 (`C:\\clash\\`) |
| NSSM | `C:\\nssm\\nssm-2.24\\win64\\nssm.exe` |

## 目录结构

| 目录 | 内容 |
|------|------|
| `bluai/` | BLUAI 资金费率监控（Telegram 推送） |
| `clash/` | Clash 代理配置（HK 节点，绕过 Binance US 封锁） |
| `openclaw/` | OpenClaw AI 机器人配置 |
| `scripts/` | 各种启动脚本 |
| `tools/` | Chrome CDP / KCEX 交易工具 |

## 迁移到新服务器步骤

### 1. 安装 Node.js v22
下载解压到 `C:\Tools\node22\`

### 2. 安装 OpenClaw
```
C:\Tools\node22\npm.cmd install -g openclaw
```

### 3. 安装 mihomo (Clash Meta)
下载: https://github.com/MetaCubeX/mihomo/releases  
解压到 `C:\clash\`，复制 `clash/config.yaml` 到 `C:\clash\config.yaml`

### 4. 安装 NSSM
下载: https://nssm.cc/release/nssm-2.24.zip  
解压到 `C:\nssm\`

### 5. 注册 Windows 服务（NSSM）
```cmd
set NSSM=C:\nssm\nssm-2.24\win64\nssm.exe

:: Clash 代理服务
%NSSM% install ClashProxy "C:\clash\mihomo-windows-amd64.exe" "-d C:\clash"
%NSSM% set ClashProxy AppDirectory "C:\clash"
%NSSM% set ClashProxy AppStdout "C:\clash\mihomo.log"
%NSSM% set ClashProxy AppStderr "C:\clash\mihomo_err.log"
%NSSM% set ClashProxy AppRestartDelay 3000
%NSSM% set ClashProxy Start SERVICE_AUTO_START
%NSSM% start ClashProxy

:: OpenClaw 机器人服务
%NSSM% install OpenClaw "C:\Tools\node22\node.exe" ""C:\Tools\node22\node_modules\openclaw\dist\index.js" gateway --port 18789"
%NSSM% set OpenClaw AppDirectory "C:\Users\Administrator"
%NSSM% set OpenClaw AppEnvironmentExtra "HOME=C:\Users\Administrator"
%NSSM% set OpenClaw AppStdout "C:\Users\administrator\oc_stdout.log"
%NSSM% set OpenClaw AppStderr "C:\Users\administrator\oc_stderr.log"
%NSSM% set OpenClaw AppRestartDelay 5000
%NSSM% set OpenClaw Start SERVICE_AUTO_START
%NSSM% start OpenClaw
```

### 6. 复制 OpenClaw 配置
```
.openclaw\openclaw.json  →  C:\Users\Administrator\.openclaw\openclaw.json
.openclaw\workspace\*.md  →  C:\Users\Administrator\.openclaw\workspace\
```

### 7. 复制监控脚本
```
bluai\bluai_monitor.js  →  C:\Users\administrator\bluai_monitor.js
bluai\fetch_bluai.js    →  C:\Users\administrator\fetch_bluai.js
```

### 8. 启动 BLUAI 监控
```cmd
schtasks /Create /TN "BLUAI_Monitor" /TR "\"C:\Tools\node22\node.exe\" \"C:\Users\administrator\bluai_monitor.js\"" /SC ONSTART /RU SYSTEM /F
schtasks /Run /TN "BLUAI_Monitor"
```

## 关键信息

- **Telegram Bot Token**: `8320119001:AAG5EgCpxeqRbTf2Lb3-LS3KK9hXeFVxIxE`
- **Telegram Chat ID**: `8018345095`
- **Clash 代理端口**: `127.0.0.1:7890`
- **OpenClaw 网关端口**: `18789`
- **Clash 订阅 URL**: 见 `clash/config.yaml`

## 系统架构

```
Telegram ←→ OpenClaw (port 18789) ←→ MiniMax LLM API
                                   ↓
                         node fetch_bluai.js
                                   ↓
                    Clash proxy 127.0.0.1:7890
                                   ↓
                         HK VPS 节点
                                   ↓
                      fapi.binance.com (BLUAIUSDT)
```
