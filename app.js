/* Tracker spese - PWA v1.2 */
'use strict';

const APP_VERSION = '1.11.1';
const LS = { cfg: 'ts_cfg', cache: 'ts_cache', outbox: 'ts_outbox' };
const TAG_PRESET = ['straordinaria', 'da rimborsare', 'da reintegrare'];
const DEFAULT_CONTO = 'Revolut Cointestato';

// icona Material Symbols + colore per categoria (colori presi dalle categorie Cashew)
const CAT = {
  'Abitazione':['home','#00897B'],'Beneficenza':['favorite','#EF5350'],'Conto personale':['person','#AB47BC'],
  'Cura personale':['content_cut','#EC407A'],'Emilia':['child_care','#26C6DA'],'Entrate Straordinarie':['savings','#26A69A'],
  'Famiglia':['family_restroom','#5C6BC0'],'Finanziamenti / Debiti':['account_balance','#78909C'],'Fuori casa':['restaurant','#FF7043'],
  'Istruzione / Formazione':['school','#FBC02D'],'Lavoro':['work','#8D6E63'],'Milù':['pets','#A1887F'],'Polizze':['shield','#42A5F5'],
  'Prestito':['swap_horiz','#7E57C2'],'Reddito':['payments','#9575CD'],'Regali':['redeem','#F44336'],
  'Risparmio e Investimenti':['trending_up','#AB47BC'],'Salute':['medical_services','#FFA726'],'Shopping e Svago':['shopping_bag','#FF8A65'],
  'Spesa':['shopping_cart','#66BB6A'],'Trasporti':['directions_car','#F9A825'],'Utenze':['bolt','#3F51B5'],'Vacanze e uscite':['beach_access','#2196F3']
};
const TIPO_CAT = { trasferimento:['swap_horiz','#64748B'], rettifica:['tune','#64748B'] };
const CONTO_COL = ['#4F7DF3','#2BA88A','#E0A100','#E2574C','#8E6CEF','#E86AA6','#14A3C7','#64748B'];
function svgIcon(name, size=22) {
  const d = ICONS[name] || ICONS.category; if (!d) return '';
  return `<svg class="mi" width="${size}" height="${size}" viewBox="${d[0]}" aria-hidden="true">${d[1].map(p=>`<path d="${p}"/>`).join('')}</svg>`;
}
const catDef = c => CAT[c] || ['category','#90A4AE'];
function bolla(icon, color, size=40) {
  return `<span class="bolla" style="--c:${color};width:${size}px;height:${size}px">${svgIcon(icon, Math.round(size*0.55))}</span>`;
}
const contoColor = nome => { const i = contiAttivi().findIndex(c => c.nome === nome); return CONTO_COL[(i < 0 ? 7 : i) % CONTO_COL.length]; };

let S = { conti:[], categorie:[], movimenti:[], config:[] };
let tab = 'home';
let filtro = { q:'', conto:'', mese:'' };

/* ---------------- utility ---------------- */
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'}) + ' €';
const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2,'0');
const nowStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseD = s => new Date(String(s).replace(' ','T'));
const meseKey = s => String(s).slice(0,7);
const meseLabel = k => { const [y,m] = k.split('-'); return new Date(+y, +m-1, 1).toLocaleDateString('it-IT',{month:'short',year:'2-digit'}); };
const parseImporto = v => { const n = Number(String(v).trim().replace(/\./g,'').replace(',','.')); return isFinite(n) ? r2(n) : NaN; };
function toast(msg, ms=2200){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add('hidden'),ms); }
const getCfg = () => { try { return JSON.parse(localStorage.getItem(LS.cfg)) || null; } catch { return null; } };
const getOutbox = () => { try { return JSON.parse(localStorage.getItem(LS.outbox)) || []; } catch { return []; } };
const setOutbox = o => localStorage.setItem(LS.outbox, JSON.stringify(o));

/* ---------------- API ---------------- */
async function api(action, payload={}) {
  const cfg = getCfg();
  if (!cfg) throw new Error('App non configurata');
  const res = await fetch(cfg.url, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: cfg.token, action, ...payload })
  });
  const j = await res.json();
  if (!j.ok) { const e = new Error(j.errore || 'Errore server'); e.server = true; throw e; }
  return j;
}

async function caricaDati() {
  setSync('⏳ sync…');
  try {
    const j = await api('bootstrap');
    S = { conti:j.conti, categorie:j.categorie, movimenti:j.movimenti, config:j.config };
    localStorage.setItem(LS.cache, JSON.stringify({ ...S, ts: Date.now() }));
    await svuotaOutbox();
    setSync('');
  } catch (e) {
    setSync(e.server ? '⚠️ ' + e.message : '📴 offline');
  }
  render();
}

async function svuotaOutbox() {
  let ob = getOutbox();
  if (!ob.length) return;
  const rest = [];
  for (const it of ob) {
    try {
      const j = await api('add', { movimento: it.movimento });
      S.movimenti = S.movimenti.filter(m => m.id !== it.tempId).concat(j.movimento);
    } catch (e) {
      if (e.server) toast('Movimento in coda scartato: ' + e.message, 4000);
      else rest.push(it);
    }
  }
  setOutbox(rest);
}

function setSync(t) {
  const n = getOutbox().length;
  $('#sync').textContent = t || (n ? `⏳ ${n} in coda` : '');
}

/* ---------------- calcoli ---------------- */
const contiAttivi = () => S.conti.filter(c => c.attivo === true || c.attivo === 'TRUE').sort((a,b)=>a.ordine-b.ordine);
const contiReali = () => contiAttivi().filter(c => c.tipo !== 'esterno');
function catInfo(cat, sub, tipo) {
  return S.categorie.find(c => c.categoria === cat && String(c.sottocategoria||'') === String(sub||'') && c.tipo === tipo);
}
const natura = m => { const c = catInfo(m.categoria, m.sottocategoria, 'spesa'); return (c && c.natura) || 'variabile'; };
const passaNatura = m => !filtro.natura || natura(m) === filtro.natura;
const isConsumo = m => { if (m.tipo !== 'spesa') return false; const c = catInfo(m.categoria, m.sottocategoria, 'spesa'); return c ? (c.consumo === true || c.consumo === 'TRUE') : true; };
function tuttiMov() {
  const pend = getOutbox().map(o => ({ ...o.movimento, id:o.tempId, _pending:true }));
  return S.movimenti.concat(pend);
}
function effetto(m, conto) {
  const i = Number(m.importo);
  if (m.tipo === 'trasferimento') return (m.conto === conto ? -i : 0) + (m.conto_dest === conto ? i : 0);
  if (m.conto !== conto) return 0;
  return m.tipo === 'spesa' ? -i : i;
}
function saldi(fino) {
  const out = {}; S.conti.forEach(c => out[c.nome] = 0);
  for (const m of tuttiMov()) {
    if (fino && m.data > fino) continue;
    if (m.tipo === 'trasferimento') { out[m.conto] = (out[m.conto]||0) - +m.importo; out[m.conto_dest] = (out[m.conto_dest]||0) + +m.importo; }
    else out[m.conto] = (out[m.conto]||0) + (m.tipo === 'spesa' ? -m.importo : +m.importo);
  }
  Object.keys(out).forEach(k => out[k] = r2(out[k]));
  return out;
}
const affidabileDa = () => (S.config.find(c => c.chiave === 'storico_affidabile_da') || {}).valore || '2026-08-01';
function mesiDisponibili() {
  const set = new Set(tuttiMov().map(m => meseKey(m.data)));
  return [...set].sort().reverse();
}
function freqCategorie(tipo) {
  const lim = nowStr(new Date(Date.now() - 90*864e5));
  const f = {};
  tuttiMov().filter(m => m.tipo === tipo && m.data >= lim).forEach(m => { const k = m.categoria + '||' + (m.sottocategoria||''); f[k] = (f[k]||0) + 1; });
  return f;
}

