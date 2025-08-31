// injector.js
module.exports = `
(function(){
  if (window.__qsig_injected) return; window.__qsig_injected = true;

  // --- state ---
  const state = { ticks: [], candles: [], ticksPerMinute: new Map() };

  function pushTick(price, ts){
    price = Number(price);
    ts = Number(ts || Date.now());
    if (!isFinite(price) || !isFinite(ts)) return;
    state.ticks.push({ price, ts });
    if (state.ticks.length > 8000) state.ticks.splice(0, state.ticks.length - 6000);
    const m = Math.floor(ts/60000)*60000;
    state.ticksPerMinute.set(m, (state.ticksPerMinute.get(m) || 0) + 1);
    // prune older minutes
    const keys = [...state.ticksPerMinute.keys()].sort((a,b)=>b-a);
    while(keys.length > 120){
      const old = keys.pop();
      state.ticksPerMinute.delete(old);
    }
  }

  // --- WebSocket sniffing (best-effort) ---
  try {
    const NativeWS = window.WebSocket;
    window.WebSocket = function(url, protocols){
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      ws.addEventListener('message', (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (Array.isArray(d)) {
            d.forEach(x => { if (x && (x.p || x.price || x.rate)) pushTick(x.p||x.price||x.rate, x.t||x.ts); });
          } else {
            if (d?.tick) pushTick(d.tick.p || d.tick.price || d.tick.rate, d.tick.t || d.tick.ts);
            else if (d?.price) pushTick(d.price, d.time || d.ts);
            else if (d?.data && Array.isArray(d.data.ticks)) d.data.ticks.forEach(t=>pushTick(t.p||t.price, t.t||t.ts));
          }
        } catch(e){}
      });
      return ws;
    };
    Object.setPrototypeOf(window.WebSocket, NativeWS);
  } catch(e){ /* ignore if blocked */ }

  // --- candle builder (1m) ---
  function buildCandlesFromTicks(){
    const byMin = new Map();
    for (const t of state.ticks){
      const m = Math.floor(t.ts/60000)*60000;
      if (!byMin.has(m)) byMin.set(m, []);
      byMin.get(m).push(t.price);
    }
    const arr = [];
    for (const [time, prices] of [...byMin.entries()].sort((a,b)=>a[0]-b[0])){
      const open = prices[0];
      const close = prices[prices.length-1];
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      arr.push({ time, open, high, low, close, ticks: prices.length });
    }
    state.candles = arr.slice(-500);
  }

  // --- helpers: EMA, RSI, ADX, ATR ---
  function ema(values, period){
    const k = 2/(period+1);
    const out = []; let prev = null;
    for (let i=0;i<values.length;i++){
      const v = values[i];
      prev = (prev === null) ? v : (v*k + prev*(1-k));
      out.push(prev);
    }
    return out;
  }

  function rsi(closes, period=14){
    if (!closes || closes.length < period+1) return Array(closes.length).fill(50);
    const gains=[], losses=[];
    for (let i=1;i<closes.length;i++){ const d=closes[i]-closes[i-1]; gains.push(Math.max(0,d)); losses.push(Math.max(0,-d)); }
    function sma(arr,p){ let s=0; for(let i=0;i<p;i++) s+=arr[i]||0; let prev=s/p; const out=[prev]; for(let i=p;i<arr.length;i++){ prev = ((prev*(p-1))+arr[i])/p; out.push(prev);} return out; }
    const ag = sma(gains, period), al = sma(losses, period); const res=[]; const pad = closes.length - (Math.min(ag.length,al.length) + 1);
    for(let i=0;i<pad;i++) res.push(50);
    for(let i=0;i<Math.min(ag.length,al.length);i++){ const rs = al[i]===0?100:ag[i]/al[i]; res.push(100 - 100/(1+rs)); }
    return res;
  }

  function adx(candles, period=14){
    if (!candles || candles.length < period+2) return Array(candles.length).fill(0);
    const trs = [], plus = [], minus = [];
    for (let i=1;i<candles.length;i++){
      const cur=candles[i], prev=candles[i-1];
      const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
      trs.push(tr);
      const up = cur.high - prev.high;
      const down = prev.low - cur.low;
      plus.push(up>down && up>0 ? up : 0);
      minus.push(down>up && down>0 ? down : 0);
    }
    const smTR = [], smP = [], smM = [];
    for (let i=0;i<trs.length;i++){
      if (i < period){
        smTR[i] = (smTR[i-1]||0) + trs[i];
        smP[i] = (smP[i-1]||0) + plus[i];
        smM[i] = (smM[i-1]||0) + minus[i];
      } else {
        smTR[i] = (smTR[i-1] - smTR[i-1]/period + trs[i]);
        smP[i] = (smP[i-1] - smP[i-1]/period + plus[i]);
        smM[i] = (smM[i-1] - smM[i-1]/period + minus[i]);
      }
    }
    const pDI = smP.map((v,i)=>100*(v/smTR[i]||0));
    const mDI = smM.map((v,i)=>100*(v/smTR[i]||0));
    const dx = pDI.map((v,i)=> {
      const denom = (v + mDI[i]) || 1;
      return Math.abs(v - mDI[i]) / denom * 100;
    });
    const adxOut = []; for (let i=0;i<dx.length;i++){
      if (i < period){ if (i===period-1){ const avg = dx.slice(0,period).reduce((s,x)=>s+x,0)/period; adxOut.push(avg); } else adxOut.push(0); }
      else { const prev = adxOut[adxOut.length-1]; adxOut.push(( (prev*(period-1)) + dx[i] ) / period); }
    }
    while(adxOut.length < candles.length) adxOut.unshift(0);
    return adxOut;
  }

  function atr(candles, period=14){
    if (!candles || candles.length < period+1) return Array(candles.length).fill(0);
    const trs=[];
    for (let i=1;i<candles.length;i++){ const cur=candles[i], prev=candles[i-1]; trs.push(Math.max(cur.high-cur.low, Math.abs(cur.high-prev.close), Math.abs(cur.low-prev.close))); }
    let prevAvg = trs.slice(0,period).reduce((s,x)=>s+x,0)/period;
    const out=[prevAvg];
    for (let i=period;i<trs.length;i++){ prevAvg = ( (prevAvg * (period-1)) + trs[i] ) / period; out.push(prevAvg); }
    while(out.length < candles.length) out.unshift(0);
    return out;
  }

  function detectPattern(candles){
    const n=candles.length; if(n<2) return null;
    const prev=candles[n-2], cur=candles[n-1];
    const prevBody=Math.abs(prev.close - prev.open), curBody=Math.abs(cur.close - cur.open);
    if(prev.close < prev.open && cur.close > cur.open && cur.open <= prev.close && cur.close >= prev.open && curBody > prevBody*0.6) return 'bullish_engulfing';
    if(prev.close > prev.open && cur.close < cur.open && cur.open >= prev.close && cur.close <= prev.open && curBody > prevBody*0.6) return 'bearish_engulfing';
    const body=curBody, range=cur.high - cur.low;
    if(range>0){
      if((cur.high - Math.max(cur.open,cur.close))/range > 0.65 && body/range < 0.25) return 'pinbar_bear';
      if((Math.min(cur.open,cur.close)-cur.low)/range > 0.65 && body/range < 0.25) return 'pinbar_bull';
    }
    return null;
  }

  function aggregateCandles(candles, minutes){
    const map = new Map();
    for(const c of candles){
      const slot = Math.floor(c.time/(minutes*60000))*(minutes*60000);
      if(!map.has(slot)) map.set(slot,[]);
      map.get(slot).push(c);
    }
    const out = [];
    for(const [t, group] of [...map.entries()].sort((a,b)=>a[0]-b[0])){
      const open = group[0].open;
      const close = group[group.length-1].close;
      const high = Math.max(...group.map(x=>x.high));
      const low = Math.min(...group.map(x=>x.low));
      const ticks = group.reduce((s,g)=>s+(g.ticks||0),0);
      out.push({ time:t, open, high, low, close, ticks });
    }
    return out;
  }

  // --- evaluateSignal (strict combo rules) ---
  function evaluateSignal(){
    buildCandlesFromTicks();
    const c = state.candles;
    if (!c || c.length < 40) return { found:false, reason:'not-enough-data' };

    const closes = c.map(x=>x.close);
    const ema9 = ema(closes,9);
    const ema21 = ema(closes,21);
    const r = rsi(closes,14);
    const adxArr = adx(c,14);
    const atrArr = atr(c,14);

    // 5-minute confirmation
    const c5 = aggregateCandles(c,5);
    const closes5 = c5.map(x=>x.close);
    const ema9_5 = ema(closes5,9);
    const ema21_5 = ema(closes5,21);

    const n = c.length-1;
    const last = c[n];
    const lastClose = last.close;
    const ema9v = ema9[n];
    const ema21v = ema21[n];
    const rsiv = r[n];
    const adxv = adxArr[n] || 0;
    const atrv = atrArr[n] || 0;

    const minutes = [...state.ticksPerMinute.keys()].sort((a,b)=>b-a);
    const lastMin = minutes[0] || Math.floor(Date.now()/60000)*60000;
    const lastTicks = state.ticksPerMinute.get(lastMin) || 0;
    const prev = minutes.slice(1,21).map(k=>state.ticksPerMinute.get(k)||0);
    const avgPrev = prev.length ? (prev.reduce((s,x)=>s+x,0)/prev.length) : (lastTicks||1);
    const tickRatio = avgPrev > 0 ? (lastTicks / avgPrev) : 1;
    const atrPct = atrv && lastClose ? (atrv / lastClose) : 0;

    const tf5_up = (ema9_5.length && ema21_5.length) ? (ema9_5[ema9_5.length-1] > ema21_5[ema9_5.length-1]) : false;
    const tf5_down = (ema9_5.length && ema21_5.length) ? (ema9_5[ema9_5.length-1] < ema21_5[ema9_5.length-1]) : false;

    const nearEma9 = Math.abs(lastClose - ema9v) / lastClose < 0.0018;
    const pattern = detectPattern(c);

    const candidateUp = (ema9v > ema21v) && tf5_up && (rsiv > 54 && rsiv < 67) && adxv > 18 && atrPct < 0.006;
    const candidateDown = (ema9v < ema21v) && tf5_down && (rsiv < 46 && rsiv > 33) && adxv > 18 && atrPct < 0.006;

    let score = 40;
    if (tf5_up || tf5_down) score += 12;
    if (Math.abs(ema9v - ema21v) / lastClose > 0.0009) score += 10;
    if (adxv > 25) score += 12;
    if (pattern) score += 18;
    if (nearEma9) score += 10;
    if (tickRatio > 0.6 && tickRatio < 3) score += 8;
    if ((rsiv > 57 && rsiv < 63) || (rsiv < 43 && rsiv > 37)) score += 8;
    if (score > 100) score = 100;

    const minScore = 80;

    if (candidateUp && (pattern && pattern.startsWith('bull') || nearEma9) && score >= minScore && adxv >= 18 && atrPct < 0.006){
      return {
        found: true,
        type: 'UP',
        accuracy: score,
        reason: \`Pro: EMA9>EMA21 (1m+5m) + RSI \${Math.round(rsiv)} + ADX \${Math.round(adxv)} + \${pattern||'pullback'}\`,
        last: { time: last.time, price: lastClose, ema9: ema9v, ema21: ema21v, rsi: rsiv, adx: adxv, atr: atrv, ticks: last.ticks }
      };
    }
    if (candidateDown && (pattern && pattern.startsWith('bear') || nearEma9) && score >= minScore && adxv >= 18 && atrPct < 0.006){
      return {
        found: true,
        type: 'DOWN',
        accuracy: score,
        reason: \`Pro: EMA9<EMA21 (1m+5m) + RSI \${Math.round(rsiv)} + ADX \${Math.round(adxv)} + \${pattern||'pullback'}\`,
        last: { time: last.time, price: lastClose, ema9: ema9v, ema21: ema21v, rsi: rsiv, adx: adxv, atr: atrv, ticks: last.ticks }
      };
    }

    return { found: false, reason: 'no-safe-setup', score };
  }

  // Expose evaluator
  window.__qsig_evaluate = function(){ try{ return evaluateSignal(); }catch(e){ return { found:false, reason:'eval-error' }; } };

  // Heartbeat
  setInterval(()=>{
    try{
      buildCandlesFromTicks();
      const c = state.candles;
      const last = c[c.length-1] || null;
      window.postMessage({ __qsig: true, type: 'status', data: { last, candleCount: c.length } }, '*');
    }catch(e){}
  }, 2000);

})();
`;
