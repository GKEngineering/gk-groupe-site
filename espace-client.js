/* ── ESPACE CLIENT — GK Groupe inc ── */
(function(){
  var cfg = window.GK_SUPABASE || {};
  var WEB3FORMS_KEY = '7e12bb33-bec8-47ed-9c49-5411d79c59ed';
  // Numéros d'inscription aux taxes, imprimés sur les soumissions et factures PDF (laisser vide pour les masquer).
  var ENTREPRISE = { tps: '', tvq: '' };

  var LABELS = {
    service: { livraison:'Livraison', demenagement:'Déménagement', service_auto:'Service auto', detaillage:'Détaillage auto', autre:'Autre' },
    plage:   { matin:'Matin', apres_midi:'Après-midi', soir:'Soir' },
    resa:    { en_attente:'En attente', confirmee:'Confirmée', refusee:'Refusée', terminee:'Terminée', annulee:'Annulée' },
    doc:     { envoyee:'Envoyée', acceptee:'Acceptée', refusee:'Refusée', payee:'Payée', en_retard:'En retard' },
    livr:    { recue:'Reçue', en_preparation:'En préparation', en_route:'En route', livree:'Livrée', probleme:'Problème' }
  };
  var TONE = {
    demandee:'info', en_attente:'warn', confirmee:'ok', terminee:'muted', annulee:'bad',
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
    show('view-loading');
    sb.from('profiles').select('is_admin, nom_complet').eq('id', user.id).maybeSingle().then(function(res){
      if(state.user !== user) return;
      if(res.data && res.data.is_admin){
        $('#adm-name').textContent = res.data.nom_complet || user.email;
        show('view-admin'); loadAdmin(); return;
      }
      show('view-app');
      $('#resa-date').min = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      loadAll();
      if(location.hash === '#reserver') goTab('reserver');
    });
  }

  function goTab(name){
    $$('[data-tab]').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === name); });
    $$('[data-panel]').forEach(function(p){ p.hidden = p.dataset.panel !== name; });
  }
  $$('[data-tab]').forEach(function(b){ b.addEventListener('click', function(){ goTab(b.dataset.tab); }); });
  $$('[data-go]').forEach(function(b){ b.addEventListener('click', function(){ goTab(b.dataset.go); }); });

  function loadAll(){ loadReservations(); loadDocuments(); loadSoumissions(); loadFactures(); loadLivraisons(); }

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
      (vehiculeTexte(r) ? '<span class="ec-muted ec-small">🚗 ' + esc(vehiculeTexte(r)) + '</span>' : '') +
      '<span class="ec-muted ec-small">' + esc(r.adresse) + '</span>' +
      (r.rdv_debut && r.statut === 'confirmee' ? '<span class="ec-rdv">📅 Rendez-vous : ' + esc(fmtRdv(r.rdv_debut)) + '</span>' : '') +
      (r.reponse_admin ? '<div class="ec-reply"><b>Message de GK Groupe</b>' + esc(r.reponse_admin) + '</div>' : '') +
      '</div>' +
      '<div class="ec-item-side">' + badge(r.statut, 'resa') +
      (r.paiement_statut === 'payee' ? '<span class="ec-badge ec-ok">Payée ' + esc(fmtMoney(r.paiement_montant)) + '</span>'
        : r.paiement_statut === 'en_attente' && r.paiement_url && r.statut !== 'annulee' && r.statut !== 'refusee'
        ? '<a class="ec-pay" href="' + esc(r.paiement_url) + '" target="_blank" rel="noopener">Payer ' + esc(fmtMoney(r.paiement_montant)) + '</a>' : '') +
      (withCancel && r.statut === 'en_attente' ? '<button class="ec-textbtn ec-danger" data-cancel="' + esc(r.id) + '">Annuler</button>' : '') +
      '</div></div>';
  }
  function fmtRdv(d){
    return new Date(d).toLocaleString('fr-CA', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
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

  var AUTO_SERVICES = ['service_auto', 'detaillage'];
  var resaVehicule = window.GKVehicule ? GKVehicule.mount($('#resa-vehicule'), 'vehicule_') : null;
  function syncVehicule(){
    if(resaVehicule) resaVehicule.setVisible(AUTO_SERVICES.indexOf($('#resa-service').value) !== -1);
  }
  $('#resa-service').addEventListener('change', syncVehicule);
  syncVehicule();

  function vehiculeTexte(r){
    return [r.vehicule_marque, r.vehicule_modele, r.vehicule_annee].filter(Boolean).join(' ');
  }

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
    var veh = resaVehicule && resaVehicule.value();
    if(veh){
      row.vehicule_annee = veh.annee;
      row.vehicule_marque = veh.marque;
      row.vehicule_modele = veh.modele;
    }
    busy(form, true);
    sb.from('reservations').insert(row).then(function(res){
      if(res.error){ setMsg($('#resa-msg'), 'Erreur : ' + res.error.message, true); return; }
      setMsg($('#resa-msg'), 'Réservation envoyée ! On vous confirme sous 24h.');
      form.reset();
      if(resaVehicule) resaVehicule.reset();
      syncVehicule();
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
        Vehicule: vehiculeTexte(row),
        Details: row.details || ''
      })
    }).catch(function(){ /* la réservation est déjà enregistrée dans Supabase */ });
  }

  /* Soumissions & factures */
  function loadDocuments(){
    sb.from('documents').select('*').order('date_doc', { ascending:false }).then(function(res){
      if(res.error){ $('#doc-list').innerHTML = empty('Impossible de charger vos documents.'); return; }
      state.docs = res.data;
      updateFactStat();
      renderDocs();
    });
  }
  function renderDocs(){
    var rows = state.docs.filter(function(d){ return state.docFilter === 'tous' || d.type === state.docFilter; });
    var soums = state.docFilter === 'facture' ? [] : state.soums;
    var facts = state.docFilter === 'soumission' ? [] : state.facts;
    $('#doc-list').innerHTML = rows.length || soums.length || facts.length ?
      facts.map(factItemClient).join('') + soums.map(soumItemClient).join('') + rows.map(function(d){
      return '<div class="ec-item">' +
        '<div class="ec-item-main"><strong>' + esc(d.titre) + '</strong>' +
        '<span class="ec-muted">' + (d.type === 'facture' ? 'Facture' : 'Soumission') + ' n° ' + esc(d.numero) + ' · ' + esc(fmtDate(d.date_doc)) + '</span></div>' +
        '<div class="ec-item-side">' + (d.montant != null ? '<span class="ec-amount">' + esc(fmtMoney(d.montant)) + '</span>' : '') +
        badge(d.statut, 'doc') +
        (d.fichier ? '<button class="ec-textbtn" data-pdf="' + esc(d.fichier) + '">PDF ↓</button>' : '') +
        '</div></div>';
    }).join('') : empty('Aucun document pour le moment. Cliquez « Demander une soumission » pour commencer.');
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

  /* ── SOUMISSIONS EN LIGNE ──
     Le client fait une demande → l'admin ajoute les lignes et l'envoie → le client la télécharge en PDF et répond. */
  var TPS = 0.05, TVQ = 0.09975;
  var SOUM_CLIENT = { demandee:'En préparation', envoyee:'À approuver', acceptee:'Acceptée', refusee:'Refusée', annulee:'Annulée' };
  var SOUM_ADMIN = { demandee:'À compléter', envoyee:'Envoyées', acceptee:'Acceptées', refusee:'Refusées', annulee:'Annulées', tous:'Toutes les soumissions' };
  var SOUM_ADMIN_BADGE = { demandee:'À compléter', envoyee:'Envoyée', acceptee:'Acceptée', refusee:'Refusée', annulee:'Annulée' };
  state.soums = [];

  function soumNumero(s){ return 'S-' + new Date(s.created_at).getFullYear() + '-' + String(s.numero).padStart(4, '0'); }
  function factureNumero(f){ return 'F-' + new Date(f.created_at).getFullYear() + '-' + String(f.numero).padStart(4, '0'); }
  function round2(n){ return Math.round(n * 100) / 100; }
  function soumTotaux(lignes, taxes){
    var st = round2(lignes.reduce(function(t, l){ return t + (Number(l.quantite) || 0) * (Number(l.prix) || 0); }, 0));
    var tps = taxes ? round2(st * TPS) : 0;
    var tvq = taxes ? round2(st * TVQ) : 0;
    return { sousTotal: st, tps: tps, tvq: tvq, total: round2(st + tps + tvq) };
  }
  function soumBadge(s, labels){ return '<span class="ec-badge ec-' + (TONE[s.statut] || 'muted') + '">' + esc(labels[s.statut]) + '</span>'; }
  function soumExpiree(s){ return s.statut === 'envoyee' && s.valide_jusqu && s.valide_jusqu < new Date().toISOString().slice(0, 10); }
  function soumVehiculeTexte(s){ return [s.vehicule_marque, s.vehicule_modele, s.vehicule_annee].filter(Boolean).join(' '); }

  // Courriel à GK Groupe (Web3Forms, comme les réservations).
  function notifyOwnerSoum(subject, fields){
    var meta = state.user.user_metadata || {};
    var body = { access_key: WEB3FORMS_KEY, subject: subject, from_name: 'Espace client GK Groupe', replyto: state.user.email,
                 Client: meta.nom_complet || '', Courriel: state.user.email, Telephone: meta.telephone || '' };
    for(var k in fields) body[k] = fields[k];
    fetch('https://api.web3forms.com/submit', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' }, body: JSON.stringify(body)
    }).catch(function(){ /* la demande est déjà enregistrée dans Supabase */ });
  }

  /* Client : demande */
  var soumVehicule = window.GKVehicule ? GKVehicule.mount($('#soum-vehicule'), 'soum_veh_') : null;
  function syncSoumVehicule(){
    if(soumVehicule) soumVehicule.setVisible(AUTO_SERVICES.indexOf($('#soum-service').value) !== -1);
  }
  $('#soum-service').addEventListener('change', syncSoumVehicule);
  syncSoumVehicule();
  function toggleSoumAsk(on){
    $('#soum-ask').hidden = !on;
    if(on){ $('#soum-date').min = new Date().toISOString().slice(0, 10); $('#soum-desc').focus(); }
  }
  $('#btn-soum-ask').addEventListener('click', function(){ toggleSoumAsk($('#soum-ask').hidden); });
  $('#soum-cancel').addEventListener('click', function(){ toggleSoumAsk(false); });

  $('#form-soum').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    var row = {
      service: $('#soum-service').value,
      description: $('#soum-desc').value.trim(),
      adresse: $('#soum-adresse').value.trim() || null,
      date_souhaitee: $('#soum-date').value || null
    };
    var veh = soumVehicule && soumVehicule.value();
    if(veh){ row.vehicule_annee = veh.annee; row.vehicule_marque = veh.marque; row.vehicule_modele = veh.modele; }
    busy(form, true);
    sb.from('soumissions').insert(row).then(function(res){
      if(res.error){ setMsg($('#soum-msg'), 'Erreur : ' + res.error.message, true); return; }
      form.reset();
      if(soumVehicule) soumVehicule.reset();
      syncSoumVehicule();
      setMsg($('#soum-msg'), '');
      toggleSoumAsk(false);
      showToast('Demande envoyée ! Votre soumission apparaîtra ici dès qu\'elle sera prête.', '');
      loadSoumissions();
      notifyOwnerSoum('Nouvelle demande de soumission (espace client) — ' + LABELS.service[row.service], {
        Service: LABELS.service[row.service], Description: row.description, Adresse: row.adresse || '',
        Date: row.date_souhaitee || '', Vehicule: soumVehiculeTexte(row)
      });
    }).finally(function(){ busy(form, false); });
  });

  /* Client : liste (mêlée aux factures dans l'onglet « Soumissions & factures ») */
  function loadSoumissions(){
    sb.from('soumissions').select('*').order('created_at', { ascending:false }).then(function(res){
      if(res.error) return;
      state.soums = res.data;
      renderDocs();
    });
  }
  function soumItemClient(s){
    var t = s.statut === 'demandee' ? null : soumTotaux(s.lignes || [], s.taxes);
    var exp = soumExpiree(s);
    return '<div class="ec-item" data-soum="' + esc(s.id) + '">' +
      '<div class="ec-item-main"><strong>Soumission ' + esc(soumNumero(s)) + ' · ' + esc(LABELS.service[s.service]) + '</strong>' +
        '<span class="ec-muted">Demandée le ' + esc(fmtDate(s.created_at)) +
          (s.valide_jusqu && s.statut === 'envoyee' ? ' · valide jusqu\'au ' + esc(fmtDate(s.valide_jusqu)) : '') + '</span>' +
        '<span class="ec-muted ec-small soum-desc">' + esc(s.description) + '</span>' +
        (s.note_admin && s.statut !== 'demandee' ? '<div class="ec-reply"><b>Note de GK Groupe</b>' + esc(s.note_admin) + '</div>' : '') +
      '</div>' +
      '<div class="ec-item-side">' +
        (t ? '<span class="ec-amount">' + esc(fmtMoney(t.total)) + '</span>' : '') +
        (exp ? '<span class="ec-badge ec-bad">Expirée</span>' : soumBadge(s, SOUM_CLIENT)) +
        (t ? '<button class="ec-textbtn" data-soum-pdf>PDF ↓</button>' : '') +
        (s.statut === 'envoyee' && !exp ? '<button class="adm-btn adm-ok" data-soum-rep="acceptee">Accepter</button><button class="ec-textbtn ec-danger" data-soum-rep="refusee">Refuser</button>' : '') +
        (s.statut === 'demandee' ? '<button class="ec-textbtn ec-danger" data-soum-rep="annulee">Annuler</button>' : '') +
      '</div></div>';
  }

  $('#doc-list').addEventListener('click', function(e){
    var el = e.target.closest('[data-soum-pdf],[data-soum-rep]');
    if(!el) return;
    var s = state.soums.filter(function(x){ return x.id === el.closest('[data-soum]').dataset.soum; })[0];
    if(el.hasAttribute('data-soum-pdf')){
      var meta = state.user.user_metadata || {};
      downloadSoumPdf(s, { nom_complet: meta.nom_complet, email: state.user.email, telephone: meta.telephone })
        .catch(function(err){ alert(err.message); });
      return;
    }
    var rep = el.dataset.soumRep;
    var question = {
      acceptee: 'Accepter la soumission ' + soumNumero(s) + ' ?\n\nGK Groupe sera avisé et vous contactera pour planifier.',
      refusee: 'Refuser la soumission ' + soumNumero(s) + ' ?',
      annulee: 'Annuler votre demande de soumission ?'
    }[rep];
    if(!confirm(question)) return;
    el.disabled = true;
    sb.rpc('repondre_soumission', { p_id: s.id, p_reponse: rep }).then(function(res){
      if(res.error){ alert('Impossible : ' + res.error.message); el.disabled = false; return; }
      showToast({ acceptee:'Merci ! Soumission acceptée — on vous contacte pour planifier.', refusee:'Soumission refusée.', annulee:'Demande annulée.' }[rep], '');
      loadSoumissions();
      if(rep !== 'annulee'){
        var t = soumTotaux(s.lignes || [], s.taxes);
        notifyOwnerSoum('Soumission ' + soumNumero(s) + ' ' + (rep === 'acceptee' ? 'ACCEPTÉE' : 'refusée') + ' par le client', {
          Soumission: soumNumero(s), Service: LABELS.service[s.service], Total: fmtMoney(t.total)
        });
      }
    });
  });

  /* PDF (généré dans le navigateur avec jsPDF, chargé seulement au besoin) */
  var pdfReady = null;
  function loadScript(src){
    return new Promise(function(ok, ko){
      var el = document.createElement('script');
      el.src = src;
      el.onload = ok;
      el.onerror = function(){ ko(new Error('Impossible de charger le générateur de PDF. Vérifiez votre connexion.')); };
      document.head.appendChild(el);
    });
  }
  function loadPdfTools(){
    if(!pdfReady){
      pdfReady = loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
        .then(function(){ return loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'); })
        .then(function(){
          return fetch('logo.png').then(function(r){ if(!r.ok) throw new Error(); return r.blob(); }).then(function(blob){
            return new Promise(function(ok){ var fr = new FileReader(); fr.onload = function(){ ok(fr.result); }; fr.readAsDataURL(blob); });
          }).catch(function(){ return null; });
        })
        .catch(function(err){ pdfReady = null; throw err; });
    }
    return pdfReady;
  }
  // Les polices de base du PDF ne connaissent que le Latin-1 : on remplace le reste.
  function pdfText(v){
    return String(v == null ? '' : v)
      .replace(/[  ]/g, ' ').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
      .replace(/[^\n\x20-\xff]/g, '');
  }
  function pdfMoney(n){
    var parts = Math.abs(n).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + parts[1] + ' $';
  }

  // kind : 'soumission' (défaut) ou 'facture'. Pour une facture, s = ligne de la table factures.
  function downloadSoumPdf(s, client, kind){
    var isF = kind === 'facture';
    if(isF) s = Object.assign({}, s, { description: s.titre, note_admin: s.note, valide_jusqu: null });
    return loadPdfTools().then(function(logo){
      var doc = new window.jspdf.jsPDF({ unit:'pt', format:'letter' });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
      var t = soumTotaux(s.lignes || [], s.taxes);
      var c = client || {};
      var numero = isF ? factureNumero(s) : soumNumero(s);

      // En-tête
      if(logo) doc.addImage(logo, 'PNG', M, 40, 128, 48);
      else { doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(22); doc.setTextColor(22, 87, 255); doc.text('GK Groupe inc', M, 72); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(10, 14, 26);
      doc.text(isF ? 'FACTURE' : 'SOUMISSION', W - M, 58, { align:'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(107, 114, 128);
      var info = ['N° ' + numero, 'Date : ' + fmtDate(s.envoyee_at || new Date().toISOString())];
      if(s.valide_jusqu) info.push('Valide jusqu\'au : ' + fmtDate(s.valide_jusqu));
      if(isF && s.date_echeance) info.push('Échéance : ' + fmtDate(s.date_echeance));
      if(isF && s._refSoumission) info.push('Réf. soumission : ' + s._refSoumission);
      doc.text(info.map(pdfText), W - M, 76, { align:'right', lineHeightFactor:1.5 });

      var lineY = Math.max(122, 76 + (info.length - 1) * 15 + 18);
      doc.setDrawColor(22, 87, 255); doc.setLineWidth(2); doc.line(M, lineY, W - M, lineY);

      // De / Préparée pour
      var y = lineY + 24;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(22, 87, 255);
      doc.text('DE', M, y); doc.text(pdfText(isF ? 'FACTURÉ À' : 'PRÉPARÉE POUR'), W / 2, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(10, 14, 26);
      var de = ['GK Groupe inc', '581-447-0086', 'gestion@gkgroupeinc.com', 'gkgroupeinc.com'];
      if(ENTREPRISE.tps) de.push('TPS : ' + ENTREPRISE.tps);
      if(ENTREPRISE.tvq) de.push('TVQ : ' + ENTREPRISE.tvq);
      doc.text(de.map(pdfText), M, y + 16, { lineHeightFactor:1.45 });
      var dest = [c.nom_complet || c.email || 'Client', c.email, c.telephone, s.adresse].filter(Boolean).map(pdfText);
      doc.text(doc.splitTextToSize(dest.join('\n'), W / 2 - M), W / 2, y + 16, { lineHeightFactor:1.45 });
      y += 16 + Math.max(de.length, dest.length) * 14.5 + 14;

      // Objet de la demande
      var objet = [LABELS.service[s.service], soumVehiculeTexte(s) && 'Véhicule : ' + soumVehiculeTexte(s),
                   s.date_souhaitee && 'Date souhaitée : ' + fmtDate(s.date_souhaitee)].filter(Boolean).join('  ·  ');
      var besoin = doc.splitTextToSize(pdfText(s.description), W - 2 * M - 24);
      var boxH = 30 + besoin.length * 13;
      doc.setFillColor(238, 242, 255); doc.roundedRect(M, y, W - 2 * M, boxH, 6, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(pdfText(objet), M + 12, y + 18);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(27, 34, 51);
      doc.text(besoin, M + 12, y + 34);
      y += boxH + 18;

      // Lignes
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, bottom: 60 },
        head: [[pdfText('Description'), pdfText('Qté'), 'Prix unitaire', 'Montant']],
        body: (s.lignes || []).map(function(l){
          var q = Number(l.quantite) || 0, p = Number(l.prix) || 0;
          return [pdfText(l.description), String(q).replace('.', ','), pdfMoney(p), pdfMoney(round2(q * p))];
        }),
        theme: 'striped',
        styles: { font:'helvetica', fontSize:10, cellPadding:7, textColor:[10, 14, 26] },
        headStyles: { fillColor:[22, 87, 255], textColor:255, fontStyle:'bold' },
        alternateRowStyles: { fillColor:[246, 248, 252] },
        columnStyles: { 1:{ halign:'center', cellWidth:48 }, 2:{ halign:'right', cellWidth:95 }, 3:{ halign:'right', cellWidth:95 } }
      });
      y = doc.lastAutoTable.finalY + 14;

      // Totaux
      var rows = [['Sous-total', pdfMoney(t.sousTotal)]];
      if(s.taxes){ rows.push(['TPS (5 %)', pdfMoney(t.tps)]); rows.push(['TVQ (9,975 %)', pdfMoney(t.tvq)]); }
      if(y + rows.length * 18 + 40 > H - 60){ doc.addPage(); y = 60; }
      var yTot = y, pageTot = doc.getNumberOfPages();
      doc.setFontSize(10);
      rows.forEach(function(r){
        doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 114, 128); doc.text(r[0], W - M - 150, y);
        doc.setTextColor(10, 14, 26); doc.text(r[1], W - M, y, { align:'right' });
        y += 18;
      });
      doc.setFillColor(22, 87, 255); doc.roundedRect(W - M - 170, y - 6, 170, 30, 5, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
      doc.text('TOTAL', W - M - 158, y + 13); doc.text(pdfMoney(t.total), W - M - 12, y + 13, { align:'right' });
      y += 50;

      // Note et acceptation
      doc.setTextColor(10, 14, 26);
      if(s.note_admin){
        var note = doc.splitTextToSize(pdfText(s.note_admin), W - 2 * M);
        if(y + 20 + note.length * 13 > H - 60){ doc.addPage(); y = 60; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Notes', M, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(note, M, y + 16);
        y += 24 + note.length * 13;
      }
      if(y + 30 > H - 60){ doc.addPage(); y = 60; }
      doc.setFontSize(9.5); doc.setTextColor(107, 114, 128);
      doc.text(pdfText(isF
        ? 'Merci de votre confiance ! Pour toute question sur cette facture : 581-447-0086 ou gestion@gkgroupeinc.com.'
        : 'Pour accepter cette soumission : connectez-vous à votre espace client sur gkgroupeinc.com/espace-client.'), M, y);

      // Tampon « PAYÉE » sur une facture réglée
      if(isF && s.statut === 'payee'){
        doc.setPage(pageTot);
        doc.setDrawColor(18, 129, 63); doc.setLineWidth(2.5); doc.setTextColor(18, 129, 63);
        doc.roundedRect(M, yTot - 12, 150, 48, 6, 6, 'S');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
        doc.text(pdfText('PAYÉE'), M + 75, yTot + 14, { align:'center' });
        if(s.payee_at){ doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.text(pdfText('le ' + fmtDate(s.payee_at)), M + 75, yTot + 28, { align:'center' }); }
      }

      // Pied de page
      for(var i = 1, n = doc.getNumberOfPages(); i <= n; i++){
        doc.setPage(i);
        doc.setDrawColor(223, 228, 238); doc.setLineWidth(0.8); doc.line(M, H - 44, W - M, H - 44);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(154, 163, 181);
        doc.text(pdfText('GK Groupe inc · 581-447-0086 · gestion@gkgroupeinc.com · gkgroupeinc.com'), M, H - 28);
        doc.text('Page ' + i + ' / ' + n, W - M, H - 28, { align:'right' });
      }
      doc.save((isF ? 'Facture-' : 'Soumission-') + numero + '.pdf');
    });
  }

  /* Admin : compléter et envoyer */
  var asState = { rows:[], filter:'demandee' };

  function loadAdminSoums(){
    sb.from('soumissions').select('*, profiles(nom_complet, email, telephone)').order('created_at', { ascending:false }).then(function(res){
      if(res.error){ $('#as-list').innerHTML = empty('Impossible de charger les soumissions : ' + res.error.message); return; }
      asState.rows = res.data;
      renderAdminSoums();
    });
  }

  function renderAdminSoums(){
    var waiting = asState.rows.filter(function(s){ return s.statut === 'demandee'; }).length;
    $('#adm-soum-count').hidden = !waiting;
    $('#adm-soum-count').textContent = waiting;
    $('#as-title').textContent = SOUM_ADMIN[asState.filter];
    $$('[data-as-filter]').forEach(function(c){ c.classList.toggle('active', c.dataset.asFilter === asState.filter); });
    var rows = asState.rows.filter(function(s){ return asState.filter === 'tous' || s.statut === asState.filter; });
    $('#as-list').innerHTML = rows.length ? rows.map(asItem).join('') : empty('Aucune soumission ici.');
    $$('#as-list .as-editor').forEach(function(ed){ refreshTotals(ed.closest('.adm-item')); });
  }

  function lineRow(l){
    return '<tr>' +
      '<td><input data-l="description" value="' + esc(l.description) + '" placeholder="Ex. : Main-d\'œuvre, 2 déménageurs × 3 h"></td>' +
      '<td><input data-l="quantite" type="number" min="0" step="0.25" value="' + esc(l.quantite) + '"></td>' +
      '<td><input data-l="prix" type="number" min="0" step="0.01" value="' + esc(l.prix) + '" placeholder="0,00"></td>' +
      '<td class="as-amount"></td>' +
      '<td><button class="as-del" data-as="del" title="Retirer la ligne" aria-label="Retirer la ligne">×</button></td></tr>';
  }

  function asItem(s){
    var c = s.profiles || {};
    var editable = s.statut === 'demandee' || s.statut === 'envoyee';
    var lignes = s.lignes && s.lignes.length ? s.lignes : [{ description:'', quantite:1, prix:'' }];
    var valid = s.valide_jusqu || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    var body;
    if(editable){
      body = '<div class="as-editor">' +
        '<div class="as-table-wrap"><table class="as-lines"><thead><tr><th>Description</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th><th></th></tr></thead>' +
        '<tbody>' + lignes.map(lineRow).join('') + '</tbody></table></div>' +
        '<button class="ec-textbtn" data-as="add">+ Ajouter une ligne</button>' +
        '<div class="as-bottom"><div class="as-opts">' +
          '<label class="as-check"><input type="checkbox" data-as-taxes' + (s.taxes ? ' checked' : '') + '> Ajouter TPS (5 %) et TVQ (9,975 %)</label>' +
          '<div class="fg"><label>Valide jusqu\'au</label><input type="date" data-as-valid value="' + esc(valid) + '"></div>' +
          '<div class="fg"><label>Note au client (optionnel)</label><textarea rows="2" data-as-note placeholder="Ce qui est inclus, délais, conditions…">' + esc(s.note_admin || '') + '</textarea></div>' +
        '</div><div class="as-totals" data-as-totals></div></div>' +
        '<div class="adm-actions">' +
          '<button class="adm-btn" data-as="pdf">Aperçu PDF</button>' +
          '<button class="adm-btn adm-ok" data-as="send">' + (s.statut === 'envoyee' ? 'Mettre à jour et renvoyer' : 'Envoyer au client') + '</button>' +
          (s.statut === 'demandee' ? '<button class="adm-btn adm-bad" data-as="decline">Décliner la demande</button>' : '') +
        '</div><p class="ec-msg" role="status"></p></div>';
    } else {
      var t = soumTotaux(s.lignes || [], s.taxes);
      body = '<div class="as-summary">' +
        (s.lignes && s.lignes.length ? '<span class="ec-amount">' + esc(fmtMoney(t.total)) + '</span><button class="adm-btn" data-as="pdf">PDF ↓</button>' : '') +
        (s.statut === 'acceptee' ? soumFactureAction(s) : '') +
        (s.statut !== 'acceptee' ? '<button class="adm-btn adm-bad" data-as="delete">🗑 Supprimer</button>' : '') +
        (s.repondue_at ? '<span class="ec-muted ec-small">Réponse du client le ' + esc(fmtDateTime(s.repondue_at)) + '</span>' : '') +
        '</div><p class="ec-msg" role="status"></p>';
    }
    return '<div class="adm-item" data-soum-id="' + esc(s.id) + '">' +
      '<div class="adm-head"><div><strong>' + esc(soumNumero(s)) + ' · ' + esc(LABELS.service[s.service]) + '</strong> ' + soumBadge(s, SOUM_ADMIN_BADGE) +
        (soumExpiree(s) ? ' <span class="ec-badge ec-bad">Expirée</span>' : '') + '</div>' +
        '<span class="adm-date">Demandée le ' + esc(fmtDateTime(s.created_at)) + '</span></div>' +
      '<div class="adm-grid">' +
        '<div><span class="adm-k">Client</span>' + esc(c.nom_complet || '—') + '</div>' +
        '<div><span class="adm-k">Téléphone</span>' + (c.telephone ? '<a class="ec-link" href="tel:' + esc(c.telephone) + '">' + esc(c.telephone) + '</a>' : '—') + '</div>' +
        '<div><span class="adm-k">Courriel</span>' + (c.email ? '<a class="ec-link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</div>' +
        (s.adresse ? '<div><span class="adm-k">Adresse</span>' + esc(s.adresse) + '</div>' : '') +
        (soumVehiculeTexte(s) ? '<div><span class="adm-k">Véhicule</span>' + esc(soumVehiculeTexte(s)) + '</div>' : '') +
        (s.date_souhaitee ? '<div><span class="adm-k">Date souhaitée</span>' + esc(fmtDate(s.date_souhaitee)) + '</div>' : '') +
      '</div>' +
      '<p class="adm-details">« ' + esc(s.description) + ' »</p>' +
      body + '</div>';
  }

  function readEditor(item){
    var lignes = $$('.as-lines tbody tr', item).map(function(tr){
      return {
        description: tr.querySelector('[data-l=description]').value.trim(),
        quantite: parseFloat(tr.querySelector('[data-l=quantite]').value) || 0,
        prix: parseFloat(tr.querySelector('[data-l=prix]').value) || 0
      };
    }).filter(function(l){ return l.description || l.prix; });
    return {
      lignes: lignes,
      taxes: item.querySelector('[data-as-taxes]').checked,
      note_admin: item.querySelector('[data-as-note]').value.trim() || null,
      valide_jusqu: item.querySelector('[data-as-valid]').value || null
    };
  }

  function refreshTotals(item){
    $$('.as-lines tbody tr', item).forEach(function(tr){
      var q = parseFloat(tr.querySelector('[data-l=quantite]').value) || 0;
      var p = parseFloat(tr.querySelector('[data-l=prix]').value) || 0;
      tr.querySelector('.as-amount').textContent = q && p ? fmtMoney(round2(q * p)) : '';
    });
    var ed = readEditor(item);
    var t = soumTotaux(ed.lignes, ed.taxes);
    item.querySelector('[data-as-totals]').innerHTML =
      '<div><span>Sous-total</span><b>' + esc(fmtMoney(t.sousTotal)) + '</b></div>' +
      (ed.taxes ? '<div><span>TPS (5 %)</span><b>' + esc(fmtMoney(t.tps)) + '</b></div><div><span>TVQ (9,975 %)</span><b>' + esc(fmtMoney(t.tvq)) + '</b></div>' : '') +
      '<div class="as-grand"><span>Total</span><b>' + esc(fmtMoney(t.total)) + '</b></div>';
  }

  function mailtoSoum(s, total){
    var c = s.profiles || {};
    if(!c.email) return '';
    var body = 'Bonjour ' + (c.nom_complet || '') + ',\n\n' +
      'Votre soumission ' + soumNumero(s) + ' (' + LABELS.service[s.service] + ') est prête : ' + fmtMoney(total) + '.\n\n' +
      'Consultez-la, téléchargez-la en PDF et acceptez-la dans votre espace client : https://gkgroupeinc.com/espace-client\n\n' +
      'GK Groupe inc\n581-447-0086';
    return 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent('Votre soumission GK Groupe ' + soumNumero(s)) +
      '&body=' + encodeURIComponent(body);
  }

  $('#as-list').addEventListener('input', function(e){
    var item = e.target.closest('.adm-item');
    if(item && item.querySelector('.as-editor')) refreshTotals(item);
  });
  $('#as-list').addEventListener('change', function(e){
    if(e.target.matches('[data-as-taxes]')) refreshTotals(e.target.closest('.adm-item'));
  });

  $('#as-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-as]');
    if(!btn) return;
    var item = btn.closest('.adm-item');
    var s = asState.rows.filter(function(x){ return x.id === item.dataset.soumId; })[0];
    var msg = item.querySelector('.ec-msg');
    var kind = btn.dataset.as;

    if(kind === 'add'){
      var tbody = item.querySelector('.as-lines tbody');
      tbody.insertAdjacentHTML('beforeend', lineRow({ description:'', quantite:1, prix:'' }));
      tbody.lastElementChild.querySelector('input').focus();
      return;
    }
    if(kind === 'del'){
      var tr = btn.closest('tr');
      if(tr.parentNode.children.length > 1) tr.remove();
      else $$('input', tr).forEach(function(i){ i.value = i.dataset.l === 'quantite' ? 1 : ''; });
      refreshTotals(item);
      return;
    }
    if(kind === 'pdf'){
      var preview = item.querySelector('.as-editor') ? Object.assign({}, s, readEditor(item)) : s;
      downloadSoumPdf(preview, s.profiles).catch(function(err){ setMsg(msg, err.message, true); });
      return;
    }

    if(kind === 'goto-facture'){ openFacturesTab(btn.dataset.statut); return; }
    if(kind === 'facture'){
      btn.disabled = true;
      creerFacture(s).then(function(){
        showToast('Brouillon de facture créé à partir de la soumission — vérifiez-le puis envoyez-le.', '');
        renderAdminSoums();
        openFacturesTab('brouillon');
      }).catch(function(err){ setMsg(msg, 'Erreur : ' + err.message, true); btn.disabled = false; });
      return;
    }

    var patch, done;
    if(kind === 'send'){
      var ed = readEditor(item);
      if(!ed.lignes.length){ setMsg(msg, 'Ajoutez au moins une ligne avec une description et un prix.', true); return; }
      if(ed.lignes.some(function(l){ return !l.description; })){ setMsg(msg, 'Chaque ligne doit avoir une description.', true); return; }
      var t = soumTotaux(ed.lignes, ed.taxes);
      patch = Object.assign(ed, { total: t.total, statut: 'envoyee', envoyee_at: new Date().toISOString() });
      done = function(){ showToast('Soumission envoyée — le client la voit dans son espace et peut la télécharger en PDF.', mailtoSoum(s, t.total)); };
    } else if(kind === 'decline'){
      if(!confirm('Décliner cette demande de soumission ?\n\nAstuce : ajoutez d\'abord une note pour expliquer au client.')) return;
      patch = { statut: 'annulee', note_admin: item.querySelector('[data-as-note]').value.trim() || null };
      done = function(){ showToast('Demande déclinée.', ''); };
    } else if(kind === 'delete'){
      if(!confirm('Supprimer définitivement la soumission ' + soumNumero(s) + ' ?\n\nElle disparaîtra aussi de l\'espace du client.')) return;
      btn.disabled = true;
      sb.from('soumissions').delete().eq('id', s.id).then(function(res){
        if(res.error){ setMsg(msg, 'Erreur : ' + res.error.message, true); btn.disabled = false; return; }
        asState.rows = asState.rows.filter(function(x){ return x.id !== s.id; });
        renderAdminSoums();
        showToast('Soumission supprimée.', '');
      });
      return;
    } else return;

    $$('button', item).forEach(function(b){ b.disabled = true; });
    sb.from('soumissions').update(patch).eq('id', s.id).then(function(res){
      if(res.error){
        setMsg(msg, 'Erreur : ' + res.error.message, true);
        $$('button', item).forEach(function(b){ b.disabled = false; });
        return;
      }
      for(var k in patch) s[k] = patch[k];
      renderAdminSoums();
      done();
    });
  });

  $$('[data-as-filter]').forEach(function(b){
    b.addEventListener('click', function(){ asState.filter = b.dataset.asFilter; renderAdminSoums(); });
  });

  /* ── FACTURES FINALES ──
     Créées depuis une soumission acceptée (brouillon) → l'admin ajuste et envoie → le client la voit en PDF → « Payée ». */
  var FACT_CLIENT = { envoyee:'À payer', payee:'Payée', annulee:'Annulée' };
  var FACT_ADMIN = { brouillon:'Brouillon', envoyee:'À payer', payee:'Payée', annulee:'Annulée' };
  var FACT_TITLES = { brouillon:'Brouillons', envoyee:'À payer', payee:'Payées', annulee:'Annulées', tous:'Toutes les factures' };
  var FACT_TONE = { brouillon:'muted', envoyee:'warn', payee:'ok', annulee:'bad' };
  state.facts = [];
  function factBadge(f, labels){ return '<span class="ec-badge ec-' + FACT_TONE[f.statut] + '">' + esc(labels[f.statut]) + '</span>'; }
  function factRef(f){ return f.soumissions ? soumNumero(f.soumissions) : ''; }

  /* Client */
  function loadFactures(){
    sb.from('factures').select('*, soumissions(numero, created_at)').order('created_at', { ascending:false }).then(function(res){
      if(res.error) return;
      state.facts = res.data;
      updateFactStat();
      renderDocs();
    });
  }
  function updateFactStat(){
    $('#stat-docs').textContent =
      state.facts.filter(function(f){ return f.statut === 'envoyee'; }).length +
      state.docs.filter(function(d){ return d.type === 'facture' && (d.statut === 'envoyee' || d.statut === 'en_retard'); }).length;
  }
  function factItemClient(f){
    var t = soumTotaux(f.lignes || [], f.taxes);
    var enRetard = f.statut === 'envoyee' && f.date_echeance && f.date_echeance < new Date().toISOString().slice(0, 10);
    return '<div class="ec-item" data-fact="' + esc(f.id) + '">' +
      '<div class="ec-item-main"><strong>Facture ' + esc(factureNumero(f)) + ' · ' + esc(LABELS.service[f.service] || f.service) + '</strong>' +
        '<span class="ec-muted">Émise le ' + esc(fmtDate(f.envoyee_at || f.created_at)) +
          (f.date_echeance && f.statut === 'envoyee' ? ' · à payer avant le ' + esc(fmtDate(f.date_echeance)) : '') +
          (f.statut === 'payee' && f.payee_at ? ' · payée le ' + esc(fmtDate(f.payee_at)) : '') + '</span>' +
        (factRef(f) ? '<span class="ec-muted ec-small">Réf. soumission ' + esc(factRef(f)) + '</span>' : '') +
        (f.note ? '<div class="ec-reply"><b>Note de GK Groupe</b>' + esc(f.note) + '</div>' : '') +
      '</div>' +
      '<div class="ec-item-side"><span class="ec-amount">' + esc(fmtMoney(t.total)) + '</span>' +
        (enRetard ? '<span class="ec-badge ec-bad">En retard</span>' : factBadge(f, FACT_CLIENT)) +
        '<button class="ec-textbtn" data-fact-pdf>PDF ↓</button>' +
      '</div></div>';
  }
  $('#doc-list').addEventListener('click', function(e){
    var el = e.target.closest('[data-fact-pdf]');
    if(!el) return;
    var f = state.facts.filter(function(x){ return x.id === el.closest('[data-fact]').dataset.fact; })[0];
    var meta = state.user.user_metadata || {};
    downloadSoumPdf(Object.assign({ _refSoumission: factRef(f) }, f), { nom_complet: meta.nom_complet, email: state.user.email, telephone: meta.telephone }, 'facture')
      .catch(function(err){ alert(err.message); });
  });

  /* Admin */
  var afState = { rows:[], filter:'brouillon' };

  function loadAdminFactures(){
    return sb.from('factures').select('*, profiles(nom_complet, email, telephone), soumissions(numero, created_at)')
      .order('created_at', { ascending:false }).then(function(res){
        if(res.error){ $('#af-list').innerHTML = empty('Impossible de charger les factures : ' + res.error.message); return; }
        afState.rows = res.data;
        renderAdminFactures();
        renderAdminSoums();
      });
  }

  function soumFactureAction(s){
    var f = afState.rows.filter(function(x){ return x.soumission_id === s.id && x.statut !== 'annulee'; })[0];
    if(!f) return '<button class="adm-btn adm-ok" data-as="facture">🧾 Créer la facture finale</button>';
    return factBadge(f, FACT_ADMIN).replace('">', '">🧾 ' + esc(factureNumero(f)) + ' · ') +
      '<button class="ec-textbtn" data-as="goto-facture" data-statut="' + esc(f.statut) + '">Voir la facture</button>';
  }

  function creerFacture(s){
    var titre = s.description.split('\n')[0].slice(0, 140);
    return sb.from('factures').insert({
      client_id: s.client_id, soumission_id: s.id, service: s.service, titre: titre,
      lignes: s.lignes || [], taxes: s.taxes, total: s.total, statut: 'brouillon',
      date_echeance: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)
    }).then(function(res){
      if(res.error) throw new Error(/factures_une_par_soumission|duplicate/.test(res.error.message)
        ? 'Une facture existe déjà pour cette soumission.' : res.error.message);
      return loadAdminFactures();
    });
  }

  function openFacturesTab(statut){
    afState.filter = statut || 'brouillon';
    $('[data-adm-tab=factures]').click();
  }

  function renderAdminFactures(){
    var drafts = afState.rows.filter(function(f){ return f.statut === 'brouillon'; }).length;
    $('#adm-fact-count').hidden = !drafts;
    $('#adm-fact-count').textContent = drafts;
    $('#af-title').textContent = FACT_TITLES[afState.filter];
    $$('[data-af-filter]').forEach(function(c){ c.classList.toggle('active', c.dataset.afFilter === afState.filter); });
    var rows = afState.rows.filter(function(f){ return afState.filter === 'tous' || f.statut === afState.filter; });
    $('#af-list').innerHTML = rows.length ? rows.map(afItem).join('') : empty('Aucune facture ici.');
    $$('#af-list .as-editor').forEach(function(ed){ refreshTotals(ed.closest('.adm-item')); });
  }

  function afItem(f){
    var c = f.profiles || {};
    var editable = f.statut === 'brouillon' || f.statut === 'envoyee';
    var lignes = f.lignes && f.lignes.length ? f.lignes : [{ description:'', quantite:1, prix:'' }];
    var t = soumTotaux(f.lignes || [], f.taxes);
    var body;
    if(editable){
      body = '<div class="as-editor">' +
        '<div class="fg"><label>Titre de la facture</label><input data-af-titre value="' + esc(f.titre) + '"></div>' +
        '<div class="as-table-wrap"><table class="as-lines"><thead><tr><th>Description</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th><th></th></tr></thead>' +
        '<tbody>' + lignes.map(lineRow).join('') + '</tbody></table></div>' +
        '<button class="ec-textbtn" data-as="add">+ Ajouter une ligne</button>' +
        '<div class="as-bottom"><div class="as-opts">' +
          '<label class="as-check"><input type="checkbox" data-as-taxes' + (f.taxes ? ' checked' : '') + '> Ajouter TPS (5 %) et TVQ (9,975 %)</label>' +
          '<div class="fg"><label>À payer avant le</label><input type="date" data-as-valid value="' + esc(f.date_echeance || '') + '"></div>' +
          '<div class="fg"><label>Note au client (optionnel)</label><textarea rows="2" data-as-note placeholder="Modes de paiement acceptés, remerciements…">' + esc(f.note || '') + '</textarea></div>' +
        '</div><div class="as-totals" data-as-totals></div></div>' +
        '<div class="adm-actions">' +
          '<button class="adm-btn" data-af="pdf">Aperçu PDF</button>' +
          '<button class="adm-btn adm-ok" data-af="send">' + (f.statut === 'envoyee' ? 'Mettre à jour et renvoyer' : 'Envoyer la facture au client') + '</button>' +
          (f.statut === 'envoyee' ? '<button class="adm-btn adm-ok" data-af="paid">✓ Marquer payée</button><button class="adm-btn adm-bad" data-af="cancel">Annuler la facture</button>'
                                   : '<button class="adm-btn adm-bad" data-af="delete">🗑 Supprimer le brouillon</button>') +
        '</div><p class="ec-msg" role="status"></p></div>';
    } else {
      body = '<div class="as-summary"><span class="ec-amount">' + esc(fmtMoney(t.total)) + '</span>' +
        '<button class="adm-btn" data-af="pdf">PDF ↓</button>' +
        (f.statut === 'payee' ? '<button class="ec-textbtn" data-af="unpaid">Annuler « payée »</button>' : '<button class="adm-btn adm-bad" data-af="delete">🗑 Supprimer</button>') +
        (f.payee_at ? '<span class="ec-muted ec-small">Payée le ' + esc(fmtDateTime(f.payee_at)) + '</span>' : '') +
        '</div><p class="ec-msg" role="status"></p>';
    }
    return '<div class="adm-item" data-fact-id="' + esc(f.id) + '">' +
      '<div class="adm-head"><div><strong>' + esc(factureNumero(f)) + ' · ' + esc(LABELS.service[f.service] || f.service) + '</strong> ' + factBadge(f, FACT_ADMIN) + '</div>' +
        '<span class="adm-date">' + esc(fmtMoney(t.total)) + '</span></div>' +
      '<div class="adm-grid">' +
        '<div><span class="adm-k">Client</span>' + esc(c.nom_complet || '—') + '</div>' +
        '<div><span class="adm-k">Courriel</span>' + (c.email ? '<a class="ec-link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</div>' +
        '<div><span class="adm-k">Soumission</span>' + esc(factRef(f) || '—') + '</div>' +
        (f.envoyee_at ? '<div><span class="adm-k">Envoyée le</span>' + esc(fmtDateTime(f.envoyee_at)) + '</div>' : '') +
      '</div>' + body + '</div>';
  }

  function mailtoFacture(f, total){
    var c = f.profiles || {};
    if(!c.email) return '';
    var body = 'Bonjour ' + (c.nom_complet || '') + ',\n\n' +
      'Votre facture ' + factureNumero(f) + ' (' + (LABELS.service[f.service] || f.service) + ') est disponible : ' + fmtMoney(total) + '.\n' +
      (f.date_echeance ? 'À payer avant le ' + fmtDate(f.date_echeance) + '.\n' : '') +
      '\nTéléchargez-la en PDF dans votre espace client : https://gkgroupeinc.com/espace-client\n\n' +
      'Merci de votre confiance !\nGK Groupe inc\n581-447-0086';
    return 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent('Votre facture GK Groupe ' + factureNumero(f)) +
      '&body=' + encodeURIComponent(body);
  }

  $('#af-list').addEventListener('input', function(e){
    var item = e.target.closest('.adm-item');
    if(item && item.querySelector('.as-editor')) refreshTotals(item);
  });
  $('#af-list').addEventListener('change', function(e){
    if(e.target.matches('[data-as-taxes]')) refreshTotals(e.target.closest('.adm-item'));
  });

  $('#af-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-af],[data-as]');
    if(!btn) return;
    var item = btn.closest('.adm-item');
    var f = afState.rows.filter(function(x){ return x.id === item.dataset.factId; })[0];
    var msg = item.querySelector('.ec-msg');
    var kind = btn.dataset.af || btn.dataset.as;

    if(kind === 'add'){
      var tbody = item.querySelector('.as-lines tbody');
      tbody.insertAdjacentHTML('beforeend', lineRow({ description:'', quantite:1, prix:'' }));
      tbody.lastElementChild.querySelector('input').focus();
      return;
    }
    if(kind === 'del'){
      var tr = btn.closest('tr');
      if(tr.parentNode.children.length > 1) tr.remove();
      else $$('input', tr).forEach(function(i){ i.value = i.dataset.l === 'quantite' ? 1 : ''; });
      refreshTotals(item);
      return;
    }
    function edited(){
      var ed = readEditor(item);
      return { lignes: ed.lignes, taxes: ed.taxes, note: ed.note_admin, date_echeance: ed.valide_jusqu,
               titre: item.querySelector('[data-af-titre]').value.trim() || f.titre };
    }
    if(kind === 'pdf'){
      var src = item.querySelector('.as-editor') ? Object.assign({}, f, edited()) : f;
      downloadSoumPdf(Object.assign({ _refSoumission: factRef(f) }, src), f.profiles, 'facture')
        .catch(function(err){ setMsg(msg, err.message, true); });
      return;
    }

    var patch, done, question;
    if(kind === 'send'){
      patch = edited();
      if(!patch.lignes.length){ setMsg(msg, 'Ajoutez au moins une ligne avec une description et un prix.', true); return; }
      if(patch.lignes.some(function(l){ return !l.description; })){ setMsg(msg, 'Chaque ligne doit avoir une description.', true); return; }
      var tot = soumTotaux(patch.lignes, patch.taxes).total;
      Object.assign(patch, { total: tot, statut: 'envoyee', envoyee_at: new Date().toISOString() });
      done = function(){ showToast('Facture envoyée — le client la voit dans son espace et peut la télécharger en PDF.', mailtoFacture(f, tot)); };
    } else if(kind === 'paid'){
      question = 'Marquer la facture ' + factureNumero(f) + ' comme payée ?';
      patch = { statut: 'payee', payee_at: new Date().toISOString() };
      done = function(){ showToast('Facture marquée payée.', ''); };
    } else if(kind === 'unpaid'){
      question = 'Remettre la facture ' + factureNumero(f) + ' « à payer » ?';
      patch = { statut: 'envoyee', payee_at: null };
      done = function(){ showToast('Facture remise « à payer ».', ''); };
    } else if(kind === 'cancel'){
      question = 'Annuler la facture ' + factureNumero(f) + ' ?\n\nLe client la verra comme annulée.';
      patch = { statut: 'annulee' };
      done = function(){ showToast('Facture annulée.', ''); };
    } else if(kind === 'delete'){
      if(!confirm('Supprimer définitivement la facture ' + factureNumero(f) + ' ?')) return;
      btn.disabled = true;
      sb.from('factures').delete().eq('id', f.id).then(function(res){
        if(res.error){ setMsg(msg, 'Erreur : ' + res.error.message, true); btn.disabled = false; return; }
        afState.rows = afState.rows.filter(function(x){ return x.id !== f.id; });
        renderAdminFactures();
        renderAdminSoums();
        showToast('Facture supprimée.', '');
      });
      return;
    } else return;

    if(question && !confirm(question)) return;
    $$('button', item).forEach(function(b){ b.disabled = true; });
    sb.from('factures').update(patch).eq('id', f.id).then(function(res){
      if(res.error){
        setMsg(msg, 'Erreur : ' + res.error.message, true);
        $$('button', item).forEach(function(b){ b.disabled = false; });
        return;
      }
      for(var k in patch) f[k] = patch[k];
      if(kind === 'send' || kind === 'paid' || kind === 'unpaid' || kind === 'cancel') afState.filter = f.statut;
      renderAdminFactures();
      renderAdminSoums();
      done();
    });
  });

  $$('[data-af-filter]').forEach(function(b){
    b.addEventListener('click', function(){ afState.filter = b.dataset.afFilter; renderAdminFactures(); });
  });

  /* ── ADMIN : créer une réservation (client au téléphone, en personne…) ── */
  var NEW_CLIENT = '__nouveau__';
  var anClients = [];
  var anVehicule = window.GKVehicule ? GKVehicule.mount($('#an-vehicule'), 'an_veh_') : null;

  function loadClientsList(){
    sb.from('profiles').select('id, nom_complet, email, telephone, is_admin').order('nom_complet').then(function(res){
      anClients = (res.data || []).filter(function(p){ return !p.is_admin; });
      var sel = $('#an-client');
      sel.innerHTML = '<option value="' + NEW_CLIENT + '">➕ Nouveau client (sans compte)</option>' +
        (anClients.length ? '<optgroup label="Clients avec un compte">' + anClients.map(function(p){
          return '<option value="' + esc(p.id) + '">' + esc((p.nom_complet || p.email) + (p.telephone ? ' · ' + p.telephone : '')) + '</option>';
        }).join('') + '</optgroup>' : '');
      syncAnClient();
    });
  }
  function syncAnClient(){
    var nouveau = $('#an-client').value === NEW_CLIENT;
    $('#an-new-client').hidden = !nouveau;
    $('#an-nom').required = nouveau;
    $('#an-tel').required = nouveau;
  }
  function syncAnVehicule(){
    if(anVehicule) anVehicule.setVisible(AUTO_SERVICES.indexOf($('#an-service').value) !== -1);
  }
  $('#an-client').addEventListener('change', syncAnClient);
  $('#an-service').addEventListener('change', syncAnVehicule);
  syncAnVehicule();

  function toggleAdmNew(on){
    $('#adm-new').hidden = !on;
    if(on){
      if(!anClients.length) loadClientsList();
      $('#an-date').value = $('#an-date').value || new Date().toISOString().slice(0, 10);
      $('#an-client').focus();
    }
  }
  $('#adm-new-btn').addEventListener('click', function(){ toggleAdmNew($('#adm-new').hidden); });
  $('#an-cancel').addEventListener('click', function(){ toggleAdmNew(false); });

  $('#form-adm-new').addEventListener('submit', function(e){
    e.preventDefault();
    var form = e.target;
    var choix = $('#an-client').value;
    var compte = anClients.filter(function(p){ return p.id === choix; })[0] || null;
    var message = $('#an-msg').value.trim();
    var row = {
      client_id: compte ? compte.id : null,
      client_nom: compte ? null : $('#an-nom').value.trim(),
      client_telephone: compte ? null : $('#an-tel').value.trim(),
      client_courriel: compte ? null : ($('#an-mail').value.trim() || null),
      service: $('#an-service').value,
      date_souhaitee: $('#an-date').value,
      plage_horaire: $('#an-plage').value,
      adresse: $('#an-adresse').value.trim(),
      details: $('#an-details').value.trim() || null,
      statut: $('#an-statut').value,
      creee_par_admin: true,
      reponse_admin: message || null,
      repondu_at: message ? new Date().toISOString() : null
    };
    var veh = anVehicule && anVehicule.value();
    if(veh){ row.vehicule_annee = veh.annee; row.vehicule_marque = veh.marque; row.vehicule_modele = veh.modele; }
    busy(form, true);
    sb.from('reservations').insert(row).then(function(res){
      if(res.error){ setMsg($('#an-feedback'), 'Erreur : ' + res.error.message, true); return; }
      form.reset();
      if(anVehicule) anVehicule.reset();
      syncAnClient(); syncAnVehicule();
      setMsg($('#an-feedback'), '');
      toggleAdmNew(false);
      adm.filter = row.statut;
      loadAdmin();
      var pourMail = Object.assign({}, row, { profiles: compte });
      showToast('Réservation créée' + (compte ? ' — le client la voit dans son espace.' : '.'), mailtoClient(pourMail, message));
    }).finally(function(){ busy(form, false); });
  });

  /* ── ADMIN : gestion des réservations ── */
  var adm = { rows:[], filter:'en_attente' };
  var ADM_TITLES = { en_attente:'À traiter', confirmee:'Confirmées', refusee:'Refusées', terminee:'Terminées', annulee:'Annulées', tous:'Toutes les réservations' };

  function loadAdmin(){
    $('#adm-list').innerHTML = '<div class="ec-spinner"></div>';
    sb.from('reservations').select('*, profiles(nom_complet, email, telephone)')
      .order('date_souhaitee', { ascending:true }).then(function(res){
        if(res.error){ $('#adm-list').innerHTML = empty('Impossible de charger les réservations : ' + res.error.message); return; }
        adm.rows = res.data;
        renderAdmin();
      });
    loadAdminSoums();
    loadAdminFactures();
  }

  function renderAdmin(){
    var today = new Date().toISOString().slice(0, 10);
    $('#adm-count-attente').textContent = adm.rows.filter(function(r){ return r.statut === 'en_attente'; }).length;
    $('#adm-count-confirmee').textContent = adm.rows.filter(function(r){ return r.statut === 'confirmee' && r.date_souhaitee >= today; }).length;
    $('#adm-count-tous').textContent = adm.rows.length;
    $('#adm-list-title').textContent = ADM_TITLES[adm.filter];
    $$('.ec-chip[data-adm-filter]').forEach(function(c){ c.classList.toggle('active', c.dataset.admFilter === adm.filter); });
    var rows = adm.rows.filter(function(r){ return adm.filter === 'tous' || r.statut === adm.filter; });
    $('#adm-list').innerHTML = rows.length ? rows.map(admItem).join('') : empty('Aucune réservation ici.');
    var bulk = $('#adm-bulk-delete');
    bulk.hidden = !(CLOSED.indexOf(adm.filter) !== -1 && rows.length > 1);
    bulk.textContent = '🗑 Supprimer les ' + rows.length + ' réservations « ' + ADM_TITLES[adm.filter].toLowerCase() + ' »';
  }

  // Seules les réservations terminées, annulées ou refusées peuvent être supprimées.
  var CLOSED = ['terminee', 'annulee', 'refusee'];

  // Coordonnées du client : son compte, ou celles saisies par l'admin pour un client sans compte.
  function resaClient(r){
    return r.profiles || { nom_complet: r.client_nom, telephone: r.client_telephone, email: r.client_courriel };
  }

  function admItem(r){
    var c = resaClient(r);
    var actions = r.statut === 'en_attente'
      ? '<button class="adm-btn adm-ok" data-adm-action="confirmee">✓ Accepter</button><button class="adm-btn adm-bad" data-adm-action="refusee">✕ Refuser</button>'
      : r.statut === 'confirmee'
      ? '<button class="adm-btn adm-ok" data-adm-action="terminee">Marquer terminée</button><button class="adm-btn adm-bad" data-adm-action="refusee">Annuler / refuser</button>'
      : '<button class="adm-btn adm-bad" data-adm-delete>🗑 Supprimer</button>';
    return '<div class="adm-item" data-id="' + esc(r.id) + '">' +
      '<div class="adm-head"><div><strong>' + esc(LABELS.service[r.service]) + '</strong> ' + badge(r.statut, 'resa') +
        (r.creee_par_admin ? ' <span class="sq-src sq-src-site">Créée par GK</span>' : '') + '</div>' +
      '<span class="adm-date">' + esc(fmtDate(r.date_souhaitee)) + ' · ' + esc(LABELS.plage[r.plage_horaire]) + '</span></div>' +
      '<div class="adm-grid">' +
        '<div><span class="adm-k">Client</span>' + esc(c.nom_complet || '—') + (r.client_id ? '' : ' <span class="ec-muted ec-small">(sans compte)</span>') + '</div>' +
        '<div><span class="adm-k">Téléphone</span>' + (c.telephone ? '<a class="ec-link" href="tel:' + esc(c.telephone) + '">' + esc(c.telephone) + '</a>' : '—') + '</div>' +
        '<div><span class="adm-k">Courriel</span>' + (c.email ? '<a class="ec-link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</div>' +
        '<div><span class="adm-k">Adresse</span>' + esc(r.adresse) + '</div>' +
        (vehiculeTexte(r) ? '<div><span class="adm-k">Véhicule</span>' + esc(vehiculeTexte(r)) + '</div>' : '') +
        '<div><span class="adm-k">Reçue le</span>' + esc(fmtDateTime(r.created_at)) + '</div>' +
      '</div>' +
      (r.details ? '<p class="adm-details">« ' + esc(r.details) + ' »</p>' : '') +
      (r.reponse_admin ? '<div class="ec-reply"><b>Votre dernier message' + (r.repondu_at ? ' (' + esc(fmtDateTime(r.repondu_at)) + ')' : '') + '</b>' + esc(r.reponse_admin) + '</div>' : '') +
      admSquare(r) +
      '<div class="adm-reply">' +
        '<textarea rows="2" placeholder="Message au client (optionnel) — ex. : Confirmé pour 9h, on vous appelle la veille."></textarea>' +
        '<div class="adm-actions">' + actions + '<button class="adm-btn" data-adm-action="message">Envoyer le message</button></div>' +
        '<p class="ec-msg" role="status"></p>' +
      '</div>' +
    '</div>';
  }

  /* ── Square : paiement ──
     L'ajout de RDV dans l'agenda Square demande Appointments Plus/Premium : on les ajoute à la main dans Square. */
  function isOpenResa(r){ return r.statut !== 'annulee' && r.statut !== 'refusee'; }

  function admSquare(r){
    var pay;
    if(r.paiement_statut === 'payee'){
      pay = '<span class="ec-badge ec-ok">💳 Payée · ' + esc(fmtMoney(r.paiement_montant)) + '</span>';
    } else if(r.paiement_url){
      pay = '<span class="ec-badge ec-warn">💳 Paiement en attente · ' + esc(fmtMoney(r.paiement_montant)) + '</span>' +
            '<button class="ec-textbtn" data-sq="copy" data-url="' + esc(r.paiement_url) + '">Copier le lien</button>';
    } else if(isOpenResa(r)){
      pay = '<div class="sq-inline"><input type="number" min="1" step="0.01" placeholder="Montant $" data-sq-montant>' +
            '<button class="adm-btn" data-sq="pay">💳 Demander le paiement</button></div>';
    } else return '';
    return '<div class="sq-box"><span class="adm-k">Paiement Square</span><div class="sq-row">' + pay + '</div><p class="ec-msg sq-msg" role="status"></p></div>';
  }

  // Appel de la fonction serveur « square » ; renvoie le message d'erreur lisible s'il y en a un.
  function callSquare(body){
    return sb.functions.invoke('square', { body: body }).then(function(res){
      if(!res.error) return res.data;
      var ctx = res.error.context;
      var read = ctx && typeof ctx.json === 'function' ? ctx.json().catch(function(){ return {}; }) : Promise.resolve({});
      return read.then(function(b){
        throw new Error(b.error || (/Failed to send|NetworkError|Failed to fetch/i.test(res.error.message)
          ? 'Connexion à Square non configurée (fonction « square » non déployée).' : res.error.message));
      });
    });
  }

  $('#adm-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-sq]');
    if(!btn) return;
    var item = btn.closest('.adm-item');
    var r = adm.rows.filter(function(x){ return x.id === item.dataset.id; })[0];
    var msg = item.querySelector('.sq-msg');

    if(btn.dataset.sq === 'copy'){
      navigator.clipboard.writeText(btn.dataset.url).then(function(){ setMsg(msg, 'Lien copié.'); });
      return;
    }
    var montant = parseFloat(item.querySelector('[data-sq-montant]').value);
    if(!(montant >= 1)){ setMsg(msg, 'Entrez un montant (1 $ minimum).', true); return; }

    $$('button', item).forEach(function(b){ b.disabled = true; });
    setMsg(msg, 'Connexion à Square…');
    callSquare({ action:'payment_link', reservation_id:r.id, montant:montant }).then(function(patch){
      for(var k in patch) r[k] = patch[k];
      renderAdmin();
      showToast('Lien de paiement créé — le client voit le bouton « Payer » dans son espace.', '');
    }).catch(function(err){
      setMsg(msg, err.message, true);
      $$('button', item).forEach(function(b){ b.disabled = false; });
    });
  });

  /* Onglet « Agenda Square » */
  var SQ_STATUS = { PENDING:['En attente','warn'], ACCEPTED:['Confirmé','ok'], CANCELLED_BY_CUSTOMER:['Annulé (client)','bad'],
    CANCELLED_BY_SELLER:['Annulé','bad'], DECLINED:['Refusé','bad'], NO_SHOW:['Absent','muted'] };
  function loadAgenda(){
    var out = $('#sq-agenda');
    out.innerHTML = '<div class="ec-spinner"></div>';
    callSquare({ action:'list_bookings' }).then(function(res){
      if(!res.bookings.length){ out.innerHTML = empty('Aucun rendez-vous dans les 30 prochains jours.'); return; }
      var day = '';
      out.innerHTML = res.bookings.map(function(b){
        var d = new Date(b.start_at);
        var label = d.toLocaleDateString('fr-CA', { weekday:'long', day:'numeric', month:'long' });
        var head = label !== day ? '<h4 class="sq-day">' + esc(label) + '</h4>' : '';
        day = label;
        var st = SQ_STATUS[b.status] || [b.status, 'muted'];
        return head + '<div class="ec-item">' +
          '<div class="ec-item-main"><strong>' + esc(d.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit' })) + ' · ' + esc(b.service) + '</strong>' +
          '<span class="ec-muted">' + esc(b.client.nom) + (b.client.telephone ? ' · <a class="ec-link" href="tel:' + esc(b.client.telephone) + '">' + esc(b.client.telephone) + '</a>' : '') + '</span>' +
          (b.note ? '<span class="ec-muted ec-small sq-note">' + esc(b.note) + '</span>' : '') + '</div>' +
          '<div class="ec-item-side"><span class="sq-src sq-src-' + b.source + '">' + (b.source === 'site' ? 'Site' : 'Square') + '</span>' +
          '<span class="ec-muted ec-small">' + esc(b.duration_minutes) + ' min</span>' +
          '<span class="ec-badge ec-' + st[1] + '">' + esc(st[0]) + '</span></div></div>';
      }).join('');
    }).catch(function(err){ out.innerHTML = empty(err.message); });
  }

  var agendaLoaded = false;
  $$('[data-adm-tab]').forEach(function(t){
    t.addEventListener('click', function(){
      $$('[data-adm-tab]').forEach(function(x){ x.classList.toggle('active', x === t); });
      $$('[data-adm-panel]').forEach(function(p){ p.hidden = p.dataset.admPanel !== t.dataset.admTab; });
      $('#adm-h1').textContent = { site:'Réservations', soumissions:'Soumissions', factures:'Factures', square:'Agenda Square' }[t.dataset.admTab];
      if(t.dataset.admTab === 'factures') renderAdminFactures();
      if(t.dataset.admTab === 'square' && !agendaLoaded){ agendaLoaded = true; loadAgenda(); }
    });
  });

  function deleteReservations(ids, done){
    sb.from('reservations').delete().in('id', ids).then(function(res){
      if(res.error){ done(res.error.message); return; }
      adm.rows = adm.rows.filter(function(r){ return ids.indexOf(r.id) === -1; });
      renderAdmin();
      showToast(ids.length > 1 ? ids.length + ' réservations supprimées.' : 'Réservation supprimée.', '');
      done();
    });
  }

  $('#adm-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-adm-delete]');
    if(!btn) return;
    var item = btn.closest('.adm-item');
    var r = adm.rows.filter(function(x){ return x.id === item.dataset.id; })[0];
    var c = resaClient(r);
    if(!confirm('Supprimer définitivement cette réservation ?\n\n' + LABELS.service[r.service] + ' — ' + (c.nom_complet || '') + ' — ' + fmtDate(r.date_souhaitee) +
                '\n\nElle disparaîtra aussi de l\'espace du client.')) return;
    btn.disabled = true;
    deleteReservations([r.id], function(err){
      if(err){ setMsg(item.querySelector('.adm-reply .ec-msg'), 'Erreur : ' + err, true); btn.disabled = false; }
    });
  });

  $('#adm-bulk-delete').addEventListener('click', function(){
    var btn = this;
    var ids = adm.rows.filter(function(r){ return r.statut === adm.filter; }).map(function(r){ return r.id; });
    if(!ids.length || CLOSED.indexOf(adm.filter) === -1) return;
    if(!confirm('Supprimer définitivement ces ' + ids.length + ' réservations ?\n\nElles disparaîtront aussi de l\'espace des clients. Cette action est irréversible.')) return;
    btn.disabled = true;
    deleteReservations(ids, function(err){
      btn.disabled = false;
      if(err) alert('Erreur : ' + err);
    });
  });

  $$('[data-adm-filter]').forEach(function(b){
    b.addEventListener('click', function(){ adm.filter = b.dataset.admFilter; renderAdmin(); });
  });
  $('#adm-refresh').addEventListener('click', function(){
    loadAdmin();
    if(agendaLoaded) loadAgenda();
  });

  $('#adm-list').addEventListener('click', function(e){
    var btn = e.target.closest('[data-adm-action]');
    if(!btn) return;
    var item = btn.closest('.adm-item');
    var r = adm.rows.filter(function(x){ return x.id === item.dataset.id; })[0];
    var action = btn.dataset.admAction;
    var message = item.querySelector('textarea').value.trim();
    var msgEl = item.querySelector('.ec-msg');
    if(action === 'message' && !message){ setMsg(msgEl, 'Écrivez un message d\'abord.', true); return; }
    if(action === 'refusee' && !confirm('Refuser cette réservation ?' + (message ? '' : '\n\nAstuce : ajoutez un message pour expliquer au client.'))) return;

    var patch = {};
    if(action !== 'message') patch.statut = action;
    if(message){ patch.reponse_admin = message; patch.repondu_at = new Date().toISOString(); }
    $$('button', item).forEach(function(b){ b.disabled = true; });
    sb.from('reservations').update(patch).eq('id', r.id).then(function(res){
      if(res.error){
        setMsg(msgEl, 'Erreur : ' + res.error.message, true);
        $$('button', item).forEach(function(b){ b.disabled = false; });
        return;
      }
      for(var k in patch) r[k] = patch[k];
      renderAdmin();
      showToast('Enregistré — le client le voit dans son espace.', mailtoClient(r, message));
    });
  });

  // Lien qui ouvre le logiciel de courriel avec un message prêt, pour prévenir aussi le client par courriel.
  function mailtoClient(r, message){
    var c = resaClient(r);
    if(!c.email) return '';
    var body = 'Bonjour ' + (c.nom_complet || '') + ',\n\n' +
      'Votre réservation « ' + LABELS.service[r.service] + ' » du ' + fmtDate(r.date_souhaitee) +
      ' (' + LABELS.plage[r.plage_horaire] + ') est maintenant : ' + LABELS.resa[r.statut] + '.\n' +
      (message ? '\n' + message + '\n' : '') +
      '\nSuivez vos réservations dans votre espace client : https://gkgroupeinc.com/espace-client\n\n' +
      'GK Groupe inc\n581-447-0086';
    return 'mailto:' + encodeURIComponent(c.email) +
      '?subject=' + encodeURIComponent('Votre réservation GK Groupe — ' + LABELS.resa[r.statut]) +
      '&body=' + encodeURIComponent(body);
  }

  function showToast(text, mail){
    var old = $('.ec-toast');
    if(old) old.remove();
    var t = document.createElement('div');
    t.className = 'ec-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<span>' + esc(text) + '</span>' + (mail ? '<a href="' + esc(mail) + '">Aussi l\'envoyer par courriel ✉</a>' : '');
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 8000);
  }

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

  // Lien partagé du type espace-client?suivi=GKX-1042 : lance le suivi directement.
  var preset = new URLSearchParams(location.search).get('suivi');
  if(preset){ $('#track-public-num').value = preset; $('#track-num').value = preset; }

  // Lien espace-client#inscription (bouton « Inscrivez-vous » du site) : ouvre directement la création de compte.
  if(location.hash === '#inscription') $('[data-auth-tab=signup]').click();
  // Lien espace-client#reserver (boutons « Réserver en ligne » du site) : après connexion, ouvre l'onglet Réservations.
  if(location.hash === '#reserver') setMsg($('#auth-msg'), 'Connectez-vous ou créez un compte pour réserver en ligne.');
  // Retour de la page de paiement Square (redirect_url défini dans supabase/functions/square).
  if(new URLSearchParams(location.search).get('paiement') === 'merci'){
    showToast('Merci ! Votre paiement a bien été reçu.', '');
    history.replaceState(null, '', location.pathname + location.hash);
  }

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