/* ---------------- render ---------------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view');
  if (!getCfg()) { v.innerHTML = vistaSetup(); bindSetup(); $('#fab').classList.add('hidden'); return; }
  $('#fab').classList.remove('hidden');
  $('#title').textContent = ({ home:'Spiccioli', movimenti:'Movimenti', grafici:'Grafici', mesi:'Confronto mesi' })[tab];
  v.innerHTML = ({ home:vistaHome, movimenti:vistaMovimenti, grafici:vistaGrafici, mesi:vistaMesi })[tab]();
  bindVista();
}

function vistaSetup() {
  return `<div class="card"><h2>Configurazione</h2>
  <p class="muted">Inserisci l'URL dell'applicazione web Apps Script (finisce con /exec) e il token generato con setupToken. Restano salvati solo su questo dispositivo.</p>
  <label>URL backend</label><input id="cfg-url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/.../exec">
  <label>Token</label><input id="cfg-token" type="password" autocomplete="off">
  <div class="btns"><button class="btn" id="cfg-save">Collega</button></div></div>`;
}
function bindSetup() {
  $('#cfg-save').onclick = async () => {
    const url = $('#cfg-url').value.trim(), token = $('#cfg-token').value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return toast('URL non valido');
    if (!token) return toast('Token mancante');
    localStorage.setItem(LS.cfg, JSON.stringify({ url, token })); chiediPersistenza();
    try { await api('ping'); toast('Collegato ✓'); caricaDati(); }
    catch (e) { localStorage.removeItem(LS.cfg); toast('Errore: ' + e.message, 4000); }
  };
}

function rigaMov(m) {
  let def, t1, cls;
  if (m.tipo === 'trasferimento') { def = TIPO_CAT.trasferimento; t1 = `${m.conto} → ${m.conto_dest}`; cls = 'neutral'; }
  else if (m.tipo === 'rettifica') { def = TIPO_CAT.rettifica; t1 = 'Rettifica'; cls = m.importo < 0 ? 'neg' : 'pos'; }
  else { def = catDef(m.categoria); t1 = m.nota || m.sottocategoria || m.categoria; cls = m.tipo === 'spesa' ? 'neg' : 'pos'; }
  const sub = m.tipo === 'trasferimento' ? (m.nota || 'Trasferimento')
    : m.tipo === 'rettifica' ? [m.conto, m.nota].filter(Boolean).join(' · ')
    : [m.nota ? (m.sottocategoria || m.categoria) : (m.sottocategoria ? m.categoria : ''), m.conto].filter(Boolean).join(' · ');
  const imp = m.tipo === 'spesa' ? -m.importo : +m.importo;
  const txt = m.tipo === 'trasferimento' ? eur(+m.importo) : (imp > 0 ? '+' : '') + eur(imp);
  const tv = tagVisibili(m.tag); const tag = tv ? `<span class="pill">${esc(tv)}</span>` : (String(m.tag||'').includes('reint:') ? `<span class="pill">reintegro</span>` : String(m.tag||'').includes('rimb:') ? `<span class="pill">rimborso</span>` : String(m.tag||'').includes('ric:') ? `<span class="pill">ricorrente</span>` : '');
  return `<div class="mov ${m._pending?'pending':''}" data-id="${esc(m.id)}">
    ${bolla(def[0], def[1], 42)}
    <div class="bd"><div class="t1">${esc(t1)}</div><div class="t2">${esc(sub)}${tag}</div></div>
    <div class="amt ${cls}">${txt}</div></div>`;
}
function listaPerGiorno(movs) {
  const gruppi = [];
  for (const m of movs) {
    const g = m.data.slice(0,10);
    if (!gruppi.length || gruppi[gruppi.length-1].g !== g) gruppi.push({ g, items: [] });
    gruppi[gruppi.length-1].items.push(m);
  }
  const oggi = nowStr().slice(0,10), ieri = nowStr(new Date(Date.now()-864e5)).slice(0,10);
  return gruppi.map(({ g, items }) => {
    const lab = g === oggi ? 'Oggi' : g === ieri ? 'Ieri' : parseD(g+' 00:00:00').toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
    const net = r2(items.reduce((a,m) => a + (m.tipo==='spesa' ? -m.importo : m.tipo==='entrata' ? +m.importo : 0), 0));
    return `<div class="day"><span>${lab}</span>${net ? `<span class="${net<0?'neg':'pos'}">${net>0?'+':''}${eur(net)}</span>` : ''}</div>
      <div class="card list">${items.map(rigaMov).join('')}</div>`;
  }).join('');
}

function vistaHome() {
  const s = saldi();
  const reali = contiReali();
  const tot = r2(reali.filter(c => c.nel_totale === true || c.nel_totale === 'TRUE').reduce((a,c) => a + s[c.nome], 0));
  const mk = nowStr().slice(0,7);
  const delMese = tuttiMov().filter(m => meseKey(m.data) === mk);
  const usc = r2(delMese.filter(isConsumo).reduce((a,m) => a + +m.importo, 0));
  const ent = r2(delMese.filter(m => m.tipo === 'entrata').reduce((a,m) => a + +m.importo, 0));
  const recenti = tuttiMov().slice().sort((a,b) => b.data.localeCompare(a.data)).slice(0, 10);
  const meseNome = new Date().toLocaleDateString('it-IT',{month:'long'});
  return `<section class="hero">
    <div class="hero-lab">Totale disponibile</div>
    <div class="hero-tot">${eur(tot)}</div>
    <div class="hero-row">
      <div class="hero-chip"><span class="dot pos">${svgIcon('arrow_downward',16)}</span><div><div class="hc-lab">Entrate di ${meseNome}</div><div class="hc-val">${eur(ent)}</div></div></div>
      <div class="hero-chip"><span class="dot neg">${svgIcon('arrow_upward',16)}</span><div><div class="hc-lab">Spese di ${meseNome}</div><div class="hc-val">${eur(usc)}</div></div></div>
    </div>
  </section>
  ${cardIeri()}
  ${cardSettimana()}
  ${cardOnline()}
  ${cardControlli()}
  ${cardRicorrenti()}
  ${cardVerifica()}
  ${cardRimborsi()}
  ${cardAnticipi()}
  <div class="sec-h"><h2>Conti e Pocket</h2></div>
  <div class="accs">
  ${reali.map(c => { const col = contoColor(c.nome); return `<button class="acc-card" data-conto="${esc(c.nome)}" style="--c:${col}">
      <span class="acc-ic">${svgIcon(c.tipo==='pocket'?'savings':c.tipo==='deposito'?'account_balance':'account_balance_wallet',20)}</span>
      <span class="acc-name">${esc(c.nome)}</span>
      <span class="acc-bal ${s[c.nome]<0?'neg':''}">${eur(s[c.nome])}</span>
      <span class="acc-sub">${esc(c.tipo)}${c.banca?' · '+esc(c.banca):''}</span></button>`; }).join('')}
  </div>
  <div class="sec-h"><h2>Ultimi movimenti</h2><button class="link" id="vedi-tutti">Vedi tutti</button></div>
  ${listaPerGiorno(recenti)}
  <p class="muted small" style="text-align:center;margin:18px 0 4px">Spiccioli v${APP_VERSION}</p>`;
}

function vistaMovimenti() {
  const mesi = mesiDisponibili();
  let movs = tuttiMov().slice().sort((a,b) => b.data.localeCompare(a.data));
  const q = filtro.q.trim().toLowerCase();
  if (filtro.conto) movs = movs.filter(m => m.conto === filtro.conto || m.conto_dest === filtro.conto);
  if (filtro.mese) movs = movs.filter(m => meseKey(m.data) === filtro.mese);
  if (q) {
    const qn = parseImporto(q);
    movs = movs.filter(m => [m.nota,m.categoria,m.sottocategoria,m.tag,m.conto,m.conto_dest].join(' ').toLowerCase().includes(q) || (isFinite(qn) && Math.abs(+m.importo - qn) < 0.005));
  }
  const tot = r2(movs.reduce((a,m) => a + (m.tipo==='spesa' ? -m.importo : m.tipo==='entrata' ? +m.importo : 0), 0));
  return `<div class="search">${svgIcon('search',20)}<input id="f-q" type="search" placeholder="Cerca nota, categoria, importo…" value="${esc(filtro.q)}"></div>
  <div class="filters">
    <select id="f-conto" class="pill-select"><option value="">Tutti i conti</option>${contiAttivi().map(c=>`<option ${filtro.conto===c.nome?'selected':''}>${esc(c.nome)}</option>`).join('')}</select>
    <select id="f-mese" class="pill-select"><option value="">Tutti i mesi</option>${mesi.map(k=>`<option value="${k}" ${filtro.mese===k?'selected':''}>${meseLabel(k)}</option>`).join('')}</select>
  </div>
  <div class="muted small" style="margin:2px 6px 0">${movs.length} movimenti · entrate − spese ${eur(tot)}</div>
  ${listaPerGiorno(movs.slice(0, 300))}
  ${movs.length > 300 ? '<p class="muted" style="text-align:center">Mostrati i primi 300: restringi i filtri</p>' : ''}`;
}

function vistaGrafici() {
  const mesi = mesiDisponibili();
  const mese = filtro.gmese || mesi[0];
  const spese = tuttiMov().filter(m => meseKey(m.data) === mese && isConsumo(m) && passaNatura(m));
  const perCat = {};
  spese.forEach(m => perCat[m.categoria] = (perCat[m.categoria]||0) + +m.importo);
  const arr = Object.entries(perCat).sort((a,b) => b[1]-a[1]);
  const tot = r2(arr.reduce((a,x) => a+x[1], 0));
  const max = arr.length ? arr[0][1] : 1;
  const warn = mese < affidabileDa().slice(0,7) ? `<div class="warnbox">Mese anteriore a ${affidabileDa()}: dati non affidabili.</div>` : '';
  const ultimi = mesi.slice(0,12).reverse();
  const trend = ultimi.map(k => {
    const ms = tuttiMov().filter(m => meseKey(m.data) === k);
    return { k, spese: r2(ms.filter(m => isConsumo(m) && passaNatura(m)).reduce((a,m)=>a+ +m.importo,0)), entrate: r2(ms.filter(m=>m.tipo==='entrata').reduce((a,m)=>a+ +m.importo,0)) };
  });
  const lab = filtro.natura==='fissa'?'fisse':filtro.natura==='variabile'?'variabili':'di consumo';
  return `<div class="toolbar">
    <select id="g-mese" class="pill-select">${mesi.map(k=>`<option value="${k}" ${k===mese?'selected':''}>${meseLabel(k)}</option>`).join('')}</select>
    <div class="seg" id="g-nat">${[['','Tutte'],['fissa','Fisse'],['variabile','Variabili']].map(([k,l])=>`<button data-n="${k}" class="${(filtro.natura||'')===k?'on':''}">${l}</button>`).join('')}</div>
  </div>
  ${warn}
  <div class="card donut-card">
    ${donut(arr, tot, `Spese ${lab}`)}
  </div>
  <div class="card list">
  ${arr.map(([c,v]) => { const d = catDef(c); return `<div class="catrow" data-cat="${esc(c)}">${bolla(d[0], d[1], 40)}
      <div class="bd"><div class="row"><span class="t1">${esc(c)}</span><span class="amt">${eur(v)}</span></div>
      <div class="row small"><div class="barwrap"><div class="bar" style="width:${(v/max*100).toFixed(1)}%;background:${d[1]}"></div></div><span class="muted pct">${tot?Math.round(v/tot*100):0}%</span></div></div></div>`; }).join('') || '<p class="muted" style="padding:12px 4px">Nessuna spesa</p>'}
  </div>
  <div class="sec-h"><h2>Ultimi 12 mesi</h2></div>
  <div class="card">${svgTrend(trend)}
  <p class="muted small">Barre: spese ${lab} · linea: entrate</p></div>`;
}

function donut(arr, tot, label) {
  const R = 74, C = 2 * Math.PI * R; let off = 0;
  const segs = tot ? arr.map(([c,v]) => { const len = v / tot * C; const gap = arr.length > 1 ? Math.min(3, len/3) : 0;
    const el = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${catDef(c)[1]}" stroke-width="18" stroke-linecap="butt"
      stroke-dasharray="${Math.max(len-gap,0.01)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"/>`; off += len; return el; }).join('')
    : `<circle r="${R}" cx="90" cy="90" fill="none" stroke="var(--line)" stroke-width="18"/>`;
  return `<div class="donut"><svg viewBox="0 0 180 180" width="200" height="200" role="img" aria-label="${esc(label)}">${segs}</svg>
    <div class="donut-c"><div class="muted small">${esc(label)}</div><div class="donut-v">${eur(tot)}</div></div></div>`;
}

function svgTrend(t) {
  if (!t.length) return '';
  const W = 600, H = 200, pl = 8, pb = 22, n = t.length, bw = (W - pl*2) / n;
  const max = Math.max(1, ...t.map(x => Math.max(x.spese, x.entrate)));
  const y = v => H - pb - (v / max) * (H - pb - 10);
  const bars = t.map((x,i) => `<rect x="${pl+i*bw+bw*0.2}" y="${y(x.spese)}" width="${bw*0.6}" height="${H-pb-y(x.spese)}" rx="3" fill="var(--accent)" opacity="0.85"><title>${meseLabel(x.k)}: ${eur(x.spese)}</title></rect>
    <text x="${pl+i*bw+bw/2}" y="${H-6}" text-anchor="middle">${meseLabel(x.k).split(' ')[0]}</text>`).join('');
  const pts = t.map((x,i) => `${pl+i*bw+bw/2},${y(x.entrate)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trend mensile">${bars}<polyline points="${pts}" fill="none" stroke="var(--pos)" stroke-width="2.5"/></svg>`;
}

function vistaMesi() {
  const mesi = mesiDisponibili().slice(0, 12);
  const reali = contiReali();
  const fine = k => { const [y,m] = k.split('-').map(Number); const d = new Date(y, m, 0); return `${k}-${pad(d.getDate())} 23:59:59`; };
  const tabSaldi = mesi.map(k => ({ k, s: saldi(fine(k)) }));
  return `<div class="card"><h2>Saldo a fine mese</h2>
  <p class="muted">Il mese in corso mostra il saldo attuale.</p>
  <div class="scrollx"><table><thead><tr><th>Conto</th>${tabSaldi.map(x=>`<th>${meseLabel(x.k)}</th>`).join('')}</tr></thead><tbody>
  ${reali.map(c => `<tr><td>${esc(c.nome)}</td>${tabSaldi.map(x=>`<td>${x.s[c.nome].toLocaleString('it-IT',{maximumFractionDigits:0,useGrouping:'always'})}</td>`).join('')}</tr>`).join('')}
  <tr><td><b>Totale</b></td>${tabSaldi.map(x=>`<td><b>${reali.filter(c=>c.nel_totale===true||c.nel_totale==='TRUE').reduce((a,c)=>a+x.s[c.nome],0).toLocaleString('it-IT',{maximumFractionDigits:0,useGrouping:'always'})}</b></td>`).join('')}</tr>
  <tr><td class="muted">Variazione</td>${tabSaldi.map((x,i)=>{ const tot=c=>reali.filter(q=>q.nel_totale===true||q.nel_totale==='TRUE').reduce((a,q)=>a+c.s[q.nome],0); if(i===tabSaldi.length-1) return '<td></td>'; const d=tot(x)-tot(tabSaldi[i+1]); return `<td class="${d<0?'neg':'pos'}">${d>0?'+':''}${d.toLocaleString('it-IT',{maximumFractionDigits:0,useGrouping:'always'})}</td>`; }).join('')}</tr>
  </tbody></table></div></div>`;
}

function bindVista() {
  document.querySelectorAll('.mov[data-id]').forEach(el => el.onclick = () => {
    const m = tuttiMov().find(x => x.id === el.dataset.id);
    if (m && m._pending) return toast('Movimento in coda: modificabile dopo la sincronizzazione');
    if (m) apriForm(m);
  });
  document.querySelectorAll('[data-conto]').forEach(el => el.onclick = () => apriConto(el.dataset.conto));
  const vt = $('#vedi-tutti'); if (vt) vt.onclick = () => { tab = 'movimenti'; render(); window.scrollTo(0,0); };
  if (tab === 'home') { bindRicorrenti(); bindControlli(); bindVerifica(); bindRimborsi(); bindAnticipi(); const wk = $('#week'); if (wk) wk.onclick = apriSettimana; const rp = $('#rp-open'); if (rp) rp.onclick = apriRiepilogo; }
  const fq = $('#f-q');
  if (fq) {
    fq.oninput = () => { filtro.q = fq.value; const pos = fq.selectionStart; render(); const n=$('#f-q'); n.focus(); n.setSelectionRange(pos,pos); };
    $('#f-conto').onchange = e => { filtro.conto = e.target.value; render(); };
    $('#f-mese').onchange = e => { filtro.mese = e.target.value; render(); };
  }
  const gm = $('#g-mese');
  if (gm) gm.onchange = e => { filtro.gmese = e.target.value; render(); };
  document.querySelectorAll('#g-nat button').forEach(b => b.onclick = () => { filtro.natura = b.dataset.n; render(); });
  document.querySelectorAll('.catrow').forEach(el => el.onclick = () => { filtro = { q: el.dataset.cat, conto:'', mese: filtro.gmese || mesiDisponibili()[0] }; tab='movimenti'; render(); });
}

/* ---------------- dettaglio conto + allinea saldo ---------------- */
function apriConto(nome) {
  const s = saldi()[nome];
  sheet(`<h2>${esc(nome)}</h2><div class="total">${eur(s)}</div>
  <label>Saldo reale in banca (allinea saldo)</label><input id="al-val" inputmode="decimal" placeholder="es. 523,40">
  <p class="muted">Crea una rettifica pari alla differenza.</p>
  <div class="btns"><button class="btn sec" id="al-mov">Vedi movimenti</button><button class="btn" id="al-ok">Allinea</button></div>`);
  $('#al-mov').onclick = () => { chiudi(); filtro = { q:'', conto:nome, mese:'' }; tab='movimenti'; render(); };
  $('#al-ok').onclick = async () => {
    const v = parseImporto($('#al-val').value);
    if (!isFinite(v)) return toast('Importo non valido');
    const diff = r2(v - s);
    if (diff === 0) { chiudi(); return toast('Saldo già allineato'); }
    const rettifica = () => salva({ tipo:'rettifica', importo:diff, conto:nome, data:nowStr(), nota:'Allineamento saldo', tag:'allinea' });
    if (diff < 0) return rettifica();
    // differenza positiva: può essere un'entrata vera (es. interessi del conto deposito), non un errore
    sheet(`<h2 class="wz-h">${eur(diff)} in più su ${esc(nome)}</h2><p class="muted">Da cosa viene la differenza?</p>
      <div class="card list">
        <button class="set-row" id="al-int"><span>Interessi<br><span class="muted small">Entrata: Entrate Straordinarie → Interessi c/deposito</span></span>${svgIcon('savings',20)}</button>
        <button class="set-row" id="al-ret"><span>Correzione<br><span class="muted small">Rettifica: errore o movimento non registrato</span></span>${svgIcon('tune',20)}</button>
      </div>`);
    $('#al-int').onclick = () => salva({ tipo:'entrata', importo:diff, conto:nome, data:nowStr(), categoria:'Entrate Straordinarie', sottocategoria:'Interessi c/deposito', nota:'Interessi c/deposito', tag:'allinea' });
    $('#al-ret').onclick = rettifica;
  };
}


