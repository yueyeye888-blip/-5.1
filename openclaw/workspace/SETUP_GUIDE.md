# KCEX 自动化交易系统 — 完整部署与使用说明

> 备份地址：https://github.com/yueyeye888-blip/KCEX-  
> 整理日期：2026-03-17  
> 适用平台：Windows Server 2022 + OpenClaw AI Agent

---

## 一、系统架构概览

```
用户 (自然语言指令)
    ↓
OpenClaw AI Agent (运行在 Windows Server)
    ↓ 调用 shell 执行
cdp_helper.js (Node.js 脚本)
    ↓ Chrome DevTools Protocol (CDP) over WebSocket
Chrome 浏览器 (端口 9222，远程调试模式)
    ↓ 操作页面
KCEX 期货交易页面 (ETH/USDT 永续，100x 杠杆)
    ↓ HTTPS API
KCEX 服务器 (下单、止盈、止损)
```

**核心设计原则：** AI Agent 不使用浏览器内置工具，只通过 shell 执行 Node.js 脚本，脚本通过 CDP WebSocket 控制 Chrome，实现全自动化下单。

---

## 二、服务器基础信息

| 项目 | 值 |
|---|---|
| 服务器 IP | 216.36.112.65 |
| 操作系统 | Windows Server 2022 |
| 账户 | Administrator |
| 密码 | Yry20021002 |
| 连接方式 | SSH（端口 22）或 RDP |
| Node.js 路径 | `C:\Tools\node22\node.exe` |
| 主脚本路径 | `C:\Users\Administrator\cdp_helper.js` |
| OpenClaw 工作区 | `C:\Users\Administrator\.openclaw\workspace\` |

---

## 三、需要安装的软件环境

### 3.1 Node.js 22（必须）

```powershell
# 下载 Node.js 22 Windows x64 二进制包（无需安装器）
# 目标路径：C:\Tools\node22\node.exe

# 验证
C:\Tools\node22\node.exe --version
# 应输出 v22.x.x
```

**关键原因：**
- `cdp_helper.js` 使用 Node 22 内置的 `fetch` API 和 `WebSocket` API
- 无需 npm 安装任何依赖，零依赖设计
- Node 18 或更低版本不支持内置 WebSocket，会报错

### 3.2 Chrome / Chromium（必须）

Chrome 需要以**远程调试模式**启动，固定端口 9222：

```powershell
# 启动命令（保存为计划任务）
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-background-networking ^
  --user-data-dir="C:\ChromeDebugProfile"
```

**设置为 Windows 计划任务（开机自启）：**

```powershell
# 创建计划任务 StartChromeDebug
schtasks /Create /TN "StartChromeDebug" /TR "\"C:\Program Files\Google\Chrome\Application\chrome.exe\" --remote-debugging-port=9222 --user-data-dir=C:\ChromeDebugProfile" /SC ONLOGON /RU Administrator /F

# 手动触发
schtasks /Run /TN "StartChromeDebug"

# 查询状态
schtasks /Query /TN "StartChromeDebug"
```

**验证 Chrome 调试端口是否正常：**
```powershell
# 在服务器上运行，应返回 JSON 列表
curl http://127.0.0.1:9222/json
```

**⚠️ 重要：Chrome 崩溃后恢复流程**
```powershell
# 1. 重启 Chrome
schtasks /Run /TN "StartChromeDebug"

# 2. 等待 8-10 秒让 Chrome 完全启动

# 3. 导航到 KCEX 页面
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js navigate https://www.kcex.com/zh-TW/futures/exchange/ETH_USDT kcex

# 4. 再等 4 秒让页面加载

# 5. 然后再执行交易命令
```

### 3.3 OpenClaw AI Agent（必须）

OpenClaw 是运行在服务器上的 AI agent 框架，负责理解用户自然语言指令并调用 shell 命令。

```powershell
# 安装（Node.js 已安装的前提下）
npm install -g openclaw

# 配置文件路径
C:\Users\Administrator\openclaw.json

# 启动
openclaw start
```

**openclaw.json 关键配置：**
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "workspace": "C:\\Users\\Administrator\\.openclaw\\workspace",
  "shell": "powershell"
}
```

