/* ── TÉMOINS (cookies) ET GOOGLE ANALYTICS — Loi 25 ──
   Google Analytics n'est chargé qu'après l'accord du visiteur. Le choix est gardé dans le navigateur ;
   le lien « Gérer les témoins » du pied de page rouvre le bandeau (GKConsent.open()). */
(function(){
  var GA_ID = 'G-E97LYHVST7';
  var KEY = 'gk-consent';

  function get(){ try { return localStorage.getItem(KEY); } catch(e){ return null; } }
  function set(v){ try { localStorage.setItem(KEY, v); } catch(e){} }

  function loadGA(){
    if(window.__gkGaLoaded) return;
    window.__gkGaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  // Efface les témoins Google Analytics déjà déposés (si le visiteur retire son accord).
  function clearGA(){
    var host = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function(c){
      var name = c.split('=')[0].trim();
      if(!/^_ga/.test(name)) return;
      ['', '; domain=' + host, '; domain=.' + host].forEach(function(d){
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + d;
      });
    });
  }

  function close(){
    var b = document.getElementById('gk-consent');
    if(b) b.remove();
  }

  function open(){
    close();
    var b = document.createElement('div');
    b.id = 'gk-consent';
    b.className = 'gk-consent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Témoins de navigation');
    b.innerHTML =
      '<p>Nous utilisons des témoins de mesure d\'audience (Google Analytics) pour améliorer notre site, ' +
      'seulement si vous l\'acceptez. <a href="confidentialite.html">Politique de confidentialité</a></p>' +
      '<div class="gk-consent-btns">' +
        '<button type="button" class="gk-refuse">Refuser</button>' +
        '<button type="button" class="gk-accept">Accepter</button>' +
      '</div>';
    b.querySelector('.gk-accept').addEventListener('click', function(){ set('oui'); close(); loadGA(); });
    b.querySelector('.gk-refuse').addEventListener('click', function(){
      var wasOn = window.__gkGaLoaded;
      set('non'); close(); clearGA();
      if(wasOn) location.reload();
    });
    document.body.appendChild(b);
  }

  window.GKConsent = { open: open };

  var choix = get();
  if(choix === 'oui') loadGA();
  else if(choix !== 'non'){
    if(document.body) open();
    else document.addEventListener('DOMContentLoaded', open);
  }
})();
