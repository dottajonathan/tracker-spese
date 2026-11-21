/* Tracker spese - PWA v1.2 */
'use strict';

const APP_VERSION = '1.2.0';
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
  $('#title').textContent = ({ home:'Tracker spese', movimenti:'Movimenti', grafici:'Grafici', mesi:'Confronto mesi' })[tab];
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
  const tag = m.tag ? `<span class="pill">${esc(m.tag)}</span>` : '';
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

/* ---------------- form movimento ---------------- */
let F = null;
function apriForm(m) {
  F = m ? { ...m, importoTxt: String(Math.abs(m.importo)).replace('.',','), segnoRett: m.tipo==='rettifica' && m.importo<0 ? -1 : 1 }
        : { tipo:'spesa', importoTxt:'', conto:DEFAULT_CONTO, conto_dest:'', categoria:'', sottocategoria:'', nota:'', tag:'', data:nowStr(), segnoRett:1 };
  renderForm();
}
function renderForm() {
  const tipi = [['spesa','Spesa'],['entrata','Entrata'],['trasferimento','Trasf.'],['rettifica','Rettifica']];
  const conti = contiAttivi();
  const usaCat = F.tipo === 'spesa' || F.tipo === 'entrata';
  let catHtml = '';
  if (usaCat) {
    const freq = freqCategorie(F.tipo);
    const cats = [...new Set(S.categorie.filter(c => c.tipo === F.tipo).map(c => c.categoria))]
      .map(c => [c, Object.entries(freq).filter(([k]) => k.startsWith(c+'||')).reduce((a,[,v])=>a+v,0)])
      .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
    const subs = F.categoria ? S.categorie.filter(c => c.tipo === F.tipo && c.categoria === F.categoria).map(c => String(c.sottocategoria||'')) : [];
    catHtml = `<label>Categoria</label><div class="catgrid">${cats.map(c=>{ const d=catDef(c); return `<button data-cat="${esc(c)}" class="${F.categoria===c?'on':''}">${bolla(d[0], d[1], 46)}<span class="cg-l">${esc(c)}</span></button>`; }).join('')}</div>
      ${subs.length > 1 || (subs.length===1 && subs[0]) ? `<label>Sottocategoria</label><div class="chips">${subs.map(s=>`<button class="chip ${String(F.sottocategoria||'')===s?'on':''}" data-sub="${esc(s)}">${s?esc(s):'(nessuna)'}</button>`).join('')}</div>` : ''}`;
  }
  const tags = (F.tag||'').split(',').map(t=>t.trim()).filter(Boolean);
  sheet(`<div class="seg" id="f-tipo">${tipi.map(([k,l])=>`<button data-t="${k}" class="${F.tipo===k?'on':''}">${l}</button>`).join('')}</div>
  <div class="row" style="justify-content:center;margin-top:10px">
    ${F.tipo==='rettifica'?`<button class="chip" id="f-segno">${F.segnoRett<0?'−':'+'}</button>`:''}
    <input id="f-imp" class="bigamt" inputmode="decimal" placeholder="0,00" value="${esc(F.importoTxt)}">
  </div>
  <label>${F.tipo==='trasferimento'?'Da conto':'Conto'}</label>
  <select id="f-conto" class="pill-select">${conti.map(c=>`<option ${F.conto===c.nome?'selected':''}>${esc(c.nome)}</option>`).join('')}</select>
  ${F.tipo==='trasferimento'?`<label>A conto</label><select id="f-dest"><option value="">—</option>${conti.map(c=>`<option ${F.conto_dest===c.nome?'selected':''}>${esc(c.nome)}</option>`).join('')}</select>`:''}
  ${catHtml}
  <label>Nota</label><input id="f-nota" value="${esc(F.nota)}" placeholder="es. Eurospin">
  <label>Tag</label><div class="chips">${TAG_PRESET.map(t=>`<button class="chip ${tags.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join('')}</div>
  <label>Data e ora</label><input id="f-data" type="datetime-local" step="1" value="${esc(F.data.replace(' ','T'))}">
  <div class="btns">${F.id?'<button class="btn danger" id="f-del">Elimina</button>':'<button class="btn sec" id="f-annulla">Annulla</button>'}<button class="btn" id="f-ok">${F.id?'Salva':'Aggiungi'}</button></div>`);

  const leggi = () => {
    F.importoTxt = $('#f-imp').value; F.conto = $('#f-conto').value; F.nota = $('#f-nota').value;
    const dv = $('#f-data').value; if (dv) F.data = (dv.length === 16 ? dv + ':00' : dv).replace('T',' ');
    const d = $('#f-dest'); if (d) F.conto_dest = d.value;
  };
  document.querySelectorAll('#f-tipo button').forEach(b => b.onclick = () => { leggi(); if (F.tipo !== b.dataset.t) { F.tipo = b.dataset.t; F.categoria=''; F.sottocategoria=''; } renderForm(); });
  document.querySelectorAll('.catgrid button').forEach(b => b.onclick = () => {
    leggi(); F.categoria = b.dataset.cat;
    const subs = S.categorie.filter(c => c.tipo === F.tipo && c.categoria === F.categoria).map(c => String(c.sottocategoria||''));
    const freq = freqCategorie(F.tipo);
    F.sottocategoria = subs.slice().sort((a,b) => (freq[F.categoria+'||'+b]||0) - (freq[F.categoria+'||'+a]||0))[0] || '';
    renderForm();
  });
  document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { leggi(); F.sottocategoria = b.dataset.sub; renderForm(); });
  document.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { leggi(); const t = new Set(tags); t.has(b.dataset.tag) ? t.delete(b.dataset.tag) : t.add(b.dataset.tag); F.tag = [...t].join(', '); renderForm(); });
  const sg = $('#f-segno'); if (sg) sg.onclick = () => { leggi(); F.segnoRett *= -1; renderForm(); };
  const an = $('#f-annulla'); if (an) an.onclick = chiudi;
  const del = $('#f-del'); if (del) del.onclick = () => confermaElimina(F.id);
  $('#f-ok').onclick = async () => {
    leggi();
    let imp = parseImporto(F.importoTxt);
    if (!isFinite(imp) || imp <= 0) return toast('Importo non valido');
    if (F.tipo === 'rettifica') imp *= F.segnoRett;
    if ((F.tipo==='spesa'||F.tipo==='entrata') && !F.categoria) return toast('Scegli una categoria');
    if (F.tipo==='trasferimento' && (!F.conto_dest || F.conto_dest===F.conto)) return toast('Conto destinazione non valido');
    const mov = { id:F.id, tipo:F.tipo, importo:imp, conto:F.conto, conto_dest:F.tipo==='trasferimento'?F.conto_dest:'',
      categoria:F.categoria||'', sottocategoria:F.sottocategoria||'', nota:F.nota.trim(), tag:F.tag||'', data:F.data };
    await salva(mov);
  };
  if (!F.id) setTimeout(() => $('#f-imp')?.focus(), 50);
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