/* ---------------- ricorrenti, controlli, settimana (v1.5) ---------------- */
// Addebiti e spostamenti ricorrenti. g = giorno del mese (31 = ultimo giorno), dal = primo mese in cui vale (yyyy-mm), al = ultimo mese (facoltativo).
// gruppo '16' = spostamenti automatici del 16 dal conto cointestato. Importi modificabili alla conferma.
const RICORRENTI = [
  { id:'verisure',  g:3,  tipo:'spesa', importo:56.63,  conto:'MPS', categoria:'Utenze', sottocategoria:'Verisure', nota:'Verisure', dal:'2026-12' },
  { id:'allianz-salute', g:4, tipo:'spesa', importo:23.82, conto:'MPS', categoria:'Polizze', sottocategoria:'', nota:'Allianz ULTRA Salute', dal:'2026-12' },
  { id:'msf',       g:4,  tipo:'spesa', importo:10,     conto:'MPS', categoria:'Beneficenza', sottocategoria:'', nota:'MSF', dal:'2026-12' },
  { id:'tim',       g:6,  tipo:'spesa', importo:50.99,  conto:'MPS', categoria:'Utenze', sottocategoria:'Internet', nota:'TIM', dal:'2026-12' },
  { id:'nen-gas',   g:10, tipo:'spesa', importo:196.94, conto:'MPS', categoria:'Utenze', sottocategoria:'Gas', nota:'NeN', dal:'2026-12' },
  { id:'nen-luce',  g:10, tipo:'spesa', importo:87.03,  conto:'MPS', categoria:'Utenze', sottocategoria:'Luce', nota:'NeN', dal:'2026-12' },
  { id:'very',      g:10, tipo:'spesa', importo:5.99,   conto:'MPS', categoria:'Utenze', sottocategoria:'Mobile', nota:'Very Mobile', dal:'2026-12' },
  { id:'agos',      g:16, tipo:'spesa', importo:271.22, conto:'MPS', categoria:'Finanziamenti / Debiti', sottocategoria:'', nota:'Agos', dal:'2026-12' },
  { id:'allianz-casa', g:23, tipo:'spesa', importo:38.85, conto:'MPS', categoria:'Polizze', sottocategoria:'', nota:'Allianz Casa e Patrimonio', dal:'2026-12' },
  { id:'prestito-mps', g:27, tipo:'spesa', importo:445.03, conto:'MPS', categoria:'Finanziamenti / Debiti', sottocategoria:'', nota:'Prestito MPS', dal:'2026-11' },
  { id:'iliad',     g:28, tipo:'spesa', importo:7.99,   conto:'MPS', categoria:'Utenze', sottocategoria:'Mobile', nota:'Iliad', dal:'2026-11', al:'2026-11' }, // Sabri passa a TIM: ultimo addebito 28/11/2026
  // TIM mobile di Sabri (dal 26/11/2026): dicembre gratis, 4,99 € da gennaio 2027. Giorno PROVVISORIO: correggere al primo addebito
  { id:'tim-sabri', g:28, tipo:'spesa', importo:4.99,   conto:'MPS', categoria:'Utenze', sottocategoria:'Mobile', nota:'TIM mobile Sabri', dal:'2027-01' },
  { id:'allianz-premorienza', g:29, tipo:'spesa', importo:12.04, conto:'MPS', categoria:'Polizze', sottocategoria:'', nota:'Allianz premorienza', dal:'2026-12' },
  { id:'mutuo',     g:31, tipo:'spesa', importo:524.47, conto:'MPS', categoria:'Finanziamenti / Debiti', sottocategoria:'', nota:'Mutuo MPS', dal:'2026-11' },
  { id:'a16-scadenze',  g:16, gruppo:'16', tipo:'trasferimento', importo:300, conto:'Revolut Cointestato', conto_dest:'Scadenze', nota:'Automatismo del 16', dal:'2026-12' },
  { id:'a16-manut',     g:16, gruppo:'16', tipo:'trasferimento', importo:90,  conto:'Revolut Cointestato', conto_dest:'Manutenzione', nota:'Automatismo del 16', dal:'2026-12' },
  { id:'a16-casa',      g:16, gruppo:'16', tipo:'trasferimento', importo:200, conto:'Revolut Cointestato', conto_dest:'Casa & Respiro', nota:'Automatismo del 16', dal:'2026-12' },
  { id:'a16-bimbe',     g:16, gruppo:'16', tipo:'trasferimento', importo:200, conto:'Revolut Cointestato', conto_dest:'Fondo Bimbe', nota:'Automatismo del 16', dal:'2026-12' },
  { id:'a16-vacanze',   g:16, gruppo:'16', tipo:'trasferimento', importo:250, conto:'Revolut Cointestato', conto_dest:'Vacanze e Regali', nota:'Automatismo del 16', dal:'2026-12' },
  { id:'a16-tr',        g:16, gruppo:'16', tipo:'spesa', importo:100, conto:'Revolut Cointestato', categoria:'Risparmio e Investimenti', sottocategoria:'PAC', nota:'Trade Republic', dal:'2026-12' },
  { id:'a16-jonny',     g:16, gruppo:'16', tipo:'spesa', importo:170, conto:'Revolut Cointestato', categoria:'Conto personale', sottocategoria:'Jonny', nota:'Conto personale Jonathan', dal:'2026-12' },
  { id:'a16-sabri',     g:16, gruppo:'16', tipo:'spesa', importo:250, conto:'Revolut Cointestato', categoria:'Conto personale', sottocategoria:'Sabri', nota:'Conto personale Sabri', dal:'2026-12' },
  { id:'scalable',  g:19, tipo:'spesa', importo:100, conto:'Revolut Cointestato', categoria:'Risparmio e Investimenti', sottocategoria:'PAC', nota:'Scalable Capital', dal:'2026-12' }
];
// Vita quotidiana divisa (28/11/2026): ordini di spesa online a parte (300 €/mese contabile), il resto 400 €/ciclo ≈ 92 €/settimana.
// La regola del recupero conta solo dalla settimana del 23/11, la prima con la divisione.
const VITA = { dal:'2026-11-23', budget:92, conto:'Revolut Cointestato', escludiCat:['Conto personale','Risparmio e Investimenti'] };
const ONLINE = { budget:300, giornoInizio:15 };
const isOrdineOnline = m => m.tipo === 'spesa' && m.categoria === 'Spesa' && (m.sottocategoria === 'Spesa online' || /esselunga\s*online/i.test(m.nota || ''));
// intervallo del controllo del 22 su MPS (decisione 38, aggiornata il 26/11/2026: Iliad 7,99 → TIM 4,99)
const intervallo22 = mk => mk < '2026-12' ? [1664, 1714] : [1712, 1762];

const LS_SKIP = 'ts_skip';
const getSkip = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_SKIP)) || []); } catch { return new Set(); } };
const setSkip = st => localStorage.setItem(LS_SKIP, JSON.stringify([...st]));
const tagsDi = m => String(m.tag||'').split(',').map(t => t.trim()).filter(Boolean);
const tagVisibili = t => String(t||'').split(',').map(x => x.trim()).filter(x => x && x !== 'allinea' && !x.startsWith('ric:') && !x.startsWith('rimb:') && !x.startsWith('reint:')).join(', ');
const ultimoGiorno = (y, m) => new Date(y, m, 0).getDate();
function scadenza(r, mk) { const [y, m] = mk.split('-').map(Number); return `${mk}-${pad(Math.min(r.g, ultimoGiorno(y, m)))}`; }
// confermato = c'è il movimento col tag, oppure uno registrato a mano nello stesso mese con stesso conto,
// stessa categoria/destinazione e importo entro ±15% (evita di riproporre ciò che è già stato segnato senza la card)
function confermato(r, mk) {
  const t = `ric:${r.id}:${mk}`;
  return tuttiMov().some(m => tagsDi(m).includes(t) || (!tagsDi(m).some(x => x.startsWith('ric:')) && m.data.slice(0,7) === mk && m.tipo === r.tipo && m.conto === r.conto
    && (r.tipo === 'trasferimento' ? m.conto_dest === r.conto_dest : m.categoria === r.categoria && (!r.sottocategoria || m.sottocategoria === r.sottocategoria)
        && (r.categoria !== 'Finanziamenti / Debiti' && r.categoria !== 'Polizze' || normNota(m.nota).includes(normNota(r.nota).split(' ')[0])))
    && (Math.abs(+m.importo - r.importo) <= r.importo * 0.15 || (r.nota && normNota(m.nota).includes(normNota(r.nota).split(' ')[0])))));
}
// voci da confermare: scadute nel mese corrente o precedente (dal mese 'dal'), e in arrivo nei prossimi 5 giorni
function vociRicorrenti() {
  const oggi = nowStr().slice(0,10), mkOra = oggi.slice(0,7);
  const d = new Date(); d.setMonth(d.getMonth() - 1); const mkPrima = nowStr(d).slice(0,7);
  const tra5 = nowStr(new Date(Date.now() + 5*864e5)).slice(0,10);
  const skip = getSkip(), out = [];
  for (const mk of [mkPrima, mkOra]) for (const r of RICORRENTI) {
    if (mk < r.dal || (r.al && mk > r.al) || confermato(r, mk) || skip.has(`${r.id}|${mk}`)) continue;
    if (!contiAttivi().some(c => c.nome === r.conto)) continue;
    const sc = scadenza(r, mk);
    if (sc <= oggi) out.push({ r, mk, sc, stato:'scaduta' });
    else if (sc <= tra5) out.push({ r, mk, sc, stato:'arrivo' });
  }
  return out.sort((a,b) => a.sc.localeCompare(b.sc));
}
function movDaRicorrente(v) {
  const r = v.r, adesso = nowStr();
  return { tipo:r.tipo, importo:r.importo, conto:r.conto, conto_dest:r.conto_dest||'', categoria:r.categoria||'', sottocategoria:r.sottocategoria||'',
    nota:r.nota||'', tag:`ric:${r.id}:${v.mk}`, data: v.sc + ' 08:00:00' <= adesso ? v.sc + ' 08:00:00' : adesso };
}
async function aggiungiSilenzioso(mov) {
  try { const j = await api('add', { movimento: mov }); S.movimenti.push(j.movimento); return true; }
  catch (e) { if (e.server) { toast('Errore: ' + e.message, 4000); return false; }
    const ob = getOutbox(); ob.push({ tempId:'tmp'+Date.now()+Math.random().toString(36).slice(2,5), movimento:mov }); setOutbox(ob); return true; }
}
function rigaRic(v) {
  const r = v.r, d = r.tipo === 'trasferimento' ? TIPO_CAT.trasferimento : catDef(r.categoria);
  const quando = v.stato === 'arrivo' ? 'in arrivo ' : '';
  const dt = parseD(v.sc + ' 00:00:00').toLocaleDateString('it-IT',{day:'numeric',month:'short'});
  return `<div class="ric" data-ric="${r.id}|${v.mk}">
    ${bolla(d[0], d[1], 38)}
    <button class="bd ric-open"><span class="t1">${esc(r.tipo === 'trasferimento' ? '→ ' + r.conto_dest : r.nota)}</span><span class="t2">${quando}${dt} · ${esc(r.conto)}</span></button>
    <span class="amt">${eur(r.importo)}</span>
    <button class="icon-btn sm ric-skip" aria-label="Salta">${svgIcon('close',18)}</button>
    <button class="icon-btn sm ok ric-ok" aria-label="Conferma">${svgIcon('check',18)}</button></div>`;
}
function cardRicorrenti() {
  const voci = vociRicorrenti();
  if (!voci.length) return '';
  const g16 = voci.filter(v => v.r.gruppo === '16' && v.stato === 'scaduta');
  const altre = voci.filter(v => !(v.r.gruppo === '16' && v.stato === 'scaduta'));
  const scad = altre.filter(v => v.stato === 'scaduta');
  return `<div class="sec-h"><h2>Da confermare</h2>${scad.length > 1 ? '<button class="link" id="ric-all">Conferma scaduti</button>' : ''}</div>
  ${g16.length ? `<div class="card ric-g"><div class="row"><div><div class="t1">Spostamenti del 16</div><div class="muted small">${g16.length} movimenti · ${eur(r2(g16.reduce((a,v)=>a+v.r.importo,0)))}</div></div>
     <button class="btn mini" id="ric-16">Conferma tutti</button></div>
     <details><summary class="muted small">Vedi o modifica uno per uno</summary>${g16.map(rigaRic).join('')}</details></div>` : ''}
  ${altre.length ? `<div class="card list">${altre.map(rigaRic).join('')}</div>` : ''}
  <p class="muted small" style="margin:4px 8px 0">Tocca il nome per cambiare l'importo prima di confermare.</p>`;
}
function trovaVoce(key) { const [id, mk] = key.split('|'); const r = RICORRENTI.find(x => x.id === id); return { r, mk, sc: scadenza(r, mk) }; }
async function confermaVoci(voci) {
  let n = 0; toast(`Salvataggio di ${voci.length}…`, 60000);
  for (const v of voci) if (await aggiungiSilenzioso(movDaRicorrente(v))) n++;
  persistiCache(); setSync(''); toast(`${n} confermat${n===1?'o':'i'} ✓`); render();
}
function bindRicorrenti() {
  document.querySelectorAll('.ric[data-ric]').forEach(el => {
    const v = trovaVoce(el.dataset.ric);
    el.querySelector('.ric-ok').onclick = () => confermaVoci([v]);
    el.querySelector('.ric-skip').onclick = () => { const st = getSkip(); st.add(`${v.r.id}|${v.mk}`); setSkip(st); toast('Saltato per questo mese'); render(); };
    el.querySelector('.ric-open').onclick = () => { apriForm(null); Object.assign(F, movDaRicorrente(v), { importoTxt: String(v.r.importo).replace('.',','), step:'riepilogo', contoScelto:true, catScelta:true }); renderForm(); };
  });
  const b16 = $('#ric-16'); if (b16) b16.onclick = () => confermaVoci(vociRicorrenti().filter(v => v.r.gruppo === '16' && v.stato === 'scaduta'));
  const ba = $('#ric-all'); if (ba) ba.onclick = () => confermaVoci(vociRicorrenti().filter(v => v.stato === 'scaduta' && v.r.gruppo !== '16'));
}