### 3.4 SSH 服务（推荐）

用于从外部（Mac/Linux）远程执行命令，不依赖 RDP：

```powershell
# Windows Server 2022 启用 OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

---

## 四、核心文件说明

### 4.1 `cdp_helper.js`（服务器端主脚本）

路径：`C:\Users\Administrator\cdp_helper.js`

**功能：** 通过 CDP WebSocket 协议控制 Chrome 浏览器，实现 KCEX 交易自动化。

**支持的命令：**

```powershell
# 查看所有打开的标签页
node cdp_helper.js info

# 在指定页面执行 JavaScript
node cdp_helper.js eval "document.title" kcex

# 鼠标点击（坐标）
node cdp_helper.js mouse_click 704 662 kcex

# 导航到 URL
node cdp_helper.js navigate "https://www.kcex.com/..." kcex

# 截图
node cdp_helper.js screenshot C:\screen.png kcex

# 【核心】执行交易
node cdp_helper.js trade long 25 10 10 kcex
```

**`trade` 命令内部流程（关键逻辑）：**

1. 读取钱包余额（CSS 选择器 `[class*=AssetsItem_num]`）
2. 关闭残留弹窗（确保 getBoundingClientRect 返回正确坐标）
3. 计算名义仓位：`notional = balance × sizePct% × 100`（100x 杠杆）
4. 取消勾选止盈止损 checkbox → 重新勾选（强制 React 重置状态）
5. 填入止盈百分比（`input[placeholder*="止盈"]`）
6. 填入止损百分比（`input[placeholder*="止損"]`）
7. 填入仓位大小（`#kcex_contract_v_open_position input.ant-input:not(.ant-checkbox-input)`）
8. 每个输入触发完整事件序列：`focus → input → change → blur`
9. 等待 600ms 让 React state 提交
10. 验证所有值（`values check: {tp, sl, sz, cbOn}`）
11. CDP 鼠标点击"開多"按钮（通过 getBoundingClientRect 动态获取坐标）
12. 等待"風險提示"确认弹窗 → 点"確認"（下单）
13. 用 × 关闭"止盈触发价格较近"警告弹窗（不点確認，否则重复下单）
14. 输出 `TRADE SUCCESS`

**关键 React 踩坑：**

| 问题 | 原因 | 解决方案 |
|---|---|---|
| 数量不能为空 | 只触发 `input/change`，React state 未提交 | 必须触发 `blur` 事件 |
| 止盈止损被清空 | blur 触发 React re-render 清空 checkbox | 先设 checkbox，再设 TP/SL，最后设 size |
| 重复下单 | "風險提示"弹窗的確認 = 下单，点了 6 次 | cleanup 用 × 关闭，不点確認 |
| 坐标 0,0 | 弹窗遮盖页面 | 下单前先清理所有残留弹窗 |

### 4.2 OpenClaw 工作区文档

路径：`C:\Users\Administrator\.openclaw\workspace\`

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | Agent 行为规范、红线、记忆机制 |
| `TRADING.md` | 交易操作完整说明，**每次交易必读** |
| `TOOLS.md` | 服务器信息、禁止事项、Chrome 管理 |
| `SOUL.md` | AI 人格定义 |
| `USER.md` | 用户偏好设置 |
| `MEMORY.md` | 长期记忆 |
| `memory/YYYY-MM-DD.md` | 每日日志 |

### 4.3 本地辅助脚本（Mac 端）

路径：`/Users/xingxiu/Desktop/Clawd-美国住宅IP/`

| 脚本 | 作用 |
|---|---|
| `ssh_exec.py` | 通过 SSH 在服务器上执行命令并返回输出 |
| `ssh_write_file.py` | 通过 SSH 上传本地文件到服务器 |

```python
# ssh_exec.py 用法
python3 ssh_exec.py "C:\\Tools\\node22\\node.exe C:\\Users\\Administrator\\cdp_helper.js trade long 25 10 10 kcex"

