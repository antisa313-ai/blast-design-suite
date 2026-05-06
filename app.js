// ─── SERVICE WORKER REGISTRATION ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(r => console.log('[SW] Registered:', r.scope))
      .catch(e => console.warn('[SW] Failed:', e));
  });
}

// ─── STATE ────────────────────────────────────────────────────────────────
let state = {
  tab: 0,
  params: {
    dia: 165, holeDepth: 12, sgRock: 2.5,
    sgExplosive: 1.1, pf: 0.35,
    stemming_ratio: 0.7, subdrill_ratio: 0.3, spacing_ratio: 1.15,
  },
  burdenMode: 'auto',   // 'auto' | 'manual'
  burdenManual: 3.5,    // nilai manual burden (m)
  grid: { rows: 3, cols: 5 },
  delays: { holeDelay: 25, rowDelay: 42 },
  pattern: 'row',
  detonatorType: 'nonel',
  history: [],
};

// Load from localStorage
try {
  const saved = localStorage.getItem('blastState');
  if (saved) state = { ...state, ...JSON.parse(saved), tab: 0 };
} catch(e) {}

function saveState() {
  try { localStorage.setItem('blastState', JSON.stringify(state)); } catch(e) {}
}

// ─── FORMULAS ─────────────────────────────────────────────────────────────
function calcBurdenAuto(p) {
  const D = p.dia / 1000;
  let B = D * 33 * Math.pow(p.sgExplosive / p.sgRock, 1/3) * Math.pow(p.pf / 0.4, -1/3);
  B = Math.max(B, D * 20);
  return Math.round(B * 100) / 100;
}

function calcGeo(p) {
  const D = p.dia / 1000;
  const B = state.burdenMode === 'manual'
    ? Math.round(state.burdenManual * 100) / 100
    : calcBurdenAuto(p);
  const S = Math.round(p.spacing_ratio * B * 100) / 100;
  const T = Math.round(p.stemming_ratio * B * 100) / 100;
  const J = Math.round(p.subdrill_ratio * B * 100) / 100;
  return { B, S, T, J, D };
}

function calcCharge(p, geo) {
  const D = p.dia / 1000;
  const chargeLength = Math.max(0, p.holeDepth - geo.T);
  const chargeKg = Math.PI * Math.pow(D/2, 2) * chargeLength * p.sgExplosive * 1000;
  return { chargeLength: Math.round(chargeLength*100)/100, chargeKg: Math.round(chargeKg*10)/10 };
}

function calcVol(geo, p, rows, cols) {
  const benchHeight = p.holeDepth - geo.J;
  const volPerHole = geo.B * geo.S * benchHeight;
  const totalHoles = rows * cols;
  return {
    benchHeight: Math.round(benchHeight*100)/100,
    volPerHole: Math.round(volPerHole*10)/10,
    totalVol: Math.round(volPerHole * totalHoles * 10)/10,
    totalHoles,
  };
}

function calcDelayMap(rows, cols, delays, pattern) {
  const map = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let d = 0;
      if (pattern === 'row') d = r * delays.rowDelay + c * delays.holeDelay;
      else if (pattern === 'echelon') d = (r + c) * delays.holeDelay;
      else { const mid = Math.floor(cols/2); d = r * delays.rowDelay + Math.abs(c - mid) * delays.holeDelay; }
      map[`${r},${c}`] = d;
    }
  }
  return map;
}

