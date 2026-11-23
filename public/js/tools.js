'use strict';
(() => {
  const form = document.getElementById('evm');
  const out = document.getElementById('evm-out');
  if (!form || !out) return;
  const n = (name) => parseFloat(form.elements[name].value) || 0;
  const f2 = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'n/a');
  const idx = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
  function calc() {
    const bac = n('bac'), pv = n('pv'), ev = n('ev'), ac = n('ac');
    const spi = pv ? ev / pv : NaN, cpi = ac ? ev / ac : NaN;
    const eac = cpi ? bac / cpi : NaN;
    const tcpi = bac - ac ? (bac - ev) / (bac - ac) : NaN;
    const cells = [
      ['SPI', idx(spi), spi >= 1 ? 'good' : 'bad', 'Schedule performance'],
      ['CPI', idx(cpi), cpi >= 1 ? 'good' : 'bad', 'Cost performance'],
      ['SV', f2(ev - pv), ev - pv >= 0 ? 'good' : 'bad', 'Schedule variance'],
      ['CV', f2(ev - ac), ev - ac >= 0 ? 'good' : 'bad', 'Cost variance'],
      ['EAC', f2(eac), '', 'Estimate at completion'],
      ['ETC', f2(eac - ac), '', 'Estimate to complete'],
      ['VAC', f2(bac - eac), bac - eac >= 0 ? 'good' : 'bad', 'Variance at completion'],
      ['TCPI', idx(tcpi), '', 'To-complete performance index'],
    ];
    out.innerHTML = cells.map(([k, v, c, d]) => `<div class="res ${c}"><b>${v}</b><span>${k} &middot; ${d}</span></div>`).join('');
  }
  form.addEventListener('input', calc);
  calc();
})();
