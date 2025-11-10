let apiUrl;
if (location.hostname === "localhost") {
  apiUrl = "http://localhost:5001";
} else {
  apiUrl = "https://api.pantsview.com";
}
// 顯示「Results: …」/ 設定總數
function setResultsLoading(on = true) {
const el = document.querySelector('#resCount, .resultsHead .counter');
if (!el) return;
el.textContent = on ? 'Results: …' : el.textContent;
}

function setResultsCount(n) {
const el = document.querySelector('#resCount, .resultsHead .counter');
if (!el) return;
el.textContent = `Results: ${n} ${n === 1 ? 'case' : 'cases'}`;
}


/* ===== helpers ===== */
// ✅ 安全版本（避免重複宣告）
window._showEl = window._showEl || function (sel, on) {
const n = typeof sel === 'string' ? document.querySelector(sel) : sel;
if (!n) return;
if (on) n.style.removeProperty('display');
else n.style.display = 'none';
};



// --- Profile helpers (HuggingFace) ---
function pad8(n){
const s = String(n ?? '').replace(/\D/g, '');
return s ? s.padStart(8, '0') : '';
}
async function profileURL(idNum){
const p = pad8(idNum);
if (!p) return '';
const res = await fetch(`https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/profile_only/PanTS_${p}/profile.jpg`);
if (!res.ok) return '';
const data = await res.blob();
const url = URL.createObjectURL(data);
return url;
}
function extractNumFromId(idStr){
const m = String(idStr || '').match(/\d+/);
return m ? Number(m[0]) : NaN;
}

const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const svg = (t, b = '#0f223b', f = '#94a3b8') => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${b}"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="18" fill="${f}">${t}</text></svg>`);
const vsvg = t => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0a0d18"/><text x="50%" y="50%" fill="#9aa3b2" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="16">${t}</text></svg>`);

const state = {
q: '',
sex: [],            // ['M','F','UNKNOWN']
tumor: '',
age_from: '',
age_to: '',
age_bin: [],        // ['0-9','10-19',...,'90-99','UNKNOWN']
sort_by: 'quality',
ct_phase: [],
manufacturer: [],
model: [],
study_type: [],
site_nat: [],
year: [],
per_page: 10000,
page: 1
};

let ALL_ITEMS = [], lastFetched = [];
let HAS_SEARCHED = false;

/* ---- UI helpers (safe, no re-declare) ---- */
window._toggleEl = window._toggleEl || function (selOrNode, on) {
const n = (typeof selOrNode === 'string') ? document.querySelector(selOrNode) : selOrNode;
if (!n) return;
if (on) n.style.removeProperty('display'); else n.style.display = 'none';
};

/* ---- Panels / Results refresh ---- */
function updatePanels() {
const searched = !!HAS_SEARCHED;
const count = searched ? (Number(window.LAST_TOTAL ?? (lastFetched?.length || 0)) || 0) : 0;

// 想要 0 筆也顯示 Results 標題：head、panel 都跟著 searched 顯示
const showHead   = searched;               // 0 筆也顯示「Results: 0 cases」
const showPanel  = searched;               // 0 筆保留右側結果面板的容器（不塞卡片）
const showCards  = searched && count > 0;  // 只有有結果才顯示卡片
const showBrowse = !showCards;             // 只要沒有卡片（含 0 筆）就顯示 Browse

// 更新數字
if (typeof setResultsCount === 'function') {
  setResultsCount(count);
} else {
  const counterEl = document.getElementById('counter') || document.querySelector('.counter');
  if (counterEl) counterEl.textContent = `Results: ${count} ${count === 1 ? 'case' : 'cases'}`;
}

// 顯示/隱藏主要區塊（注意：head/panel 永遠跟 searched，同步；cards 依 count）
window._toggleEl = window._toggleEl || function (selOrNode, on) {
  const n = (typeof selOrNode === 'string') ? document.querySelector(selOrNode) : selOrNode;
  if (!n) return; if (on) n.style.removeProperty('display'); else n.style.display = 'none';
};
window._toggleEl('.resultsHead', showHead);
window._toggleEl('#resultsPanel', showPanel);
window._toggleEl('#cards', showCards);
window._toggleEl('#recBar', showBrowse);

// Advanced 面板：多筆才顯示
const filt = document.getElementById('filters');
if (filt) {
  const showFilter = showCards && count > 1;
  filt.classList.toggle('show', showFilter);
  window._toggleEl(filt, showFilter);
}

// 單筆視覺
const mainEl  = document.querySelector('.main') || document.querySelector('.content') || document.querySelector('.twoCols');
const panelEl = document.getElementById('resultsPanel');
const cardsEl = document.getElementById('cards');

if (showCards && count === 1) {
  mainEl?.classList.add('singleResult');
  panelEl?.classList.add('spanAll');
  cardsEl?.classList.add('centerOne');
} else {
  mainEl?.classList.remove('singleResult');
  panelEl?.classList.remove('spanAll');
  cardsEl?.classList.remove('centerOne');
}

// 排序下拉（單筆時關閉；0 筆也關）
const sortSel = document.getElementById('sortBy');
if (sortSel) {
  const wrap = sortSel.closest('.sortWrap') || sortSel;
  if (count <= 1) {
    wrap.style.display = 'none';
    sortSel.disabled = true;
    if (state.sort_by !== 'quality') state.sort_by = 'quality';
  } else {
    wrap.style.display = '';
    sortSel.disabled = false;
  }
}
}


function wirePopSafe(root) {
if (!root) return;
const btn = root.querySelector('.popBtn');
if (!btn) return;

btn.addEventListener('click', (e) => {
  e.stopPropagation();
  root.classList.toggle('open');
  $$('.pop.open').forEach(p => { if (p !== root) p.classList.remove('open'); });
});

root.querySelector('.popPanel')?.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', (e) => { if (!root.contains(e.target)) root.classList.remove('open'); });
}
wirePopSafe(document.getElementById('popID'));
wirePopSafe(document.getElementById('popSTA'));

async function fetchJSON(u) {
const r = await fetch(u, { cache: 'no-store' });
if (!r.ok) throw new Error(await r.text());
return r.json();
}


/* quality helpers */
function idNum(x) { const m = String(x.case_id || x['PanTS ID'] || x.id).match(/\d+/) || [0]; return Number(m[0]); }
function isComplete(it) {
const sexOK = it.sex === 'M' || it.sex === 'F';
const ageOK = Number.isFinite(it.age) && it.age > 0;
const tumorOK = it.tumor === 0 || it.tumor === 1;
const spOK = Number.isFinite(it.spacing_sum) && it.spacing_sum > 0;
const shOK = Number.isFinite(it.shape_sum) && it.shape_sum > 0;
return sexOK && ageOK && tumorOK && spOK && shOK;
}
function compareQuality(a, b) {
const ca = isComplete(a), cb = isComplete(b);
if (ca !== cb) return cb - ca;
const s1 = (a.spacing_sum ?? 1e9) - (b.spacing_sum ?? 1e9);
if (s1 !== 0) return s1;
const s2 = (b.shape_sum ?? -1) - (a.shape_sum ?? -1);
if (s2 !== 0) return s2;
return idNum(a) - idNum(b);
}