# ssh_write_file.py 用法
python3 ssh_write_file.py "C:\\Users\\Administrator\\cdp_helper.js" cdp_helper.js
```

---

## 五、KCEX 页面关键信息

### 5.1 交易品种

- 交易对：ETH/USDT 永续合约
- 杠杆：100x（固定）
- 数量字段：填写**名义仓位**（USDT），不是保证金
  - 示例：余额 34 USDT，25% 仓位 → 保证金 8.5 USDT → 名义仓位 850 USDT

### 5.2 关键 CSS 选择器

```javascript
// 钱包余额
'[class*=AssetsItem_num]'

// 数量输入框（size）
'#kcex_contract_v_open_position input.ant-input:not(.ant-checkbox-input)'

// 止盈输入框
'input[placeholder*="止盈"]'

// 止损输入框
'input[placeholder*="止損"]'

// 止盈止损 checkbox
'.ant-checkbox-wrapper'  // 含"止盈止損"文本的那个
// checkbox 坐标通常在 (644, 526)

// 開多按钮坐标通常在 (704, 662)
// 注意：坐标会随页面滚动变化，代码动态获取
```

### 5.3 弹窗处理逻辑

```
点击"開多"后 → 弹出「風險提示」弹窗
弹窗内容：
  - 标题：風險提示
  - 正文：止盈觸發價格距離訂單價格較近，有可能會被立即觸發
  - 按钮：取消 / 確認

处理：点"確認" → 订单提交 → KCEX API 收到请求

Order 提交后可能出现第二个相同弹窗（残留）
处理：用 × (ant-modal-close) 关闭，不能再点確認（否则重复下单！）
```

### 5.4 KCEX API 订单结构

下单 API：`POST https://www.kcex.com/fapi/v1/private/order/create`

```json
{
  "symbol": "ETH_USDT",
  "side": 1,
  "openType": 2,
  "type": "5",
  "vol": 415,
  "leverage": 100,
  "marketCeiling": false,
  "bboPriceType": 0,
  "stopLossPrice": "2106.48",
  "takeProfitPrice": "2110.69",
  "lossTrend": "1",
  "profitTrend": "1",
  "priceProtect": "0"
}
```

止盈止损以**绝对价格**发送（不是百分比），由 KCEX 前端根据当前价格和收益率百分比计算后发出。

---

## 六、完整重建步骤（从零开始）

### Step 1：服务器基础环境

```powershell
# 1. 创建工具目录
mkdir C:\Tools

# 2. 下载 Node.js 22（无安装器版）
# 下载 node-v22.x.x-win-x64.zip，解压到 C:\Tools\node22\

# 3. 验证
C:\Tools\node22\node.exe --version

# 4. 确保 SSH 服务启用（用于远程管理）
Get-Service sshd
```

### Step 2：Chrome 调试配置

```powershell
# 1. 安装 Chrome（如未安装）

# 2. 创建调试专用 profile 目录
mkdir C:\ChromeDebugProfile

# 3. 创建计划任务（开机自启 + 手动触发）
schtasks /Create /TN "StartChromeDebug" ^
  /TR "\"C:\Program Files\Google\Chrome\Application\chrome.exe\" --remote-debugging-port=9222 --no-first-run --disable-background-networking --user-data-dir=C:\ChromeDebugProfile" ^
  /SC ONLOGON /RU Administrator /F

# 4. 启动 Chrome
schtasks /Run /TN "StartChromeDebug"
# 等待 10 秒

# 5. 验证（本地浏览器访问）
# http://127.0.0.1:9222/json
# 或
curl http://127.0.0.1:9222/json
```

### Step 3：上传核心脚本

```bash
# 从 Mac 端（或从 GitHub 克隆）上传 cdp_helper.js
python3 ssh_write_file.py "C:\\Users\\Administrator\\cdp_helper.js" cdp_helper.js
```

或从 GitHub 直接下载：
```powershell
# 在服务器上
curl -o C:\Users\Administrator\cdp_helper.js https://raw.githubusercontent.com/yueyeye888-blip/KCEX-/main/cdp_helper.js
```

### Step 4：导航到 KCEX 并登录

```powershell
# 导航并等待登录
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js navigate https://www.kcex.com/zh-TW/futures/exchange/ETH_USDT kcex

# 手动通过 RDP 在 Chrome 中登录账号
# 确认登录后验证余额可读
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js eval "(function(){var els=document.querySelectorAll('[class*=AssetsItem_num]');for(var el of els){var v=parseFloat(el.textContent);if(v>0&&v<100000)return v;}return null;})()" kcex
# 应返回如：34.13
```

