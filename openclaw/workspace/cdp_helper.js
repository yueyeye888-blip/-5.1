#!/usr/bin/env node
/**
 * cdp_helper.js - Chrome DevTools Protocol controller (Node.js, no extra deps)
 * Uses Node 22 built-in fetch + WebSocket
 *
 * Usage:
 *   node cdp_helper.js info
 *   node cdp_helper.js eval "document.title" [tabKeyword]
 *   node cdp_helper.js click ".css-selector" [tabKeyword]
 *   node cdp_helper.js screenshot output.png [tabKeyword]
 *   node cdp_helper.js navigate "https://url" [tabKeyword]
 *   node cdp_helper.js js_file script.js [tabKeyword]
 */

const CDP_HOST = 'http://127.0.0.1:9222';
const fs = require('fs');
const path = require('path');

async function getTabs() {
  const r = await fetch(`${CDP_HOST}/json`);
  return r.json();
}

async function findTab(keyword) {
  const tabs = await getTabs();
  if (!tabs.length) throw new Error('No tabs found. Is Chrome running with --remote-debugging-port=9222?');
  if (keyword) {
    const kw = keyword.toLowerCase();
    const match = tabs.find(t => (t.url || '').toLowerCase().includes(kw) || (t.title || '').toLowerCase().includes(kw));
    if (match) return match;
  }
  return tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension')) || tabs[0];
}

function wsSendRecv(wsUrl, method, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`Timeout waiting for ${method}`)); }, timeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    };
    ws.onmessage = (evt) => {
      clearTimeout(timer);
      ws.close();
      try { resolve(JSON.parse(evt.data)); } catch(e) { resolve({}); }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`WebSocket error: ${e.message || e}`)); };
    ws.onclose = () => {};
  });
}

async function cmdInfo() {
  const tabs = await getTabs();
  tabs.forEach((t, i) => {
    console.log(`[${i}] ${t.type || '?'} | ${(t.title || '').substring(0,50)} | ${(t.url || '').substring(0,80)}`);
  });
}

async function cmdEval(expression, tabKeyword) {
  const tab = await findTab(tabKeyword);
  if (!tab.webSocketDebuggerUrl) throw new Error('Tab has no webSocketDebuggerUrl');
  const result = await wsSendRecv(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, timeout: 15000
  }, 25000);
  const rv = result?.result?.result;
  const exc = result?.result?.exceptionDetails;
  if (exc) {
    process.stderr.write(`JS ERROR: ${JSON.stringify(exc?.exception?.description || exc)}\n`);
    process.exit(1);
  }
  const val = rv?.value;
  if (val === undefined || val === null) {
    console.log('(undefined/null)');
  } else if (typeof val === 'object') {
    console.log(JSON.stringify(val, null, 2));
  } else {
    console.log(String(val));
  }
}

async function cmdClick(selector, tabKeyword) {
  const js = `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if(!el) return 'Element not found: ${selector.replace(/'/g,"\\'")}';
    el.scrollIntoView({block:'center'});
    el.click();
    return 'clicked: ' + el.tagName + ' ' + (el.textContent||el.value||'').substring(0,60);
  })()`;
  const tab = await findTab(tabKeyword);
  const result = await wsSendRecv(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: js, returnByValue: true, awaitPromise: false
  }, 15000);
  console.log(result?.result?.result?.value || '(no return)');
}