// controlli del mese: avanzo dal 16 al 21, MPS dal 22 al 25
function cardControlli() {
  const oggi = nowStr().slice(0,10), gg = +oggi.slice(8,10), mk = oggi.slice(0,7);
  const s = saldi(); const out = [];
  if (gg >= 16 && gg <= 21 && mk >= '2026-12') {
    const fatto = tuttiMov().some(m => tagsDi(m).includes(`ric:avanzo:${mk}`));
    const mancano16 = RICORRENTI.some(r => r.gruppo === '16' && mk >= r.dal && !confermato(r, mk));
    if (!fatto) {
      const av = r2(s['Revolut Cointestato'] - 700);
      out.push(mancano16
        ? `<div class="ctl"><span class="ctl-ic warn">${svgIcon('savings',20)}</span><div class="bd"><div class="t1">Avanzo del ciclo</div><div class="t2">Prima conferma gli spostamenti del 16</div></div></div>`
        : av > 0 ? `<div class="ctl"><span class="ctl-ic ok">${svgIcon('savings',20)}</span><div class="bd"><div class="t1">Avanzo da spostare: ${eur(av)}</div><div class="t2">Saldo cointestato − 700 € → Casa & Respiro</div></div><button class="btn mini" id="ctl-avanzo" data-v="${av}">Registra</button></div>`
        : `<div class="ctl"><span class="ctl-ic bad">${svgIcon('savings',20)}</span><div class="bd"><div class="t1">Nessun avanzo: ${eur(av)}</div><div class="t2">Ciclo chiuso sotto 700 €: si recupera con la regola settimanale</div></div></div>`);
    }
  }
  if (gg >= 22 && gg <= 25) {
    const [lo, hi] = intervallo22(mk), v = s['MPS'];
    const fatto = tuttiMov().some(m => tagsDi(m).includes(`ric:integra22:${mk}`));
    if (!fatto) out.push(v < lo
      ? `<div class="ctl"><span class="ctl-ic bad">${svgIcon('account_balance',20)}</span><div class="bd"><div class="t1">MPS sotto soglia: ${eur(v)}</div><div class="t2">Intervallo ${lo}-${hi} €: integra ${eur(r2(hi - v))} da Casa & Respiro</div></div><button class="btn mini" id="ctl-mps" data-v="${r2(hi - v)}">Registra</button></div>`
      : v > hi + 200 ? `<div class="ctl"><span class="ctl-ic warn">${svgIcon('account_balance',20)}</span><div class="bd"><div class="t1">MPS molto sopra soglia: ${eur(v)}</div><div class="t2">${eur(r2(v - hi))} oltre il limite di ${hi} €: controlla che non manchi un addebito; se è avanzo vero, è un dato per la revisione dei Pocket</div></div></div>`
      : `<div class="ctl"><span class="ctl-ic ok">${svgIcon('account_balance',20)}</span><div class="bd"><div class="t1">MPS a posto: ${eur(v)}</div><div class="t2">Intervallo ${lo}-${hi} € · ${v > hi ? 'sopra' : 'dentro'}: nessuna azione</div></div></div>`);
  }
  return out.length ? `<div class="sec-h"><h2>Controlli del mese</h2></div><div class="card list">${out.join('')}</div>` : '';
}
function bindControlli() {
  const mk = nowStr().slice(0,7);
  const a = $('#ctl-avanzo'); if (a) a.onclick = () => { apriForm(null); Object.assign(F, { tipo:'trasferimento', importoTxt:String(a.dataset.v).replace('.',','), conto:'Revolut Cointestato', conto_dest:'Casa & Respiro', nota:'Avanzo del ciclo', tag:`ric:avanzo:${mk}`, step:'riepilogo' }); renderForm(); };
  const m = $('#ctl-mps'); if (m) m.onclick = () => { apriForm(null); Object.assign(F, { tipo:'trasferimento', importoTxt:String(m.dataset.v).replace('.',','), conto:'Casa & Respiro', conto_dest:'MPS', nota:'Integrazione controllo del 22', tag:`ric:integra22:${mk}`, step:'riepilogo' }); renderForm(); };
}

// budget settimanale della vita quotidiana (regola 6.2)
function lunedi(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function movVita(da, a) {
  const s0 = nowStr(da).slice(0,10), s1 = nowStr(a).slice(0,10);
  return tuttiMov().filter(m => m.tipo === 'spesa' && m.conto === VITA.conto && !VITA.escludiCat.includes(m.categoria) && !isOrdineOnline(m)
    && !tagsDi(m).some(t => /^ric:a16-/.test(t) || t === 'da rimborsare') && m.data.slice(0,10) >= s0 && m.data.slice(0,10) < s1);
}
const spesaVita = (da, a) => r2(movVita(da, a).reduce((t,m) => t + +m.importo, 0));
function settimana() {
  const l0 = lunedi(new Date()), l1 = new Date(l0), lm1 = new Date(l0), lm2 = new Date(l0);
  l1.setDate(l1.getDate() + 7); lm1.setDate(lm1.getDate() - 7); lm2.setDate(lm2.getDate() - 14);
  const valida = d => nowStr(d).slice(0,10) >= VITA.dal;
  const over1 = valida(lm1) ? Math.max(0, spesaVita(lm1, l0) - VITA.budget) : 0, over2 = valida(lm2) ? Math.max(0, spesaVita(lm2, lm1) - VITA.budget) : 0;
  const recupero = r2((over1 > 80 ? over1 / 2 : over1) + (over2 > 80 ? over2 / 2 : 0));
  const budget = r2(VITA.budget - recupero), speso = spesaVita(l0, l1);
  return { budget, speso, resto: r2(budget - speso), recupero, da: l0, a: l1 };
}
function cardSettimana() {
  const w = settimana(), pct = w.budget > 0 ? Math.min(100, w.speso / w.budget * 100) : 100;
  const col = w.resto < 0 ? 'var(--neg)' : pct > 80 ? 'var(--warn)' : 'var(--pos)';
  return `<button class="card week" id="week"><div class="row"><div><div class="muted small">Vita quotidiana · settimana</div>
    <div class="week-v">${eur(w.speso)} <span class="muted">di ${eur(w.budget)}</span></div></div>
    <div class="week-r" style="color:${col}">${w.resto >= 0 ? 'restano' : 'sforati'}<b>${eur(Math.abs(w.resto))}</b></div></div>
    <div class="barwrap big"><div class="bar" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>
    ${w.recupero ? `<div class="muted small" style="margin-top:6px">Budget ridotto di ${eur(w.recupero)} per recuperare le settimane precedenti</div>` : ''}</button>`;
}

// ordini di spesa online nel mese contabile (dal 15 al 14, come il profilo della spesa)
function meseOnline() {
  const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth() - (d.getDate() < ONLINE.giornoInizio ? 1 : 0), ONLINE.giornoInizio);
  const fin = new Date(ini.getFullYear(), ini.getMonth() + 1, ONLINE.giornoInizio);
  const s0 = nowStr(ini).slice(0,10), s1 = nowStr(fin).slice(0,10);
  const ordini = tuttiMov().filter(m => isOrdineOnline(m) && m.data.slice(0,10) >= s0 && m.data.slice(0,10) < s1).sort((x,y) => x.data.localeCompare(y.data));
  const speso = r2(ordini.reduce((t,m) => t + +m.importo, 0));
  return { ordini, speso, resto: r2(ONLINE.budget - speso), ini, fin };
}
function cardOnline() {
  const o = meseOnline(), pct = Math.min(100, o.speso / ONLINE.budget * 100);
  const col = o.resto < 0 ? 'var(--neg)' : pct > 85 ? 'var(--warn)' : 'var(--pos)';
  const f = d => d.toLocaleDateString('it-IT', { day:'numeric', month:'short' }), fine = new Date(o.fin); fine.setDate(fine.getDate() - 1);
  return `<div class="card week"><div class="row"><div><div class="muted small">Spesa online · ${f(o.ini)} – ${f(fine)}</div>
    <div class="week-v">${eur(o.speso)} <span class="muted">di ${eur(ONLINE.budget)}</span></div></div>
    <div class="week-r" style="color:${col}">${o.resto >= 0 ? 'restano' : 'sforati'}<b>${eur(Math.abs(o.resto))}</b></div></div>
    <div class="barwrap big"><div class="bar" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>
    <div class="muted small" style="margin-top:6px">${o.ordini.length ? o.ordini.map(m => `${parseD(m.data).toLocaleDateString('it-IT',{day:'numeric',month:'short'})}: ${eur(m.importo)}`).join(' · ') : 'Nessun ordine in questo mese'}</div></div>`;
}

function apriSettimana() {
  const w = settimana(), movs = movVita(w.da, w.a).sort((x,y) => y.data.localeCompare(x.data));
  const fine = new Date(w.a); fine.setDate(fine.getDate() - 1);
  const f = d => d.toLocaleDateString('it-IT', { day:'numeric', month:'short' });
  sheet(`<h2 class="wz-h">Vita quotidiana</h2>
    <p class="muted" style="margin-top:-6px">${f(w.da)} – ${f(fine)} · ${movs.length} spes${movs.length===1?'a':'e'} · ${eur(w.speso)} di ${eur(w.budget)}</p>
    ${movs.length ? listaPerGiorno(movs) : '<p class="muted">Nessuna spesa conteggiata questa settimana.</p>'}
    <p class="muted small" style="margin-top:12px">Contano le spese del Revolut Cointestato. Esclusi: ordini di spesa online (hanno il loro budget), spostamenti del 16, conti personali, PAC, spese da rimborsare e spese registrate sui Pocket.</p>`);
  bindVista();
}

/* ---------------- riepilogo di ieri (v1.7) ---------------- */
// Sostituisce il riepilogo giornaliero pianificato: stessi calcoli, fatti dall'app sui dati già caricati.
// Periodo contabile = dal giorno del primo "Stipendio netto" di ogni mese di calendario.
const RP = { sogliaMPS: 250 };
const isoG = d => nowStr(d).slice(0,10);
const addG = (s, n) => { const d = parseD(s + ' 12:00:00'); d.setDate(d.getDate() + n); return isoG(d); };
const diffG = (a, b) => Math.round((parseD(b + ' 12:00:00') - parseD(a + ' 12:00:00')) / 864e5);
const ggMese = s => parseD(s + ' 12:00:00').toLocaleDateString('it-IT', { day:'numeric', month:'short' });
const isStipendio = m => m.tipo === 'entrata' && m.categoria === 'Reddito' && m.sottocategoria === 'Stipendio netto';
const mediana = a => { const s = a.slice().sort((x,y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k-1] + s[k]) / 2; };

function riepilogo() {
  const dI = new Date(); dI.setDate(dI.getDate() - 1);   // calendario, non -24h (cambio ora legale)
  const ieri = isoG(dI), primaIeri = addG(ieri, -1);
  const movs = tuttiMov(), giorno = m => m.data.slice(0,10);
  // inizi dei periodi
  const perMese = {};
  movs.filter(isStipendio).forEach(m => { const g = giorno(m), k = g.slice(0,7); if (!perMese[k] || g < perMese[k]) perMese[k] = g; });
  const past = Object.values(perMese).sort().filter(g => g <= ieri);
  const S0 = past.length ? past[past.length-1] : ieri.slice(0,8) + '01';
  const P0 = past.length > 1 ? past[past.length-2] : null;
  const N = diffG(S0, ieri) + 1;
  const finestra = (a, b) => {
    let f = 0, v = 0, str = 0; const daily = new Array(diffG(a, b) + 1).fill(0), perCat = {}, varMov = [];
    for (const m of movs) { const g = giorno(m); if (g < a || g > b || !isConsumo(m)) continue;
      if (natura(m) === 'fissa') f += +m.importo; else { v += +m.importo; perCat[m.categoria] = (perCat[m.categoria] || 0) + +m.importo; varMov.push(m); }
      if (tagsDi(m).includes('straordinaria')) str += +m.importo;
      daily[diffG(a, g)] += +m.importo; }
    let c = 0; return { f: r2(f), v: r2(v), str: r2(str), perCat, varMov, cum: daily.map(x => (c += x, r2(c))) };
  };
  const cur = finestra(S0, ieri);
  let prev = { f:0, v:0, str:0, perCat:{}, varMov:[] }, pcum = [], pend = null, fisseDopo = 0;
  if (P0) {
    const fineP = addG(S0, -1);
    pend = addG(P0, N - 1); if (pend > fineP) pend = fineP;
    prev = finestra(P0, pend); pcum = finestra(P0, fineP).cum;
    fisseDopo = r2(movs.filter(m => isConsumo(m) && natura(m) === 'fissa' && giorno(m) > pend && giorno(m) < S0).reduce((a,m) => a + +m.importo, 0));
  }
  // movimenti e saldi
  const movIeri = movs.filter(m => giorno(m) === ieri).sort((a,b) => b.data.localeCompare(a.data));
  const spesi = r2(movIeri.filter(isConsumo).reduce((a,m) => a + +m.importo, 0));
  const s1 = saldi(ieri + ' 23:59:59'), s0 = saldi(primaIeri + ' 23:59:59');
  const reali = contiReali(), nelTot = c => c.nel_totale === true || c.nel_totale === 'TRUE';
  const totale = r2(reali.filter(nelTot).reduce((a,c) => a + s1[c.nome], 0));
  const dTot = r2(totale - reali.filter(nelTot).reduce((a,c) => a + s0[c.nome], 0));
  // avvisi
  const avvisi = [];
  reali.forEach(c => { if (s1[c.nome] < 0) avvisi.push(`Saldo negativo su ${c.nome}: ${eur(s1[c.nome])}`); });
  if ('MPS' in s1 && s1['MPS'] < RP.sogliaMPS) avvisi.push(`MPS sotto il cuscinetto: ${eur(s1['MPS'])} (soglia ${RP.sogliaMPS} €)`);
  const da90 = addG(ieri, -90);
  for (const m of movIeri) {
    if (m.tipo !== 'spesa') continue;
    if (!catInfo(m.categoria, m.sottocategoria, 'spesa')) avvisi.push(`Categoria mancante o sconosciuta: ${eur(+m.importo)} ${m.nota || ''}`.trim());
    // stessa categoria/sottocategoria e stessa nota (es. "Esselunga Online" solo con i suoi ordini, non con i piccoli acquisti)
    const nm = normNota(m.nota);
    const st = movs.filter(x => x !== m && x.tipo === 'spesa' && x.categoria === m.categoria && (x.sottocategoria||'') === (m.sottocategoria||'')
      && normNota(x.nota) === nm && giorno(x) >= da90 && giorno(x) < ieri).map(x => +x.importo);
    if (st.length >= 3 && +m.importo > 3 * mediana(st)) avvisi.push(`Importo insolito: ${eur(+m.importo)} per «${m.nota || m.sottocategoria || m.categoria}» (di solito ${eur(mediana(st))}, mediana 90 gg)`);
  }
  return { ieri, S:S0, P:P0, N, pend, cur, prev, pcum, fisseDopo, movIeri, spesi, s1, s0, reali, totale, dTot, avvisi, evidenza: evidenza(cur, prev, P0) };
}