### Step 5：安装 OpenClaw

```powershell
# 安装 OpenClaw
C:\Tools\node22\npm.cmd install -g openclaw

# 上传工作区文档
# 将  AGENTS.md / TRADING.md / TOOLS.md / SOUL.md / USER.md
# 上传到 C:\Users\Administrator\.openclaw\workspace\
```

### Step 6：测试交易

```powershell
# 小额测试（3% 仓位）
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade long 3 10 10 kcex

# 预期输出（必须含以下两行）：
# [1] ORDER_CONFIRMED|modal:...
# TRADE SUCCESS: {"direction":"long","amount":102,"tp":10,"sl":10}
```

---

## 七、日常使用方式

### 方式一：直接发命令（推荐）

直接把 shell 命令发给 AI 机器人执行：

```
执行以下命令，把完整输出发给我：
C:\Tools\node22\node.exe C:\Users\Administrator\cdp_helper.js trade long 25 10 10 kcex
```

### 方式二：自然语言（机器人翻译）

告诉机器人：
```
开多 25% 仓位，止盈10%，止损10%
```
机器人会读 TRADING.md 后执行正确命令。

### 命令参数速查

```
trade <方向> <仓位%> <止盈%> <止损%> kcex

方向：long（开多）/ short（开空）
仓位%：占可用余额的百分比（25 = 25%）
止盈%：收益率止盈（10 = 10%，100x 杠杆下价格移动 0.1% 触发）
止损%：收益率止损（10 = 10%）

例：
trade long 25 10 10 kcex   → 做多 25%，止盈10%，止损10%
trade short 50 5 5 kcex    → 做空 50%，止盈5%，止损5%
trade long 10 8 3 kcex     → 做多 10%，止盈8%，止损3%
```

---

## 八、常见报错与处理

| 报错 | 原因 | 处理方法 |
|---|---|---|
| `ERROR: fetch failed` | Chrome 崩溃或未启动 | `schtasks /Run /TN "StartChromeDebug"` 等 10 秒 |
| `No tabs found` | Chrome 未启动或端口错误 | 检查 9222 端口，重启 Chrome |
| `數量不能為空` | React state 未提交（blur 事件缺失）| 已修复，确保使用最新 cdp_helper.js |
| `WARNING: trade may not have completed` | 14 次循环超时（确认弹窗未出现）| 检查页面是否有遮挡弹窗，重试 |
| 重复下单（委托暴增） | cleanup 循环点了多余的確認 | 已修复，cleanup 改用 × 关闭 |
| `ERROR: cannot read balance` | 未登录或页面加载失败 | 检查 KCEX 登录状态，刷新页面 |
| 坐标 0,0 开多无效 | 残留弹窗遮盖了元素 | 已修复，交易前自动清理弹窗 |

---

## 九、维护注意事项

1. **每次修改 `cdp_helper.js` 后**，必须用 `ssh_write_file.py` 上传到服务器覆盖
2. **Chrome 需要保持登录 KCEX**，长时间不用可能会掉线，需要手动重新登录
3. **Chrome 崩溃是常见现象**（内存问题），计划任务设置了重启机制
4. **不要在 Chrome 里开太多标签页**，会加速崩溃
5. **KCEX 的 sizePct 是保证金百分比**，名义仓位由脚本自动 × 100 计算
6. **止盈止损以收益率百分比设置**（不是价格），10% 在 100x 杠杆下 = 价格动 0.1%
7. **`止盈/止損倉位--/--` 是正常显示**，止盈止损以计划委托形式存在，不影响实际功能

---

## 十、文件备份清单

GitHub 备份：https://github.com/yueyeye888-blip/KCEX-

需要保留的核心文件：

```
cdp_helper.js              ← 最重要，全部交易逻辑在此
TRADING.md                 ← AI agent 操作说明
TOOLS.md                   ← 环境和禁止事项说明
AGENTS.md                  ← Agent 行为规范
ssh_exec.py                ← Mac 端远程执行工具
ssh_write_file.py          ← Mac 端文件上传工具
```