// Full trade execution using real CDP events (works with React controlled inputs)
// direction: long|short, sizePct: 0-100 (%), tpPct: tp%, slPct: sl%
async function cmdTrade(direction, sizePct, tpPct, slPct, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const ws = tab.webSocketDebuggerUrl;
  const ev = (expr) => wsSendRecv(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false }, 10000);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // React controlled input setter
  const setVal = async (selector, value) => {
    const r = await ev(`(function(){
      var el=document.querySelector(${JSON.stringify(selector)});
      if(!el) return 'not found';
      var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      el.focus();
      el.dispatchEvent(new Event('focus',{bubbles:true}));
      ns.call(el,${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,bubbles:true}));
      el.blur();
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return 'set:'+el.value;
    })()`);
    return r?.result?.result?.value;
  };

  // Step 1: Calculate trade amount from balance
  // sizePct = % of balance to use as MARGIN
  // Quantity field in KCEX takes the NOTIONAL position value in USDT (not margin)
  // So: notional = margin * leverage = balance * sizePct% * 100
  const balJs = `(function(){
    var els=document.querySelectorAll('[class*=AssetsItem_num]');
    for(var el of els){var v=parseFloat(el.textContent);if(v>0&&v<100000)return v;}
    return null;
  })()`;
  const balance = (await ev(balJs))?.result?.result?.value;
  if (!balance) { console.error('ERROR: cannot read balance'); process.exit(1); }
  const margin = Math.floor(balance * parseFloat(sizePct) / 100 * 100) / 100;
  const leverage = 100;
  const amount = Math.floor(margin * leverage * 100) / 100;
  console.log('balance:', balance, '| margin:', margin, '| notional:', amount, '(' + sizePct + '% of balance, ' + leverage + 'x)');

  // Step 1b: Pre-trade cleanup — dismiss any leftover modals from previous trades
  // This ensures getBoundingClientRect() returns real coords (not 0,0 when covered by modal)
  await ev(`(function(){
    var wraps=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){return w.style.display!=='none';});
    wraps.forEach(function(w){
      var x=w.querySelector('.ant-modal-close');
      if(x)x.click();
    });
  })()`);
  await wait(300);

  // Step 2: Enable TP/SL checkbox FIRST via CDP physical mouse click
  // Always uncheck→recheck to force React to reset TP/SL field state
  // (when "already on", React has stale state from previous order; must reset)
  const clickCb = async () => {
    const coords = await ev(`(function(){
      var wrapper=[...document.querySelectorAll('.ant-checkbox-wrapper')].find(w=>w.textContent.includes('\u6b62\u76c8\u6b62\u640d'));
      if(!wrapper) return null;
      var span=wrapper.querySelector('.ant-checkbox-inner')||wrapper.querySelector('.ant-checkbox')||wrapper;
      var rect=span.getBoundingClientRect();
      return JSON.stringify({x:Math.round(rect.left+rect.width/2), y:Math.round(rect.top+rect.height/2)});
    })()`);
    const pos = JSON.parse(coords?.result?.result?.value || 'null');
    if (!pos) return false;
    const mc = { x: pos.x, y: pos.y, button: 'left', clickCount: 1, modifiers: 0 };
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mousePressed' }, 5000);
    await wait(80);
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mouseReleased' }, 5000);
    return pos;
  };
  // Check current state
  const cbState = (await ev(`(function(){
    var w=[...document.querySelectorAll('.ant-checkbox-wrapper')].find(w=>w.textContent.includes('\u6b62\u76c8\u6b62\u640d'));
    return w?w.querySelector('input[type="checkbox"]')?.checked:null;
  })()`))?.result?.result?.value;
  if (cbState === true) {
    // Already on: uncheck first to reset React state
    const p1 = await clickCb();
    console.log('tpsl: unchecked at', p1?.x, p1?.y);
    await wait(500);
  }
  // Now check it (fresh state)
  const p2 = await clickCb();
  console.log('tpsl: checked at', p2?.x, p2?.y);
  await wait(800);

  // Step 3: Set TP (positive percentage, e.g. 10 = 10% profit target)
  const tpR = await setVal('input[placeholder*="\u6b62\u76c8"]', tpPct);
  console.log('TP:', tpR);
  if (!tpR || tpR === 'not found') {
    await wait(600);
    const tpR2 = await setVal('input[placeholder*="\u6b62\u76c8"]', tpPct);
    console.log('TP retry:', tpR2);
  }
  await wait(300);

  // Step 4: Set SL (negative percentage, e.g. -10 = 10% loss limit)
  const slVal = String(slPct).startsWith('-') ? slPct : -Math.abs(slPct);
  const slR = await setVal('input[placeholder*="\u6b62\u640d"]', slVal);
  console.log('SL:', slR);
  if (!slR || slR === 'not found') {
    await wait(600);
    const slR2 = await setVal('input[placeholder*="\u6b62\u640d"]', slVal);
    console.log('SL retry:', slR2);
  }
  await wait(300);

  // Step 5: Set size LAST — after checkbox/TP/SL so React re-renders won't clear it
  // Use setVal (native setter + dispatchEvent) same as TP/SL — more reliable than insertText
  const MAIN_SIZE = '#kcex_contract_v_open_position input.ant-input:not(.ant-checkbox-input)';
  const szR = await setVal(MAIN_SIZE, amount);
  console.log('size:', szR);
  if (!szR || szR === 'not found') {
    await wait(400);
    const szR2 = await setVal(MAIN_SIZE, amount);
    console.log('size retry:', szR2);
  }
  await wait(600);  // extra wait after blur so React commits size to internal state

  // Step 6: Verify all values before submitting
  const check = (await ev(`(function(){
    var tp=document.querySelector('input[placeholder*="\u6b62\u76c8"]')?.value;
    var sl=document.querySelector('input[placeholder*="\u6b62\u640d"]')?.value;
    var sz=document.querySelector('#kcex_contract_v_open_position input.ant-input:not(.ant-checkbox-input)')?.value;
    var cbOn=([...document.querySelectorAll('.ant-checkbox-wrapper')].find(w=>w.textContent.includes('\u6b62\u76c8\u6b62\u640d'))?.querySelector('input[type="checkbox"]')?.checked)||false;
    return JSON.stringify({tp,sl,sz,cbOn});
  })()`))?.result?.result?.value;
  console.log('values check:', check);

  // Step 7: Click 開多 or 開空 via real CDP mouse events + JS fallback
  const btnLabel = direction === 'short' ? '開空' : '開多';
  const btnCoords = await ev(`(function(){
    var btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes('${btnLabel}'));
    if(!btn) return null;
    var r=btn.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
  })()`);
  const coords = JSON.parse(btnCoords?.result?.result?.value || 'null');
  if (coords) {
    const mc = { x: coords.x, y: coords.y, button: 'left', clickCount: 1, modifiers: 0 };
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mousePressed' }, 5000);
    await wait(50);
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mouseReleased' }, 5000);
    console.log('CDP mouse_click 開多 at', coords);
  } else {
    // fallback to JS click
    await ev(`(function(){var btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes('${btnLabel}'));btn&&btn.click();})()`);
    console.log('JS click fallback:', btnLabel);
  }

  // Step 8: Wait for confirm → dump modal content → click it; auto-dismiss guidance modal
  for (let i = 0; i < 14; i++) {
    await wait(500);
    const status = (await ev(`(function(){
      var btns=[...document.querySelectorAll('button')];
      var btnTexts=${i < 3 ? `btns.map(b=>b.textContent.trim().slice(0,20)).filter(t=>t).join('|')` : `''`};
      var guidanceSels=['[class*=NewGuidanceModal]','[class*=guidanceModal]','[class*=GuideModal]','[class*=guide_modal]'];
      var isGuidance=b=>guidanceSels.some(s=>b.closest(s));
      var confirm=btns.find(b=>/確\\s*認|确认/.test(b.textContent)&&!isGuidance(b));
      var guidance=btns.find(b=>/確\\s*認|确认/.test(b.textContent)&&isGuidance(b));
      var close=btns.find(b=>b.textContent.includes('\u5e02\u50f9\u5168\u5e73'));
      var bodyText=document.body.textContent;
      var posMatch=bodyText.match(/\u5f53\u524d\u5009\u4f4d\((\d+)\)/);
      var posCount=posMatch?parseInt(posMatch[1]):0;
      if(guidance){guidance.click();return 'guidance_dismissed';}
      if(confirm){
        var modal=confirm.closest('[class*=modal],[class*=Modal],[class*=dialog],[class*=Dialog],[class*=popup],[class*=Popup],[role=dialog]');
        var modalText=modal?modal.textContent.replace(/\s+/g,' ').trim().slice(0,400):'no_modal';
        var allModalLike=[...document.querySelectorAll('[class*=modal],[class*=Modal],[role=dialog]')].map(function(m){return m.textContent.trim().slice(0,100);}).filter(function(t){return t.length>5;}).join(' || ');
        confirm.click();
        return 'ORDER_CONFIRMED|modal:'+modalText+'|all:'+allModalLike;
      }
      if(close||posCount>0)return 'ORDER_PLACED_DIRECT:pos='+posCount;
      return 'waiting:'+(btnTexts||('pos='+posCount));
    })()`))?.result?.result?.value || 'eval_err';
    console.log(`[${i+1}]`, status);
    if (status.startsWith('ORDER_CONFIRMED') || status.startsWith('ORDER_PLACED_DIRECT')) {
      // Post-confirm cleanup: dismiss any remaining "TP price too close" warning modals
      // IMPORTANT: Use the × close button, NOT 確認 (which would place another order!)
      for (let j = 0; j < 6; j++) {
        await wait(400);
        const cleanup = (await ev(`(function(){
          var wraps=[...document.querySelectorAll('.ant-modal-wrap')].filter(function(w){
            return w.style.display!=='none' && w.textContent.includes('\u6b62\u76c8\u89f8\u767c\u50f9\u683c');
          });
          if(wraps.length>0){
            var closeBtn=wraps[0].querySelector('.ant-modal-close');
            if(closeBtn){closeBtn.click();return 'tpwarn_closed_x';}
            // fallback: ESC key
            var evt=new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true});
            document.dispatchEvent(evt);
            return 'tpwarn_esc';
          }
          return 'no_tpwarn';
        })()`))?.result?.result?.value || '';
        if (cleanup === 'no_tpwarn') break;
        console.log('cleanup:', cleanup);
      }
      console.log('TRADE SUCCESS:', JSON.stringify({ direction, amount, tp: tpPct, sl: slPct }));
      return;
    }
  }
  console.log('WARNING: trade may not have completed - check KCEX page manually');
}

