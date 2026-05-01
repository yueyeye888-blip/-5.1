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

  // Step 0: Log layout state (works with both narrow x=18 and wide x=1348 layout)
  {
    const panelX = (await ev(`(function(){var c=document.getElementById('kcex_contract_v_open_position');if(!c)return -1;return Math.round(c.getBoundingClientRect().left);})()`))?.result?.result?.value;
    console.log('layout: panel x=' + panelX);
    // Try resize event to help layout settle
    await ev(`window.dispatchEvent(new Event('resize'));`);
    await wait(500);
  }
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
  // Loop-dismiss all visible modals (KCEX shows multi-step guidance on each page load)
  for (let _di = 0; _di < 5; _di++) {
    const _dismissed = await ev(`(function(){
      var count=0;
      var wraps=[...document.querySelectorAll('.ant-modal-wrap,.ant-modal-root')].filter(function(w){return w.style.display!=='none'&&w.offsetParent!==null;});
      wraps.forEach(function(w){
        var x=w.querySelector('.ant-modal-close');
        if(x){x.click();count++;}
      });
      return count;
    })()`);
    const _count = _dismissed?.result?.result?.value;
    if (!_count || _count === 0) break;
    await wait(800);
  }
  await wait(1500);

  // Step 2: Enable TP/SL checkbox via JS label click (avoids hard-coded coords that break when modals overlay)
  const clickTP = async (x, y) => {
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { x, y, button: 'left', clickCount: 1, modifiers: 0, type: 'mousePressed' }, 5000);
    await wait(80);
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { x, y, button: 'left', clickCount: 1, modifiers: 0, type: 'mouseReleased' }, 5000);
  };
  const clickTPSLCheckbox = async () => {
    return (await ev(`(function(){
      // Try to find TP/SL label by text '止盈止損'
      var labels=[...document.querySelectorAll('label,span,.ant-checkbox-wrapper')].filter(function(el){
        return el.textContent.trim().includes('\u6b62\u76c8\u6b62\u640d');
      });
      if(labels.length>0){labels[0].click();return 'clicked_label';}
      // Fallback: find checkbox by parent text
      var cb=[...document.querySelectorAll('input[type=checkbox]')].find(function(el){
        var p=el.closest('label')||el.closest('[class*=checkbox]')||el.parentElement;
        return p&&p.textContent.includes('\u6b62\u76c8\u6b62\u640d');
      });
      if(cb){cb.click();return 'clicked_cb';}
      // Fallback 2: position-based
      var cbPos=[...document.querySelectorAll('input[type=checkbox]')].find(function(el){
        try{var r=el.getBoundingClientRect();return r.left>1350&&r.left<1470&&r.top>400&&r.top<500;}catch(e){return false;}
      });
      if(cbPos){cbPos.click();return 'clicked_pos:'+Math.round(cbPos.getBoundingClientRect().left)+','+Math.round(cbPos.getBoundingClientRect().top);}
      // Fallback 3: CDP coords
      return null;
    })()`))?.[`result`]?.[`result`]?.value;
  };
  // Check current TP/SL state
  const cbState = (await ev(`(function(){
    var cb=[...document.querySelectorAll('input[type=checkbox]')].find(function(el){
      var p=el.closest('label')||el.closest('[class*=checkbox]')||el.parentElement;
      return p&&p.textContent.includes('\u6b62\u76c8\u6b62\u640d');
    }) || [...document.querySelectorAll('input[type=checkbox]')].find(function(el){
      try{var r=el.getBoundingClientRect();return r.left>1350&&r.left<1470&&r.top>400&&r.top<500;}catch(e){return false;}
    });
    return cb?cb.checked:null;
  })()`))?.result?.result?.value;
  if (cbState === true) {
    // Already on: uncheck first to reset React state
    const u = await clickTPSLCheckbox();
    console.log('tpsl: unchecked via JS:', u);
    await wait(500);
  }
  // Now check it (fresh state)
  const tpslClickResult = await clickTPSLCheckbox();
  if (!tpslClickResult) {
    // Last resort: CDP coords
    await clickTP(1410, 446);
    console.log('tpsl: checked via CDP coords 1410,446 (fallback)');
  } else {
    console.log('tpsl: checked via JS:', tpslClickResult);
  }
  await wait(1200);

  // Step 3: Set TP (positive percentage, e.g. 10 = 10% profit target)
  // KCEX新版本: TP/SL输入框placeholder为空，改为通过位置选择(x≈1360, y≈250 for TP, y≈302 for SL)
  const findTPSLPanelInput = async (type) => {
    const yTarget = type === 'tp' ? 250 : 302;
    const r = await ev(`(function(){
      var inputs=[...document.querySelectorAll('input.ant-input')].filter(function(el){
        try{
          var r=el.getBoundingClientRect();
          return r.left>1300&&r.left<1500&&r.top>200&&r.top<350&&r.width>50&&r.width<200&&el.type!=='hidden'&&el.value.length<20;
        }catch(e){return false;}
      });
      if(inputs.length===0) return null;
      // Sort by proximity to target y
      inputs.sort(function(a,b){
        return Math.abs(a.getBoundingClientRect().top-yTarget)-Math.abs(b.getBoundingClientRect().top-yTarget);
      });
      var el=inputs[0];
      var r=el.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),val:el.value});
    })()`);
    return r?.result?.result?.value;
  };
  const tpR = await setVal('input[placeholder*="\u6b62\u76c8"]', tpPct);
  const tpFallback = await findTPSLPanelInput('tp');
  if (tpFallback) {
    const tpInfo = JSON.parse(tpFallback);
    console.log('TP (position fallback):', tpInfo.x + ',' + tpInfo.y, 'val:', tpInfo.val);
    // Try setVal with a position-based approach
    const r2 = await ev(`(function(){
      var inputs=[...document.querySelectorAll('input.ant-input')].filter(function(el){
        try{var r=el.getBoundingClientRect();return r.left>1300&&r.left<1500&&r.top>200&&r.top<350&&r.width>50;}catch(e){return false;}
      });
      inputs.sort(function(a,b){return Math.abs(a.getBoundingClientRect().top-250)-Math.abs(b.getBoundingClientRect().top-250);});
      var el=inputs[0];if(!el)return null;
      el.focus();
      var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      ns.call(el,'${tpPct}');
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
      el.blur();
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return 'tp_set:'+el.value;
    })()`);
    console.log('TP set:', r2?.result?.result?.value);
  } else {
    console.log('TP:', tpR || 'not found');
  }
  if (!tpR && !tpFallback) {
    await wait(600);
    const tpR2 = await setVal('input[placeholder*="\u6b62\u76c8"]', tpPct);
    console.log('TP retry:', tpR2);
  }
  await wait(300);

  // Step 4: Set SL (negative percentage, e.g. -10 = 10% loss limit)
  const slVal = String(slPct).startsWith('-') ? slPct : -Math.abs(slPct);
  const slR = await setVal('input[placeholder*="\u6b62\u640d"]', slVal);
  const slFallback = await findTPSLPanelInput('sl');
  if (slFallback) {
    const slInfo = JSON.parse(slFallback);
    console.log('SL (position fallback):', slInfo.x + ',' + slInfo.y, 'val:', slInfo.val);
    const r2 = await ev(`(function(){
      var inputs=[...document.querySelectorAll('input.ant-input')].filter(function(el){
        try{var r=el.getBoundingClientRect();return r.left>1300&&r.left<1500&&r.top>200&&r.top<350&&r.width>50;}catch(e){return false;}
      });
      inputs.sort(function(a,b){return Math.abs(a.getBoundingClientRect().top-302)-Math.abs(b.getBoundingClientRect().top-302);});
      var el=inputs[0];if(!el)return null;
      el.focus();
      var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      ns.call(el,'${slVal}');
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
      el.blur();
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return 'sl_set:'+el.value;
    })()`);
    console.log('SL set:', r2?.result?.result?.value);
  } else {
    console.log('SL:', slR || 'not found');
  }
  if (!slR && !slFallback) {
    await wait(600);
    const slR2 = await setVal('input[placeholder*="\u6b62\u640d"]', slVal);
    console.log('SL retry:', slR2);
  }
  await wait(300);

  // Step 5: Set size LAST — after checkbox/TP/SL so React re-renders won't clear it
  // KCEX: size input is inside #kcex_contract_v_open_position, identified by having min-y among visible text inputs
  // When TP/SL panel is OPEN: size input y≈234 (no placeholder), TP y≈465, SL y≈515
  const szR = await ev(`(function(){
    var container=document.getElementById('kcex_contract_v_open_position');
    if(!container) return 'no_container';
    // Size input has NO placeholder (TP/SL inputs have Chinese placeholders)
    // Use placeholder-empty filter to find size input regardless of window width
    var textInputs=[...container.querySelectorAll('input[type=text],input:not([type])')]
      .filter(function(el){
        var r=el.getBoundingClientRect();
        return r.width>50&&r.height>0&&!el.placeholder;
      });
    // Fallback: if no empty-placeholder input, take topmost visible input
    if(textInputs.length===0){
      textInputs=[...container.querySelectorAll('input[type=text],input:not([type])')]
        .filter(function(el){var r=el.getBoundingClientRect();return r.width>50&&r.height>0;});
    }
    textInputs.sort(function(a,b){ return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
    var el = textInputs[0]; // topmost input = size input
    if(!el) return 'not found';
    try{
      var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      el.focus();
      el.dispatchEvent(new Event('focus',{bubbles:true}));
      ns.call(el,'${amount}');
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
      el.blur();
      el.dispatchEvent(new Event('blur',{bubbles:true}));
      return 'set:'+el.value+'@'+Math.round(el.getBoundingClientRect().left)+','+Math.round(el.getBoundingClientRect().top);
    }catch(e){
      return 'err:'+e.message+'@'+Math.round(el.getBoundingClientRect().left)+','+Math.round(el.getBoundingClientRect().top);
    }
  })()`);
  const szVal = szR?.result?.result?.value;
  console.log('size:', szVal);
  if (!szVal || szVal === 'not found' || szVal === 'no_container' || szVal.startsWith('err:')) {
    await wait(400);
    // Fallback: find size input via JS and use CDP insertText
    const sizeCoords = (await ev(`(function(){
      var c=document.getElementById('kcex_contract_v_open_position');
      if(!c)return null;
      var els=[...c.querySelectorAll('input[type=text],input:not([type])')]
        .filter(function(el){var r=el.getBoundingClientRect();return r.width>50&&r.height>0&&!el.placeholder;});
      if(els.length===0)els=[...c.querySelectorAll('input[type=text],input:not([type])')]
        .filter(function(el){var r=el.getBoundingClientRect();return r.width>50&&r.height>0;});
      els.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top;});
      var el=els[0];if(!el)return null;
      var r=el.getBoundingClientRect();
      el.focus();el.dispatchEvent(new Event('focus',{bubbles:true}));
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`))?.result?.result?.value;
    const sc = sizeCoords ? JSON.parse(sizeCoords) : {x:1532, y:234};
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { x:sc.x, y:sc.y, button:'left', clickCount:3, modifiers:0, type:'mousePressed' }, 5000);
    await wait(50);
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { x:sc.x, y:sc.y, button:'left', clickCount:3, modifiers:0, type:'mouseReleased' }, 5000);
    await wsSendRecv(ws, 'Input.insertText', { text: String(amount) }, 5000);
    console.log('size via CDP insertText:', amount, 'at', sc);
    // After insertText, trigger React events to commit value
    await wait(200);
    await ev(`(function(){
      var c=document.getElementById('kcex_contract_v_open_position');
      if(!c)return;
      var els=[...c.querySelectorAll('input[type=text],input:not([type])')]
        .filter(function(el){var r=el.getBoundingClientRect();return r.width>50&&r.height>0&&!el.placeholder;});
      if(els.length===0)els=[...c.querySelectorAll('input[type=text],input:not([type])')]
        .filter(function(el){var r=el.getBoundingClientRect();return r.width>50&&r.height>0;});
      els.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top;});
      var el=els[0];if(!el)return;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      el.blur();
      el.dispatchEvent(new Event('blur',{bubbles:true}));
    })()`);
  }
  await wait(1000);  // extra wait after blur so React commits size to internal state

  // Step 6: Verify all values before submitting
  const check = (await ev(`(function(){
    var tp=document.querySelector('input[placeholder*="\u6b62\u76c8"]')?.value;
    var sl=document.querySelector('input[placeholder*="\u6b62\u640d"]')?.value;
    var sz=(function(){var c=document.getElementById('kcex_contract_v_open_position');if(!c)return null;var arr=[...c.querySelectorAll('input[type=text],input:not([type])')].filter(function(e){var r=e.getBoundingClientRect();return r.width>50&&r.left>0;});arr.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top;});return arr[0]?arr[0].value:null;})();
    var cbOn=([...document.querySelectorAll('.ant-checkbox-wrapper')].find(w=>w.textContent.includes('\u6b62\u76c8\u6b62\u640d'))?.querySelector('input[type="checkbox"]')?.checked)||false;
    return JSON.stringify({tp,sl,sz,cbOn});
  })()`))?.result?.result?.value;
  console.log('values check:', check);

  // Step 7: Click 開多 or 開空 via JS click (triggers React event chain including 風險提示 modal)
  const btnLabel = direction === 'short' ? '開空' : '開多';
  const clickResult = await ev(`(function(){
    var btn=document.querySelector('button.component_longBtn__JPpVz,button.component_shortBtn__JPpVz')
      ||[...document.querySelectorAll('button')].find(function(b){return b.textContent.trim().includes('${btnLabel}')&&b.getBoundingClientRect().left>0;});
    if(!btn) return 'btn_not_found';
    var r=btn.getBoundingClientRect();
    btn.click();
    return 'JS_clicked:'+btn.textContent.trim()+'@'+Math.round(r.left+r.width/2)+','+Math.round(r.top+r.height/2);
  })()`);
  const clickVal = clickResult?.result?.result?.value || 'eval_err';
  console.log('btn click:', clickVal);
  if (clickVal === 'btn_not_found') {
    // Fallback: use confirmed working fixed coords for KCEX right panel
    const fx = 1450, fy = 583;
    const mc = { x: fx, y: fy, button: 'left', clickCount: 1, modifiers: 0 };
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mousePressed' }, 5000);
    await wait(50);
    await wsSendRecv(ws, 'Input.dispatchMouseEvent', { ...mc, type: 'mouseReleased' }, 5000);
    console.log('CDP mouse_click 開多 at FIXED', {x:fx, y:fy}, '(btn not found)');
  }

  // Step 8: Wait for confirm → click 確認 in 風險提示 modal, then TRADE SUCCESS
  for (let i = 0; i < 20; i++) {
    await wait(500);
    const status = (await ev(`(function(){
      var btnTexts=${i < 5 ? `[...document.querySelectorAll('button')].map(b=>b.textContent.trim().slice(0,20)).filter(t=>t).join('|')` : `''`};
      // posCount: read from tab "當前倉位(N)"
      var posEl=[...document.querySelectorAll('[class*=tab],[class*=Tab]')].find(function(t){return t.textContent.indexOf('\u5009\u4f4d')>=0&&t.getBoundingClientRect().width>0;});
      var posTabMatch=posEl?posEl.textContent.match(/\\((\\d+)\\)/):null;
      var posCount=posTabMatch?parseInt(posTabMatch[1]):0;
      // Dismiss guidance modal (NewGuidanceModal) if visible
      var guidanceModal=document.querySelector('[class*=NewGuidanceModal]');
      if(guidanceModal){
        var gInner=guidanceModal.querySelector('.ant-modal');
        if(gInner&&gInner.getBoundingClientRect().width>0){
          var gClose=guidanceModal.querySelector('.ant-modal-close');
          if(gClose){gClose.click();return 'guidance_closed';}
        }
      }
      // Dismiss regular guidance via confirm btn
      var guidanceSels=['[class*=guidanceModal]','[class*=GuideModal]','[class*=guide_modal]'];
      var otherGuidance=guidanceSels.map(function(s){return document.querySelector(s);}).find(function(el){return el&&el.querySelector('.ant-modal')&&el.querySelector('.ant-modal').getBoundingClientRect().width>0;});
      if(otherGuidance){var gc=otherGuidance.querySelector('.ant-modal-close');if(gc){gc.click();return 'other_guidance_closed';}}
      // --- KEY FIX: find 風險提示 modal via [class*=PlanRisk] using ant-modal-root ---
      var planRisk=document.querySelector('[class*=PlanRisk]');
      if(planRisk){
        var prInner=planRisk.closest('.ant-modal');
        if(!prInner)prInner=planRisk;
        var prBtns=[...prInner.querySelectorAll('button')].filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0;});
        var confirmBtn=prBtns.find(function(b){return /\u78ba\s*\u8a8d|\u786e\s*\u8ba4/.test(b.textContent);})||prBtns[prBtns.length-1];
        if(confirmBtn){confirmBtn.click();return 'ORDER_CONFIRMED|risk_modal_JS_click';}
        return 'risk_modal_found_no_visible_btn';
      }
      // Fallback: any visible 確認 button not in guidance
      var allBtns=[...document.querySelectorAll('button')].filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0;});
      var closeAllBtn=allBtns.find(function(b){return b.textContent.includes('\u5e02\u50f9\u5168\u5e73');});
      if(closeAllBtn||posCount>0)return 'ORDER_PLACED_DIRECT:pos='+posCount;
      var confirmFallback=allBtns.find(function(b){return /\u78ba\s*\u8a8d|\u786e\s*\u8ba4/.test(b.textContent);});
      if(confirmFallback){confirmFallback.click();return 'ORDER_CONFIRMED|fallback_btn';}
      return 'waiting:'+(btnTexts||('pos='+posCount));
    })()`))?.result?.result?.value || 'eval_err';
    console.log(`[${i+1}]`, status);
    if (status.startsWith('ORDER_CONFIRMED') || status.startsWith('ORDER_PLACED_DIRECT')) {
      // Post-confirm: wait briefly then DISMISS (not confirm) any lingering modals
      // IMPORTANT: must NOT click 確認 here - that would place a duplicate order!
      await wait(1000);
      for (let j = 0; j < 5; j++) {
        const cleanup = (await ev(`(function(){
          // Dismiss any visible PlanRisk modal by clicking 取消 or X (NOT 確認)
          var planRisk=document.querySelector('[class*=PlanRisk]');
          if(planRisk){
            var pInner=planRisk.closest('.ant-modal');if(!pInner)pInner=planRisk;
            var pRect=pInner.getBoundingClientRect();
            if(pRect.width===0||pRect.height===0) return 'no_extra_modal'; // still closing animation, ignore
            // Click 取消 (cancel) to dismiss without placing new order
            var pBtns=[...pInner.querySelectorAll('button')].filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&r.height>0;});
            var cancelBtn=pBtns.find(function(b){return /\u53d6\s*\u6d88|\u5426/.test(b.textContent);});
            if(!cancelBtn){
              // fallback: click X close button
              var closeX=pInner.querySelector('.ant-modal-close')||planRisk.querySelector('.ant-modal-close');
              if(closeX){closeX.click();return 'extra_modal_closed_x';}
              return 'extra_modal_no_dismiss_btn';
            }
            cancelBtn.click();return 'extra_modal_dismissed';
          }
          return 'no_extra_modal';
        })()`))?.result?.result?.value || '';
        console.log('cleanup:', cleanup);
        if (cleanup === 'no_extra_modal') break;
        await wait(500);
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

// Insert text using CDP native Input.insertText (triggers beforeInput for Draft.js editors)
async function cmdInsertText(text, tabKeyword) {
  const tab = await findTab(tabKeyword);
  const ws = tab.webSocketDebuggerUrl;
  // Focus the contenteditable element via JS
  const focusJs = `(function(){
    var el = document.querySelector('[data-testid="tweetTextarea_0"]');
    if(!el) return 'NOT_FOUND';
    el.scrollIntoView({block:'center'});
    el.focus();
    return 'FOCUSED';
  })()`;
  const fr = await wsSendRecv(ws, 'Runtime.evaluate', { expression: focusJs, returnByValue: true, awaitPromise: false }, 10000);
  console.log('Focus:', fr?.result?.result?.value);
  await new Promise(r => setTimeout(r, 500));
  // Insert text via CDP native input
  await wsSendRecv(ws, 'Input.insertText', { text: String(text) }, 5000);
  console.log('Inserted:', text.substring(0, 60));
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === 'help') {
    console.log('Commands: info | eval <js> [keyword] | click <selector> [keyword] | type_in <selector> <text> [keyword] | mouse_click <x> <y> [keyword] | trade <long|short> <sizePct> <tpPct> <slPct> [keyword] | screenshot <file> [keyword] | navigate <url> [keyword] | js_file <file> [keyword] | insert_text <text> [keyword]');
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
    else if (cmd === 'insert_text') await cmdInsertText(rest[0], rest[1]);
    else { console.error(`Unknown command: ${cmd}`); process.exit(1); }
  } catch(e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
})();


