/* Tracker spese - PWA v1.2 */
'use strict';

const APP_VERSION = '1.5.1';
const LS = { cfg: 'ts_cfg', cache: 'ts_cache', outbox: 'ts_outbox' };
const TAG_PRESET = ['straordinaria', 'da rimborsare'];
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
    localStorage.setItem(LS.cfg, JSON.stringify({ url, token }));
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
  const tv = tagVisibili(m.tag); const tag = tv ? `<span class="pill">${esc(tv)}</span>` : (String(m.tag||'').includes('ric:') ? `<span class="pill">ricorrente</span>` : '');
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
  ${cardSettimana()}
  ${cardControlli()}
  ${cardRicorrenti()}
  <div class="sec-h"><h2>Conti e Pocket</h2></div>
  <div class="accs">
  ${reali.map(c => { const col = contoColor(c.nome); return `<button class="acc-card" data-conto="${esc(c.nome)}" style="--c:${col}">
      <span class="acc-ic">${svgIcon(c.tipo==='pocket'?'savings':c.tipo==='deposito'?'account_balance':'account_balance_wallet',20)}</span>
      <span class="acc-name">${esc(c.nome)}</span>
      <span class="acc-bal ${s[c.nome]<0?'neg':''}">${eur(s[c.nome])}</span>
      <span class="acc-sub">${esc(c.tipo)}${c.banca?' · '+esc(c.banca):''}</span></button>`; }).join('')}
  </div>
  <div class="sec-h"><h2>Ultimi movimenti</h2><button class="link" id="vedi-tutti">Vedi tutti</button></div>
  ${listaPerGiorno(recenti)}`;
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
  if (tab === 'home') { bindRicorrenti(); bindControlli(); }
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
    await salva({ tipo:'rettifica', importo:diff, conto:nome, data:nowStr(), nota:'Allineamento saldo', tag:'' });
  };
}


/* ---------------- ricorrenti, controlli, settimana (v1.5) ---------------- */
// Addebiti e spostamenti ricorrenti. g = giorno del mese (31 = ultimo giorno), dal = primo mese in cui vale (yyyy-mm).
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
  { id:'iliad',     g:28, tipo:'spesa', importo:7.99,   conto:'MPS', categoria:'Utenze', sottocategoria:'Mobile', nota:'Iliad', dal:'2026-11' },
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
const VITA = { dal:'2026-11-16', budget:161, conto:'Revolut Cointestato', escludiCat:['Conto personale','Risparmio e Investimenti'] };
// intervallo del controllo del 22 su MPS (decisione 38, aggiornata il 21/11/2026)
const intervallo22 = mk => mk < '2026-12' ? [1664, 1714] : [1715, 1765];

const LS_SKIP = 'ts_skip';
const getSkip = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_SKIP)) || []); } catch { return new Set(); } };
const setSkip = st => localStorage.setItem(LS_SKIP, JSON.stringify([...st]));
const tagsDi = m => String(m.tag||'').split(',').map(t => t.trim()).filter(Boolean);
const tagVisibili = t => String(t||'').split(',').map(x => x.trim()).filter(x => x && !x.startsWith('ric:')).join(', ');
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
    if (mk < r.dal || confermato(r, mk) || skip.has(`${r.id}|${mk}`)) continue;
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
  document.querySelectorAll('.ric').forEach(el => {
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
function spesaVita(da, a) {
  const s0 = nowStr(da).slice(0,10), s1 = nowStr(a).slice(0,10);
  return r2(tuttiMov().filter(m => m.tipo === 'spesa' && m.conto === VITA.conto && !VITA.escludiCat.includes(m.categoria)
    && !tagsDi(m).some(t => /^ric:a16-/.test(t)) && m.data.slice(0,10) >= s0 && m.data.slice(0,10) < s1).reduce((a,m) => a + +m.importo, 0));
}
function settimana() {
  const l0 = lunedi(new Date()), l1 = new Date(l0), lm1 = new Date(l0), lm2 = new Date(l0);
  l1.setDate(l1.getDate() + 7); lm1.setDate(lm1.getDate() - 7); lm2.setDate(lm2.getDate() - 14);
  const valida = d => nowStr(d).slice(0,10) >= VITA.dal;
  const over1 = valida(lm1) ? Math.max(0, spesaVita(lm1, l0) - VITA.budget) : 0, over2 = valida(lm2) ? Math.max(0, spesaVita(lm2, lm1) - VITA.budget) : 0;
  const recupero = r2((over1 > 80 ? over1 / 2 : over1) + (over2 > 80 ? over2 / 2 : 0));
  const budget = r2(VITA.budget - recupero), speso = spesaVita(l0, l1);
  return { budget, speso, resto: r2(budget - speso), recupero };
}
function cardSettimana() {
  const w = settimana(), pct = w.budget > 0 ? Math.min(100, w.speso / w.budget * 100) : 100;
  const col = w.resto < 0 ? 'var(--neg)' : pct > 80 ? 'var(--warn)' : 'var(--pos)';
  return `<div class="card week"><div class="row"><div><div class="muted small">Vita quotidiana · questa settimana</div>
    <div class="week-v">${eur(w.speso)} <span class="muted">di ${eur(w.budget)}</span></div></div>
    <div class="week-r" style="color:${col}">${w.resto >= 0 ? 'restano' : 'sforati'}<b>${eur(Math.abs(w.resto))}</b></div></div>
    <div class="barwrap big"><div class="bar" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>
    ${w.recupero ? `<div class="muted small" style="margin-top:6px">Budget ridotto di ${eur(w.recupero)} per recuperare le settimane precedenti</div>` : ''}</div>`;
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
  const cat = best && best.score >= 25 ? { ...topCat(best.e), da: best.e.nota, esatta: best.k === q } : null;
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
if (getCfg()) caricaDati();
if (getCfg() && new URLSearchParams(location.search).get('nuovo') === '1') { history.replaceState(null, '', location.pathname); apriForm(null); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