// Type text into a focused element using real CDP Input events (works with React)
async function cmdTypeIn(selector, text, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const ws = tab.webSocketDebuggerUrl;
  // Step 1: focus element and select all via JS
  const focusJs = `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if(!el) return 'not found';
    el.focus();
    el.setSelectionRange(0, el.value.length);
    return 'focused: ' + el.value;
  })()`;
  const fResult = await wsSendRecv(ws, 'Runtime.evaluate', { expression: focusJs, returnByValue: true, awaitPromise: false }, 10000);
  if ((fResult?.result?.result?.value || '').includes('not found')) {
    console.error('Element not found: ' + selector); return;
  }
  console.log('focus:', fResult?.result?.result?.value);
  // Step 2: Use Input.insertText to type (replaces selected text in React controlled input)
  await wsSendRecv(ws, 'Input.insertText', { text: String(text) }, 5000);
  console.log('typed: ' + text);
  // Step 3: dispatch blur to trigger React state update
  await wsSendRecv(ws, 'Runtime.evaluate', {
    expression: `document.activeElement && document.activeElement.dispatchEvent(new Event('blur',{bubbles:true}))`,
    returnByValue: true, awaitPromise: false
  }, 5000);
}

// Click at specific screen coordinates using real CDP mouse events (works with sliders/canvas)
async function cmdMouseClick(x, y, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const ws = tab.webSocketDebuggerUrl;
  const common = { x: parseFloat(x), y: parseFloat(y), button: 'left', clickCount: 1, modifiers: 0 };
  await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...common, type: 'mousePressed' }, 5000);
  await new Promise(r => setTimeout(r, 50));
  await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...common, type: 'mouseReleased' }, 5000);
  console.log(`mouse_click at (${x}, ${y}) done`);
}