/* Browse */
let recTimer = null, recPlaying = true;

async function initBrowse() {
try {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  const bar = $('#recScroll');
  if (!bar) return;
  bar.innerHTML = '';

  let source = [];
  if (ALL_ITEMS && ALL_ITEMS.length) {
    source = ALL_ITEMS;
  } else {
    const r = await fetchJSON('/api/random?n=60&k=120&scope=filtered');
    source = r.items || [];
  }

  const best = source.slice().sort(compareQuality).filter(isComplete).slice(0, 20);

  if (!best.length) {
    const empty = document.createElement('article');
    empty.className = 'card inRec';
    empty.innerHTML = `
      <div class="body" style="padding:12px 14px">
        <div class="titleRow"><span class="recId" style="font-weight:900">No items</span></div>
        <div class="keyRow" style="margin-top:6px;color:#93a4b8">Try adjusting filters, then Search</div>
      </div>`;
    bar.appendChild(empty);
    $('#recPrev')?.setAttribute('disabled', 'disabled');
    $('#recNext')?.setAttribute('disabled', 'disabled');
    $('#recPlay')?.setAttribute('disabled', 'disabled');
    return;
  } else {
    $('#recPrev')?.removeAttribute('disabled');
    $('#recNext')?.removeAttribute('disabled');
    $('#recPlay')?.removeAttribute('disabled');
  }

  const frag = document.createDocumentFragment();
  for (const it of best) {
    const card = await makeCard(it);
    card.classList.add('inRec');
    frag.appendChild(card);
  }
  bar.appendChild(frag);

  const vp = document.querySelector('.recViewport');
  const firstCard = bar.querySelector('.card') || bar.querySelector('.recCard');
  if (vp && firstCard) {
    const h = Math.ceil(firstCard.getBoundingClientRect().height);
    vp.style.minHeight = h + 'px';
  }

  const scroller = bar;
  const gap = 12;
  let step = firstCard ? (firstCard.getBoundingClientRect().width + gap) : 340;

  const atEnd = () =>
    (scroller.scrollLeft + scroller.clientWidth) >= (scroller.scrollWidth - 2);

  const tick = () => {
    if (atEnd()) scroller.scrollTo({ left: 0, behavior: 'smooth' });
    else scroller.scrollBy({ left: step, behavior: 'smooth' });
  };

  $('#recPrev').onclick = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); scroller.scrollBy({ left: -step, behavior: 'smooth' }); };
  $('#recNext').onclick = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); scroller.scrollBy({ left: +step, behavior: 'smooth' }); };
  $('#recPlay').onclick = (e) => {
    e?.preventDefault?.(); e?.stopPropagation?.();
    recPlaying = !recPlaying;
    $('#recPlay').textContent = recPlaying ? '⏸' : '▶';
    if (recPlaying) startAuto(); else stopAuto();
  };

  function startAuto() { stopAuto(); recTimer = setInterval(tick, 2600); }
  function stopAuto() { if (recTimer) { clearInterval(recTimer); recTimer = null; } }

  $('#recPlay').textContent = recPlaying ? '⏸' : '▶';
  if (recPlaying) startAuto();

  if (window._recResizeHandler) {
    window.removeEventListener('resize', window._recResizeHandler);
  }
  window._recResizeHandler = () => {
    const first = bar.querySelector('.card') || bar.querySelector('.recCard');
    step = first ? (first.getBoundingClientRect().width + gap) : 340;
  };
  window.addEventListener('resize', window._recResizeHandler, { passive: true });

  ['recPrev', 'recNext', 'recPlay'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.tabIndex = 0;
    if (!btn.getAttribute('aria-label')) {
      btn.setAttribute('aria-label', id === 'recPrev' ? 'Previous' : id === 'recNext' ? 'Next' : 'Pause/Play');
    }
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => {
      const k = e.key;
      const shouldClick =
        k === 'Enter' ||
        k === ' ' ||
        (id === 'recPrev' && k === 'ArrowLeft') ||
        (id === 'recNext' && k === 'ArrowRight') ||
        (id === 'recPlay' && (k === 'k' || k === 'K'));
      if (shouldClick) { e.preventDefault(); e.stopPropagation(); btn.click(); }
    });
  });
} catch (e) {
  console.warn('initBrowse failed:', e);
}
}

/* Lists / facets */
const SPLIT_RE = /[;,|/、，·・]+/;
const NAT_MAP = { 'USA': 'US', 'U.S.': 'US', 'U S A': 'US', 'GB': 'UK', 'U.K.': 'UK', 'N/A': 'NA', 'NULL': 'NA' };
const normToken = s => (s ?? '').toString().trim().toUpperCase();
const mapNat = code => NAT_MAP[normToken(code)] ?? normToken(code);
const splitTokens = (raw, mapper = x => x) => String(raw ?? '').split(SPLIT_RE).map(t => mapper(normToken(t))).filter(Boolean);
const pickField = (obj, cands) => { for (const k of cands) { if (Object.prototype.hasOwnProperty.call(obj, k)) { const v = obj[k]; if (v == null) continue; const s = String(v).trim(); if (s !== '' && s.toLowerCase() !== 'unknown') return v; } } return ''; };

/* --- 建立清單（初次） --- */
function buildFacetList(container, key, rows, hasLabel = false){
const box = document.getElementById(container);
if (!box) return;
box.innerHTML = '';

const validRows = (rows || [])
  .filter(r => (r.count ?? 0) > 0)
  .sort((a,b) => (b.count??0)-(a.count??0));

validRows.forEach(r => {
  const text = hasLabel ? (r.label || r.value) : r.value;
  const d = document.createElement('div');
  d.className = 'optRow';
  d.dataset.k = key;
  d.dataset.v = String(r.value);
  d.innerHTML = `<label><input type="checkbox" data-k="${key}" value="${r.value}"> <span class="lbl">${text}</span></label> <span class="count">${r.count ?? 0}</span>`;

  box.appendChild(d);
});

const fset = box.closest('.fset');
if (fset) fset.style.display = box.children.length ? '' : 'none';
}

/* --- Show more / less --- */
function wireShowMore(){
document.querySelectorAll('.showMore').forEach(btn=>{
  const targetId = btn.dataset.target;
  const limit = parseInt(btn.dataset.limit || '12', 10);
  const box = document.getElementById(targetId);
  if (!box) return;

  const apply = () => {
    const rows = Array.from(box.querySelectorAll('.optRow'))
      .filter(r => r.dataset.hiddenByCount !== '1'); // 被 count=0 隱藏的不列入分頁
    const expanded = box.classList.contains('expanded');
    rows.forEach((row, idx) => row.style.display = (expanded || idx < limit) ? 'flex' : 'none');
    btn.style.display = (rows.length > limit) ? '' : 'none';
    btn.textContent = expanded ? 'Show less' : 'Show more';
  };

  btn.addEventListener('click', () => { box.classList.toggle('expanded'); apply(); });
  box._applyPager = apply;  // 提供外部（更新數字後）重算
  apply();
});
}

