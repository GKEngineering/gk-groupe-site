/* ── ESPACE CLIENT — GK Groupe inc ── */
(function(){
  var cfg = window.GK_SUPABASE || {};
  var WEB3FORMS_KEY = '7e12bb33-bec8-47ed-9c49-5411d79c59ed';

  var LABELS = {
    service: { livraison:'Livraison', demenagement:'Déménagement', service_auto:'Service auto', detaillage:'Détaillage auto' },
    plage:   { matin:'Matin', apres_midi:'Après-midi', soir:'Soir' },
    resa:    { en_attente:'En attente', confirmee:'Confirmée', terminee:'Terminée', annulee:'Annulée' },
    doc:     { envoyee:'Envoyée', acceptee:'Acceptée', refusee:'Refusée', payee:'Payée', en_retard:'En retard' },
    livr:    { recue:'Reçue', en_preparation:'En préparation', en_route:'En route', livree:'Livrée', probleme:'Problème' }
  };
  var TONE = {
    en_attente:'warn', confirmee:'ok', terminee:'muted', annulee:'bad',
    envoyee:'warn', acceptee:'ok', refusee:'bad', payee:'ok', en_retard:'bad',
    recue:'muted', en_preparation:'warn', en_route:'info', livree:'ok', probleme:'bad'
  };
  var LIVR_ORDER = ['recue','en_preparation','en_route','livree'];

  var $ = function(s, root){ return (root || document).querySelector(s); };
  var $$ = function(s, root){ return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function fmtDate(d){
    if(!d) return '—';
    var date = d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d);
    return date.toLocaleDateString('fr-CA', { day:'numeric', month:'long', year:'numeric' });
  }
  function fmtDateTime(d){
    return new Date(d).toLocaleString('fr-CA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  }
  function fmtMoney(n){
    return n == null ? '' : Number(n).toLocaleString('fr-CA', { style:'currency', currency:'CAD' });
  }
  function badge(statut, group){
    return '<span class="ec-badge ec-' + (TONE[statut] || 'muted') + '">' + esc(LABELS[group][statut] || statut) + '</span>';
  }
  function empty(text){ return '<p class="ec-empty">' + esc(text) + '</p>'; }
  function setMsg(el, text, isError){
    el.textContent = text || '';
    el.classList.toggle('ec-error', !!isError);
  }
  function busy(form, on){
    var btn = form.querySelector('[type=submit]');
    if(btn) btn.disabled = on;
  }
  function show(id){
    $$('.ec-view').forEach(function(v){ v.hidden = v.id !== id; });
  }

  // Supabase n'est pas encore configuré : on affiche un message d'attente au lieu d'une page cassée.
  if(!window.supabase || !cfg.url || cfg.url.indexOf('VOTRE-PROJET') !== -1){
    show('view-config');
    return;
  }

  var sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  var state = { user:null, profile:null, docs:[], docFilter:'tous' };

  /* ── AUTH ── */
  $$('[data-auth-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      $$('[data-auth-tab]').forEach(function(b){ b.classList.toggle('active', b === btn); });
      $$('[data-auth-panel]').forEach(function(p){ p.hidden = p.dataset.authPanel !== btn.dataset.authTab; });
      setMsg($('#auth-msg'), '');
    });
  });

  var AUTH_ERRORS = {
    'Invalid login credentials': 'Courriel ou mot de passe incorrect.',
    'Email not confirmed': 'Confirmez d\'abord votre courriel avec le lien reçu.',
    'User already registered': 'Un compte existe déjà avec ce courriel.'
  };
  function authError(err){ return AUTH_ERRORS[err.message] || err.message; }

  $('#form-login').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    busy(form, true);
    sb.auth.signInWithPassword({ email:$('#login-email').value.trim(), password:$('#login-pass').value })
      .then(function(res){ if(res.error) setMsg($('#auth-msg'), authError(res.error), true); })
      .finally(function(){ busy(form, false); });
  });

  $('#form-signup').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    busy(form, true);
    sb.auth.signUp({
      email: $('#su-email').value.trim(),
      password: $('#su-pass').value,
      options: {
        emailRedirectTo: location.origin + location.pathname,
        data: { nom_complet: $('#su-name').value.trim(), telephone: $('#su-phone').value.trim() }
      }
    }).then(function(res){
      if(res.error) return setMsg($('#auth-msg'), authError(res.error), true);
      if(!res.data.session) setMsg($('#auth-msg'), 'Compte créé ! Cliquez sur le lien envoyé à votre courriel pour l\'activer.');
    }).finally(function(){ busy(form, false); });
  });

  $('#btn-forgot').addEventListener('click', function(){
    var email = $('#login-email').value.trim();
    if(!email){ setMsg($('#auth-msg'), 'Entrez votre courriel ci-dessus, puis cliquez à nouveau.', true); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
      .then(function(res){
        setMsg($('#auth-msg'), res.error ? authError(res.error) : 'Un lien pour changer votre mot de passe vous a été envoyé.', !!res.error);
      });
  });

  $('#form-reset').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    busy(form, true);
    sb.auth.updateUser({ password:$('#reset-pass').value })
      .then(function(res){
        if(res.error) return setMsg($('#reset-msg'), authError(res.error), true);
        enterApp(res.data.user);
      })
      .finally(function(){ busy(form, false); });
  });

  $('#btn-logout').addEventListener('click', function(){ sb.auth.signOut(); });

  var recovering = false;
  sb.auth.onAuthStateChange(function(event, session){
    if(event === 'PASSWORD_RECOVERY'){ recovering = true; show('view-reset'); return; }
    if(recovering) return;
    if(session && session.user){
      if(!state.user || state.user.id !== session.user.id) enterApp(session.user);
    } else {
      state.user = null;
      $('#btn-logout').hidden = true;
      show('view-auth');
    }
  });

  /* ── TABLEAU DE BORD ── */
  function enterApp(user){
    recovering = false;
    state.user = user;
    $('#btn-logout').hidden = false;
    var meta = user.user_metadata || {};
    $('#hello-name').textContent = (meta.nom_complet || user.email).split(' ')[0];
    show('view-app');
    $('#resa-date').min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    loadAll();
  }

  function goTab(name){
    $$('[data-tab]').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === name); });
    $$('[data-panel]').forEach(function(p){ p.hidden = p.dataset.panel !== name; });
  }
  $$('[data-tab]').forEach(function(b){ b.addEventListener('click', function(){ goTab(b.dataset.tab); }); });
  $$('[data-go]').forEach(function(b){ b.addEventListener('click', function(){ goTab(b.dataset.go); }); });

  function loadAll(){ loadReservations(); loadDocuments(); loadLivraisons(); }

  /* Réservations */
  function loadReservations(){
    sb.from('reservations').select('*').order('date_souhaitee', { ascending:false }).then(function(res){
      var list = $('#resa-list');
      if(res.error){ list.innerHTML = empty('Impossible de charger vos réservations.'); return; }
      var rows = res.data;
      var today = new Date().toISOString().slice(0, 10);
      var upcoming = rows.filter(function(r){ return r.date_souhaitee >= today && (r.statut === 'en_attente' || r.statut === 'confirmee'); })
                         .sort(function(a, b){ return a.date_souhaitee < b.date_souhaitee ? -1 : 1; });
      $('#stat-resa').textContent = upcoming.length;
      $('#next-resa').innerHTML = upcoming.length ? resaItem(upcoming[0], false)
        : empty('Aucune réservation à venir.') + '<button class="ec-textbtn" data-go-inline="reserver">Réserver un service →</button>';
      list.innerHTML = rows.length ? rows.map(function(r){ return resaItem(r, true); }).join('') : empty('Vous n\'avez pas encore de réservation.');
    });
  }
  function resaItem(r, withCancel){
    return '<div class="ec-item">' +
      '<div class="ec-item-main"><strong>' + esc(LABELS.service[r.service]) + '</strong>' +
      '<span class="ec-muted">' + esc(fmtDate(r.date_souhaitee)) + ' · ' + esc(LABELS.plage[r.plage_horaire]) + '</span>' +
      '<span class="ec-muted ec-small">' + esc(r.adresse) + '</span></div>' +
      '<div class="ec-item-side">' + badge(r.statut, 'resa') +
      (withCancel && r.statut === 'en_attente' ? '<button class="ec-textbtn ec-danger" data-cancel="' + esc(r.id) + '">Annuler</button>' : '') +
      '</div></div>';
  }
  document.addEventListener('click', function(e){
    var cancel = e.target.closest('[data-cancel]');
    if(cancel){
      if(!confirm('Annuler cette réservation ?')) return;
      cancel.disabled = true;
      sb.rpc('annuler_reservation', { p_id: cancel.dataset.cancel }).then(function(res){
        if(res.error){ alert('Impossible d\'annuler : ' + res.error.message); cancel.disabled = false; }
        else loadReservations();
      });
    }
    var go = e.target.closest('[data-go-inline]');
    if(go) goTab(go.dataset.goInline);
  });

  $('#form-resa').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    var row = {
      service: $('#resa-service').value,
      date_souhaitee: $('#resa-date').value,
      plage_horaire: $('#resa-plage').value,
      adresse: $('#resa-adresse').value.trim(),
      details: $('#resa-details').value.trim() || null
    };
    busy(form, true);
    sb.from('reservations').insert(row).then(function(res){
      if(res.error){ setMsg($('#resa-msg'), 'Erreur : ' + res.error.message, true); return; }
      setMsg($('#resa-msg'), 'Réservation envoyée ! On vous confirme sous 24h.');
      form.reset();
      loadReservations();
      notifyOwner(row);
    }).finally(function(){ busy(form, false); });
  });

  // Courriel à GK Groupe pour chaque nouvelle réservation (même service que les formulaires du site).
  function notifyOwner(row){
    var meta = state.user.user_metadata || {};
    fetch('https://api.web3forms.com/submit', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: 'Nouvelle réservation (espace client) — ' + LABELS.service[row.service],
        from_name: 'Espace client GK Groupe',
        replyto: state.user.email,
        Client: meta.nom_complet || '',
        Courriel: state.user.email,
        Telephone: meta.telephone || '',
        Service: LABELS.service[row.service],
        Date: row.date_souhaitee + ' (' + LABELS.plage[row.plage_horaire] + ')',
        Adresse: row.adresse,
        Details: row.details || ''
      })
    }).catch(function(){ /* la réservation est déjà enregistrée dans Supabase */ });
  }

  /* Soumissions & factures */
  function loadDocuments(){
    sb.from('documents').select('*').order('date_doc', { ascending:false }).then(function(res){
      if(res.error){ $('#doc-list').innerHTML = empty('Impossible de charger vos documents.'); return; }
      state.docs = res.data;
      $('#stat-docs').textContent = res.data.filter(function(d){
        return d.type === 'facture' && (d.statut === 'envoyee' || d.statut === 'en_retard');
      }).length;
      renderDocs();
    });
  }
  function renderDocs(){
    var rows = state.docs.filter(function(d){ return state.docFilter === 'tous' || d.type === state.docFilter; });
    $('#doc-list').innerHTML = rows.length ? rows.map(function(d){
      return '<div class="ec-item">' +
        '<div class="ec-item-main"><strong>' + esc(d.titre) + '</strong>' +
        '<span class="ec-muted">' + (d.type === 'facture' ? 'Facture' : 'Soumission') + ' n° ' + esc(d.numero) + ' · ' + esc(fmtDate(d.date_doc)) + '</span></div>' +
        '<div class="ec-item-side">' + (d.montant != null ? '<span class="ec-amount">' + esc(fmtMoney(d.montant)) + '</span>' : '') +
        badge(d.statut, 'doc') +
        (d.fichier ? '<button class="ec-textbtn" data-pdf="' + esc(d.fichier) + '">PDF ↓</button>' : '') +
        '</div></div>';
    }).join('') : empty('Aucun document pour le moment.');
  }
  $$('[data-doc-filter]').forEach(function(b){
    b.addEventListener('click', function(){
      state.docFilter = b.dataset.docFilter;
      $$('[data-doc-filter]').forEach(function(x){ x.classList.toggle('active', x === b); });
      renderDocs();
    });
  });
  $('#doc-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-pdf]');
    if(!btn) return;
    // Ouvre la fenêtre tout de suite (sinon le bloqueur de pop-up l'empêche), puis y charge le lien temporaire.
    var win = window.open('', '_blank');
    sb.storage.from('documents').createSignedUrl(btn.dataset.pdf, 120).then(function(res){
      if(res.error){ if(win) win.close(); alert('Document introuvable. Contactez-nous.'); return; }
      if(win) win.location = res.data.signedUrl; else location.href = res.data.signedUrl;
    });
  });

  /* Livraisons */
  function loadLivraisons(){
    sb.from('livraisons').select('*, livraison_etapes(statut, note, created_at)').order('created_at', { ascending:false }).then(function(res){
      var list = $('#livr-list');
      if(res.error){ list.innerHTML = empty('Impossible de charger vos livraisons.'); return; }
      $('#stat-livr').textContent = res.data.filter(function(l){ return l.statut !== 'livree'; }).length;
      list.innerHTML = res.data.length ? res.data.map(function(l){
        return trackCard({ numero_suivi:l.numero_suivi, statut:l.statut, date_prevue:l.date_prevue,
                           destination:l.destination, etapes:l.livraison_etapes || [] });
      }).join('') : empty('Aucune livraison associée à votre compte.');
    });
  }

  function trackCard(t){
    var idx = LIVR_ORDER.indexOf(t.statut);
    var steps = LIVR_ORDER.map(function(s, i){
      var cls = t.statut === 'probleme' ? '' : i < idx ? ' done' : i === idx ? ' current' : '';
      return '<li class="ec-step' + cls + '"><span></span>' + esc(LABELS.livr[s]) + '</li>';
    }).join('');
    var history = (t.etapes || []).slice().sort(function(a, b){ return a.created_at < b.created_at ? 1 : -1; }).map(function(e){
      return '<li><span class="ec-muted ec-small">' + esc(fmtDateTime(e.created_at)) + '</span> ' + esc(LABELS.livr[e.statut] || e.statut) +
             (e.note ? ' — ' + esc(e.note) : '') + '</li>';
    }).join('');
    return '<div class="ec-track">' +
      '<div class="ec-track-head"><div><span class="ec-mono">' + esc(t.numero_suivi) + '</span>' +
      (t.destination ? '<span class="ec-muted ec-small">' + esc(t.destination) + '</span>' : '') + '</div>' + badge(t.statut, 'livr') + '</div>' +
      '<ol class="ec-steps">' + steps + '</ol>' +
      (t.date_prevue ? '<p class="ec-muted ec-small">Livraison prévue : <b>' + esc(fmtDate(t.date_prevue)) + '</b></p>' : '') +
      (history ? '<details class="ec-history"><summary>Historique</summary><ul>' + history + '</ul></details>' : '') +
      '</div>';
  }

  function bindTracking(formSel, inputSel, outSel){
    $(formSel).addEventListener('submit', function(e){
      e.preventDefault();
      var out = $(outSel);
      var num = $(inputSel).value.trim();
      busy(e.target, true);
      sb.rpc('suivre_livraison', { p_numero:num }).then(function(res){
        if(res.error) out.innerHTML = empty('Erreur, réessayez plus tard.');
        else if(!res.data) out.innerHTML = empty('Aucun colis trouvé pour « ' + num + ' ».');
        else out.innerHTML = trackCard(res.data);
      }).finally(function(){ busy(e.target, false); });
    });
  }
  bindTracking('#form-track-public', '#track-public-num', '#track-public-result');
  bindTracking('#form-track', '#track-num', '#track-result');

  // Lien partagé du type espace-client.html?suivi=GKX-1042 : lance le suivi directement.
  var preset = new URLSearchParams(location.search).get('suivi');
  if(preset){ $('#track-public-num').value = preset; $('#track-num').value = preset; }

  sb.auth.getSession().then(function(res){
    if(recovering) return;
    if(!res.data.session){
      show('view-auth');
      if(preset) $('#form-track-public').requestSubmit();
    } else if(preset){
      goTab('suivi');
      $('#form-track').requestSubmit();
    }
  });
})();
