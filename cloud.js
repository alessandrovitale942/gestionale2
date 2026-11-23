/* ============================================================
   RepairPro CLOUD: accesso con email e password + stessi dati su ogni dispositivo
   Se la configurazione qui sotto resta vuota, RepairPro funziona come prima (senza login).

   CONFIGURAZIONE (una volta sola) su https://console.firebase.google.com
   1. Crea un progetto (puoi disattivare Google Analytics).
   2. Build > Authentication > Inizia > Email/password > Abilita.
      Poi scheda "Users" > Aggiungi utente: crea tu email e password di chi deve entrare.
      Authentication > Impostazioni > Domini autorizzati: aggiungi il tuo sito (es. nome.github.io).
   3. Build > Realtime Database > Crea database > posizione Belgio (europe-west1) > modalita bloccata.
   4. Realtime Database > Regole: incolla questo, mettendo gli UID che vedi nella scheda Users:
      { "rules": { "negozio": {
          ".read":  "auth.uid === 'UID_PRIMO' || auth.uid === 'UID_SECONDO'",
          ".write": "auth.uid === 'UID_PRIMO' || auth.uid === 'UID_SECONDO'" } } }
   5. Impostazioni progetto (ingranaggio) > Le tue app > Web (</>) > registra l'app e copia qui sotto
      apiKey, authDomain, databaseURL, projectId, appId.
   ============================================================ */
var RP_FIREBASE = {
  apiKey: 'AIzaSyCxxhBlYKHbLMm9eikm8vcnfi-obd5Aqss',
  authDomain: 'repair-pro-cc900.firebaseapp.com',
  databaseURL: 'https://repair-pro-cc900-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'repair-pro-cc900',
  appId: '1:773780067819:web:d393ee4583185a061035ae'
};