/* --- 只更新數字；第一次之後固定（凍結） --- */
function updateFacetCounts(countPayload = {}){
const pairs = [
  ['ct_phase_opts', 'ct_phase'],
  ['manufacturer_opts', 'manufacturer'],
  ['model_opts', 'model'],
  ['type_opts', 'study_type'],
  ['nat_opts', 'site_nat'],
  ['year_opts', 'year']
];
pairs.forEach(([containerId, key]) => {
  const box = document.getElementById(containerId);
  if (!box) return;

  const rows = Array.from(box.querySelectorAll('.optRow'));
  const mp = Object.create(null);
  (countPayload[key] || []).forEach(r => { mp[String(r.value)] = r.count || 0; });

  let visibleByCount = 0;
  rows.forEach(row => {
    const input = row.querySelector('input');
    const val = row.dataset.v || (input ? input.value : '');
    const c = (val in mp) ? mp[val] : 0;
    const badge = row.querySelector('.count');
    if (badge) badge.textContent = c;

    const keepBecauseChecked = !!(input && input.checked);
    const shouldShow = (c > 0) || keepBecauseChecked;

    row.dataset.hiddenByCount = shouldShow ? '0' : '1';
    row.style.display = shouldShow ? 'flex' : 'none';
    if (shouldShow) visibleByCount++;
  });

  const fset = box.closest('.fset');
  if (fset) fset.style.display = visibleByCount ? '' : 'none';
});

// 更新數字後，讓每一組重新計算 Show more/less
;['ct_phase_opts','manufacturer_opts','model_opts','type_opts','nat_opts','year_opts']
  .forEach(id => document.getElementById(id)?._applyPager?.());
}

/* --- 收集 Advanced 勾選 → state --- */
function collectAdvanced() {
const pickVals = k => Array.from(document.querySelectorAll(`#filters input[type=checkbox][data-k="${k}"]:checked`))
  .map(i => String(i.value)).filter(v => v !== '');
state.ct_phase     = pickVals('ct_phase');
state.manufacturer = pickVals('manufacturer');
state.model        = pickVals('model');
state.study_type   = pickVals('study_type');
state.site_nat     = pickVals('site_nat');
state.year         = pickVals('year');
updateSTASummary?.();
}

/* --- 把 state 轉成查詢字串（facets / search 共用） --- */
function qsFromState() {
const p = new URLSearchParams();

if (state.q) p.set('caseid', state.q);

if (Array.isArray(state.sex) && state.sex.length) {
  state.sex.forEach(v => p.append('sex[]', v));
}
if (state.tumor !== '') p.set('tumor', state.tumor);

if (Array.isArray(state.age_bin) && state.age_bin.length) {
  state.age_bin.forEach(v => p.append('age_bin[]', v));
} else {
  if (state.age_from) p.set('age_from', state.age_from);
  if (state.age_to)   p.set('age_to',   state.age_to);
}

['ct_phase', 'manufacturer', 'model', 'study_type', 'site_nat', 'year']
  .forEach(k => (state[k] || []).forEach(v => p.append(k + '[]', v)));

if (state.sort_by)  p.set('sort_by',  state.sort_by);
if (state.page)     p.set('page',     state.page);
if (state.per_page) p.set('per_page', state.per_page);

return p.toString();
}

/* === Facet counts：只取一次，之後凍結 === */
let FROZEN_FACETS = null;

// async function refreshFacets() {
// try {
//   if (FROZEN_FACETS) {         // 已凍結 → 只用舊數字重繪
//     updateFacetCounts(FROZEN_FACETS);
//     return;
//   }
//   const qs  = qsFromState();   // 第一次取數字
//   const url = apiUrl + '/api/facets?fields=ct_phase,manufacturer,model,study_type,site_nat,year&top_k=999&guarantee=0&' + qs;
//   const f   = await fetchJSON(url);
//   FROZEN_FACETS = f?.facets || {};
//   updateFacetCounts(FROZEN_FACETS);
// } catch (err) {
//   console.warn('refreshFacets failed:', err);
// }
// }

/* === 一次性初始化：建立 Advanced 清單、綁定事件 === */
(async function primeUI() {
// 第一次先取（有 guarantee=1），用來建出清單
let f0 = { facets: {} };
try {
  f0 = await fetchJSON('/api/facets?fields=ct_phase,manufacturer,model,study_type,site_nat,year&top_k=999&guarantee=1');
} catch (e) {
  console.warn('facets fetch failed:', e);
}
const fx = f0?.facets || {};

// 建 facet 清單
try {
  if (document.getElementById('ct_phase_opts')) buildFacetList('ct_phase_opts', 'ct_phase', fx.ct_phase || []);
  if (document.getElementById('manufacturer_opts')) buildFacetList('manufacturer_opts', 'manufacturer', fx.manufacturer || []);
  if (document.getElementById('model_opts')) buildFacetList('model_opts', 'model',
    (fx.model || []).map(r => ({ value: r.value, label: r.label ?? r.value, count: r.count })), true);
  if (document.getElementById('type_opts')) buildFacetList('type_opts', 'study_type', fx.study_type || []);
  if (document.getElementById('nat_opts')) buildFacetList('nat_opts', 'site_nat',
    (fx.site_nat || []).map(r => ({ value: r.value, label: r.label ?? r.value, count: r.count })), true);
  if (document.getElementById('year_opts')) buildFacetList('year_opts', 'year',
    (fx.year || []).map(r => ({ value: String(r.value), count: r.count })));
} catch (e) {
  console.warn('build facet list failed:', e);
}

// 裝上 Show more/less
wireShowMore();

// 第一次的數字先補上（之後就凍結）
if (!FROZEN_FACETS) FROZEN_FACETS = fx;
updateFacetCounts(FROZEN_FACETS);

// 監聽 Advanced 勾選
const filtersEl = document.getElementById('filters');
if (filtersEl) {
  filtersEl.addEventListener('change', async e => {
    const cb = e.target?.closest?.('input[type=checkbox]');
    if (!cb) return;
    const key = cb.dataset.k;
    const isAny = (cb.value === '');
    if (isAny) {
      document.querySelectorAll(`#filters input[type=checkbox][data-k="${key}"]`).forEach(x => x.checked = (x === cb));
    } else {
      const any = document.querySelector(`#filters input[type=checkbox][data-k="${key}"][value=""]`);
      if (any) any.checked = false;
    }
    collectAdvanced();
    await refreshFacets();   // 這裡只會重繪凍結的數字
    if (HAS_SEARCHED) run();
  });
}
})();

/* Recent helpers（唯一版本） */
function saveRecent(id) {
try {
  const key = 'recentIds';
  const cur = JSON.parse(localStorage.getItem(key) || '[]');
  const idStr = String(id || '').trim();
  if (!idStr) return;
  const next = [idStr, ...cur.filter(x => x !== idStr)].slice(0, 12);
  localStorage.setItem(key, JSON.stringify(next));
} catch (e) {
  console.warn('saveRecent failed', e);
}
}

/* Results render */
const cardsEl = $('#cards');
let rendered = 0;
const BATCH = 60;
let current = [];

