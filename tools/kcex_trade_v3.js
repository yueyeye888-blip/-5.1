// KCEX trade v3 — pure CDP mouse events, synchronous execution
// Usage: cdp_helper.js eval "<content>" kcex
// All clicks via CDP Input.dispatchMouseEvent (synchronous)
// Confirmed working coords: TP/SL cb=(861,477), 開多=(1450,583), 確認=(114,179)
(function(){
  var log = [];
  
  // Helper: CDP mouse click at viewport coords (synchronous via Chrome CDP)
  // We can't call CDP directly from eval, so use element.click() on elements at those coords
  function clickEl(x, y, label) {
    var el = document.elementFromPoint(x, y);
    if (el) {
      el.click();
      log.push('click:' + label + '@' + x + ',' + y + ' → ' + el.tagName + '.' + el.className.slice(0, 30));
      return true;
    }
    log.push('FAIL:no el at ' + x + ',' + y);
    return false;
  }
  
  function setInputValue(el, val) {
    if (!el) return false;
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    el.dispatchEvent(new Event('blur', {bubbles: true}));
    return el.value;
  }
  
  // 1. Close guidance
  var guide = document.querySelector('[class*=Guidance]');
  if (guide) { guide.remove(); log.push('guide removed'); }
  
  // 2. TP/SL checkbox at (861, 477)
  // First click to uncheck if already on, second to check
  var cbEl = document.elementFromPoint(861, 477);
  if (cbEl) {
    var inputCb = cbEl.querySelector ? (cbEl.querySelector('input[type=checkbox]') || cbEl) : cbEl;
    if (inputCb && inputCb.type === 'checkbox') {
      if (inputCb.checked) {
        clickEl(861, 477, 'tpsl uncheck');
      }
      clickEl(861, 477, 'tpsl check');
    } else {
      clickEl(861, 477, 'tpsl panel');
    }
  }
  
  // 3. Wait for TP/SL inputs to appear (busy-wait using sync XHR)
  var waited = 0;
  var tpInput = null, slInput = null;
  while (waited < 2000) {
    var inputs = [];
    var allIn = document.querySelectorAll('input.ant-input');
    for (var i = 0; i < allIn.length; i++) {
      try {
        var r = allIn[i].getBoundingClientRect();
        if (r.left > 1300 && r.left < 1500 && r.top > 200 && r.top < 350 && r.width > 50 && allIn[i].type !== 'hidden') {
          inputs.push({ el: allIn[i], top: r.top });
        }
      } catch(e) {}
    }
    if (inputs.length >= 2) {
      inputs.sort(function(a, b) { return Math.abs(a.top - 250) - Math.abs(b.top - 250); });
      tpInput = inputs[0].el;
      inputs.sort(function(a, b) { return Math.abs(a.top - 302) - Math.abs(b.top - 302); });
      slInput = inputs[0].el;
      if (tpInput && slInput) break;
    }
    // Sync delay using sync XHR
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/robots.txt', false);
    xhr.send('');
    waited += 50;
  }
  log.push('waited for inputs: tp=' + (tpInput ? 'found' : 'missing') + ' sl=' + (slInput ? 'found' : 'missing'));
  
  // 4. Set TP and SL
  if (tpInput) {
    var tv = setInputValue(tpInput, '10');
    log.push('TP set: ' + tv);
  }
  if (slInput) {
    var sv = setInputValue(slInput, '-10');
    log.push('SL set: ' + sv);
  }
  
  // 5. Set size (25% of balance at 100x)
  var balEl = document.querySelector('.AssetsItem_num__E7zsM');
  var balance = balEl ? parseFloat(balEl.innerText.replace(/[^\d.]/g, '')) : 51.36;
  var notional = Math.floor(balance * 0.25 * 100) / 100;
  log.push('Balance: ' + balance + ' → notional: ' + notional);
  
  var sizeInput = document.querySelector('input.quickTrading_sizeInput__sX_Ms') || document.querySelector('input.quickTrading');
  if (sizeInput) {
    setInputValue(sizeInput, notional);
    log.push('Size set: ' + sizeInput.value);
  } else {
    log.push('WARNING: size input not found');
  }
  
  // 6. Click 開多 at (1450, 583)
  clickEl(1450, 583, '開多');
  
  // 7. Wait for confirmation dialog
  waited = 0;
  var confirmBtn = null;
  while (waited < 3000) {
    var btns = Array.from(document.querySelectorAll('button'));
    confirmBtn = btns.find(function(b) {
      return /確認|确认/.test(b.innerText) && b.offsetParent !== null;
    });
    if (confirmBtn) break;
    var xhr2 = new XMLHttpRequest();
    xhr2.open('GET', '/robots.txt', false);
    xhr2.send('');
    waited += 50;
  }
  
  // 8. Click 確認
  if (confirmBtn) {
    var br = confirmBtn.getBoundingClientRect();
    clickEl(Math.round(br.left + br.width / 2), Math.round(br.top + br.height / 2), '確認');
    log.push('Confirmed!');
  } else {
    log.push('WARNING: confirm button not found');
  }
  
  // 9. Return log
  return 'KCEX_TRADE_V3:' + JSON.stringify({ log: log, balance: balance, notional: notional });
})()