(function () {
  if (!RP_FIREBASE.apiKey || !RP_FIREBASE.databaseURL) return;   // cloud spento

  // Liste: ogni scheda/fattura/ordine e salvata online come voce a se (niente piu sovrascritture tra PC).
  var LISTE = {
    rp_rl: { n: 'rl', imp: function (a) { RL = a; } },
    rp_fl: { n: 'fl', imp: function (a) { FL = a; } },
    rp_ol: { n: 'ol', imp: function (a) { OL = a; } },
    rp_ric: { n: 'ric', imp: function (a) { RIC = a; } }
  };
  var SCAL = { rp_ml: function (v) { ML = JSON.parse(v); }, rp_set: function (v) { SET = JSON.parse(v); }, rp_logo: function () {} };
  var CONT = { rp_rid: function (v) { RID = parseInt(v, 10) || 0; }, rp_fid: function (v) { FID = parseInt(v, 10) || 0; }, rp_oid: function (v) { OID = parseInt(v, 10) || 0; }, rp_ricid: function (v) { RICID = parseInt(v, 10) || 0; } };
  var CHIAVI = Object.keys(LISTE).concat(Object.keys(SCAL), Object.keys(CONT));
  var ready = false, applying = false, attached = false, auth, db, pend = {}, tm = null, known = { rl: {}, fl: {}, ol: {}, ric: {} }, ultimo = {};

  // il PIN di sblocco dei dispositivi NON va mai online
  // Vista PUBBLICA della scheda (letta da stato.html con il codice del link): niente nome, telefono del cliente, prezzo o PIN
  function vista(it) {
    var S = window.SET || {};
    return { n: it.id, d: it.device || '', s: it.stato || 'In attesa', e: it.esito || '', u: Date.now(), c: it.consegna || '', neg: S.nome || '', tel: S.tel || '' };
  }
  function dIt(x) { var m = String(x || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; }
  // A ogni accesso rimetto online lo stato delle schede attive (e di quelle consegnate da poco): cosi una scheda il cui codice e stato creato
  // quando le regole non erano ancora a posto non resta "non trovata". "Ultimo aggiornamento" cambia solo se lo stato e diverso.
  function ripubblica() {
    var lim = Date.now() - 45 * 864e5;
    leggiL('rp_rl').forEach(function (it) {
      if (!it || !it.tk) return;
      if (it.stato === 'Consegnato') { var t = dIt(it.dataConsegnato) || dIt(it.data); if (!t || t < lim) return; }
      try {
        db.ref('stato/' + it.tk).transaction(function (cur) { var v = vista(it); v.u = (cur && cur.u && cur.s === v.s) ? cur.u : Date.now(); return v; }).catch(function () {});
      } catch (e) {}
    });
  }
  function ser(it) { return JSON.stringify(it, function (k, v) { return k === 'pin' ? undefined : v; }); }
  function leggiL(k) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function ident(it) { return ['nome', 'cliente', 'fornitore', 'device', 'desc'].map(function (c) { return it[c] == null ? '' : it[c]; }).join('|'); }

  var _si = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    _si.apply(this, arguments);
    if (ready && !applying && this === localStorage && CHIAVI.indexOf(k) > -1) locale(k, String(v));
  };
  window.addEventListener('storage', function (e) {   // salvataggi fatti da Jarvis (altra finestra)
    if (ready && e.storageArea === localStorage && CHIAVI.indexOf(e.key) > -1 && e.newValue !== null) locale(e.key, e.newValue);
  });

  var IN = 'width:100%;padding:12px 14px;border-radius:10px;border:1px solid #252c3b;background:#0f131b;color:#eef1f6;font-size:15px;outline:none;box-sizing:border-box';
  var ui = document.createElement('div');
  ui.id = 'rp-login';
  ui.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:radial-gradient(900px 420px at 80% -10%,rgba(255,122,26,.18),transparent 60%),#0c0e13;font-family:"DM Sans",Arial,sans-serif;color:#eef1f6';
  ui.innerHTML = '<form id="rp-lf" style="width:100%;max-width:360px;background:#141821;border:1px solid #252c3b;border-radius:20px;padding:30px 28px;box-shadow:0 30px 80px rgba(0,0,0,.6)">'
    + '<div style="font:800 26px Syne,Arial,sans-serif;letter-spacing:-.02em">RepairPro</div>'
    + '<div style="color:#8b94a7;font-size:14px;margin:6px 0 22px">Accedi per ritrovare i tuoi dati su qualsiasi dispositivo.</div>'
    + '<input id="rp-em" type="email" autocomplete="username" placeholder="Email" required style="' + IN + '">'
    + '<input id="rp-pw" type="password" autocomplete="current-password" placeholder="Password" required style="' + IN + ';margin-top:10px">'
    + '<button type="submit" style="width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,#ff5a2a,#ff8a1f);color:#fff;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer">Accedi</button>'
    + '<div id="rp-msg" style="min-height:20px;margin:14px 0 8px;font-size:13px;color:#ffb273"></div>'
    + '<a href="#" id="rp-rs" style="color:#8b94a7;font-size:13px">Password dimenticata?</a></form>';
  document.documentElement.appendChild(ui);
  function msg(t) { ui.querySelector('#rp-msg').textContent = t || ''; }
  function errore(e) {
    var m = { 'auth/invalid-credential': 'Email o password non corrette.', 'auth/wrong-password': 'Email o password non corrette.', 'auth/user-not-found': 'Email o password non corrette.', 'auth/invalid-email': 'Email non valida.', 'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.', 'auth/network-request-failed': 'Nessuna connessione a internet.' }[e && e.code];
    return m || ('Errore: ' + ((e && e.message) || e));
  }

  // ---- invio online (raggruppato) ----
  function accoda(up) { Object.keys(up).forEach(function (p) { pend[p] = up[p]; }); clearTimeout(tm); tm = setTimeout(flush, 700); }
  function flush() {
    var p = pend; pend = {};
    if (!Object.keys(p).length) return Promise.resolve();
    // i dati veri e la pagina pubblica di stato vanno in due invii separati: se le regole della pagina pubblica non sono ancora a posto, i dati si salvano lo stesso
    var dati = {}, stato = {}, jobs = [];
    Object.keys(p).forEach(function (k) { if (k.indexOf('stato/') === 0) stato[k] = p[k]; else dati[k] = p[k]; });
    if (Object.keys(dati).length) jobs.push(db.ref('negozio').update(dati).catch(function (e) { alert('Salvataggio online non riuscito: ' + e.message); }));
    if (Object.keys(stato).length) jobs.push(db.ref().update(stato).catch(function () { if (window.showToast && !window.__avvStato) { window.__avvStato = 1; showToast('Pagina di stato non aggiornata', 'Controlla le regole di Firebase (istruzioni Fase 3)'); } }));
    return Promise.all(jobs);
  }
  function locale(k, v) {
    if (LISTE[k]) {
      var n = LISTE[k].n, arr; try { arr = JSON.parse(v); } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      var up = {}, vivi = {};
      arr.forEach(function (it) {
        if (!it || it.id == null) return;
        var id = String(it.id), s = ser(it); vivi[id] = 1;
        if (known[n][id] !== s) { known[n][id] = s; up['v2/' + n + '/' + id] = s; if (n === 'rl' && it.tk) up['stato/' + it.tk] = vista(it); }      // solo le schede cambiate
      });
      Object.keys(known[n]).forEach(function (id) { if (!vivi[id]) { if (n === 'rl') { try { var o = JSON.parse(known[n][id]); if (o.tk) up['stato/' + o.tk] = null; } catch (e) {} } delete known[n][id]; up['v2/' + n + '/' + id] = null; } });   // schede eliminate
      if (Object.keys(up).length) accoda(up);
    } else if (ultimo[k] !== v) {
      ultimo[k] = v;
      if (CONT[k]) db.ref('negozio/' + k).transaction(function (c) { return String(Math.max(parseInt(c || '0', 10) || 0, parseInt(v, 10) || 0)); });   // i contatori salgono soltanto
      else accoda((function () { var o = {}; o[k] = v; return o; })());
    }
  }

  // ---- modifiche arrivate da un altro dispositivo ----
  function scrivi(k, arr) { applying = true; _si.call(localStorage, k, JSON.stringify(arr)); applying = false; LISTE[k].imp(arr); if (window.syncDaJarvis) syncDaJarvis(); }
  function remotoItem(k, s) {
    var n = LISTE[k].n, id = s.key, str = s.val();
    if (typeof str !== 'string' || known[n][id] === str) return;
    var it; try { it = JSON.parse(str); } catch (e) { return; }
    known[n][id] = str;
    var arr = leggiL(k), i = -1;
    arr.forEach(function (x, j) { if (String(x.id) === id) i = j; });
    if (i > -1) { if (arr[i].pin && !it.pin) it.pin = arr[i].pin; arr[i] = it; }   // il PIN resta solo su questo dispositivo
    else { arr.push(it); arr.sort(function (a, b) { return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0); }); }
    scrivi(k, arr);
  }
  function remotoRimosso(k, s) {
    var n = LISTE[k].n, id = s.key; delete known[n][id];
    var arr = leggiL(k), nuovo = arr.filter(function (x) { return String(x.id) !== id; });
    if (nuovo.length !== arr.length) scrivi(k, nuovo);
  }
  function remotoScalare(k, v) {
    if (typeof v !== 'string') return;
    var l = localStorage.getItem(k);
    if (CONT[k]) { if ((parseInt(v, 10) || 0) <= (parseInt(l || '0', 10) || 0)) return; }
    else if (v === l) return;
    applying = true; _si.call(localStorage, k, v); applying = false; ultimo[k] = v;
    try { (CONT[k] || SCAL[k])(v); if (window.syncDaJarvis) syncDaJarvis(); } catch (e) {}
  }

  function backup(obj, nome) {
    try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' })); a.download = nome + '-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); } catch (e) {}
  }
  function fine(u) {
    ready = true; ui.style.display = 'none';
    window.rpUtente = u.email || '';
    var out = document.getElementById('nb-logout');
    if (out) { out.style.display = ''; out.textContent = '\u{1F6AA} Esci (' + (u.email || '') + ')'; }
    if (attached) return; attached = true;
    ripubblica();
    Object.keys(LISTE).forEach(function (k) {
      var r = db.ref('negozio/v2/' + LISTE[k].n);
      r.on('child_added', function (s) { remotoItem(k, s); }); r.on('child_changed', function (s) { remotoItem(k, s); }); r.on('child_removed', function (s) { remotoRimosso(k, s); });
    });
    Object.keys(SCAL).concat(Object.keys(CONT)).forEach(function (k) { db.ref('negozio/' + k).on('value', function (s) { remotoScalare(k, s.val()); }); });
  }

  function avvia(u) {
    msg('Sincronizzo i dati...');
    db.ref('negozio').once('value').then(function (snap) {
      var cloud = snap.val() || {}, v2 = cloud.v2 || {}, up = {}, cambiato = false, uso = 'online', cl = {}, loc = {}, vecchio = false, copia = {};
      Object.keys(LISTE).forEach(function (k) {
        var n = LISTE[k].n; cl[n] = {}; loc[k] = leggiL(k); copia[k] = loc[k];
        Object.keys(v2[n] || {}).forEach(function (id) { cl[n][id] = v2[n][id]; });
        if (cloud[k] != null) {   // vecchio formato (lista intera in un blocco): lo trasformo e lo elimino, cosi spariscono anche i PIN
          vecchio = true;
          if (!Object.keys(cl[n]).length) { try { JSON.parse(cloud[k]).forEach(function (it) { if (it && it.id != null) { var s = ser(it); cl[n][String(it.id)] = s; up['v2/' + n + '/' + it.id] = s; } }); } catch (e) {} }
          up[k] = null;
        }
      });
      if (vecchio) backup(cloud, 'backup-cloud-prima-aggiornamento');
      var conflitto = Object.keys(LISTE).some(function (k) {
        return loc[k].some(function (it) { var s = cl[LISTE[k].n][String(it.id)]; if (s == null) return false; try { return ident(JSON.parse(s)) !== ident(it); } catch (e) { return false; } });
      });
      if (conflitto && !sessionStorage.getItem('rp_cloud_ok')) {
        var mio = {}; Object.keys(LISTE).forEach(function (k) { mio[k] = loc[k]; });
        if (confirm('Su questo dispositivo ci sono dati DIVERSI da quelli online.\n\nOK = usa i dati ONLINE (scarico prima una copia di sicurezza di quelli di questo dispositivo).\nAnnulla = altre opzioni.')) backup(mio, 'backup-questo-dispositivo');
        else if (confirm('Vuoi allora CARICARE online i dati di QUESTO dispositivo, sostituendo quelli online?\n\nOK = si, sostituisci (scarico prima una copia di quelli online).\nAnnulla = no, usa i dati online.')) { backup(cloud, 'backup-dati-online'); uso = 'locale'; }
        else backup(mio, 'backup-questo-dispositivo');
      }
      sessionStorage.setItem('rp_cloud_ok', '1');
      known = { rl: {}, fl: {}, ol: {} };
      Object.keys(LISTE).forEach(function (k) {
        var n = LISTE[k].n, L = LISTE[k], arr = loc[k], out = [], visti = {};
        if (uso === 'locale') {
          arr.forEach(function (it) { if (it.id == null) return; var s = ser(it), id = String(it.id); if (cl[n][id] !== s) up['v2/' + n + '/' + id] = s; cl[n][id] = s; });
          Object.keys(cl[n]).forEach(function (id) { if (!arr.some(function (it) { return String(it.id) === id; })) { delete cl[n][id]; up['v2/' + n + '/' + id] = null; } });
        } else {   // online: le voci online vincono, quelle presenti solo qui restano e vengono caricate
          Object.keys(cl[n]).forEach(function (id) {
            try { var it = JSON.parse(cl[n][id]), m = arr.filter(function (x) { return String(x.id) === id; })[0]; if (m && m.pin && !it.pin) it.pin = m.pin; out.push(it); visti[id] = 1; } catch (e) {}
          });
          arr.forEach(function (it) { if (it.id == null || visti[String(it.id)]) return; var s = ser(it); up['v2/' + n + '/' + it.id] = s; cl[n][String(it.id)] = s; out.push(it); });
          out.sort(function (a, b) { return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0); });
          if (JSON.stringify(out) !== JSON.stringify(arr)) { applying = true; _si.call(localStorage, k, JSON.stringify(out)); applying = false; L.imp(out); cambiato = true; }
        }
        known[n] = {}; Object.keys(cl[n]).forEach(function (id) { known[n][id] = cl[n][id]; });
      });
      Object.keys(SCAL).forEach(function (k) {   // magazzino, impostazioni, logo
        var l = localStorage.getItem(k);
        if (uso === 'locale' && l !== null) { if (l !== cloud[k]) up[k] = l; }
        else if (typeof cloud[k] === 'string') { if (l !== cloud[k]) { applying = true; _si.call(localStorage, k, cloud[k]); applying = false; cambiato = true; } }
        else if (l !== null) up[k] = l;
        ultimo[k] = localStorage.getItem(k);
      });
      Object.keys(CONT).forEach(function (k) {   // contatori: vale il piu alto
        var l = parseInt(localStorage.getItem(k) || '0', 10) || 0, c = parseInt(cloud[k] || '0', 10) || 0;
        if (c > l) { applying = true; _si.call(localStorage, k, String(c)); applying = false; cambiato = true; }
        else if (l > c) up[k] = String(l);
        ultimo[k] = localStorage.getItem(k);
      });
      return (Object.keys(up).length ? db.ref('negozio').update(up) : Promise.resolve()).then(function () {
        if (cambiato && !sessionStorage.getItem('rp_cloud_reloaded')) { sessionStorage.setItem('rp_cloud_reloaded', '1'); location.reload(); return; }
        if (cambiato) CHIAVI.forEach(function (k) { var v = localStorage.getItem(k); if (v === null) return; try { if (LISTE[k]) LISTE[k].imp(JSON.parse(v)); else (CONT[k] || SCAL[k])(v); } catch (e) {} });
        if (cambiato && window.syncDaJarvis) syncDaJarvis();
        fine(u);
      });
    }).catch(function (e) { msg('Non riesco a leggere i dati online: ' + ((e && e.message) || e)); });
  }

  window.rpLogout = function () {
    if (!confirm('Uscire? I dati restano al sicuro online e verranno rimossi da questo dispositivo.')) return;
    flush().then(function () { return auth.signOut(); }).then(function () {
      CHIAVI.forEach(function (k) { localStorage.removeItem(k); });
      sessionStorage.removeItem('rp_cloud_ok'); sessionStorage.removeItem('rp_cloud_reloaded');
      location.reload();
    });
  };

  function inizia() {
    firebase.initializeApp(RP_FIREBASE);
    auth = firebase.auth(); db = firebase.database();
    window.rpCloud = { db: function () { return db; }, ok: function () { return ready; } };   // usato dalle foto
    auth.onAuthStateChanged(function (u) { if (u) avvia(u); else { ready = false; ui.style.display = 'grid'; msg(''); } });
    ui.querySelector('#rp-lf').onsubmit = function (ev) {
      ev.preventDefault(); msg('Accesso in corso...');
      auth.signInWithEmailAndPassword(ui.querySelector('#rp-em').value.trim(), ui.querySelector('#rp-pw').value).catch(function (e) { msg(errore(e)); });
    };
    ui.querySelector('#rp-rs').onclick = function (ev) {
      ev.preventDefault();
      var em = ui.querySelector('#rp-em').value.trim();
      if (!em) { msg('Scrivi prima la tua email.'); return; }
      auth.sendPasswordResetEmail(em).then(function () { msg('Ti ho inviato una email per reimpostare la password.'); }).catch(function (e) { msg(errore(e)); });
    };
  }
  function carica(urls, cb) {
    var i = 0;
    (function next() {
      if (i >= urls.length) return cb();
      var s = document.createElement('script');
      s.src = urls[i++]; s.onload = next;
      s.onerror = function () { msg('Servizio online non raggiungibile. Controlla la connessione.'); };
      document.head.appendChild(s);
    })();
  }
  var V = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-';
  if (window.firebase && firebase.database) inizia(); else carica([V + 'app-compat.js', V + 'auth-compat.js', V + 'database-compat.js'], inizia);
})();