function sorter(items) {
const s = state.sort_by || 'quality';
if (s === 'spacing_asc') return items.slice().sort((a, b) => (a.spacing_sum ?? 1e9) - (b.spacing_sum ?? 1e9));
if (s === 'shape_desc') return items.slice().sort((a, b) => (b.shape_sum ?? -1) - (a.shape_sum ?? -1));
if (s === 'age_asc')    return items.slice().sort((a, b) => (a.age ?? 1e9) - (b.age ?? 1e9));
if (s === 'age_desc')   return items.slice().sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
if (s === 'id_asc')     return items.slice().sort((a, b) => idNum(a) - idNum(b));
if (s === 'id_desc')    return items.slice().sort((a, b) => idNum(b) - idNum(a));
return items.slice().sort(compareQuality);
}

/* 控制排序下拉的顯示/隱藏（只有 1 筆或 0 筆就藏起來） */
function updateSortVisibility() {
const sel = document.getElementById('sortBy');
if (!sel) return;

const wrap = sel.closest('.sortWrap') || sel;
const count = Array.isArray(lastFetched) ? lastFetched.length : 0;
const enable = count > 1;

if (!enable) {
  wrap.style.display = 'none';
  sel.disabled = true;
  // 回到預設排序，避免顯示誤導
  if (state.sort_by !== 'quality') state.sort_by = 'quality';
  if (sel.value !== 'quality') sel.value = 'quality';
} else {
  wrap.style.display = '';
  sel.disabled = false;
}
}


async function makeCard(it) {
const id = String(it.case_id || it['PanTS ID'] || it.id || '');
const sex = it.sex || '—';
const age = Number.isFinite(it.age) ? `${it.age}y` : '—';
const tumor = (it.tumor === 1 ? 'Tumor' : (it.tumor === 0 ? 'No tumor' : '—'));

const thumbURL = (typeof profileURL === 'function' && typeof idNum === 'function')
  ? await profileURL(idNum(it))
  : null;

const wrap = document.createElement('article');
wrap.className = 'card';
wrap.innerHTML = `
  <img class="thumb" src="${thumbURL || svg('2D Image')}"
        onerror="this.src='${svg('2D Image')}'" alt="">
  <div class="body">
    <div class="titleRow">
      <a href="javascript:void(0)" class="caseLink" data-id="${id}">
        ${id.replace(/^Case\\s*/, '')}
      </a>
    </div>
    <div class="keyRow">
      <span class="kv"><span class="k">Sex</span><span class="v">${sex}</span></span>
      <span class="kv"><span class="k">Age</span><span class="v">${age}</span></span>
      <span class="kv"><span class="tag ${tumor === 'No tumor' ? 'ok' : 'bad'}">${tumor}</span></span>
    </div>
  </div>`;

const open = () => { saveRecent(id); openViewer(id); };
wrap.querySelector('.caseLink')?.addEventListener('click', open);
wrap.querySelector('.thumb')?.addEventListener('click', open);
return wrap;
}

async function renderMore() {
if (rendered >= current.length) return;
const fr = document.createDocumentFragment();
const end = Math.min(rendered + BATCH, current.length);
for (let i = rendered; i < end; i++) fr.appendChild(await makeCard(current[i]));
cardsEl.appendChild(fr);
rendered = end;
}

window.addEventListener('scroll', () => {
const near = (window.innerHeight + window.scrollY) > (document.body.offsetHeight - 800);
if (near) renderMore();
});

// === 全域搜尋狀態（若已存在就沿用）===
window.state = window.state || {
q: '',
sex: [],             // ['M','F'] 之一或多選
tumor: '',           // '' | '1' | '0'
age_bin: [],         // 例如 ['20-29','30-39'] 或 ['UNKNOWN']
age_from: '',        // 自由輸入數字字串
age_to: '',
ct_phase: [],
manufacturer: [],
model: [],
study_type: [],
site_nat: [],
year: [],
sort_by: '',         // 'quality' 等
page: 1,
per_page: 60
};

// === 把 state 轉成查詢字串，供 facets / search 用 ===
qsFromState = () => {
const p = new URLSearchParams();

if (state.q) p.set('caseid', state.q);

// sex 多選
if (Array.isArray(state.sex) && state.sex.length) {
  state.sex.forEach(v => p.append('sex[]', v));
}

// tumor
if (state.tumor !== '') p.set('tumor', state.tumor);

// age：優先 bins，否則 from/to
if (Array.isArray(state.age_bin) && state.age_bin.length) {
  state.age_bin.forEach(v => p.append('age_bin[]', v));
} else {
  if (state.age_from) p.set('age_from', state.age_from);
  if (state.age_to)   p.set('age_to',   state.age_to);
}

// 進階 facets 多選
['ct_phase','manufacturer','model','study_type','site_nat','year']
  .forEach(k => (state[k] || []).forEach(v => p.append(k + '[]', v)));

if (state.sort_by)  p.set('sort_by',  state.sort_by);
if (state.page)     p.set('page',     String(state.page));
if (state.per_page) p.set('per_page', String(state.per_page));

return p.toString();
}

// （若你沒有 fetchJSON，補一個簡單版）
window.fetchJSON = window.fetchJSON || (async function(url, opt){
const r = await fetch(url, opt);
if (!r.ok) throw new Error('HTTP ' + r.status);
return r.json();
});

async function refreshFacets() {
try {
  // 已經凍結 → 只重繪，不再打後端
  if (FROZEN_FACETS) {
    updateFacetCounts(FROZEN_FACETS);
    return;
  }
  // 第一次才取
  const qs  = qsFromState();
  const url = '/api/facets?fields=ct_phase,manufacturer,model,study_type,site_nat,year&top_k=999&guarantee=0&' + qs;
  const f   = await fetchJSON(url);
  FROZEN_FACETS = f?.facets || {};
  updateFacetCounts(FROZEN_FACETS);
} catch (err) {
  console.warn('refreshFacets failed:', err);
}
}

/* ---- 搜尋執行（統一入口） ---- */
function triggerSearch() {
const qBox = document.getElementById('q');
state.q = (qBox?.value || '').trim();
HAS_SEARCHED = true;
// 關掉彈窗
document.getElementById('popID')?.classList.remove('open');
document.getElementById('popSTA')?.classList.remove('open');
run();
}
// ===== Recommended IDs =====
let ID_RECO = [];          // 快取推薦
let ID_RECO_AT = 0;        // 最近抓取時間戳（毫秒）
const RECO_TTL = 60*1000;  // 1 分鐘內不重抓

function dedup(arr) {
const seen = new Set(); const out = [];
for (const x of arr) { const k = String(x); if (!seen.has(k)) { seen.add(k); out.push(k); } }
return out;
}

// 取出最近瀏覽
function getRecentIds() {
try { return JSON.parse(localStorage.getItem('recentIds')||'[]'); } catch { return []; }
}

// 生成 chip 按鈕
function makeIdChip(id) {
const b = document.createElement('button');
b.className = 'chip';
b.textContent = id;
b.addEventListener('click', () => {
  const q = document.getElementById('q');
  if (q) q.value = id;
  state.q = id;
  HAS_SEARCHED = true;
  run();
  document.getElementById('popID')?.classList.remove('open');
});
return b;
}