// Un solo fatto che aiuta a leggere il confronto (regole fisse al posto del commento scritto da Claude).
// Priorità: 1) spese straordinarie  2) categoria che spiega la differenza delle variabili  3) singola spesa che pesa sulle variabili.
const pct = (a, b) => (a - b) / b * 100;
const segnoPct = p => `${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%`;
function evidenza(cur, prev, P) {
  const tot = cur.f + cur.v, ptot = prev.f + prev.v;
  if (cur.str > 0 || prev.str > 0) {
    const a = tot - cur.str, b = ptot - prev.str;
    return `Spese con tag «straordinaria»: ${eur(cur.str)} in questo periodo${P ? `, ${eur(prev.str)} negli stessi giorni del precedente` : ''}.`
      + (P && b > 0 ? ` Senza queste il periodo è ${eur(r2(a))}, ${segnoPct(pct(a, b))} rispetto al precedente.` : '');
  }
  if (P && prev.v > 0) {
    const dv = cur.v - prev.v;
    if (Math.abs(dv) >= 50 && Math.abs(pct(cur.v, prev.v)) >= 10) {
      const cats = [...new Set([...Object.keys(cur.perCat), ...Object.keys(prev.perCat)])]
        .map(c => [c, (cur.perCat[c] || 0) - (prev.perCat[c] || 0)]).filter(([, d]) => Math.sign(d) === Math.sign(dv)).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      if (cats.length && Math.abs(cats[0][1]) >= Math.abs(dv) * 0.5) {
        const [cat, dc] = cats[0], ad = Math.abs(dc), sg = x => `${x > 0 ? '+' : '−'}${eur(Math.abs(r2(x)))}`;
        const chi = ad > Math.abs(dv) * 1.05 ? `la voce che pesa di più è ${cat} (${sg(dc)}), in parte compensata da altre categorie in ${dv > 0 ? 'calo' : 'aumento'}`
          : `${ad >= Math.abs(dv) * 0.9 ? 'quasi tutta' : 'soprattutto'} da ${cat} (${sg(dc)})`;
        let txt = `Variabili ${sg(dv)} rispetto agli stessi giorni del periodo precedente: ${chi}.`;
        // se l'aumento della categoria è dovuto a una sola spesa, la nomina (tipico caso una tantum)
        const top = dv > 0 && cur.varMov.filter(m => m.categoria === cat).sort((x, y) => y.importo - x.importo)[0];
        if (top && +top.importo >= 100 && +top.importo >= dc * 0.6)
          txt += ` Dentro ${cat} conta soprattutto «${top.nota || top.sottocategoria || cat}» (${eur(+top.importo)}): se è una tantum, segnala con il tag «straordinaria».`;
        return txt;
      }
    }
  }
  const big = cur.varMov.slice().sort((x, y) => y.importo - x.importo)[0];
  if (big && +big.importo >= 100 && cur.v > 0 && +big.importo / cur.v >= 0.2)
    return `La spesa più grande del periodo è «${big.nota || big.sottocategoria || big.categoria}» (${eur(+big.importo)}, ${(+big.importo / cur.v * 100).toFixed(0)}% delle variabili): se è una tantum, falsa il confronto. Puoi segnarla con il tag «straordinaria».`;
  return '';
}

function pillVs(a, b) {
  if (b <= 0) return '<span class="rp-pill neu">nessun confronto</span>';
  const p = (a - b) / b * 100;
  if (Math.abs(p) < 1) return '<span class="rp-pill neu">= vs prec.</span>';
  return `<span class="rp-pill ${p < 0 ? 'down' : 'up'}">${p < 0 ? '▼' : '▲'} ${Math.abs(p).toFixed(0)}% vs prec.</span>`;
}

function cardIeri() {
  let R; try { R = riepilogo(); } catch (e) { return ''; }
  const gg = parseD(R.ieri + ' 12:00:00').toLocaleDateString('it-IT', { weekday:'long', day:'numeric' });
  const n = R.movIeri.length, tot = r2(R.cur.f + R.cur.v), ptot = r2(R.prev.f + R.prev.v);
  return `<button class="card rp-card" id="rp-open"><div class="row"><div><div class="muted small">Riepilogo di ${esc(gg)}</div>
    <div class="week-v">${eur(R.spesi)} <span class="muted">spesi · ${n} moviment${n === 1 ? 'o' : 'i'}</span></div></div>
    ${R.avvisi.length ? `<span class="rp-badge">${svgIcon('lightbulb',16)}${R.avvisi.length}</span>` : svgIcon('chevron_right',22)}</div>
    <div class="rp-line"><span>Periodo dal ${esc(ggMese(R.S))}</span><span class="rp-r"><b>${eur(tot)}</b>${pillVs(tot, ptot)}</span></div></button>`;
}

function svgCumulata(R) {
  const W = 340, H = 150, pl = 34, pr = 8, pt = 12, pb = 20, w = W - pl - pr, h = H - pt - pb;
  const cum = R.cur.cum, pc = R.pcum, xmax = Math.max(pc.length, R.N, 30);
  const top = Math.max(1, ...cum, ...pc) * 1.08;
  const step = [250, 500, 1000, 2500, 5000, 10000, 25000, 50000].find(s => top / s <= 2.2) || 50000;
  const ymax = top <= step * 2 ? step * 2 : step * 3;
  const X = d => pl + (d - 1) / (xmax - 1) * w, Y = v => pt + h - v / ymax * h;
  const k = g => g === 0 ? '0' : g >= 1000 ? (g / 1000).toLocaleString('it-IT') + 'k' : String(g);
  let s = `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spese cumulate del periodo">`;
  for (let g = 0; g <= ymax; g += step) s += `<line x1="${pl}" x2="${W-pr}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" class="rp-grid"/><text x="${pl-6}" y="${(Y(g)+3.5).toFixed(1)}" text-anchor="end">${k(g)}</text>`;
  for (const d of [1, 8, 15, 22, xmax]) { const g = addG(R.S, d - 1); s += `<text x="${X(d).toFixed(1)}" y="${H-4}" text-anchor="middle">${+g.slice(8)}/${+g.slice(5,7)}</text>`; }
  if (pc.length) s += `<polyline points="${pc.map((v,i) => `${X(i+1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" class="rp-prev"/>`;
  const pts = cum.map((v,i) => `${X(i+1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  s += `<polygon points="${X(1).toFixed(1)},${Y(0).toFixed(1)} ${pts} ${X(cum.length).toFixed(1)},${Y(0).toFixed(1)}" class="rp-area"/><polyline points="${pts}" class="rp-cur"/>`;
  const cx = X(cum.length), cy = Y(cum[cum.length-1] || 0), dx = cx > W - 90;
  s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" class="rp-dot"/><text x="${(dx ? cx - 8 : cx + 8).toFixed(1)}" y="${(dx ? cy - 8 : cy + 4).toFixed(1)}" text-anchor="${dx ? 'end' : 'start'}" class="rp-lab">${eur(cum[cum.length-1] || 0)}</text>`;
  return s + '</svg>';
}

function apriRiepilogo() {
  const R = riepilogo();
  const gg = s => parseD(s + ' 12:00:00').toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'long' });
  const tot = r2(R.cur.f + R.cur.v), ptot = r2(R.prev.f + R.prev.v);
  let nota = '';
  if (R.prev.f > 0 && Math.abs(R.cur.f - R.prev.f) / R.prev.f > 0.15) {
    nota = `Le fisse dipendono dal calendario degli addebiti: confronto parziale, non necessariamente un ${R.cur.f > R.prev.f ? 'aumento' : 'calo'}.`;
    if (R.fisseDopo > 0) nota += ` Nel periodo precedente, dopo il ${+R.pend.slice(8)}/${+R.pend.slice(5,7)}, arrivarono altre fisse per ${eur(R.fisseDopo)}.`;
  }
  const smax = Math.max(1, ...R.reali.map(c => R.s1[c.nome]));
  const saldiH = R.reali.map(c => { const v = R.s1[c.nome], d = r2(v - R.s0[c.nome]);
    return `<div class="rp-acc"><div><div>${esc(c.nome)}</div><div class="barwrap rp-bar"><div class="bar" style="width:${(Math.max(0, v) / smax * 100).toFixed(0)}%;background:${contoColor(c.nome)}"></div></div></div>
      <div class="rp-accv"><div class="amt ${v < 0 ? 'neg' : ''}">${eur(v)}</div>${d ? `<div class="small ${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${eur(d)}</div>` : ''}</div></div>`; }).join('');
  const avvH = R.avvisi.length ? R.avvisi.map(a => `<div class="hint warn">${svgIcon('lightbulb',18)}<span>${esc(a)}</span></div>`).join('')
    : `<div class="hint ok">${svgIcon('check',18)}<span>Nessun avviso${'MPS' in R.s1 ? ` · MPS ${eur(R.s1['MPS'])}, sopra il cuscinetto` : ''}</span></div>`;
  sheet(`<h2 class="wz-h">Riepilogo di ${esc(gg(R.ieri))}</h2>
    <p class="muted" style="margin-top:-6px">${eur(R.spesi)} di consumi · ${R.movIeri.length} moviment${R.movIeri.length === 1 ? 'o' : 'i'}</p>
    ${R.movIeri.length ? listaPerGiorno(R.movIeri) : '<p class="muted">Nessun movimento registrato ieri.</p>'}
    <div class="set-sec">Periodo dal ${esc(ggMese(R.S))} · giorno ${R.N}</div>
    <div class="card"><div class="rp-tot"><span class="amt">${eur(tot)}</span>${pillVs(tot, ptot)}</div>
      ${svgCumulata(R)}
      <div class="rp-legend"><span><i style="background:var(--accent)"></i>Periodo attuale</span><span><i class="dash"></i>${R.P ? `Dal ${esc(ggMese(R.P))}` : 'Nessun periodo precedente'}</span></div>
      <div class="rp-fv"><div><div class="muted small">Fisse</div><div class="amt">${eur(R.cur.f)}</div>${pillVs(R.cur.f, R.prev.f)}</div>
        <div><div class="muted small">Variabili</div><div class="amt">${eur(R.cur.v)}</div>${pillVs(R.cur.v, R.prev.v)}</div></div>
      ${R.evidenza ? `<div class="hint ok rp-ev">${svgIcon('lightbulb',18)}<span>${esc(R.evidenza)}</span></div>` : ''}
      ${nota ? `<p class="muted small" style="margin:10px 0 0">${esc(nota)}</p>` : ''}
      <p class="muted small" style="margin:8px 0 0">Spese di consumo confrontate con gli stessi ${R.N} giorni del periodo precedente.</p></div>
    <div class="set-sec">Saldi a fine ${+R.ieri.slice(8)}/${+R.ieri.slice(5,7)}</div>
    <div class="card list">${saldiH}<div class="rp-acc rp-totrow"><b>Totale</b><div class="rp-accv"><b class="amt">${eur(R.totale)}</b>${R.dTot ? `<div class="small ${R.dTot < 0 ? 'neg' : 'pos'}">${R.dTot > 0 ? '+' : ''}${eur(R.dTot)}</div>` : ''}</div></div></div>
    <div class="set-sec">Avvisi</div>${avvH}`);
  bindVista();
}

/* ---------------- blocco con impronta (WebAuthn, verifica sul dispositivo) ---------------- */
// È un blocco dell'interfaccia: i dati in localStorage restano in chiaro. Nessun server verifica la firma:
// basta che l'autenticatore del telefono confermi la persona (flag UV nei dati dell'autenticatore).
const LOCK_KEY = 'ts_lock', LOCK_DOPO_MS = 5 * 60 * 1000;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const lockCfg = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)); } catch { return null; } };
const uvOk = authData => (new Uint8Array(authData)[32] & 0x04) !== 0;
async function impraDisponibile() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function registraImpronta() {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'Spiccioli', id: location.hostname },
    user: { id: rnd(16), name: 'spiccioli', displayName: 'Spiccioli' },
    challenge: rnd(32),
    pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
    authenticatorSelection: { authenticatorAttachment:'platform', userVerification:'required', residentKey:'preferred' },
    timeout: 60000, attestation: 'none' } });
  localStorage.setItem(LOCK_KEY, JSON.stringify({ id: b64u(cred.rawId), dal: nowStr() }));
}
let sbloccoInCorso = false;
async function sblocca() {
  const cfg = lockCfg(); if (!cfg) return mostraBlocco(false);
  if (sbloccoInCorso) return; sbloccoInCorso = true;
  try {
    const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname,
      allowCredentials: [{ type:'public-key', id: unb64u(cfg.id) }], userVerification:'required', timeout: 60000 } });
    if (!uvOk(a.response.authenticatorData)) throw new Error('verifica non effettuata');
    mostraBlocco(false);
  } catch (e) {
    $('#lk-msg').textContent = e.name === 'NotAllowedError' ? 'Annullato. Tocca Sblocca per riprovare.' : 'Impronta non riconosciuta (' + (e.message || e.name) + ').';
    $('#lk-reset').classList.remove('hidden');
  } finally { sbloccoInCorso = false; }
}
function mostraBlocco(on) {
  document.documentElement.classList.toggle('locked', on);
  if (on) { $('#lk-msg').textContent = "Usa l'impronta per sbloccare"; sblocca(); }
}
function initBlocco() {
  $('#lk-ic').innerHTML = svgIcon('fingerprint', 44);
  $('#lk-go').innerHTML = svgIcon('fingerprint', 20) + ' Sblocca'; $('#lk-go').onclick = sblocca;
  // se la passkey è stata cancellata dal telefono, se ne registra una nuova: anche questo richiede l'impronta/PIN
  $('#lk-reset').onclick = async () => {
    try { await registraImpronta(); $('#lk-reset').classList.add('hidden'); mostraBlocco(false); toast('Impronta registrata di nuovo'); }
    catch (e) { $('#lk-msg').textContent = 'Registrazione non riuscita: ' + (e.message || e.name); }
  };
  let nascostaDa = 0;
  document.addEventListener('visibilitychange', () => {
    if (!lockCfg()) return;
    if (document.visibilityState === 'hidden') nascostaDa = Date.now();
    else if (nascostaDa && Date.now() - nascostaDa > LOCK_DOPO_MS) mostraBlocco(true);
  });
  if (lockCfg()) mostraBlocco(true);
}

