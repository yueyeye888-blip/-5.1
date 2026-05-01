/**
 * KCEX ETH/USDT Trade Script v3
 * Usage:
 *   node cdp_helper.js eval "window.TRADE_PARAMS={direction:'long',pct:25,tp:10,sl:10}" kcex
 *   node cdp_helper.js js_file trade.js kcex
 */
(async function TRADE() {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Most reliable React input setter: focus → select all → execCommand insertText
  function setReactInput(el, val) {
    el.focus();
    // Select all existing content
    el.select && el.select();
    el.setSelectionRange && el.setSelectionRange(0, el.value.length);
    // Use execCommand (works for React controlled inputs)
    const ok = document.execCommand('insertText', false, String(val));
    if (!ok) {
      // Fallback: native setter + events
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Clear + set (for inputs that may have existing value like "10%")
  function clearAndSet(el, val) {
    el.focus();
    // Select all content in this specific input
    el.setSelectionRange(0, el.value.length);
    // Insert text replaces selection
    const ok = document.execCommand('insertText', false, String(val));
    if (!ok) {
      // Fallback
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function waitFor(filterFn, maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const els = [...document.querySelectorAll('input,button')].filter(e => e.offsetParent !== null);
      const el = els.find(filterFn);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  function findOrderConfirmBtn() {
    // Find ALL confirm buttons - prefer ones NOT in guidance modals, but don't filter too aggressively
    const btns = [...document.querySelectorAll('button')]
      .filter(e => e.offsetParent !== null && /確\s*認|确认/i.test(e.innerText));
    if (!btns.length) return null;
    // Try to pick the order confirm (not guidance)
    const nonGuidance = btns.find(b => {
      const p = b.closest('[class*=NewGuidanceModal],[class*=guidance],[class*=Guidance]');
      return !p;
    });
    return nonGuidance || btns[0];
  }

  const params = window.TRADE_PARAMS || {};
  const direction = params.direction || 'long';
  const pct       = parseFloat(params.pct  ?? 25);
  const tp        = parseFloat(params.tp   ?? 10);
  const sl        = parseFloat(params.sl   ?? 10);
  const closeAll  = params.closeAll || false;
  const log = [];

  // ── CLOSE ALL ─────────────────────────────────────────────────
  if (closeAll) {
    const closeBtn = [...document.querySelectorAll('button')]
      .find(e => e.offsetParent !== null && (e.innerText||'').includes('市價全平'));
    if (!closeBtn) return JSON.stringify({ error: '市價全平 not found (no open position?)', log });
    closeBtn.click(); log.push('clicked 市價全平');
    await sleep(1500);
    const cb = findOrderConfirmBtn();
    if (cb) { cb.click(); log.push('close confirmed'); await sleep(500); }
    return JSON.stringify({ done: 'closed all', log });
  }

  // ── READ BALANCE ───────────────────────────────────────────────
  const balEl = document.querySelector('.AssetsItem_num__E7zsM');
  const balance = parseFloat((balEl ? balEl.innerText : '0').replace(/[^\d.]/g, '')) || 0;
  const amount  = Math.floor(balance * pct / 100 * 100) / 100 || 1;
  log.push(`balance: ${balance} | amount: ${amount} (${pct}%)`);

  // ── SET LEVERAGE ───────────────────────────────────────────────
  // KCEX新版本：需要点击 "20X" (LeverageEdit_short section) 打开杠杆弹窗
  if (params.leverage) {
    // 1. 点击 "20X" 区域打开杠杆弹窗
    const shortSection = document.querySelector('[class*=LeverageEdit_short]');
    if (shortSection) {
      shortSection.click(); log.push('opened leverage modal');
      await sleep(1200);
    }
    
    // 2. 在弹窗内填写杠杆值
    const lvInput = document.querySelector('input.LeverageProgress_leverageInput__iWDFl');
    if (lvInput) {
      lvInput.focus();
      var lvSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      lvSetter.call(lvInput, String(params.leverage));
      lvInput.dispatchEvent(new Event('input', {bubbles:true}));
      lvInput.dispatchEvent(new Event('change', {bubbles:true}));
      lvInput.dispatchEvent(new Event('blur', {bubbles:true}));
      log.push(`leverage input → ${params.leverage}x (val:${lvInput.value})`);
      await sleep(400);
      
      // 3. 点击确认
      const allBtns = [...document.querySelectorAll('button')];
      const confirmBtn = allBtns.find(e => e.offsetParent !== null && /確\s*認|确认/.test(e.innerText));
      if (confirmBtn) {
        confirmBtn.click(); log.push('leverage confirmed');
        await sleep(1500);
      } else {
        log.push('WARNING: leverage confirm btn not found');
      }
    } else {
      log.push('WARNING: leverage input not found in modal');
    }
  }

  // ── ENABLE TP/SL CHECKBOX ──────────────────────────────────────
  const tpslWrap = [...document.querySelectorAll('.ant-checkbox-wrapper')]
    .find(e => (e.innerText||'').match(/止盈止損|止盈止损/));
  if (tpslWrap) {
    const cb = tpslWrap.querySelector('input[type=checkbox]');
    if (cb && !cb.checked) {
      cb.click(); log.push('tpsl checkbox → ON'); await sleep(800);
    } else {
      log.push('tpsl already ON');
    }
  } else {
    log.push('WARNING: tpsl checkbox not found');
  }

  // ── SET TP/SL VALUES ───────────────────────────────────────────
  await sleep(400);
  const tpInput = await waitFor(e => e.tagName === 'INPUT' && (e.placeholder||'').includes('止盈'), 3000);
  const slInput = await waitFor(e => e.tagName === 'INPUT' && (e.placeholder||'').match(/止損|止损/), 3000);

  if (tpInput) {
    clearAndSet(tpInput, String(tp));
    await sleep(200);
    log.push(`TP → ${tp} (val: ${tpInput.value})`);
  } else {
    log.push('ERROR: TP input not found');
  }

  if (slInput) {
    clearAndSet(slInput, String(sl));
    await sleep(200);
    log.push(`SL → ${sl} (val: ${slInput.value})`);
  } else {
    log.push('ERROR: SL input not found');
  }

  // ── SET AMOUNT ─────────────────────────────────────────────────
  const sizeInput = document.querySelector('.quickTrading_sizeInput__sX_Ms');
  if (!sizeInput) return JSON.stringify({ error: 'size input not found', log });
  clearAndSet(sizeInput, String(amount));
  await sleep(400);
  log.push(`size → ${amount} (val: ${sizeInput.value})`);

  // ── CLICK BUY/SELL ─────────────────────────────────────────────
  const btnText = direction === 'long' ? '開多' : '開空';
  const actionBtn = [...document.querySelectorAll('button')]
    .find(e => e.offsetParent !== null && (e.innerText||'').includes(btnText));
  if (!actionBtn) return JSON.stringify({ error: `${btnText} button not found`, log });
  actionBtn.click();
  log.push(`clicked ${btnText}`);

  // ── WAIT & CONFIRM ─────────────────────────────────────────────
  // Poll up to 6 seconds
  let confirmBtn = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    confirmBtn = findOrderConfirmBtn();
    if (confirmBtn) break;
  }

  if (confirmBtn) {
    const txt = confirmBtn.innerText.trim();
    confirmBtn.click();
    log.push(`confirm clicked: "${txt}"`);
    await sleep(1000);
  } else {
    log.push('no confirm dialog (may have executed directly or form invalid)');
  }

  // ── RESULT ─────────────────────────────────────────────────────
  const posTab = document.querySelector('[class*=HandleContent] .ant-tabs-tab:first-child')?.innerText || '';
  const hasPosBtn = !![...document.querySelectorAll('button')].find(e => e.offsetParent !== null && (e.innerText||'').includes('市價全平'));

  return JSON.stringify({
    done: true,
    direction, amount, tp, sl,
    sizeInputFinal: sizeInput.value,
    log,
    posTabText: posTab,
    hasCloseBtn: hasPosBtn
  }, null, 2);
})()
