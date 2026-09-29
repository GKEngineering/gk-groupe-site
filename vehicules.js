/* ── SÉLECTEUR DE VÉHICULE (Année → Marque → Modèle) ──
   Modèles tirés en direct de la base publique NHTSA (vpic.nhtsa.dot.gov), selon la marque et l'année.
   Si l'API ne répond pas ou si le véhicule n'est pas listé, le client peut écrire le modèle à la main. */
(function(){
  var MARQUES = ['Acura','Alfa Romeo','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford',
    'Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln',
    'Lucid','Maserati','Mazda','Mercedes-Benz','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Plymouth',
    'Polestar','Pontiac','Porsche','Ram','Rivian','Saab','Saturn','Scion','Smart','Subaru','Suzuki','Tesla',
    'Toyota','Volkswagen','Volvo'];
  var AUTRE = '__autre__';
  var cache = {};
  var uid = 0;

  function el(tag, attrs, html){
    var e = document.createElement(tag);
    for(var k in attrs) e.setAttribute(k, attrs[k]);
    if(html != null) e.innerHTML = html;
    return e;
  }
  function options(select, placeholder, items){
    select.innerHTML = '';
    select.appendChild(new Option(placeholder, ''));
    items.forEach(function(v){ select.appendChild(new Option(v, v)); });
    select.appendChild(new Option('Autre / pas dans la liste', AUTRE));
  }

  function fetchModeles(marque, annee){
    var key = marque + '|' + annee;
    if(!cache[key]){
      cache[key] = fetch('https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/' +
                         encodeURIComponent(marque) + '/modelyear/' + annee + '?format=json')
        .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
        .then(function(d){
          var seen = {};
          return (d.Results || []).map(function(m){ return String(m.Model_Name).trim(); })
            .filter(function(n){ var k = n.toLowerCase(); if(!n || seen[k]) return false; seen[k] = true; return true; })
            .sort(function(a, b){ return a.localeCompare(b, 'fr'); });
        })
        .catch(function(err){ delete cache[key]; throw err; });
    }
    return cache[key];
  }

  /* root : conteneur vide où construire les champs.
     prefix : préfixe des attributs name (ex. "veh_" → veh_annee, veh_marque, veh_modele). */
  function mount(root, prefix){
    var id = 'veh' + (++uid);
    prefix = prefix || 'veh_';
    root.classList.add('veh-block');
    root.innerHTML =
      '<p class="veh-title">Votre véhicule</p>' +
      '<div class="veh-row">' +
        '<div class="fg"><label for="' + id + '-a">Année *</label><select id="' + id + '-a" data-f="annee"></select></div>' +
        '<div class="fg"><label for="' + id + '-ma">Marque *</label><select id="' + id + '-ma" data-f="marque"></select>' +
          '<input data-f="marque-autre" placeholder="Marque" hidden></div>' +
        '<div class="fg"><label for="' + id + '-mo">Modèle *</label><select id="' + id + '-mo" data-f="modele" disabled></select>' +
          '<input data-f="modele-autre" placeholder="Modèle" hidden></div>' +
      '</div>';

    var f = {};
    Array.prototype.forEach.call(root.querySelectorAll('[data-f]'), function(e){ f[e.dataset.f] = e; });
    f.annee.name = prefix + 'annee';
    f.marque.name = prefix + 'marque';
    f.modele.name = prefix + 'modele';

    var annees = [];
    for(var y = new Date().getFullYear() + 1; y >= 1981; y--) annees.push(String(y));
    f.annee.appendChild(new Option('Année', ''));
    annees.forEach(function(y){ f.annee.appendChild(new Option(y, y)); });
    options(f.marque, 'Marque', MARQUES);
    options(f.modele, 'Choisir l\'année et la marque', []);

    // Un champ texte « Autre » prend le même name que le select, qui lui est désactivé : un seul envoi par champ.
    function toggleAutre(sel, input){
      var autre = sel.value === AUTRE;
      input.hidden = !autre;
      input.disabled = !autre || root.hidden;
      input.required = autre;
      input.name = autre ? sel.name : '';
      if(autre) input.focus();
    }

    var req = 0;
    function refreshModeles(){
      var annee = f.annee.value, marque = f.marque.value;
      f['modele-autre'].hidden = true; f['modele-autre'].required = false; f['modele-autre'].name = '';
      if(!annee || !marque){ options(f.modele, 'Choisir l\'année et la marque', []); f.modele.disabled = true; return; }
      if(marque === AUTRE){ options(f.modele, 'Modèle', []); f.modele.value = AUTRE; f.modele.disabled = false; toggleAutre(f.modele, f['modele-autre']); return; }
      var mine = ++req;
      f.modele.disabled = true;
      options(f.modele, 'Chargement…', []);
      fetchModeles(marque, annee).then(function(list){
        if(mine !== req) return;
        options(f.modele, list.length ? 'Modèle' : 'Aucun modèle trouvé', list);
        f.modele.disabled = false;
        if(!list.length){ f.modele.value = AUTRE; toggleAutre(f.modele, f['modele-autre']); }
      }).catch(function(){
        if(mine !== req) return;
        options(f.modele, 'Modèle', []);
        f.modele.disabled = false;
        f.modele.value = AUTRE;
        toggleAutre(f.modele, f['modele-autre']);
      });
    }

    f.annee.addEventListener('change', refreshModeles);
    f.marque.addEventListener('change', function(){ toggleAutre(f.marque, f['marque-autre']); refreshModeles(); });
    f.modele.addEventListener('change', function(){ toggleAutre(f.modele, f['modele-autre']); });

    function val(sel, input){ return sel.value === AUTRE ? input.value.trim() : sel.value; }

    return {
      setVisible: function(on){
        root.hidden = !on;
        [f.annee, f.marque].forEach(function(s){ s.disabled = !on; s.required = on; });
        f.modele.required = on;
        f.modele.disabled = !on || !f.annee.value || !f.marque.value;
        toggleAutre(f.marque, f['marque-autre']);
        if(f.modele.value === AUTRE) toggleAutre(f.modele, f['modele-autre']);
        f['marque-autre'].blur(); f['modele-autre'].blur();
      },
      reset: function(){
        f.annee.value = ''; f.marque.value = '';
        f['marque-autre'].value = ''; f['modele-autre'].value = '';
        toggleAutre(f.marque, f['marque-autre']);
        refreshModeles();
      },
      value: function(){
        if(root.hidden) return null;
        return { annee: parseInt(f.annee.value, 10) || null,
                 marque: val(f.marque, f['marque-autre']),
                 modele: val(f.modele, f['modele-autre']) };
      }
    };
  }

  window.GKVehicule = { mount: mount };
})();