// ─── STYLES ───────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: #0a0e1a; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
  
  .header { background: linear-gradient(135deg, #0f172a 0%, #0a0e1a 100%);
    border-bottom: 1px solid #1e2d45; padding: 16px 16px 0; position: sticky; top: 0; z-index: 100; }
  .header-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .header-icon { width: 40px; height: 40px; background: #f59e0b; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
  .header-title { font-size: 18px; font-weight: 900; color: #fff; }
  .header-sub { font-size: 11px; color: #94a3b8; }
  .offline-badge { background: #7c3aed; color: #fff; font-size: 10px; padding: 2px 8px;
    border-radius: 20px; margin-left: auto; flex-shrink: 0; }
  
  .tabs { display: flex; gap: 2px; }
  .tab { flex: 1; padding: 10px 4px; background: transparent; border: none; border-bottom: 3px solid transparent;
    color: #4b5563; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
    text-align: center; letter-spacing: 0.03em; }
  .tab.active { color: #f59e0b; border-bottom-color: #f59e0b; }
  
  .content { padding: 16px; padding-bottom: 80px; }
  
  .card { background: #111827; border: 1px solid #1e2d45; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .card-title { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .card-title-icon { font-size: 18px; }
  .card-title-text { font-weight: 800; font-size: 14px; color: #fbbf24; letter-spacing: 0.05em; }
  
  .field { margin-bottom: 14px; }
  .field-label { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .field-name { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; }
  .field-unit { font-size: 11px; color: #4b5563; }
  .field input { width: 100%; }
  .field input[type=text] { background: #0d1424; border: 1px solid #1e2d45; border-radius: 8px;
    color: #e2e8f0; padding: 10px 12px; font-size: 15px; font-family: 'JetBrains Mono', monospace;
    outline: none; transition: border-color 0.2s; -webkit-appearance: none; }
  .field input[type=text]:focus { border-color: #f59e0b; box-shadow: 0 0 0 2px #f59e0b22; }
  input[type=range] { -webkit-appearance: none; height: 6px; border-radius: 3px;
    background: #1e2d45; outline: none; margin-top: 8px; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px;
    border-radius: 50%; background: #f59e0b; cursor: pointer; box-shadow: 0 0 6px #f59e0b88; }
  
  .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .result-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .result-box { background: #0d1424; border: 1px solid #1e2d45; border-radius: 10px;
    padding: 12px; text-align: center; }
  .result-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 6px; }
  .result-value { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px; color: #f59e0b; }
  .result-value.blue { color: #38bdf8; }
  .result-value.green { color: #34d399; }
  .result-value.red { color: #f87171; }
  .result-unit { font-size: 11px; color: #4b5563; margin-left: 3px; }
  
  .result-row { display: flex; justify-content: space-between; align-items: center;
    padding: 10px 0; border-bottom: 1px solid #1e2d45; }
  .result-row:last-child { border-bottom: none; }
  .result-row-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
  .result-row-val { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 16px; color: #f59e0b; }
  
  .radio-group { display: flex; flex-direction: column; gap: 8px; }
  .radio-option { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    background: #0d1424; border: 1px solid #1e2d45; border-radius: 8px; cursor: pointer; font-size: 13px; }
  .radio-option.selected { background: #78350a22; border-color: #f59e0b; color: #fbbf24; }
  .radio-option input { accent-color: #f59e0b; width: 16px; height: 16px; }
  
  canvas { width: 100%; border-radius: 10px; border: 1px solid #1e2d45; display: block; }
  
  .validate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .validate-box { padding: 10px 12px; border-radius: 10px; }
  .validate-box.ok { background: #0d2718; border: 1px solid #1a4a2e; }
  .validate-box.warn { background: #200d0d; border: 1px solid #4a1a1a; }
  .validate-name { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
  .validate-val { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 18px; margin: 4px 0; }
  .validate-status { font-size: 11px; }
  .validate-status.ok { color: #34d399; }
  .validate-status.warn { color: #f87171; }
  
  .save-btn { position: fixed; bottom: 20px; right: 16px; background: #f59e0b; color: #0a0e1a;
    border: none; border-radius: 50px; padding: 12px 24px; font-weight: 800; font-size: 14px;
    cursor: pointer; box-shadow: 0 4px 20px #f59e0b66; display: flex; align-items: center; gap: 8px;
    z-index: 200; }
  .toast { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: #1e3a2e; color: #34d399; border: 1px solid #34d399; padding: 10px 20px;
    border-radius: 50px; font-size: 13px; font-weight: 700; z-index: 300; opacity: 0;
    transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  
  .info-box { background: #0d1a2a; border-left: 3px solid #38bdf8; padding: 10px 12px;
    border-radius: 0 8px 8px 0; font-size: 12px; color: #94a3b8; margin-top: 10px; line-height: 1.6; }
  .info-box strong { color: #e2e8f0; }
  
  .section-divider { height: 1px; background: #1e2d45; margin: 16px 0; }
  
  @media (max-width: 380px) {
    .result-grid-3 { grid-template-columns: 1fr 1fr; }
    .result-value { font-size: 15px; }
  }

  .burden-toggle { display: flex; gap: 0; margin-bottom: 10px; border-radius: 8px; overflow: hidden; border: 1px solid #1e2d45; }
  .burden-toggle-btn { flex: 1; padding: 9px 4px; border: none; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 0.2s; letter-spacing: 0.04em; }
  .burden-toggle-btn.auto { background: #1e2d45; color: #94a3b8; }
  .burden-toggle-btn.auto.active { background: #38bdf8; color: #0a0e1a; }
  .burden-toggle-btn.manual { background: #1e2d45; color: #94a3b8; }
  .burden-toggle-btn.manual.active { background: #f59e0b; color: #0a0e1a; }
  .burden-auto-val { display: flex; align-items: center; justify-content: space-between;
    background: #0d1424; border: 1px solid #1e2d45; border-radius: 8px; padding: 10px 14px; }
  .burden-formula-tag { font-size: 10px; color: #38bdf8; background: #0d2030; 
    padding: 2px 8px; border-radius: 20px; border: 1px solid #1a3a50; }
`;

// ─── RENDER ENGINE ────────────────────────────────────────────────────────
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') el.className = v;
    else if (k.startsWith('on')) el[k.toLowerCase()] = v;
    else el.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (c === null || c === undefined) return;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return el;
}

function inputField(label, unit, value, onChange, opts = {}) {
  const id = 'f' + Math.random().toString(36).slice(2);
  
  // Use text input with decimal inputmode — fixes Android keyboard staying open
  // and allows typing "0.5" without workarounds
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.id = id;
  inp.value = String(value);
  inp.setAttribute('autocomplete', 'off');
  inp.setAttribute('autocorrect', 'off');
  inp.setAttribute('spellcheck', 'false');

  // On focus: select all so user can immediately type new value
  inp.addEventListener('focus', () => {
    setTimeout(() => inp.select(), 50);
  });

  // Allow typing freely — only parse & fire onChange on blur or Enter
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { inp.blur(); }
  });

  inp.addEventListener('blur', () => {
    // Replace comma with dot for Indonesian locale
    let raw = inp.value.replace(',', '.');
    // Strip anything that is not digit or dot or minus
    raw = raw.replace(/[^0-9.\-]/g, '');
    let num = parseFloat(raw);
    if (isNaN(num)) num = opts.min ?? 0;
    if (opts.min !== undefined) num = Math.max(opts.min, num);
    if (opts.max !== undefined) num = Math.min(opts.max, num);
    // Round to step precision
    if (opts.step !== undefined && opts.step < 1) {
      const decimals = String(opts.step).split('.')[1]?.length ?? 2;
      num = parseFloat(num.toFixed(decimals));
    }
    inp.value = String(num);
    onChange(num);
  });

  return h('div', { className: 'field' },
    h('div', { className: 'field-label' },
      h('label', { className: 'field-name', for: id }, label),
      unit ? h('span', { className: 'field-unit' }, unit) : null
    ),
    inp
  );
}

function resultBox(label, value, unit, colorClass = '') {
  const v = typeof value === 'number' ? value.toFixed(typeof value === 'number' && value < 10 ? 2 : 1) : value;
  return h('div', { className: 'result-box' },
    h('div', { className: 'result-label' }, label),
    h('div', { className: `result-value ${colorClass}` }, v,
      unit ? h('span', { className: 'result-unit' }, unit) : null
    )
  );
}

function resultRow(label, value, unit, colorClass = '') {
  const v = typeof value === 'number' ? value.toFixed(2) : value;
  return h('div', { className: 'result-row' },
    h('span', { className: 'result-row-label' }, label),
    h('span', { className: `result-row-val ${colorClass}` }, v,
      unit ? h('span', { className: 'result-unit' }, unit) : null
    )
  );
}

function cardWrap(icon, title, ...children) {
  return h('div', { className: 'card' },
    h('div', { className: 'card-title' },
      h('span', { className: 'card-title-icon' }, icon),
      h('span', { className: 'card-title-text' }, title)
    ),
    ...children
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────
function renderTab0() {
  const p = state.params;
  const geo = calcGeo(p);
  const charge = calcCharge(p, geo);
  const burdenAuto = calcBurdenAuto(p);
  const isManual = state.burdenMode === 'manual';

  const set = (k) => (v) => { state.params[k] = v; saveState(); renderApp(); };

  // Burden toggle buttons
  const btnAuto = h('button', { className: `burden-toggle-btn auto ${!isManual ? 'active' : ''}` }, '⚡ AUTO (Langefors)');
  btnAuto.addEventListener('click', () => { state.burdenMode = 'auto'; saveState(); renderApp(); });

  const btnManual = h('button', { className: `burden-toggle-btn manual ${isManual ? 'active' : ''}` }, '✏️ INPUT MANUAL');
  btnManual.addEventListener('click', () => {
    state.burdenMode = 'manual';
    state.burdenManual = burdenAuto; // seed with auto value
    saveState(); renderApp();
  });

  const toggleRow = h('div', { className: 'burden-toggle' }, btnAuto, btnManual);

  // Burden input area — auto shows read-only value; manual shows editable input
  const burdenArea = isManual
    ? inputField('Burden Manual (B)', 'm', state.burdenManual,
        v => { state.burdenManual = v; saveState(); renderApp(); },
        { min: 0.1, max: 30, step: 0.05 })
    : h('div', { className: 'field' },
        h('div', { className: 'field-label' },
          h('span', { className: 'field-name' }, 'Burden (B) — Otomatis'),
          h('span', { className: 'burden-formula-tag' }, 'Langefors')
        ),
        h('div', { className: 'burden-auto-val' },
          h('span', { style: 'font-family:JetBrains Mono,monospace;font-size:20px;font-weight:700;color:#38bdf8' },
            burdenAuto.toFixed(2), h('span', { style: 'font-size:12px;color:#4b5563;margin-left:4px' }, 'm')
          ),
          h('span', { style: 'font-size:11px;color:#4b5563' }, `min ${(geo.D*20).toFixed(2)} m`)
        )
      );

  return h('div', {},
    cardWrap('🔩', 'Parameter Pemboran',
      inputField('Diameter Lubang', 'mm', p.dia, set('dia'), { min: 50, max: 500 }),
      inputField('Kedalaman Lubang', 'm', p.holeDepth, set('holeDepth'), { min: 1, max: 50, step: 0.5 }),
      inputField('SG Batuan', 't/m³', p.sgRock, set('sgRock'), { min: 1, max: 4, step: 0.05 }),
    ),
    cardWrap('💥', 'Parameter Bahan Peledak',
      inputField('SG Bahan Peledak', 't/m³', p.sgExplosive, set('sgExplosive'), { min: 0.8, max: 1.8, step: 0.05 }),
      inputField('Powder Factor Target', 'kg/m³', p.pf, set('pf'), { min: 0.1, max: 2, step: 0.05 }),
    ),
    cardWrap('📏', 'Burden (B)',
      h('div', { style: 'margin-bottom:14px;font-size:12px;color:#94a3b8;line-height:1.6' },
        'Pilih mode: ', h('strong', { style: 'color:#e2e8f0' }, 'AUTO'), ' = dihitung dari formula Langefors, ',
        h('strong', { style: 'color:#e2e8f0' }, 'MANUAL'), ' = kamu tentukan sendiri.'
      ),
      toggleRow,
      h('div', { style: 'margin-top:12px' }, burdenArea),
      isManual ? h('div', { className: 'info-box', style: 'margin-top:10px' },
        h('strong', {}, 'Auto Langefors: '), `${burdenAuto.toFixed(2)} m  |  `,
        h('strong', {}, 'Selisih: '), `${Math.abs(state.burdenManual - burdenAuto).toFixed(2)} m`,
        ` (${((state.burdenManual/burdenAuto - 1)*100).toFixed(1)}%)`
      ) : null,
    ),
    cardWrap('📐', 'Rasio Desain',
      inputField('Stemming Ratio (T/B)', '', p.stemming_ratio, set('stemming_ratio'), { min: 0.5, max: 1.2, step: 0.05 }),
      inputField('Subdrill Ratio (J/B)', '', p.subdrill_ratio, set('subdrill_ratio'), { min: 0.1, max: 0.5, step: 0.05 }),
      inputField('Spacing Ratio (S/B)', '', p.spacing_ratio, set('spacing_ratio'), { min: 0.8, max: 2, step: 0.05 }),
    ),
    cardWrap('📊', 'Hasil Geometri',
      h('div', { className: 'result-grid' },
        h('div', { className: 'result-box', style: isManual ? 'border-color:#f59e0b' : 'border-color:#38bdf8' },
          h('div', { className: 'result-label' }, 'Burden (B) ' + (isManual ? '✏️' : '⚡')),
          h('div', { className: `result-value ${isManual ? '' : 'blue'}` }, geo.B.toFixed(2),
            h('span', { className: 'result-unit' }, 'm'))
        ),
        resultBox('Spacing (S)', geo.S, 'm'),
        resultBox('Stemming (T)', geo.T, 'm'),
        resultBox('Subdrill (J)', geo.J, 'm'),
      ),
      h('div', { style: 'margin-top:10px' },
        resultBox('Panjang Kolom Isian', charge.chargeLength, 'm', 'blue'),
      ),
      h('div', { className: 'info-box' },
        h('strong', {}, 'Mode Burden: '),
        isManual ? '✏️ Manual (input langsung)' : '⚡ Auto Langefors & Kihlström'
      )
    )
  );
}

function renderTab1() {
  const p = state.params;
  const g = state.grid;
  const d = state.delays;
  const geo = calcGeo(p);
  const vol = calcVol(geo, p, g.rows, g.cols);
  const totalDelay = state.pattern === 'row'
    ? (g.rows - 1) * d.rowDelay + (g.cols - 1) * d.holeDelay
    : (g.rows + g.cols - 2) * d.holeDelay;

  const setG = k => v => { state.grid[k] = v; saveState(); renderApp(); };
  const setD = k => v => { state.delays[k] = v; saveState(); renderApp(); };

  const canvas = h('canvas', { id: 'blastCanvas', width: '600', height: '360' });

  const wrap = h('div', {},
    cardWrap('🔲', 'Grid Lubang Ledak',
      inputField('Jumlah Baris', 'baris', g.rows, setG('rows'), { min: 1, max: 10, step: 1 }),
      inputField('Jumlah Kolom', 'kolom', g.cols, setG('cols'), { min: 1, max: 15, step: 1 }),
      h('div', { className: 'result-grid' },
        resultBox('Total Lubang', vol.totalHoles, 'lubang', 'blue'),
        resultBox('Total Volume', vol.totalVol, 'm³', 'green'),
      )
    ),
    cardWrap('⏱', 'Pola & Delay',
      h('div', { className: 'field' },
        h('div', { className: 'field-label' }, h('span', { className: 'field-name' }, 'Pola Peledakan')),
        h('div', { className: 'radio-group' },
          ...[ ['row','Row by Row (Baris per Baris)'], ['echelon','Echelon (Diagonal)'], ['v','V-Pattern (Chevron)'] ]
            .map(([val, lbl]) => {
              const opt = h('label', { className: `radio-option ${state.pattern === val ? 'selected' : ''}` },
                h('input', { type: 'radio', name: 'pattern', value: val, ...(state.pattern === val ? { checked: 'true' } : {}) }),
                lbl
              );
              opt.addEventListener('click', () => { state.pattern = val; saveState(); renderApp(); });
              return opt;
            })
        )
      ),
      inputField('Delay Antar Lubang', 'ms', d.holeDelay, setD('holeDelay'), { min: 5, max: 500, step: 1 }),
      inputField('Delay Antar Baris', 'ms', d.rowDelay, setD('rowDelay'), { min: 5, max: 1000, step: 1 }),
      h('div', { className: 'result-grid-3', style: 'margin-top:6px' },
        resultBox('Hole Delay', d.holeDelay, 'ms'),
        resultBox('Row Delay', d.rowDelay, 'ms'),
        resultBox('Total Waktu', totalDelay, 'ms', 'blue'),
      )
    ),
    cardWrap('🗺', 'Peta Rangkaian',
      canvas,
      h('div', { className: 'info-box' },
        'Warna = urutan detonasi. Angka dalam lubang = waktu delay (ms) dari detonasi pertama.'
      )
    ),
    cardWrap('🔌', 'Jenis Detonator',
      h('div', { className: 'radio-group' },
        ...[ ['nonel','Non-Electric (Nonel/LEDC)'], ['electric','Electric Detonator'], ['electronic','Electronic (Programmable)'] ]
          .map(([val, lbl]) => {
            const opt = h('label', { className: `radio-option ${state.detonatorType === val ? 'selected' : ''}` },
              h('input', { type: 'radio', name: 'dettype', value: val }),
              lbl
            );
            opt.addEventListener('click', () => { state.detonatorType = val; saveState(); renderApp(); });
            return opt;
          })
      )
    )
  );

  // Draw canvas after DOM mount
  setTimeout(() => drawCanvas(), 50);

  return wrap;
}

function drawCanvas() {
  const canvas = document.getElementById('blastCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const { rows, cols } = state.grid;
  const delays = state.delays;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  const mx = 55, my = 45;
  const aw = W - mx*2, ah = H - my*2;
  const cw = aw / Math.max(cols,1), ch = ah / Math.max(rows,1);
  const radius = Math.min(cw, ch) * 0.22;

  // Grid lines
  for (let r = 0; r <= rows; r++) {
    const y = my + r * ch;
    ctx.strokeStyle = '#1a2235'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx+aw, y); ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    const x = mx + c * cw;
    ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my+ah); ctx.stroke();
  }

  // Delay map
  const dmap = calcDelayMap(rows, cols, delays, state.pattern);
  const allD = Object.values(dmap);
  const uniq = [...new Set(allD)].sort((a,b)=>a-b);

  const getColor = (d) => {
    const idx = uniq.indexOf(d);
    const t = idx / Math.max(uniq.length-1, 1);
    const r = Math.round(255*(1-t)*0.9 + 50*t);
    const g = Math.round(200*t + 50*(1-t));
    const b = Math.round(50 + 100*t);
    return `rgb(${r},${g},${b})`;
  };

  // Connection lines
  ctx.setLineDash([3,4]); ctx.strokeStyle = '#1e3050'; ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols-1; c++) {
    const x1 = mx+c*cw+cw/2, y1 = my+r*ch+ch/2;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x1+cw,y1); ctx.stroke();
  }
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows-1; r++) {
    const x = mx+c*cw+cw/2, y1 = my+r*ch+ch/2;
    ctx.beginPath(); ctx.moveTo(x,y1); ctx.lineTo(x,y1+ch); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Holes
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = mx+c*cw+cw/2, y = my+r*ch+ch/2;
      const d = dmap[`${r},${c}`];
      const color = getColor(d);

      // Glow
      const grd = ctx.createRadialGradient(x,y,0,x,y,radius*2.5);
      grd.addColorStop(0, color+'44'); grd.addColorStop(1,'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x,y,radius*2.5,0,Math.PI*2); ctx.fill();

      // Circle
      ctx.fillStyle = '#0a0e1a'; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fill(); ctx.stroke();

      // Label
      const fs = Math.max(8, Math.min(radius*0.75, 13));
      ctx.fillStyle = color; ctx.font = `bold ${fs}px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d+'ms', x, y);
    }
  }

  // Axis labels
  ctx.fillStyle = '#4b5563'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('← SPACING →', W/2, H-8);
  ctx.save(); ctx.translate(12, H/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('← BURDEN →', 0, 0); ctx.restore();

  // Legend
  const lw = Math.min(180, W-30), lx = W-lw-10, ly = 8;
  for (let i = 0; i < 6; i++) {
    const t = i/5, dd = uniq[Math.floor(t*(uniq.length-1))];
    ctx.fillStyle = getColor(dd);
    ctx.fillRect(lx + i*(lw/6), ly, lw/6-1, 8);
  }
  ctx.fillStyle = '#4b5563'; ctx.font = '9px monospace';
  ctx.textAlign = 'left'; ctx.fillText('0ms', lx, ly+18);
  ctx.textAlign = 'right'; ctx.fillText(Math.max(...allD)+'ms', lx+lw, ly+18);
}

function renderTab2() {
  const p = state.params;
  const g = state.grid;
  const geo = calcGeo(p);
  const charge = calcCharge(p, geo);
  const vol = calcVol(geo, p, g.rows, g.cols);
  const totalExplosive = Math.round(charge.chargeKg * vol.totalHoles * 10) / 10;
  const actualPF = Math.round(totalExplosive / vol.totalVol * 1000) / 1000;
  const totalDelay = state.pattern === 'row'
    ? (g.rows-1)*state.delays.rowDelay + (g.cols-1)*state.delays.holeDelay
    : (g.rows+g.cols-2)*state.delays.holeDelay;

  const checks = [
    { label:'Rasio S/B', v: geo.S/geo.B, lo:1.0, hi:1.5 },
    { label:'Rasio T/B', v: geo.T/geo.B, lo:0.5, hi:1.0 },
    { label:'Rasio J/B', v: geo.J/geo.B, lo:0.2, hi:0.4 },
    { label:'PF Aktual', v: actualPF, lo:0.15, hi:1.5 },
    { label:'Isian/Depth', v: charge.chargeLength/p.holeDepth, lo:0.3, hi:0.9 },
    { label:'B/D Ratio', v: geo.B/(p.dia/1000), lo:20, hi:40 },
  ];

  const detLabel = { nonel:'Non-Electric (Nonel)', electric:'Electric', electronic:'Electronic (Programmable)' };

  return h('div', {},
    cardWrap('📦', 'Volume & Produksi',
      resultRow('Tinggi Jenjang', vol.benchHeight, 'm'),
      resultRow('Volume per Lubang', vol.volPerHole, 'm³'),
      resultRow('Total Lubang', vol.totalHoles, 'lubang', 'blue'),
      resultRow('Total Volume', vol.totalVol, 'm³', 'green'),
      resultRow('Total Tonase', Math.round(vol.totalVol*p.sgRock*10)/10, 'ton', 'green'),
    ),
    cardWrap('🧨', 'Kebutuhan Bahan Peledak',
      resultRow('Panjang Isian per Lubang', charge.chargeLength, 'm'),
      resultRow('Bahan Peledak per Lubang', charge.chargeKg, 'kg'),
      resultRow('Total Bahan Peledak', totalExplosive, 'kg', 'blue'),
      resultRow('Total Bahan Peledak', Math.round(totalExplosive/10)/100, 'ton', 'blue'),
      resultRow('Powder Factor Aktual', actualPF, 'kg/m³', actualPF > p.pf*1.3 ? 'red' : 'green'),
    ),
    cardWrap('🔌', 'Kebutuhan Detonator',
      resultRow('Jenis', detLabel[state.detonatorType] || '-'),
      resultRow('Jumlah Detonator', vol.totalHoles, 'pcs', 'blue'),
      resultRow('Total Waktu Peledakan', totalDelay, 'ms'),
    ),
    cardWrap('✅', 'Validasi Desain',
      h('div', { className: 'validate-grid' },
        ...checks.map(({ label, v, lo, hi }) => {
          const ok = v >= lo && v <= hi;
          return h('div', { className: `validate-box ${ok ? 'ok' : 'warn'}` },
            h('div', { className: 'validate-name' }, label),
            h('div', { className: `validate-val ${ok ? 'green' : 'red'}` }, v.toFixed(2)),
            h('div', { className: `validate-status ${ok ? 'ok' : 'warn'}` },
              ok ? `✓ OK (${lo}–${hi})` : `⚠ Range: ${lo}–${hi}`
            )
          );
        })
      )
    ),
    cardWrap('📐', 'Ringkasan Geometri',
      h('div', { className: 'result-grid' },
        resultBox('Burden', geo.B, 'm'),
        resultBox('Spacing', geo.S, 'm'),
        resultBox('Stemming', geo.T, 'm'),
        resultBox('Subdrill', geo.J, 'm'),
      )
    )
  );
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────
function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Style
  let styleEl = document.getElementById('appStyle');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'appStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;

  // Header
  const header = h('div', { className: 'header safe-top' },
    h('div', { className: 'header-top' },
      h('div', { className: 'header-icon' }, '💥'),
      h('div', {},
        h('div', { className: 'header-title' }, 'Blast Design Suite'),
        h('div', { className: 'header-sub' }, 'Geometri · Rangkaian · Delay')
      ),
      h('span', { className: 'offline-badge' }, '📡 Offline Ready')
    ),
    h('div', { className: 'tabs' },
      ...['Geometri', 'Rangkaian', 'Rekap'].map((t, i) => {
        const tab = h('button', { className: `tab ${state.tab === i ? 'active' : ''}` }, t);
        tab.addEventListener('click', () => { state.tab = i; renderApp(); });
        return tab;
      })
    )
  );

  // Content
  const content = h('div', { className: 'content' },
    state.tab === 0 ? renderTab0() :
    state.tab === 1 ? renderTab1() :
    renderTab2()
  );

  // Save button
  const saveBtn = h('button', { className: 'save-btn' }, '💾', ' Simpan');
  saveBtn.addEventListener('click', () => {
    saveState();
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  });

  const toast = h('div', { className: 'toast', id: 'toast' }, '✓ Data tersimpan!');

  app.append(header, content, saveBtn, toast);

  // Draw canvas if on tab 1
  if (state.tab === 1) setTimeout(drawCanvas, 80);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', renderApp);
