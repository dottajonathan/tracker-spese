/**
 * Tracker spese - backend Apps Script
 * Versione 1.0 (schema_version 1)
 *
 * Tutte le chiamate arrivano in POST con Content-Type text/plain
 * (evita il preflight CORS, che Apps Script non gestisce).
 * Corpo: JSON {token, action, ...}
 *
 * Azioni:
 *   ping                          -> {ok, versione}
 *   bootstrap                     -> {ok, conti, categorie, movimenti, config}
 *   add     {movimento}           -> {ok, movimento}
 *   update  {movimento}           -> {ok, movimento}    (movimento.id obbligatorio)
 *   delete  {id}                  -> {ok, id}
 */

const VERSIONE = '1.0';
const SHEET_MOV = 'Movimenti';
const SHEET_CONTI = 'Conti';
const SHEET_CAT = 'Categorie';
const SHEET_CFG = 'Config';
const COLONNE = ['id', 'data', 'tipo', 'importo', 'conto', 'conto_dest',
                 'categoria', 'sottocategoria', 'nota', 'tag', 'origine'];
const TIPI = ['spesa', 'entrata', 'trasferimento', 'rettifica'];
const TZ = 'Europe/Rome';

/* ---------- Setup: eseguire UNA volta a mano dall'editor ---------- */

function setupToken() {
  const bytes = Utilities.getUuid() + Utilities.getUuid();
  const token = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
  ).replace(/=+$/, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  Logger.log('TOKEN (copialo e conservalo): ' + token);
}

/* ---------- Entry point ---------- */

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return risposta({ ok: false, errore: 'JSON non valido' });
  }
  const tokenAtteso = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!tokenAtteso || req.token !== tokenAtteso) {
    return risposta({ ok: false, errore: 'Non autorizzato' });
  }
  try {
    switch (req.action) {
      case 'ping':      return risposta({ ok: true, versione: VERSIONE });
      case 'bootstrap': return risposta(bootstrap());
      case 'add':       return conLock(() => aggiungi(req.movimento));
      case 'update':    return conLock(() => aggiorna(req.movimento));
      case 'delete':    return conLock(() => elimina(req.id));
      default:          return risposta({ ok: false, errore: 'Azione sconosciuta: ' + req.action });
    }
  } catch (err) {
    return risposta({ ok: false, errore: String(err && err.message || err) });
  }
}

function doGet() {
  // Nessun dato esposto in GET: serve solo a verificare che il deploy risponda.
  return risposta({ ok: true, servizio: 'Tracker spese', versione: VERSIONE });
}

/* ---------- Azioni ---------- */

function bootstrap() {
  return {
    ok: true,
    versione: VERSIONE,
    conti: leggiTabella(SHEET_CONTI),
    categorie: leggiTabella(SHEET_CAT),
    config: leggiTabella(SHEET_CFG),
    movimenti: leggiTabella(SHEET_MOV).map(normalizzaLetto)
  };
}

function aggiungi(m) {
  const mov = valida(m);
  mov.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  mov.origine = 'app';
  const sh = foglio(SHEET_MOV);
  const riga = COLONNE.map(c => mov[c] === undefined ? '' : mov[c]);
  sh.appendRow(riga);
  // la data resta testo ISO, non convertita dal locale
  sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(mov.data);
  return { ok: true, movimento: mov };
}

function aggiorna(m) {
  if (!m || !m.id) throw new Error('id mancante');
  const sh = foglio(SHEET_MOV);
  const r = trovaRiga(sh, m.id);
  if (r < 0) throw new Error('Movimento non trovato: ' + m.id);
  const esistente = sh.getRange(r, 1, 1, COLONNE.length).getValues()[0];
  const mov = valida(m);
  mov.id = m.id;
  mov.origine = esistente[COLONNE.indexOf('origine')] || 'app';
  sh.getRange(r, 1, 1, COLONNE.length).setValues([COLONNE.map(c => mov[c] === undefined ? '' : mov[c])]);
  sh.getRange(r, 2).setNumberFormat('@').setValue(mov.data);
  return { ok: true, movimento: mov };
}

function elimina(id) {
  if (!id) throw new Error('id mancante');
  const sh = foglio(SHEET_MOV);
  const r = trovaRiga(sh, id);
  if (r < 0) throw new Error('Movimento non trovato: ' + id);
  sh.deleteRow(r);
  return { ok: true, id: id };
}

/* ---------- Validazione ---------- */

function valida(m) {
  if (!m) throw new Error('movimento mancante');
  const tipo = String(m.tipo || '');
  if (TIPI.indexOf(tipo) < 0) throw new Error('tipo non valido: ' + tipo);

  const importo = Math.round(Number(m.importo) * 100) / 100;
  if (!isFinite(importo) || importo === 0) throw new Error('importo non valido');
  if (tipo !== 'rettifica' && importo < 0) throw new Error('importo deve essere positivo');

  const conti = leggiTabella(SHEET_CONTI).map(c => c.nome);
  if (conti.indexOf(m.conto) < 0) throw new Error('conto sconosciuto: ' + m.conto);

  let contoDest = '';
  if (tipo === 'trasferimento') {
    if (conti.indexOf(m.conto_dest) < 0) throw new Error('conto destinazione sconosciuto: ' + m.conto_dest);
    if (m.conto_dest === m.conto) throw new Error('origine e destinazione coincidono');
    contoDest = m.conto_dest;
  }

  let categoria = '', sotto = '';
  if (tipo === 'spesa' || tipo === 'entrata') {
    categoria = String(m.categoria || '');
    sotto = String(m.sottocategoria || '');
    const ok = leggiTabella(SHEET_CAT).some(c =>
      c.categoria === categoria && String(c.sottocategoria || '') === sotto && c.tipo === tipo);
    if (!ok) throw new Error('categoria non valida per ' + tipo + ': ' + categoria + ' / ' + sotto);
  }

  const data = String(m.data || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(data)) throw new Error('data non valida (atteso yyyy-MM-dd HH:mm:ss)');

  return {
    data: data,
    tipo: tipo,
    importo: importo,
    conto: m.conto,
    conto_dest: contoDest,
    categoria: categoria,
    sottocategoria: sotto,
    nota: String(m.nota || '').slice(0, 500),
    tag: String(m.tag || '').slice(0, 200)
  };
}

/* ---------- Utility ---------- */

function conLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return risposta({ ok: false, errore: 'Occupato, riprova' });
  try { return risposta(fn()); } finally { lock.releaseLock(); }
}

function foglio(nome) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sh) throw new Error('Foglio mancante: ' + nome);
  return sh;
}

function leggiTabella(nome) {
  const v = foglio(nome).getDataRange().getValues();
  const head = v.shift();
  return v.filter(r => r.some(x => x !== '')).map(r => {
    const o = {};
    head.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

function normalizzaLetto(m) {
  // se una data fosse stata convertita in Date dal foglio, la riporta a testo
  if (m.data instanceof Date) m.data = Utilities.formatDate(m.data, TZ, 'yyyy-MM-dd HH:mm:ss');
  m.importo = Number(m.importo);
  return m;
}

function trovaRiga(sh, id) {
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return -1;
}

function risposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