/* ---------------- verifica saldi e rimborsi (v1.9) ---------------- */
// Verifica saldi: dal 16 del mese (dopo gli spostamenti del 16) si conferma conto per conto che il saldo coincide con la banca.
// "Coincide" resta sul telefono (ts_verif); un "Allinea" crea una rettifica nel foglio e vale come verifica.
const LS_VERIF = 'ts_verif', VERIF_DAL = '2026-11';
const getVerif = () => { try { return JSON.parse(localStorage.getItem(LS_VERIF)) || {}; } catch { return {}; } };
function verificato(conto, mk) {
  if ((getVerif()[mk] || {})[conto]) return true;
  return tuttiMov().some(m => m.conto === conto && ((m.tipo === 'rettifica' && m.nota === 'Allineamento saldo') || tagsDi(m).includes('allinea'))
    && m.data.slice(0,10) >= mk + '-16' && m.data.slice(0,7) === mk);
}
function cardVerifica() {
  const oggi = nowStr().slice(0,10), mk = oggi.slice(0,7);
  if (+oggi.slice(8,10) < 16 || mk < VERIF_DAL) return '';
  if (RICORRENTI.some(r => r.gruppo === '16' && mk >= r.dal && !confermato(r, mk))) return '';
  const s = saldi(), conti = contiReali().map(c => c.nome);
  const daFare = conti.filter(n => !verificato(n, mk));
  if (!daFare.length) return '';
  return `<div class="sec-h"><h2>Verifica saldi</h2><span class="muted small">${conti.length - daFare.length}/${conti.length}</span></div>
  <div class="card list">${daFare.map(n => `<div class="ric" data-vf="${esc(n)}">
    <span class="acc-dot" style="background:${contoColor(n)}"></span>
    <div class="bd"><span class="t1 wrap">${esc(n)}</span></div>
    <span class="amt">${eur(s[n])}</span>
    <button class="icon-btn sm vf-no" aria-label="Non coincide, allinea">${svgIcon('tune',18)}</button>
    <button class="icon-btn sm ok vf-ok" aria-label="Coincide">${svgIcon('check',18)}</button></div>`).join('')}</div>
  <p class="muted small" style="margin:4px 8px 0">Coincide con la banca? ✓ se sì, altrimenti il tasto a sinistra per allinearlo.</p>`;
}
function bindVerifica() {
  const mk = nowStr().slice(0,7);
  document.querySelectorAll('[data-vf]').forEach(el => {
    const n = el.dataset.vf;
    el.querySelector('.vf-ok').onclick = () => { const v = getVerif(); v[mk] = v[mk] || {}; v[mk][n] = nowStr(); localStorage.setItem(LS_VERIF, JSON.stringify(v)); render(); };
    el.querySelector('.vf-no').onclick = () => apriConto(n);
  });
}

// Rimborsi: spese con tag "da rimborsare" senza un'entrata collegata (tag rimb:<id spesa>).
const RIMB_CAT = ['Entrate Straordinarie', 'Rimborsi'];
function rimborsiAperti() {
  const tutti = tuttiMov(), chiusi = new Set();
  tutti.forEach(m => tagsDi(m).forEach(t => { if (t.startsWith('rimb:')) chiusi.add(t.slice(5)); }));
  return tutti.filter(m => m.id && !m._pending && m.tipo === 'spesa' && tagsDi(m).includes('da rimborsare') && !chiusi.has(m.id)).sort((x,y) => x.data.localeCompare(y.data));
}
function cardRimborsi() {
  const ap = rimborsiAperti(); if (!ap.length) return '';
  const tot = r2(ap.reduce((t,m) => t + +m.importo, 0));
  return `<div class="sec-h"><h2>Rimborsi da incassare</h2><span class="muted small">${eur(tot)}</span></div>
  <div class="card list">${ap.map(m => { const d = catDef(m.categoria); const gg = Math.floor((Date.now() - parseD(m.data)) / 864e5);
    return `<div class="ric" data-rb="${esc(m.id)}">${bolla(d[0], d[1], 38)}
    <div class="bd"><span class="t1">${esc(m.nota || m.sottocategoria || m.categoria)}</span><span class="t2">${parseD(m.data).toLocaleDateString('it-IT',{day:'numeric',month:'short'})} · ${gg} gg fa</span></div>
    <span class="amt">${eur(m.importo)}</span>
    <button class="icon-btn sm rb-no" aria-label="Non arriverà">${svgIcon('close',18)}</button>
    <button class="icon-btn sm ok rb-ok" aria-label="Incassato">${svgIcon('check',18)}</button></div>`; }).join('')}</div>
  <p class="muted small" style="margin:4px 8px 0">✓ quando arriva il rimborso (puoi cambiare importo e conto). Per aggiungerne uno usa il tag "da rimborsare".</p>`;
}
function bindRimborsi() {
  document.querySelectorAll('[data-rb]').forEach(el => {
    const sp = tuttiMov().find(m => m.id === el.dataset.rb); if (!sp) return;
    el.querySelector('.rb-ok').onclick = () => { apriForm(null); Object.assign(F, { tipo:'entrata', importoTxt:String(sp.importo).replace('.',','), conto:sp.conto, conto_dest:'',
      categoria:RIMB_CAT[0], sottocategoria:RIMB_CAT[1], nota:'Rimborso ' + (sp.nota || sp.sottocategoria || sp.categoria), tag:'rimb:' + sp.id, step:'riepilogo', contoScelto:true, catScelta:true }); renderForm(); };
    el.querySelector('.rb-no').onclick = () => {
      sheet(`<h2 class="wz-h">Rimborso non in arrivo?</h2><p class="muted">"${esc(sp.nota || sp.categoria)}" (${eur(sp.importo)}) esce dall'elenco e resta una spesa normale.</p>
        <div class="btns"><button class="btn sec" id="rn-no">Annulla</button><button class="btn" id="f-ok">Conferma</button></div>`);
      $('#rn-no').onclick = chiudi;
      $('#f-ok').onclick = () => salva({ ...sp, tag: tagsDi(sp).filter(t => t !== 'da rimborsare').join(', ') });
    };
  });
}

// Anticipi da reintegrare: spese pagate da un Pocket "in prestito" (tag "da reintegrare"), da restituire con la 13ª
// (decisione 31: regali di Natale anticipati da Casa & Respiro, restituiti il 22 dicembre con la quota della 13ª per i regali).
const REINTEGRO = { mmdd: '12-22', etichetta: '22 dicembre, con la 13ª' };
function anticipiAperti() {
  const tutti = tuttiMov(), chiusi = new Set();
  tutti.forEach(m => tagsDi(m).forEach(t => { if (t.startsWith('reint:')) t.slice(6).split('+').forEach(id => chiusi.add(id)); }));
  return tutti.filter(m => m.id && !m._pending && m.tipo === 'spesa' && tagsDi(m).includes('da reintegrare') && !chiusi.has(m.id));
}
function cardAnticipi() {
  const ap = anticipiAperti(); if (!ap.length) return '';
  const tot = r2(ap.reduce((t,m) => t + +m.importo, 0)), oggi = nowStr().slice(5,10), ora = oggi >= REINTEGRO.mmdd;
  const perConto = {}; ap.forEach(m => perConto[m.conto] = r2((perConto[m.conto] || 0) + +m.importo));
  const conti = Object.keys(perConto);
  return `<div class="sec-h"><h2>Da reintegrare</h2><span class="muted small">${eur(tot)}</span></div>
  <div class="card ${ora ? 'rint-on' : ''}" style="padding:14px 16px">
    <div class="muted small">${ora ? 'È il momento: reintegra con la 13ª' : 'Promemoria per il ' + REINTEGRO.etichetta}</div>
    ${ap.map(m => `<div class="sum-row"><span>${esc(m.nota || m.categoria)} <span class="muted small">· ${esc(m.conto)}</span></span><span class="sum-v">${eur(m.importo)}</span></div>`).join('')}
    ${ora ? conti.map(c => `<button class="btn" style="margin-top:12px;width:100%" data-rint="${esc(c)}">Reintegra ${eur(perConto[c])} su ${esc(c)}</button>`).join('') : ''}
  </div>`;
}
function bindAnticipi() {
  document.querySelectorAll('[data-rint]').forEach(b => b.onclick = () => {
    const c = b.dataset.rint, ap = anticipiAperti().filter(m => m.conto === c), tot = r2(ap.reduce((t,m) => t + +m.importo, 0));
    apriForm(null); Object.assign(F, { tipo:'trasferimento', importoTxt:String(tot).replace('.',','), conto:'Revolut Cointestato', conto_dest:c,
      nota:'Reintegro anticipo: ' + ap.map(m => m.nota || m.categoria).join(', '), tag:'reint:' + ap.map(m => m.id).join('+'), step:'riepilogo' }); renderForm();
  });
}

/* ---------------- impostazioni ---------------- */
const TEMI = [['auto','Automatico','brightness_auto','linear-gradient(135deg,#F6F7FB 50%,#0F1115 50%)'],['light','Chiaro','light_mode','#F6F7FB'],
  ['dim','Medio','contrast','#2F3540'],['dark','Scuro','dark_mode','#0F1115']];
const temaAttuale = () => { try { return localStorage.getItem('ts_theme') || 'auto'; } catch { return 'auto'; } };
function applicaTema(t) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  // colore della barra di stato: con il tema forzato vale una sola meta, senza media query
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const col = { light:'#F6F7FB', dim:'#252A33', dark:'#0F1115' };
  const add = (c, media) => { const m = document.createElement('meta'); m.name = 'theme-color'; m.content = c; if (media) m.media = media; document.head.appendChild(m); };
  if (t === 'auto') { add(col.light, '(prefers-color-scheme: light)'); add(col.dark, '(prefers-color-scheme: dark)'); } else add(col[t]);
}
function apriImpostazioni() {
  const t = temaAttuale(), cfg = getCfg();
  sheet(`<h2 class="wz-h">Impostazioni</h2>
    <div class="set-sec">Tema</div>
    <div class="themes">${TEMI.map(([k,l,ic,bg]) => `<button data-th="${k}" class="${t===k?'on':''}"><span class="sw" style="background:${bg};color:${k==='light'?'#1B1D24':'#E7E9EF'}">${k==='auto'?'':svgIcon(ic,18)}</span>${l}</button>`).join('')}</div>
    <p class="muted small" style="margin:8px 2px 0">Automatico segue il tema chiaro/scuro del telefono.</p>
    <div class="set-sec">App</div>
    <div class="card list">
      <div class="set-row"><span>Versione</span><span class="muted">${APP_VERSION}</span></div>
      <div class="set-row"><span>Collegamento</span><span class="muted">${cfg ? 'configurato' : 'non configurato'}</span></div>
      <div class="set-row"><span>Memoria permanente<br><span class="muted small">Se è "no", Chrome può cancellare i dati dell'app</span></span><span class="muted" id="set-persist">…</span></div>
      <button class="set-row" id="set-sync" ><span>Ricarica i dati dal foglio</span>${svgIcon('sync',20)}</button>
    </div>
    <div class="set-sec">Sicurezza</div>
    <div class="card list">
      <div class="set-row"><span>Blocco con impronta<br><span class="muted small">All'apertura e dopo 5 minuti in background</span></span>
        <label class="toggle"><input type="checkbox" id="set-lock" ${lockCfg() ? 'checked' : ''}><span></span></label></div>
    </div>`);
  document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => {
    try { localStorage.setItem('ts_theme', b.dataset.th); } catch {}
    applicaTema(b.dataset.th); document.querySelectorAll('[data-th]').forEach(x => x.classList.toggle('on', x === b));
  });
  (async () => { const el = $('#set-persist'); if (!el) return;
    try { el.textContent = navigator.storage && await navigator.storage.persisted() ? 'sì' : 'no'; } catch { el.textContent = 'n/d'; } })();
  $('#set-sync').onclick = () => { chiudi(); caricaDati(); toast('Aggiornamento…'); };
  $('#set-lock').onchange = async e => {
    const cb = e.target;
    if (cb.checked) {
      if (!(await impraDisponibile())) { cb.checked = false; return toast('Impronta non disponibile su questo dispositivo', 4000); }
      try { await registraImpronta(); toast('Blocco attivo ✓'); }
      catch (err) { cb.checked = false; toast(err.name === 'NotAllowedError' ? 'Attivazione annullata' : 'Errore: ' + (err.message || err.name), 4000); }
    } else {
      // per disattivare serve comunque l'impronta, altrimenti chiunque con l'app aperta lo toglierebbe
      try {
        const c = lockCfg();
        const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname,
          allowCredentials: [{ type:'public-key', id: unb64u(c.id) }], userVerification:'required', timeout: 60000 } });
        if (!uvOk(a.response.authenticatorData)) throw new Error('verifica non effettuata');
        localStorage.removeItem(LOCK_KEY); toast('Blocco disattivato');
      } catch (err) { cb.checked = true; toast('Disattivazione annullata', 3000); }
    }
  };
}