// 繪製「最近瀏覽」
function renderRecent() {
const box = document.getElementById('idRecent');
if (!box) return;
const r = getRecentIds();
box.innerHTML = '';
if (!r.length) { box.innerHTML = '<span class="recMeta">No recent</span>'; return; }
dedup(r).slice(0, 12).forEach(id => box.appendChild(makeIdChip(id)));
}

// 抓取推薦（有快取）
async function fetchRecommended() {
const now = Date.now();
if (ID_RECO.length && (now - ID_RECO_AT) < RECO_TTL) return ID_RECO;

try {
  // 以「品質」做推薦，最多 12 筆；你也可以換成其他排序
  const url = '/api/search?per_page=12&sort_by=quality';
  const data = await fetchJSON(url);
  const items = Array.isArray(data?.items) ? data.items : [];
  ID_RECO = items
    .map(it => String(it.case_id || it['PanTS ID'] || it.id || ''))
    .filter(Boolean);
  ID_RECO_AT = now;
} catch (e) {
  console.warn('fetchRecommended failed', e);
  ID_RECO = [];
}
return ID_RECO;
}

// 繪製「Recommended IDs」
async function renderIdRecommendations() {
const box = document.getElementById('idReco');
if (!box) return;
box.innerHTML = '<span class="recMeta">Loading…</span>';

// 先抓推薦；抓不到就用最近瀏覽頂上
let list = await fetchRecommended();
if (!list || !list.length) list = getRecentIds();

box.innerHTML = '';
if (!list.length) {
  box.innerHTML = '<span class="recMeta">No suggestions</span>';
  return;
}
dedup(list).slice(0, 12).forEach(id => box.appendChild(makeIdChip(id)));
}

// ===== 事件：開啟彈窗時重新渲染 =====
(function bindIdPop() {
const wrap = document.getElementById('popID');
const input = document.getElementById('q');
if (!wrap || !input) return;

// 打開彈窗
const open = async () => {
  wrap.classList.add('open');
  await renderIdRecommendations();
  renderRecent();
};
// 關閉彈窗
const close = () => wrap.classList.remove('open');

// 聚焦/點擊打開，按 Esc 關閉
input.addEventListener('focus', open);
input.addEventListener('click', open);
input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

// 點擊外面區域就關閉
document.addEventListener('click', (e) => {
  if (!wrap.contains(e.target)) close();
});
})();
/* ---- Search 按鈕 ---- */
document.getElementById('searchBtn')?.addEventListener('click', (e) => {
e.preventDefault();
e.stopPropagation();
// 統一走主流程，避免重複請求 & 數字閃爍
triggerSearch();
});

/* ---- 在輸入框按 Enter 搜尋、按 Esc 清空並搜尋全部 ---- */

const qInput = document.getElementById('q');
qInput?.addEventListener('keydown', (e) => {
if (e.key === 'Enter') {
  e.preventDefault();
  triggerSearch();
} else if (e.key === 'Escape') {
  qInput.value = '';
  triggerSearch(); // 空字串 → 搜尋全部
}
});


/* ---- Search run ---- */
async function run() {
// 1) 同步查詢字串
const qBox  = document.getElementById('q');
const query = (qBox?.value || '').trim();
state.q = query;

// 2) 先刷新 facets（照你原流程）
await refreshFacets();

// 3) 打第一次 /api/search
const p = new URLSearchParams(qsFromState());
p.set('per_page', '10000');
let data = await fetchJSON('/api/search?' + p.toString());
lastFetched = (data.items || []).filter(Boolean);

// 4) 僅在「沒有任何條件且 0 筆」時才 fallback 抓全量
const hasAnyFilter = (() => {
  const arrLen = k => Array.isArray(state[k]) ? state[k].length : 0;
  return !!(state.q ||
    arrLen('sex') || state.tumor !== '' ||
    state.age_from || state.age_to || arrLen('age_bin') ||
    arrLen('ct_phase') || arrLen('manufacturer') || arrLen('model') ||
    arrLen('study_type') || arrLen('site_nat') || arrLen('year'));
})();

if (!hasAnyFilter && query === '' && lastFetched.length === 0) {
  data = await fetchJSON('/api/search?per_page=10000&sort_by=id');
  lastFetched = (data.items || []).filter(Boolean);
}

// 5) 前端自訂過濾（保留你的原本邏輯）
const norm = s => String(s ?? '').trim().toLowerCase();
lastFetched = lastFetched.filter(it => {
  const hasAll = (selected, value) => selected.length === 0 || selected.some(v => norm(v) === norm(value));
  const overlap = (selected, tokens) => {
    if (selected.length === 0) return true;
    const sel = selected.map(norm);
    return tokens.some(t => sel.includes(norm(t)));
  };
  const model = pickField(it, ['manufacturer model', 'Manufacturer model', 'model', 'Model']);
  if (!hasAll(state.model, model)) return false;

  const types = splitTokens(pickField(it, ['study type', 'Study type', 'study_type', 'type', 'Type']));
  const nats  = splitTokens(pickField(it, ['site nationality', 'Site nationality', 'site_nat', 'nationality', 'country', 'Country']), mapNat);
  const year  = pickField(it, ['study year', 'Study year', 'year', 'study_year', 'Year']);

  return overlap(state.study_type, types) &&
          overlap(state.site_nat, nats) &&
          hasAll(state.year, year);
});

// 6) 以「前端可見數」為準覆寫 LAST_TOTAL，避免 9901
window.LAST_TOTAL = lastFetched.length;

// 7) 更新 UI + 渲染
HAS_SEARCHED = true;           // 確保顯示結果區
updatePanels();
await renderAfterFetch(lastFetched);
}

/* =========================
  STA / Recent + Age 多選
  ========================= */
// --- Age：多選 + Unknown（外觀改成與 Tumor 一致的平面 pill） ---
function renderAgeChips(list) {
const w = $('#ageChips');
if (!w) return;

// 確保外觀 class 存在（平面、不像按鈕）
w.classList.add('chipArea', 'flat');
w.innerHTML = '';

const bins = Array.isArray(list) && list.length
  ? list.slice()
  : ['0-9','10-19','20-29','30-39','40-49','50-59','60-69','70-79','80-89','90-99'];

// Any
const anyBtn = document.createElement('button');
anyBtn.className = 'chip';
anyBtn.id = 'ageAny';
anyBtn.textContent = 'Any';       // ← 原本是 "Any age"
anyBtn.addEventListener('click', () => {
  state.age_bin = [];
  state.age_from = '';
  state.age_to = '';
  $$('#ageChips .chip').forEach(x => x.classList.remove('active'));
  anyBtn.classList.add('active');
  updateSTASummary();
  // 不 auto-search；按下 Search 才查
});
w.appendChild(anyBtn);

// bins（多選）
bins.forEach(label => {
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.textContent = label;
  btn.dataset.bin = label;
  btn.addEventListener('click', () => {
    const bin = btn.dataset.bin;
    const i = state.age_bin.indexOf(bin);
    if (i === -1) state.age_bin.push(bin); else state.age_bin.splice(i, 1);
    btn.classList.toggle('active');
    const any = $('#ageAny');
    if (any) any.classList.toggle('active', state.age_bin.length === 0);
    // 選了 bins 就清 from/to
    state.age_from = '';
    state.age_to = '';
    updateSTASummary();
    // 不 auto-search；按下 Search 才查
  });
  w.appendChild(btn);
});

// Unknown
const unk = document.createElement('button');
unk.className = 'chip';
unk.textContent = 'Unknown';
unk.dataset.bin = 'UNKNOWN';
unk.addEventListener('click', () => {
  const bin = 'UNKNOWN';
  const i = state.age_bin.indexOf(bin);
  if (i === -1) state.age_bin.push(bin); else state.age_bin.splice(i, 1);
  unk.classList.toggle('active');
  const any = $('#ageAny');
  if (any) any.classList.toggle('active', state.age_bin.length === 0);
  state.age_from = '';
  state.age_to = '';
  updateSTASummary();
  // 不 auto-search；按下 Search 才查
});
w.appendChild(unk);

// 初始 active
if (Array.isArray(state.age_bin) && state.age_bin.length) {
  state.age_bin.forEach(b => {
    const btn = $(`#ageChips .chip[data-bin="${CSS.escape(b)}"]`);
    if (btn) btn.classList.add('active');
  });
} else {
  anyBtn.classList.add('active');
}
}



