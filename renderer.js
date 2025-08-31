(function(){
  const price = document.getElementById('price');
  const ema9 = document.getElementById('ema9');
  const ema21 = document.getElementById('ema21');
  const rsi = document.getElementById('rsi');
  const output = document.getElementById('output');
  const status = document.getElementById('status');
  const btn = document.getElementById('getSignal');

  function addSignal(sig){
    const d = document.createElement('div');
    d.className = 'sig ' + (sig.type==='UP' ? 'up' : 'down');
    d.innerHTML = `<div><b>${sig.type}</b> — ${sig.reason}</div><div class="time">${new Date(sig.time).toLocaleString()}</div>`;
    output.prepend(d);
    while (output.children.length>50) output.removeChild(output.lastChild);
  }

  btn.addEventListener('click', async ()=>{
    btn.disabled = true; btn.textContent = 'Checking...';
    try{
      const res = await window.qsig.requestEval();
      if (res?.found){
        addSignal(res);
      } else {
        output.prepend(`<div class="sig"><b>No safe signal</b> — ${res.reason||'no-setup'}</div>`);
      }
    }catch(e){
      output.prepend(`<div class="sig"><b>Error</b> — ${e.message}</div>`);
    }
    btn.disabled = false; btn.textContent = 'Get Signal';
  });

  window.qsig?.onStatus((s)=>{
    status.textContent = s?.last ? `Last candle time: ${new Date(s.last.time).toLocaleString()} — Candles: ${s.candleCount}` : 'Waiting for data…';
    if(s?.last){ price.textContent = Number(s.last.close).toFixed(6); }
  });

  window.qsig?.onSignal((sig)=>{
    if(!sig) return;
    const el = document.createElement('div'); el.className = `sig ${sig.type==='UP'?'up':'down'}`;
    el.innerHTML = `<b>${sig.type}</b> — ${sig.reason} <div style="margin-top:6px;font-size:12px;color:#bcd">Accuracy: ${Math.round(sig.accuracy||0)}%</div>`;
    output.prepend(el);
  });
})();