// doppioni: stesso tipo, importo, giorno e categoria (o stessi conti per i trasferimenti)
function possibileDoppione(mov) {
  return tuttiMov().find(m => m.id !== mov.id && m.tipo === mov.tipo && Math.abs(+m.importo - mov.importo) < 0.005 && m.data.slice(0,10) === mov.data.slice(0,10)
    && (mov.tipo === 'trasferimento' ? m.conto === mov.conto && m.conto_dest === mov.conto_dest : m.categoria === mov.categoria && (m.sottocategoria||'') === (mov.sottocategoria||'')));
}

/* ---------------- form movimento a step ---------------- */
// Regole "da dove pago" (report, sezione 6.1) per categoria/sottocategoria. '*' = tutte le sottocategorie.
// conto: nome del conto atteso; personale: si paga dal conto personale (non tracciato qui).
const REGOLE = [
  ['Spesa','*',{conto:'Revolut Cointestato',why:'vita quotidiana'}],
  ['Fuori casa','Pranzi lavoro',{personale:'di chi pranza',why:'i pranzi di lavoro si pagano dal conto personale (prima i buoni pasto)'}],
  ['Fuori casa','*',{conto:'Revolut Cointestato',why:'vita quotidiana'}],
  ['Abitazione','Articoli per la casa',{conto:'Revolut Cointestato',why:'piccoli acquisti ricorrenti: vita quotidiana'}],
  ['Abitazione','Mobilio',{conto:'Casa & Respiro',why:'mobili e arredo'}],
  ['Abitazione','Manutenzione ordinaria',{conto:'Manutenzione',why:'riparazioni e manutenzione di casa'}],
  ['Abitazione','Manutenzione straordinaria',{conto:'Manutenzione',why:'guasti e riparazioni (se non basta: BBVA)'}],
  ['Salute','Farmaci',{conto:'Revolut Cointestato',why:'farmacia: vita quotidiana'}],
  ['Salute','*',{conto:'Casa & Respiro',why:'visite ed esami degli adulti (per le bimbe: Fondo Bimbe)'}],
  ['Milù','Cibo gatti',{conto:'Revolut Cointestato',why:'vita quotidiana'}],
  ['Milù','Veterinario',{conto:'Casa & Respiro',why:'veterinario oltre il vaccino (il vaccino annuale: vita quotidiana)'}],
  ['Emilia','*',{conto:'Fondo Bimbe',why:'spese per le bimbe'}],
  ['Famiglia','Giocattoli',{conto:'Fondo Bimbe',why:'spese per le bimbe'}],
  ['Istruzione / Formazione','Mensa scolastica',{conto:'Scadenze',why:'la mensa si paga da Scadenze'}],
  ['Istruzione / Formazione','Gres',{conto:'Scadenze',why:'il GRES si paga da Scadenze'}],
  ['Istruzione / Formazione','*',{conto:'Fondo Bimbe',why:'scuola e attività delle bimbe'}],
  ['Regali','*',{conto:'Vacanze e Regali',why:'regali e feste'}],
  ['Vacanze e uscite','*',{conto:'Vacanze e Regali',why:'viaggi, alloggi e uscite in vacanza'}],
  ['Trasporti','Manutenzione auto',{conto:'Manutenzione',why:'tagliando, revisione, gomme'}],
  ['Trasporti','*',{personale:'di Sabri',why:'carburante, pedaggi, parcheggi e multe si pagano dal conto personale di Sabri'}],
  ['Lavoro','Spese trasferta',{personale:'di Jonathan',why:'le trasferte si anticipano dal conto personale (rimborso in busta)'}],
  ['Utenze','Tari',{conto:'Scadenze',why:'la TARI si paga da Scadenze'}],
  ['Utenze','*',{conto:'MPS',why:'spese fisse in addebito su MPS'}],
  ['Finanziamenti / Debiti','*',{conto:'MPS',why:'rate in addebito su MPS'}],
  ['Polizze','*',{conto:'MPS',why:'Allianz in addebito su MPS da dicembre 2026'}],
  ['Beneficenza','*',{conto:'MPS',why:'donazione in addebito su MPS'}],
  ['Shopping e Svago','Abbonamenti',{conto:'Revolut Cointestato',why:'abbonamenti piccoli: vita quotidiana'}]
];
function regolaPer(cat, sub) {
  const r = REGOLE.find(([c,s]) => c === cat && s === (sub||'')) || REGOLE.find(([c,s]) => c === cat && s === '*');
  if (!r) return null;
  const v = r[2];
  if (v.conto && !contiAttivi().some(c => c.nome === v.conto)) return null;
  return v;
}
const normNota = t => String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
// indice delle note già usate: nota normalizzata -> categoria/sottocategoria/conto più frequenti
function indiceNote(tipo) {
  const idx = {};
  for (const m of tuttiMov()) {
    if (m.tipo !== tipo || !m.nota) continue;
    const k = normNota(m.nota); if (!k) continue;
    const e = idx[k] || (idx[k] = { nota: m.nota, n: 0, last: '', cats: {} });
    e.n++; if (m.data > e.last) { e.last = m.data; e.nota = m.nota; }
    const ck = m.categoria + '||' + (m.sottocategoria||'');
    e.cats[ck] = (e.cats[ck]||0) + 1;
  }
  return idx;
}
function topCat(e) { const [k, n] = Object.entries(e.cats).sort((a,b) => b[1]-a[1])[0]; const [cat, sub] = k.split('||'); return { cat, sub, n, quota: n / e.n }; }
function suggerisci(tipo, nota) {
  const q = normNota(nota); if (!q) return { lista: [], cat: null };
  const idx = indiceNote(tipo);
  const voci = Object.entries(idx).map(([k, e]) => {
    let score = 0;
    if (k === q) score = 100; else if (k.startsWith(q)) score = 60; else if (k.includes(q)) score = 40;
    else { const w = q.split(' ')[0]; if (w.length >= 3 && k.split(' ').includes(w)) score = 25; }
    return { k, e, score: score ? score + Math.min(e.n, 20) : 0 };
  }).filter(v => v.score).sort((a,b) => b.score - a.score || b.e.last.localeCompare(a.e.last));
  const best = voci[0];
  let cat = best && best.score >= 25 ? { ...topCat(best.e), da: best.e.nota, esatta: best.k === q } : null;
  // gli ordini online hanno una sottocategoria propria (budget a parte), anche se lo storico li ha come Supermercati
  if (tipo === 'spesa' && /esselunga\s*online/i.test(nota)) cat = { cat:'Spesa', sub:'Spesa online', n:1, quota:1, da:nota, esatta:true };
  return { lista: voci.slice(0, 5), cat };
}

let F = null;
function apriForm(m) {
  F = m ? { ...m, importoTxt: String(Math.abs(m.importo)).replace('.',','), segnoRett: m.tipo==='rettifica' && m.importo<0 ? -1 : 1, step: 'riepilogo', contoScelto: true, catScelta: true }
        : { tipo:'spesa', importoTxt:'', conto:DEFAULT_CONTO, conto_dest:'', categoria:'', sottocategoria:'', nota:'', tag:'', data:nowStr(), segnoRett:1, step:'importo', contoScelto:false, catScelta:false };
  renderForm();
}
const passiPer = t => t === 'trasferimento' ? ['importo','conti','riepilogo'] : t === 'rettifica' ? ['importo','riepilogo'] : ['importo','nota','categoria','riepilogo'];
function vai(step) { F.step = step; if (step === 'riepilogo') F.daRiep = false; renderForm(); }
// se il passo è stato riaperto dal riepilogo, 'avanti' torna lì invece di ripercorrere tutto il wizard
function avanti() { const p = passiPer(F.tipo); const i = p.indexOf(F.step); if (F.daRiep && p.includes('riepilogo')) return vai('riepilogo'); if (i < p.length - 1) vai(p[i+1]); }
function indietro() { const p = passiPer(F.tipo); const i = p.indexOf(F.step); if (i > 0) vai(p[i-1]); else chiudi(); }

function testataStep(titolo) {
  const p = passiPer(F.tipo), i = p.indexOf(F.step);
  return `<div class="wz-top"><button class="icon-btn" id="wz-back" aria-label="Indietro">${svgIcon(i > 0 ? 'arrow_back' : 'close', 22)}</button>
    <div class="wz-dots">${p.map((_,j) => `<span class="${j<=i?'on':''}"></span>`).join('')}</div><span style="width:40px"></span></div>
    <h2 class="wz-h">${titolo}</h2>`;
}
function importoFmt() { const v = parseImporto(F.importoTxt); return isFinite(v) ? eur(F.tipo==='rettifica' ? v*F.segnoRett : v) : '—'; }

function renderForm() {
  const st = F.step;
  const tipi = [['spesa','Spesa'],['entrata','Entrata'],['trasferimento','Trasf.'],['rettifica','Rettifica']];
  let html = '';
  if (st === 'importo') {
    html = testataStep(F.id ? 'Importo' : 'Quanto?') + `
      <div class="seg" id="f-tipo">${tipi.map(([k,l])=>`<button data-t="${k}" class="${F.tipo===k?'on':''}">${l}</button>`).join('')}</div>
      <div class="wz-amt">${F.tipo==='rettifica'?`<button class="chip" id="f-segno">${F.segnoRett<0?'−':'+'}</button>`:''}
        <input id="f-imp" class="bigamt" inputmode="decimal" enterkeyhint="next" placeholder="0,00" value="${esc(F.importoTxt)}"><span class="wz-eur">€</span></div>
      <div class="btns"><button class="btn" id="wz-next">Avanti</button></div>`;
  } else if (st === 'nota') {
    const sg = suggerisci(F.tipo, F.nota);
    html = testataStep('Che cos\'è?') + `
      <div class="wz-sub">${importoFmt()}</div>
      <input id="f-nota" value="${esc(F.nota)}" placeholder="es. Esselunga, Farmacia, Pannolini" enterkeyhint="next" autocomplete="off">
      <div id="sugg">${listaSugg(sg)}</div>
      <div class="btns"><button class="btn" id="wz-next">${F.nota ? 'Avanti' : 'Salta'}</button></div>`;
  } else if (st === 'categoria') {
    const freq = freqCategorie(F.tipo);
    const cats = [...new Set(S.categorie.filter(c => c.tipo === F.tipo).map(c => c.categoria))]
      .map(c => [c, Object.entries(freq).filter(([k]) => k.startsWith(c+'||')).reduce((a,[,v])=>a+v,0)])
      .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
    const subs = F.categoria ? S.categorie.filter(c => c.tipo === F.tipo && c.categoria === F.categoria).map(c => String(c.sottocategoria||'')) : [];
    const hasSubs = subs.length > 1 || (subs.length === 1 && subs[0]);
    html = testataStep('Categoria') + `
      <div class="wz-sub">${importoFmt()}${F.nota ? ' · ' + esc(F.nota) : ''}</div>
      ${F.sugg && !F.catScelta ? `<div class="hint ok">${svgIcon('check',18)}<span>Suggerita da «${esc(F.sugg.da)}»: ${esc(F.sugg.cat)}${F.sugg.sub ? ' › ' + esc(F.sugg.sub) : ''}</span></div>` : ''}
      <div class="catgrid">${cats.map(c=>{ const d=catDef(c); return `<button data-cat="${esc(c)}" class="${F.categoria===c?'on':''}">${bolla(d[0], d[1], 46)}<span class="cg-l">${esc(c)}</span></button>`; }).join('')}</div>
      ${hasSubs ? `<label>Sottocategoria</label><div class="chips">${subs.map(x=>`<button class="chip ${String(F.sottocategoria||'')===x?'on':''}" data-sub="${esc(x)}">${x?esc(x):'(nessuna)'}</button>`).join('')}</div>` : ''}
      <div class="btns"><button class="btn" id="wz-next" ${F.categoria?'':'disabled'}>Avanti</button></div>`;
  } else if (st === 'conti') {
    const conti = contiAttivi();
    html = testataStep('Da dove a dove?') + `<div class="wz-sub">${importoFmt()}</div>
      <label>Da</label><div class="chips">${conti.map(c=>`<button class="chip ${F.conto===c.nome?'on':''}" data-da="${esc(c.nome)}">${esc(c.nome)}</button>`).join('')}</div>
      <label>A</label><div class="chips">${conti.map(c=>`<button class="chip ${F.conto_dest===c.nome?'on':''}" data-a="${esc(c.nome)}" ${F.conto===c.nome?'disabled':''}>${esc(c.nome)}</button>`).join('')}</div>
      <div class="btns"><button class="btn" id="wz-next" ${F.conto_dest && F.conto_dest!==F.conto?'':'disabled'}>Avanti</button></div>`;
  } else {
    html = renderRiepilogo();
  }
  sheet(html);
  bindForm();
}