/* ===== Viewer ===== */
function showPreparing(on) {
$('#prepPage').classList.toggle('show', !!on);
$('#prepPage').setAttribute('aria-hidden', on ? 'false' : 'true');
}

function openViewer(id) {
// showPreparing(true);
const num = parseInt(id.match(/\d+$/)[0], 10);
window.location.href = "/case/" + num;
// // 標記 viewer 模式（會觸發 body.viewer-open .hero 隱藏）
// document.body.style.overflow = 'hidden';
// document.body.classList.add('viewer-open');

// const v = $('#viewer');
// v.classList.add('compact');
// v.setAttribute('aria-hidden', 'false');

// // 初始文字/占位
// $('#vCard').style.display = 'none';
// $('#vSidebar').style.display = 'none';
// $('#caseTitle').textContent = 'Case ID: ' + id;
// $('#axial').src = vsvg('2D Axial');
// $('#sagittal').src = vsvg('2D Sagittal');
// $('#coronal').src = vsvg('2D Coronal');

// // 讓 viewer 一定在最上面
// v.style.position = 'fixed';
// v.style.inset = '0';
// v.style.zIndex = '10000';

// setTimeout(() => {
//   showPreparing(false);
//   v.classList.add('show');
//   $('#prep')?.classList.add('hidden');

//   // 更新網址
//   const u = new URL(location.href);
//   u.searchParams.set('case', id);
//   history.replaceState({}, '', u);
// }, 700);
}
// document.activeElement?.blur();  // 移除當前焦點，避免 aria-hidden 警告
// document.getElementById('viewer').setAttribute('aria-hidden', 'true');

function closeViewer() {
const v = $('#viewer');
v.classList.remove('show');
v.setAttribute('aria-hidden', 'true');

// 還原捲動與 viewer 標記 → 搜尋列會自動回來
document.body.style.overflow = '';
document.body.classList.remove('viewer-open');

// 清掉 URL 參數
const u = new URL(location.href);
u.searchParams.delete('case');
history.replaceState({}, '', u);
}

$('#btnBack').addEventListener('click', closeViewer);

const CLASS_MAP = [
{ name: 'Vascular System', key: 'vascular', items: [['aorta'], ['celiac_artery'], ['superior_mesenteric_artery'], ['postcava'], ['veins']] },
{ name: 'Digestive System', key: 'digestive', items: [['Pancreas'], ['colon'], ['duodenum'], ['stomach'], ['liver'], ['common_bile_duct'], ['gall_bladder']] },
{ name: 'Endocrine System', key: 'endocrine', items: [['adrenal_gland_left'], ['adrenal_gland_right']] },
{ name: 'Urinary System', key: 'urinary', items: [['Kidneys'], ['bladder']] },
{ name: 'Skeletal System', key: 'skeletal', items: [['femur_left'], ['femur_right']] },
{ name: 'Lymphatic System', key: 'lymphatic', items: [['spleen']] },
{ name: 'Reproductive System', key: 'reproductive', items: [['prostate']] },
{ name: 'Respiratory System', key: 'respiratory', items: [['lung_left'], ['lung_right']] }
];


function renderClassMap() {
const root = document.getElementById('cmRoot'); if (!root) return; root.innerHTML = '';
CLASS_MAP.forEach(grp => {
  const box = document.createElement('section'); box.className = 'cm-group';
  const row = document.createElement('div'); row.className = 'cm-row';
  row.innerHTML = `<span class="chev" aria-hidden="true">▾</span><span class="title">${grp.name}</span><input type="checkbox" class="grpCheck" checked aria-label="Toggle ${grp.name}">`;
  const items = document.createElement('div'); items.className = 'cm-items';
  grp.items.forEach(([label]) => {
    const id = `cm_${grp.key}_${label}`.replace(/\W+/g, '_').toLowerCase();
    const r = document.createElement('label'); r.className = 'cm-item';
    r.innerHTML = `<input type="checkbox" class="itemCheck" id="${id}" data-group="${grp.key}" data-name="${label}" checked><span class="name">${label.replace(/_/g, ' ')}</span>`;
    items.appendChild(r);
  });
  let open = true; const chev = row.querySelector('.chev');
  const setOpen = (on) => { open = on; box.classList.toggle('closed', !on); chev.textContent = on ? '▾' : '▸'; };
  row.addEventListener('click', (e) => { const t = e.target; if (t && t.classList && t.classList.contains('grpCheck')) return; setOpen(!open); });
  setOpen(true);
  const grpCheck = row.querySelector('input.grpCheck');
  if (grpCheck) { grpCheck.addEventListener('change', () => { const checked = grpCheck.checked; items.querySelectorAll('input.itemCheck').forEach(c => { c.checked = checked; }); }); }
  box.appendChild(row); box.appendChild(items); root.appendChild(box);
});
const btn = document.getElementById('toggleAll');
if (btn) {
  btn.onclick = () => {
    const boxes = Array.from(document.querySelectorAll('.cm-group .grpCheck'));
    const turnOff = boxes.length && boxes.every(b => b.checked);
    boxes.forEach(b => b.checked = !turnOff);
    document.querySelectorAll('.cm-group .itemCheck').forEach(c => c.checked = !turnOff);
  };
}
}

// settings / classmap toggle
document.getElementById('btnGear')?.addEventListener('click', () => {
const card = $('#vCard'), side = $('#vSidebar'); if (!card || !side) return;
side.style.display = 'none';
card.style.display = (getComputedStyle(card).display === 'none') ? 'block' : 'none';
});
document.getElementById('openClassMap')?.addEventListener('click', () => {
const side = $('#vSidebar'), card = $('#vCard'); if (!side || !card) return;
card.style.display = 'none';
if (getComputedStyle(side).display === 'none') { renderClassMap(); side.style.display = 'block'; }
else { side.style.display = 'none'; }
});