async function cmdScreenshot(outfile, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const result = await wsSendRecv(tab.webSocketDebuggerUrl, 'Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false
  }, 20000);
  const data = result?.result?.data;
  if (!data) throw new Error('No screenshot data returned');
  fs.writeFileSync(outfile, Buffer.from(data, 'base64'));
  console.log(`Screenshot saved: ${outfile} (${fs.statSync(outfile).size} bytes)`);
}

async function cmdNavigate(url, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const result = await wsSendRecv(tab.webSocketDebuggerUrl, 'Page.navigate', { url }, 15000);
  console.log(`Navigated: ${JSON.stringify(result?.result)}`);
}

async function cmdJsFile(jsfile, tabKeyword) {
  const expression = fs.readFileSync(jsfile, 'utf8');
  const tab = await findTab(tabKeyword);
  if (!tab.webSocketDebuggerUrl) throw new Error('Tab has no webSocketDebuggerUrl');
  const result = await wsSendRecv(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, timeout: 30000
  }, 40000);
  const rv = result?.result?.result;
  const exc = result?.result?.exceptionDetails;
  if (exc) {
    process.stderr.write(`JS ERROR: ${JSON.stringify(exc?.exception?.description || exc)}\n`);
    process.exit(1);
  }
  const val = rv?.value;
  if (val === undefined || val === null) console.log('(undefined/null)');
  else if (typeof val === 'object') console.log(JSON.stringify(val, null, 2));
  else console.log(String(val));
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === 'help') {
    console.log('Commands: info | eval <js> [keyword] | click <selector> [keyword] | type_in <selector> <text> [keyword] | mouse_click <x> <y> [keyword] | trade <long|short> <sizePct> <tpPct> <slPct> [keyword] | screenshot <file> [keyword] | navigate <url> [keyword] | js_file <file> [keyword]');
    process.exit(0);
  }
  const [cmd, ...rest] = args;
  try {
    if (cmd === 'info') await cmdInfo();
    else if (cmd === 'eval') await cmdEval(rest[0], rest[1]);
    else if (cmd === 'click') await cmdClick(rest[0], rest[1]);
    else if (cmd === 'type_in') await cmdTypeIn(rest[0], rest[1], rest[2]);
    else if (cmd === 'mouse_click') await cmdMouseClick(parseFloat(rest[0]), parseFloat(rest[1]), rest[2]);
    else if (cmd === 'trade') await cmdTrade(rest[0], parseFloat(rest[1]), parseFloat(rest[2]), parseFloat(rest[3]), rest[4]);
    else if (cmd === 'screenshot') await cmdScreenshot(rest[0] || 'screenshot.png', rest[1]);
    else if (cmd === 'navigate') await cmdNavigate(rest[0], rest[1]);
    else if (cmd === 'js_file') await cmdJsFile(rest[0], rest[1]);
    else { console.error(`Unknown command: ${cmd}`); process.exit(1); }
  } catch(e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
})();