function listaSugg(sg) {
  if (!sg.lista.length) return '';
  return `<div class="sugg-list">${sg.lista.map(v => { const t = topCat(v.e); const d = catDef(t.cat);
    return `<button class="sugg" data-nota="${esc(v.e.nota)}">${bolla(d[0], d[1], 34)}<span class="bd"><span class="t1">${esc(v.e.nota)}</span><span class="t2">${esc(t.sub || t.cat)} · ${v.e.n} volt${v.e.n===1?'a':'e'}</span></span></button>`; }).join('')}</div>`;
}

function controlloConto() {
  if (F.tipo !== 'spesa') return '';
  const r = regolaPer(F.categoria, F.sottocategoria);
  if (!r) return '';
  if (r.personale) return `<div class="hint warn">${svgIcon('lightbulb',18)}<span>Di regola ${esc(r.why)}. Il conto personale non è tracciato qui: se l'hai pagata davvero da ${esc(F.conto)}, va bene così.</span></div>`;
  if (r.conto === F.conto) return `<div class="hint ok">${svgIcon('check',18)}<span>Conto giusto: ${esc(r.why)}.</span></div>`;
  return `<div class="hint warn">${svgIcon('lightbulb',18)}<span>Di regola si paga da <b>${esc(r.conto)}</b> (${esc(r.why)}).</span><button class="link" id="usa-conto" data-c="${esc(r.conto)}">Usa ${esc(r.conto)}</button></div>`;
}

function renderRiepilogo() {
  const conti = contiAttivi();
  const tags = (F.tag||'').split(',').map(t=>t.trim()).filter(Boolean);
  const d = F.tipo==='trasferimento' ? TIPO_CAT.trasferimento : F.tipo==='rettifica' ? TIPO_CAT.rettifica : catDef(F.categoria);
  const usaCat = F.tipo === 'spesa' || F.tipo === 'entrata';
  const riga = (step, lab, val) => `<button class="sum-row" data-go="${step}"><span class="muted small">${lab}</span><span class="sum-v">${val}</span>${svgIcon('chevron_right',20)}</button>`;
  return testataStep(F.id ? 'Modifica movimento' : 'Controlla e salva') + `
    <div class="sum-head">${bolla(d[0], d[1], 52)}<div><div class="sum-amt ${F.tipo==='spesa'?'neg':F.tipo==='entrata'?'pos':''}">${importoFmt()}</div><div class="muted small">${({spesa:'Spesa',entrata:'Entrata',trasferimento:'Trasferimento',rettifica:'Rettifica'})[F.tipo]}</div></div></div>
    <div class="card list sum">
      ${riga('importo','Importo', importoFmt())}
      ${F.tipo!=='rettifica' && F.tipo!=='trasferimento' ? riga('nota','Nota', esc(F.nota||'—')) : ''}
      ${usaCat ? riga('categoria','Categoria', esc(F.categoria ? F.categoria + (F.sottocategoria ? ' › ' + F.sottocategoria : '') : 'da scegliere')) : ''}
      ${F.tipo==='trasferimento' ? riga('conti','Conti', esc(F.conto + ' → ' + (F.conto_dest||'—'))) : ''}
    </div>
    ${F.tipo!=='trasferimento' ? `<label>Conto</label><div class="chips" id="f-conti">${contiReali().map(c=>`<button class="chip ${F.conto===c.nome?'on':''}" data-conto-sel="${esc(c.nome)}">${esc(c.nome)}</button>`).join('')}</div>${controlloConto()}` : ''}
    ${F.tipo==='rettifica' || F.tipo==='trasferimento' ? `<label>Nota</label><input id="f-nota2" value="${esc(F.nota)}" placeholder="facoltativa">` : ''}
    <label>Tag</label><div class="chips">${TAG_PRESET.map(t=>`<button class="chip ${tags.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join('')}</div>
    <label>Data e ora</label><input id="f-data" type="datetime-local" step="1" value="${esc(F.data.replace(' ','T'))}">
    <div class="btns">${F.id?'<button class="btn danger" id="f-del">Elimina</button>':''}<button class="btn" id="f-ok">${F.id?'Salva':'Aggiungi'}</button></div>`;
}

function scegliCategoria(cat, sub) {
  F.categoria = cat;
  const subs = S.categorie.filter(c => c.tipo === F.tipo && c.categoria === cat).map(c => String(c.sottocategoria||''));
  if (sub !== undefined && subs.includes(sub)) F.sottocategoria = sub;
  else { const freq = freqCategorie(F.tipo); F.sottocategoria = subs.slice().sort((a,b) => (freq[cat+'||'+b]||0) - (freq[cat+'||'+a]||0))[0] || ''; }
  // conto proposto dalla regola, finché l'utente non l'ha scelto a mano
  const r = regolaPer(F.categoria, F.sottocategoria);
  if (!F.contoScelto && F.tipo === 'spesa') F.conto = r && r.conto ? r.conto : DEFAULT_CONTO;
}

function bindForm() {
  const back = $('#wz-back'); if (back) back.onclick = indietro;
  const next = $('#wz-next');
  const leggiData = () => { const dv = $('#f-data')?.value; if (dv) F.data = (dv.length === 16 ? dv + ':00' : dv).replace('T',' '); };
  if (F.step === 'importo') {
    const inp = $('#f-imp');
    const go = () => { F.importoTxt = inp.value; const v = parseImporto(F.importoTxt); if (!isFinite(v) || v <= 0) return toast('Importo non valido'); avanti(); };
    next.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    document.querySelectorAll('#f-tipo button').forEach(b => b.onclick = () => { F.importoTxt = inp.value; if (F.tipo !== b.dataset.t) { F.tipo = b.dataset.t; F.categoria=''; F.sottocategoria=''; F.catScelta=false; F.sugg=null; if (F.tipo==='trasferimento' && !F.conto_dest) F.conto = DEFAULT_CONTO; } renderForm(); });
    const sg = $('#f-segno'); if (sg) sg.onclick = () => { F.importoTxt = inp.value; F.segnoRett *= -1; renderForm(); };
    setTimeout(() => { inp.focus(); inp.select?.(); }, 60);
  }
  if (F.step === 'nota') {
    const inp = $('#f-nota');
    const conferma = () => {
      F.nota = inp.value.trim();
      const sg = suggerisci(F.tipo, F.nota);
      if (sg.cat && !F.catScelta) { F.sugg = sg.cat; scegliCategoria(sg.cat.cat, sg.cat.sub); } else if (!sg.cat) F.sugg = null;
      avanti();
    };
    inp.oninput = () => { F.nota = inp.value; $('#sugg').innerHTML = listaSugg(suggerisci(F.tipo, F.nota)); next.textContent = F.nota ? 'Avanti' : 'Salta'; bindSugg(); };
    inp.onkeydown = e => { if (e.key === 'Enter') conferma(); };
    next.onclick = conferma;
    const bindSugg = () => document.querySelectorAll('.sugg').forEach(b => b.onclick = () => { inp.value = b.dataset.nota; conferma(); });
    bindSugg();
    setTimeout(() => inp.focus(), 60);
  }
  if (F.step === 'categoria') {
    document.querySelectorAll('.catgrid button').forEach(b => b.onclick = () => {
      F.catScelta = true; scegliCategoria(b.dataset.cat);
      const subs = S.categorie.filter(c => c.tipo === F.tipo && c.categoria === F.categoria).map(c => String(c.sottocategoria||''));
      if (subs.length > 1 || (subs.length === 1 && subs[0])) renderForm(); else avanti();
    });
    document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { F.catScelta = true; scegliCategoria(F.categoria, b.dataset.sub); avanti(); });
    next.onclick = () => { if (F.categoria) { F.catScelta = true; avanti(); } };
  }
  if (F.step === 'conti') {
    document.querySelectorAll('[data-da]').forEach(b => b.onclick = () => { F.conto = b.dataset.da; if (F.conto_dest === F.conto) F.conto_dest = ''; renderForm(); });
    document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { F.conto_dest = b.dataset.a; renderForm(); });
    next.onclick = () => { if (F.conto_dest && F.conto_dest !== F.conto) avanti(); };
  }
  if (F.step === 'riepilogo') {
    const leggiNota2 = () => { const n2 = $('#f-nota2'); if (n2) F.nota = n2.value; };
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { leggiData(); leggiNota2(); F.daRiep = true; vai(b.dataset.go); });
    document.querySelectorAll('[data-conto-sel]').forEach(b => b.onclick = () => { leggiData(); leggiNota2(); F.conto = b.dataset.contoSel; F.contoScelto = true; renderForm(); });
    const uc = $('#usa-conto'); if (uc) uc.onclick = () => { leggiData(); leggiNota2(); F.conto = uc.dataset.c; F.contoScelto = true; renderForm(); };
    const tags = (F.tag||'').split(',').map(t=>t.trim()).filter(Boolean);
    document.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { leggiData(); leggiNota2(); const t = new Set(tags); t.has(b.dataset.tag) ? t.delete(b.dataset.tag) : t.add(b.dataset.tag); F.tag = [...t].join(', '); renderForm(); });
    const del = $('#f-del'); if (del) del.onclick = () => confermaElimina(F.id);
    $('#f-ok').onclick = async () => {
      leggiData(); leggiNota2();
      let imp = parseImporto(F.importoTxt);
      if (!isFinite(imp) || imp <= 0) return toast('Importo non valido');
      if (F.tipo === 'rettifica') imp *= F.segnoRett;
      if ((F.tipo==='spesa'||F.tipo==='entrata') && !F.categoria) return vai('categoria');
      if (F.tipo==='trasferimento' && (!F.conto_dest || F.conto_dest===F.conto)) return vai('conti');
      const mov = { id:F.id, tipo:F.tipo, importo:imp, conto:F.conto, conto_dest:F.tipo==='trasferimento'?F.conto_dest:'',
        categoria:(F.tipo==='spesa'||F.tipo==='entrata')?F.categoria:'', sottocategoria:(F.tipo==='spesa'||F.tipo==='entrata')?(F.sottocategoria||''):'',
        nota:(F.nota||'').trim(), tag:F.tag||'', data:F.data };
      if (!mov.id && !F.dupOk) { const d = possibileDoppione(mov); if (d) return chiediDoppione(mov, d); }
      await salva(mov);
    };
  }
}
function chiediDoppione(mov, d) {
  sheet(`<h2 class="wz-h">Possibile doppione</h2><p class="muted">C'è già un movimento uguale nello stesso giorno:</p>
    <div class="card list">${rigaMov(d)}</div>
    <div class="btns"><button class="btn sec" id="dp-no">Torna indietro</button><button class="btn" id="dp-si">Salva comunque</button></div>`);
  $('#dp-no').onclick = () => renderForm();
  $('#dp-si').onclick = async () => { F.dupOk = true; await salva(mov); };
}

async function salva(mov) {
  const btn = $('#f-ok') || $('#al-ok'); if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    if (mov.id) {
      const j = await api('update', { movimento: mov });
      S.movimenti = S.movimenti.map(m => m.id === mov.id ? j.movimento : m);
    } else {
      const j = await api('add', { movimento: mov });
      S.movimenti.push(j.movimento);
    }
    persistiCache(); chiudi(); toast('Salvato ✓'); render();
  } catch (e) {
    if (!e.server && !mov.id) {
      const ob = getOutbox(); ob.push({ tempId:'tmp'+Date.now(), movimento:mov }); setOutbox(ob);
      chiudi(); toast('Offline: salvato in coda'); setSync(''); render();
    } else {
      toast('Errore: ' + e.message, 4000);
      if (btn) { btn.disabled = false; btn.textContent = mov.id ? 'Salva' : 'Aggiungi'; }
    }
  }
}

function confermaElimina(id) {
  sheet(`<h2>Eliminare il movimento?</h2><p class="muted">L'operazione non si può annullare.</p>
  <div class="btns"><button class="btn sec" id="d-no">Annulla</button><button class="btn danger" id="d-si">Elimina</button></div>`);
  $('#d-no').onclick = () => renderForm();
  $('#d-si').onclick = async () => {
    try { await api('delete', { id }); S.movimenti = S.movimenti.filter(m => m.id !== id); persistiCache(); chiudi(); toast('Eliminato'); render(); }
    catch (e) { toast('Errore: ' + e.message, 4000); }
  };
}

function persistiCache() { localStorage.setItem(LS.cache, JSON.stringify({ ...S, ts: Date.now() })); }
function sheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function chiudi() { $('#sheet').classList.add('hidden'); F = null; }

/* ---------------- avvio ---------------- */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); window.scrollTo(0,0); });
$('#fab').onclick = () => apriForm(null);
$('#fab').innerHTML = svgIcon('add', 30);
document.querySelectorAll('.ni').forEach(n => n.innerHTML = svgIcon(n.dataset.i, 24));
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') chiudi(); });
window.addEventListener('online', () => caricaDati());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && getCfg()) caricaDati(); });

try { const c = JSON.parse(localStorage.getItem(LS.cache)); if (c) S = c; } catch {}
render();
applicaTema(temaAttuale());
initBlocco();
// chiede a Chrome di non cancellare i dati dell'app (URL, token, cache, movimenti in attesa) quando manca spazio.
// Su Chrome non compare nessuna richiesta: decide il browser (web.dev/articles/persistent-storage).
async function chiediPersistenza() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
if (getCfg()) chiediPersistenza();
$('#btn-set').innerHTML = svgIcon('settings', 22); $('#btn-set').onclick = apriImpostazioni;
if (getCfg()) caricaDati();
if (getCfg() && new URLSearchParams(location.search).get('nuovo') === '1') { history.replaceState(null, '', location.pathname); apriForm(null); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