['op', 'lvl', 'win'].forEach(id => { const r = $('#' + id), lab = $('#' + id + 'v'); r?.addEventListener('input', () => { if (lab) lab.textContent = r.value; }); });
$('#zoomIn').innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 4v7H4v2h7v7h2v-7h7v-2h-7V4z"/></svg>';
$('#zoomOut').innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 11v2h16v-2z"/></svg>';
$('#download').innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3v10l3.5-3.5 1.4 1.4L12 16.8 7.1 10.9l1.4-1.4L11 13V3zM4 19v2h16v-2H4z"/></svg>';
$('#report').innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 1.5V8h3.5L14 4.5zM8 11h8v2H8v-2zm0 4h8v2H8v-2z"/></svg>';
let Z = 1; function applyZoom() { $$('.v-view img').forEach(img => { img.style.transformOrigin = 'center center'; img.style.transform = `scale(${Z})`; }); }
$('#zoomIn')?.addEventListener('click', () => { Z = Math.min(3, Z + 0.2); applyZoom(); });
$('#zoomOut')?.addEventListener('click', () => { Z = Math.max(1, Z - 0.2); applyZoom(); });

const rpModal = $('#reportModal');
$('#download')?.addEventListener('click', () => {
['axial', 'sagittal', 'coronal'].forEach(id => {
  const img = document.getElementById(id);
  if (!img || !img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = `case-${(document.getElementById('caseTitle')?.textContent || 'id').replace(/\D+/g, '')}-${id}.png`;
  document.body.appendChild(a); a.click(); a.remove();
});
});
$('#report')?.addEventListener('click', () => rpModal?.classList.add('show'));
$('#rpClose')?.addEventListener('click', () => rpModal?.classList.remove('show'));
rpModal?.addEventListener('click', e => { if (e.target === rpModal) rpModal.classList.remove('show'); });

// deeplink
(() => { const u = new URL(location.href); const id = u.searchParams.get('case'); if (id) openViewer(id); })();

/* ---- Recent render ---- */
renderRecent = () => {
const box = $('#idRecent');
if (!box) return;

const r = JSON.parse(localStorage.getItem('recentIds') || '[]');
box.innerHTML = '';

if (!r.length) {
  box.innerHTML = '<span class="recMeta">No recent</span>';
  return;
}

r.forEach(id => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = id;
  b.addEventListener('click', () => {
    $('#q').value = id;
    state.q = id;
    HAS_SEARCHED = true;
    run();
    $('#popID')?.classList.remove('open');
  });
  box.appendChild(b);
});
}

/* ---- STA Summary ---- */
function updateSTASummary() {
const tumor =
  state.tumor === '' ? 'Any tumor' :
  state.tumor === '1' ? 'Tumor' : 'No tumor';

const toArray = v => Array.isArray(v) ? v : (v ? [String(v)] : []);
const selSex = toArray(state.sex);
const mapSex = s => (s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Unknown');
const sexLabel = selSex.length ? selSex.map(mapSex).join('/') : 'Any sex';

let ageLabel = 'Any age';
if (Array.isArray(state.age_bin) && state.age_bin.length) {
  const bins = state.age_bin.slice();
  const onlyUnknown = bins.length === 1 && bins[0] === 'UNKNOWN';
  if (onlyUnknown) {
    ageLabel = 'UNKNOWN';
  } else {
    const shown = bins.filter(b => b !== 'UNKNOWN').slice(0, 3).join(', ');
    const more = bins.filter(b => b !== 'UNKNOWN').length > 3
      ? ` +${bins.filter(b => b !== 'UNKNOWN').length - 3}` : '';
    ageLabel = shown ? (shown + more) : 'UNKNOWN';
  }
}
const sta = document.getElementById('staSummary');
if (sta) sta.textContent = `${tumor} · ${sexLabel} · ${ageLabel}`;
}

/* ---- Search / Sex / Tumor / Sort ---- */
// Search button
(() => {
const btn = document.getElementById('searchBtn');
if (!btn) return;
btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  HAS_SEARCHED = true;
  run();
  document.getElementById('popID')?.classList.remove('open');
  document.getElementById('popSTA')?.classList.remove('open');
});
})();

// Sex multi
(() => {
const box = document.getElementById('sexChips');
if (!box) return;
box.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  e.stopPropagation();
  const val = b.dataset.sex ?? '';
  if (!Array.isArray(state.sex)) state.sex = state.sex ? [String(state.sex)] : [];
  if (val === '') {
    state.sex = [];
    $$('#sexChips .chip').forEach(x => x.classList.remove('active'));
    $$('#sexChips .chip[data-sex=""]').forEach(x => x.classList.add('active'));
  } else {
    b.classList.toggle('active');
    const i = state.sex.indexOf(val);
    if (i === -1) state.sex.push(val); else state.sex.splice(i, 1);
    const anyBtn = $$('#sexChips .chip[data-sex=""]')[0];
    if (anyBtn) anyBtn.classList.toggle('active', state.sex.length === 0);
  }
  updateSTASummary();
});
})();

// Tumor single
(() => {
const box = document.getElementById('tumorChips');
if (!box) return;
box.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  e.stopPropagation();
  state.tumor = b.dataset.tumor ?? '';
  $$('#tumorChips .chip').forEach(x =>
    x.classList.toggle('active', (x.dataset.tumor ?? '') === state.tumor)
  );
  updateSTASummary();
});
})();

// Sort select
(() => {
const sortSel = document.getElementById('sortBy');
if (!sortSel) return;
sortSel.addEventListener('change', async () => {
  state.sort_by = sortSel.value || 'quality';
  if (HAS_SEARCHED) await renderAfterFetch(lastFetched || []);
});
})();
// 拉一次完整清單到 ALL_ITEMS（給 Browse / 後備用）
async function bootstrapLists(){
try{
  const data = await fetch('/api/search?per_page=10000&sort_by=id', {cache:'no-store'})
                .then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  ALL_ITEMS = data.items || [];
}catch(e){
  console.warn('bootstrapLists failed:', e);
  ALL_ITEMS = [];
}
}
/* ---- 初始化 ---- */
(async function init() {
// 有就呼叫；避免缺函式時中斷
try { renderRecent?.(); } catch(e){ console.warn('renderRecent failed:', e); }

if (typeof bootstrapLists === 'function') {
  await bootstrapLists();
} else {
  console.warn('bootstrapLists is not defined; skipping preload');
}

// Age 初始 chips
state.age_bin = [];
renderAgeChips();

// Browse 區塊
try { await initBrowse?.(); } catch(e){ console.warn('initBrowse failed:', e); }

// STA chips 初始狀態
$$('#sexChips .chip').forEach(x => x.classList.toggle('active', (x.dataset.sex ?? '') === ''));
$$('#tumorChips .chip').forEach(x => x.classList.toggle('active', (x.dataset.tumor ?? '') === ''));

updateSTASummary?.();
HAS_SEARCHED = false;
lastFetched = [];
updatePanels?.();
})();


// 首頁載入先把結果面板藏起來
document.addEventListener('DOMContentLoaded', () => {
const resultsPanel = document.getElementById('resultsPanel');
const head = document.querySelector('.resultsHead');
const cards = document.getElementById('cards');

if (resultsPanel) resultsPanel.style.display = 'none';
if (head) head.style.display = 'none';
if (cards) cards.style.display = 'none';

try {
  updatePanels();
} catch (e) {
  console.warn(e);
}
});


// ===== helpers for infinite render =====
// 懶載圖 + 併發限流（避免 429）
const IMG_VIEWPORT = () => document.querySelector('#resultsPanel');
const MAX_IMG_CONC = 6;
let _imgInFlight = 0;
const _imgQueue = [];

// 圖片 IntersectionObserver：只在接近可視範圍時才排入下載
const ioImg = new IntersectionObserver((entries) => {
entries.forEach(e => {
  if (!e.isIntersecting) return;
  const img = e.target;
  ioImg.unobserve(img);
  _enqueueImgLoad(img);
});
}, { root: IMG_VIEWPORT(), rootMargin: '400px' });

function attachLazy(imgEl, url){
imgEl.loading = 'lazy';
imgEl.decoding = 'async';
imgEl.dataset.src = url;
imgEl.src = svg('2D Image'); // 你的 placeholder
ioImg.observe(imgEl);
}

function _enqueueImgLoad(img){
_imgQueue.push({ img, attempt: 0 });
_pumpImgQueue();
}

function _pumpImgQueue(){
while (_imgInFlight < MAX_IMG_CONC && _imgQueue.length){
  const job = _imgQueue.shift();
  _imgInFlight++;
  _loadWithRetry(job.img, job.attempt).finally(() => {
    _imgInFlight--;
    _pumpImgQueue();
  });
}
}

function _loadWithRetry(img, attempt = 0){
const url = img.dataset.src;
if (!url) return Promise.resolve();
return new Promise((resolve) => {
  const fail = () => {
    if (attempt < 3){
      const wait = 500 * Math.pow(2, attempt); // 0.5s,1s,2s
      setTimeout(() => _loadWithRetry(img, attempt + 1).then(resolve), wait);
    } else {
      img.src = svg('2D Image');
      resolve();
    }
  };
  img.onerror = fail;
  img.onload  = () => resolve();
  img.src = url; // 真正發請求
});
}

// 分批掛載（防止重複宣告）
window.BATCH    = window.BATCH    ?? 60;   // 每批幾張卡
window._mountIdx = window._mountIdx ?? 0;
window._infIO    = window._infIO    ?? null;


function _fallbackCard(item){
const el = document.createElement('article');
el.className = 'card';
el.innerHTML = `
  <img class="thumb" alt="">
  <div class="body">
    <div class="titleRow">
      <a href="javascript:void(0)" class="caseLink">${String(item.case_id || item.id || '')}</a>
    </div>
    <div class="keyRow">
      <span class="kv"><span class="k">Sex</span><span class="v">${String(item.sex ?? '—')}</span></span>
      <span class="kv"><span class="k">Age</span><span class="v">${Number.isFinite(item.age) ? item.age + 'y' : '—'}</span></span>
      <span class="kv"><span class="tag ${item.tumor === 1 ? 'bad' : 'ok'}">${item.tumor === 1 ? 'Tumor' : 'No tumor'}</span></span>
    </div>
  </div>`;
return el;
}

async function _appendBatch(cards, items){
const end = Math.min(_mountIdx + BATCH, items.length);
const frag = document.createDocumentFragment();
for (let i = _mountIdx; i < end; i++){
  const it = items[i];
  const el = (typeof makeCard === 'function') ? await makeCard(it)
          : (typeof makeCardHTML === 'function') ? (() => {
              const a = document.createElement('article');
              a.className = 'card';
              a.innerHTML = makeCardHTML(it);
              return a;
            })()
          : _fallbackCard(it);

  // 懶載圖：尋找卡片中的 .thumb，掛上 attachLazy（不要直接設 src）
  const img = el.querySelector('img.thumb');
  if (img) {
    const id = extractNumFromId(it.case_id || it.id);
    attachLazy(img, await profileURL(id));
  }
  frag.appendChild(el);
}
cards.appendChild(frag);
_mountIdx = end;
}

function _setupInfinite(cards, items){
// 清掉舊 sentinel
const old = cards.querySelector('[data-sentinel]');
if (old) old.remove();

const sentinel = document.createElement('div');
sentinel.setAttribute('data-sentinel', '1');
sentinel.style.height = '1px';
cards.appendChild(sentinel);

if (_infIO) { _infIO.disconnect(); _infIO = null; }
_infIO = new IntersectionObserver((entries) => {
  entries.forEach(async (e) => {
    if (!e.isIntersecting) return;
    if (_mountIdx < items.length) {
      await _appendBatch(cards, items);
    } else {
      _infIO.disconnect();
    }
  });
}, { root: IMG_VIEWPORT(), rootMargin: '800px' });

_infIO.observe(sentinel);
}

async function _startInfiniteRender(cards, items){
cards.innerHTML = '';
_mountIdx = 0;
await _appendBatch(cards, items);     // 先掛第一批
_setupInfinite(cards, items);   // 滾到接近底部再補
}
// ===== end helpers =====


async function renderAfterFetch(items = []) {
const cardsEl = document.getElementById('cards');
const resultsPanel = document.getElementById('resultsPanel');
const head = document.querySelector('.resultsHead');
const recBar = document.querySelector('#recBar');
if (!cardsEl) return;

const list = Array.isArray(items) ? items : [];
window.lastFetched = list;
const n = list.length;

// 0 筆：結果標題與面板保留，卡片隱藏，Browse 顯示
if (n === 0) {
  // 統一更新「Results: 0 cases」
  const total = 0;
  if (typeof setResultsCount === 'function') setResultsCount(total);
  else {
    const counterEl = document.getElementById('counter') || document.querySelector('.counter');
    if (counterEl) counterEl.textContent = 'Results: 0 cases';
  }

  head && (head.style.display = '');         // 保留標題
  resultsPanel && (resultsPanel.style.display = ''); // 保留右側容器
  if (cardsEl) { cardsEl.style.display = 'none'; cardsEl.innerHTML = ''; }

  recBar && recBar.style.removeProperty('display'); // 顯示 Browse
  return;
}

// 有結果：正常顯示
recBar && (recBar.style.display = 'none');
head && (head.style.display = '');
resultsPanel && (resultsPanel.style.display = '');
cardsEl.style.display = '';

const total = Number(window.LAST_TOTAL ?? n) || n;
if (typeof setResultsCount === 'function') setResultsCount(total);
else {
  const counterEl = document.getElementById('counter') || document.querySelector('.counter');
  if (counterEl) counterEl.textContent = `Results: ${total} ${total === 1 ? 'case' : 'cases'}`;
}

cardsEl.classList.toggle('centerOne', n === 1);
head?.classList.toggle('single', n === 1);
resultsPanel?.classList.toggle('single', n === 1);

const sorted = (typeof sorter === 'function') ? sorter(list.slice()) : list.slice();
await _startInfiniteRender(cardsEl, sorted);

const sortSel = document.getElementById('sortBy');
if (sortSel) {
  const disabled = n < 2;
  sortSel.disabled = disabled;
  sortSel.parentElement?.classList?.toggle('disabled', disabled);
}
}



// 防止拖移造成選取
['#recPrev', '#recNext', '#recPlay'].forEach(sel => {
const btn = document.querySelector(sel);
if (btn) btn.addEventListener('mousedown', e => e.preventDefault());
});

