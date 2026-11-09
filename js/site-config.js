  // ---------- SERVICE CLIENT (configuration Supabase) ----------
  const SERVICE_CLIENT_FALLBACK = {
    whatsappDisplay:'05505861', whatsappUrl:'https://wa.me/22605505861',
    email:'oualikevin9@gmail.com', text:'Notre équipe est disponible pour vous accompagner.'
  };
  let serviceClientConfigActuelle = {...SERVICE_CLIENT_FALLBACK};

  function normaliserNumeroWhatsApp(valeur) {
    const brut=String(valeur||'').trim();
    const chiffres=brut.replace(/\D/g,'');
    if(!chiffres) return {display:'',url:''};
    const international=chiffres.startsWith('226') ? chiffres : '226'+chiffres.replace(/^0/,'');
    return {display:brut,url:'https://wa.me/'+international};
  }

  function appliquerServiceClientPublic(cfg) {
    const c={...SERVICE_CLIENT_FALLBACK,...cfg};
    const wa=normaliserNumeroWhatsApp(c.whatsappDisplay || c.whatsapp || '');
    c.whatsappDisplay=wa.display || SERVICE_CLIENT_FALLBACK.whatsappDisplay;
    c.whatsappUrl=wa.url || SERVICE_CLIENT_FALLBACK.whatsappUrl;
    c.email=String(c.email||SERVICE_CLIENT_FALLBACK.email).trim();
    c.text=String(c.text||SERVICE_CLIENT_FALLBACK.text).trim();
    serviceClientConfigActuelle=c;
    const txt=document.getElementById('serviceClientPublicText');
    const waLink=document.getElementById('serviceClientWhatsapp');
    const waDisplay=document.getElementById('serviceClientWhatsappDisplay');
    const emLink=document.getElementById('serviceClientEmail');
    const emDisplay=document.getElementById('serviceClientEmailDisplay');
    if(txt) txt.textContent=c.text;
    if(waLink){ waLink.href=c.whatsappUrl; }
    if(waDisplay) waDisplay.textContent=c.whatsappDisplay;
    if(emLink) emLink.href='mailto:'+c.email;
    if(emDisplay) emDisplay.textContent=c.email;
    const waInput=document.getElementById('adminServiceWhatsappInput');
    const emInput=document.getElementById('adminServiceEmailInput');
    const txInput=document.getElementById('adminServiceTextInput');
    if(waInput && document.activeElement!==waInput) waInput.value=c.whatsappDisplay;
    if(emInput && document.activeElement!==emInput) emInput.value=c.email;
    if(txInput && document.activeElement!==txInput) txInput.value=c.text;
    const waOld=document.getElementById('adminServiceWhatsapp');
    const emOld=document.getElementById('adminServiceEmail');
    const txOld=document.getElementById('adminServiceText');
    if(waOld) waOld.textContent=c.whatsappDisplay;
    if(emOld) emOld.textContent=c.email;
    if(txOld) txOld.textContent=c.text;
  }

  async function chargerServiceClientConfig() {
    try {
      const res=await fetch(`${SUPABASE_URL}/rest/v1/service_client?select=id,whatsapp,email,texte&id=eq.1`,{headers:HEADERS});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const rows=await res.json();
      if(rows[0]) appliquerServiceClientPublic({whatsappDisplay:rows[0].whatsapp,email:rows[0].email,text:rows[0].texte});
      else appliquerServiceClientPublic(SERVICE_CLIENT_FALLBACK);
    } catch(e) {
      console.warn('[Service client] configuration distante indisponible, repli local.',e);
      appliquerServiceClientPublic(SERVICE_CLIENT_FALLBACK);
    }
  }

  async function enregistrerServiceClientConfig() {
    const msg=document.getElementById('adminServiceMsg');
    const btn=document.getElementById('adminServiceSave');
    const whatsapp=document.getElementById('adminServiceWhatsappInput')?.value.trim() || '';
    const email=document.getElementById('adminServiceEmailInput')?.value.trim() || '';
    const texte=document.getElementById('adminServiceTextInput')?.value.trim() || '';
    if(msg){msg.className='form-msg';msg.style.display='';}
    if(!session || session.role!=='admin') { if(msg){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';} return; }
    const wa=normaliserNumeroWhatsApp(whatsapp);
    if(!wa.display){if(msg){msg.textContent='Merci de renseigner le numéro WhatsApp.';msg.className='form-msg err';}return;}
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){if(msg){msg.textContent='Merci de renseigner une adresse e-mail valide.';msg.className='form-msg err';}return;}
    if(!texte){if(msg){msg.textContent='Merci de renseigner le texte du service client.';msg.className='form-msg err';}return;}
    if(btn){btn.disabled=true;btn.textContent='Enregistrement en cours…';}
    try {
      const res=await fetch(`${SUPABASE_URL}/rest/v1/service_client?id=eq.1`,{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({whatsapp:wa.display,email,texte,updated_at:new Date().toISOString()})
      });
      const body=await res.text();
      if(!res.ok) throw new Error('HTTP '+res.status+' — '+body);
      const rows=body?JSON.parse(body):[];
      appliquerServiceClientPublic(rows[0]?{whatsappDisplay:rows[0].whatsapp,email:rows[0].email,text:rows[0].texte}:{whatsappDisplay:wa.display,email,text:texte});
      if(msg){msg.textContent='Coordonnées du service client enregistrées avec succès.';msg.className='form-msg ok';}
    } catch(e) {
      if(msg){msg.textContent='Impossible d’enregistrer les coordonnées pour le moment. Veuillez réessayer.';msg.className='form-msg err';}
    } finally { if(btn){btn.disabled=false;btn.textContent='Enregistrer les coordonnées';} }
  }

  document.getElementById('adminServiceSave')?.addEventListener('click',enregistrerServiceClientConfig);
  chargerServiceClientConfig();

  // ---------- IDENTITÉ DE L'ACCUEIL (modifiable par l'administration) ----------
  const HOME_PRESENTATION_SETTING = 'home_presentation';
  const HOME_PRESENTATION_DEFAULT = {
    title: 'Une bibliothèque pensée pour tous',
    text: 'Aurore — Section Archives rassemble les ressources éducatives dans un espace clair, collaboratif et accessible. Chaque contribution est organisée et vérifiée afin de faciliter la recherche, le partage et l’accès au savoir. Ensemble, construisons une bibliothèque utile, vivante et ouverte à tous.'
  };
  function appliquerApercuPresentationAccueil(){
    const title = document.getElementById('adminHomePresentationTitle')?.value.trim() || HOME_PRESENTATION_DEFAULT.title;
    const text = document.getElementById('adminHomePresentationText')?.value.trim() || '';
    const pt = document.getElementById('adminHomePresentationPreviewTitle');
    const px = document.getElementById('adminHomePresentationPreviewText');
    if(pt) pt.textContent = title;
    if(px) px.textContent = text;
  }
  function appliquerPresentationAccueilLocale(title,text){
    const data = window.PRESENTATION_ADMIN_CONFIG || {};
    data.title = String(title || HOME_PRESENTATION_DEFAULT.title).trim() || HOME_PRESENTATION_DEFAULT.title;
    data.text = String(text || HOME_PRESENTATION_DEFAULT.text).trim() || HOME_PRESENTATION_DEFAULT.text;
    window.PRESENTATION_ADMIN_CONFIG = data;
    window.dispatchEvent(new CustomEvent('aurore:presentation-accueil-updated',{detail:data}));
  }
  async function chargerPresentationAccueilAdmin(){
    try{
      const res = await fetch(SUPABASE_URL+'/rest/v1/aurore_admin_interface_settings?select=setting_value&setting_key=eq.'+encodeURIComponent(HOME_PRESENTATION_SETTING),{headers:{'apikey':SUPABASE_ANON_KEY},cache:'no-store'});
      const rows = await res.json().catch(()=>[]);
      const value = rows?.[0]?.setting_value || HOME_PRESENTATION_DEFAULT;
      const title = String(value.title || HOME_PRESENTATION_DEFAULT.title);
      const text = String(value.text || HOME_PRESENTATION_DEFAULT.text);
      const ti=document.getElementById('adminHomePresentationTitle'), tx=document.getElementById('adminHomePresentationText');
      if(ti && document.activeElement!==ti) ti.value=title;
      if(tx && document.activeElement!==tx) tx.value=text;
      appliquerApercuPresentationAccueil();
      appliquerPresentationAccueilLocale(title,text);
    }catch(e){
      appliquerPresentationAccueilLocale(HOME_PRESENTATION_DEFAULT.title,HOME_PRESENTATION_DEFAULT.text);
      appliquerApercuPresentationAccueil();
      console.warn('[Accueil] identité administrable indisponible.',e);
    }
  }
  async function enregistrerPresentationAccueilAdmin(){
    const msg=document.getElementById('adminHomePresentationMsg'),btn=document.getElementById('adminHomePresentationSave');
    const title=document.getElementById('adminHomePresentationTitle')?.value.trim() || '';
    const text=document.getElementById('adminHomePresentationText')?.value.trim() || '';
    if(!session || session.role!=='admin'){if(msg){msg.textContent='Action réservée aux administrateurs.';msg.className='admin-home-presentation-msg';}return;}
    if(!title || !text){if(msg){msg.textContent='Le titre et le texte sont obligatoires.';msg.className='admin-home-presentation-msg';}return;}
    if(btn){btn.disabled=true;btn.textContent='Enregistrement…';}
    try{
      const body={setting_key:HOME_PRESENTATION_SETTING,setting_value:{title,text},updated_at:new Date().toISOString()};
      const res=await fetch(SUPABASE_URL+'/rest/v1/aurore_admin_interface_settings?on_conflict=setting_key',{
        method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(body)
      });
      if(!res.ok) throw new Error('HTTP '+res.status);
      appliquerPresentationAccueilLocale(title,text); appliquerApercuPresentationAccueil();
      if(msg){msg.textContent='Identité de l’accueil enregistrée et appliquée.';msg.className='admin-home-presentation-msg';}
    }catch(e){
      if(msg){msg.textContent='Impossible d’enregistrer l’identité de l’accueil.';msg.className='admin-home-presentation-msg';}
    }finally{if(btn){btn.disabled=false;btn.textContent="Enregistrer l'identité de l'accueil";}}
  }
  document.getElementById('adminHomePresentationTitle')?.addEventListener('input',appliquerApercuPresentationAccueil);
  document.getElementById('adminHomePresentationText')?.addEventListener('input',appliquerApercuPresentationAccueil);
  document.getElementById('adminHomePresentationSave')?.addEventListener('click',enregistrerPresentationAccueilAdmin);
  chargerPresentationAccueilAdmin();

  // ---------- ANNONCE ACCUEIL (module indépendant, table dédiée "annonce_accueil") ----------
  // Même motif que service_client ci-dessus : une seule ligne (id=1), lecture
  // publique avec la clé anon, écriture via headersAdmin(). Aucune régression si
  // la table est vide/absente : le bloc public reste simplement display:none.
  function appliquerApercuAnnonceAdmin() {
    const texte = document.getElementById('adminAnnonceInput')?.value.trim() || '';
    const preview = document.getElementById('adminAnnoncePreview');
    const previewTexte = document.getElementById('adminAnnoncePreviewTexte');
    const previewVide = document.getElementById('adminAnnoncePreviewVide');
    if (texte) {
      previewTexte.textContent = texte;
      preview.style.display = 'flex';
      previewVide.style.display = 'none';
    } else {
      preview.style.display = 'none';
      previewVide.style.display = 'block';
    }
  }
  document.getElementById('adminAnnonceInput')?.addEventListener('input', appliquerApercuAnnonceAdmin);

  function appliquerAnnoncePublic(message, active) {
    const bloc = document.getElementById('homeAnnonceBlock');
    const texte = document.getElementById('homeAnnonceTexte');
    const contenu = String(message || '').trim();
    if (active && contenu) {
      texte.textContent = contenu;
      bloc.style.display = 'flex';
    } else {
      bloc.style.display = 'none';
    }
  }

  async function chargerAnnonceAccueil() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil?select=id,message,active&id=eq.1`, { headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      const row = rows[0] || null;
      appliquerAnnoncePublic(row?.message, row?.active === true);
      const input = document.getElementById('adminAnnonceInput');
      const chk = document.getElementById('adminAnnonceActive');
      if (input && document.activeElement !== input) input.value = row?.message || '';
      if (chk) chk.checked = row?.active === true;
      appliquerApercuAnnonceAdmin();
    } catch (e) {
      console.warn('[Annonce accueil] configuration distante indisponible.', e);
      appliquerAnnoncePublic('', false); // reste masqué, aucune régression
    }
  }

  async function enregistrerAnnonceAccueil() {
    const msg = document.getElementById('adminAnnonceMsg');
    const btn = document.getElementById('adminAnnonceSave');
    const message = document.getElementById('adminAnnonceInput')?.value.trim() || '';
    const active = document.getElementById('adminAnnonceActive')?.checked || false;
    if (msg) { msg.className = 'form-msg'; msg.style.display = ''; }
    if (!session || session.role !== 'admin') { if (msg) { msg.textContent = 'Cette action est réservée aux administrateurs.'; msg.className = 'form-msg err'; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement en cours…'; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil?id=eq.1`, {
        method: 'PATCH', headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ message, active, updated_at: new Date().toISOString() })
      });
      let body = await res.text();
      let rows = body ? JSON.parse(body) : [];
      if (res.ok && rows.length === 0) {
        // Aucune ligne id=1 n'existe encore : on la crée (une seule fois).
        const resIns = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil`, {
          method: 'POST', headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ id: 1, message, active, updated_at: new Date().toISOString() })
        });
        body = await resIns.text();
        if (!resIns.ok) throw new Error('HTTP ' + resIns.status + ' — ' + body);
        rows = body ? JSON.parse(body) : [];
      } else if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' — ' + body);
      }
      appliquerAnnoncePublic(rows[0]?.message ?? message, rows[0]?.active ?? active);
      if (msg) { msg.textContent = 'Annonce enregistrée avec succès.'; msg.className = 'form-msg ok'; }
    } catch (e) {
      if (msg) { msg.textContent = "Impossible d’enregistrer l’annonce pour le moment. Veuillez réessayer."; msg.className = 'form-msg err'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  }
  document.getElementById('adminAnnonceSave')?.addEventListener('click', enregistrerAnnonceAccueil);
  chargerAnnonceAccueil();

  (function initialiserAccueilAuraster(){
    const icon = document.getElementById('homeSearchIcon');
    if (icon && typeof ICONS !== 'undefined') icon.innerHTML = ICONS.search;
    const input = document.getElementById('homeSearchInput');
    if (input) {
      input.addEventListener('input', () => {
        if (typeof window.programmerRechercheWiki === 'function') {
          window.programmerRechercheWiki(input.value);
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        const query = input.value.trim();
        if (!query) return;
        if (typeof window.auroreRechercherWikipedia === 'function') {
          window.auroreRechercherWikipedia(query);
          return;
        }
        lancerRecherche(query);
      });
    }
    chargerAnnoncesActives();
    // Le diagnostic réseau se lance désormais depuis le panneau visible de l'onglet
    // Publicités de l'admin (bouton #diagReseauBtn), pas automatiquement au chargement.
    document.getElementById('diagReseauBtn')?.addEventListener('click', diagnostiquerConnectiviteReseauMinimal);
    document.getElementById('diagPubBtn')?.addEventListener('click', afficherDiagnosticAffichagePublic);
    document.getElementById('diagRenduBtn')?.addEventListener('click', inspecterRenduAdSlots);
    document.getElementById('diagHomeBtn')?.addEventListener('click', diagnostiquerAccueilEtAdHome1);
    const adminPromoTab=document.querySelector('.admin-tab[data-tab="vitrine"]');
    if(adminPromoTab) adminPromoTab.addEventListener('click',chargerPublicitesAdmin);
    document.getElementById('adminPromoSave')?.addEventListener('click',enregistrerPublicite);
    document.getElementById('adminPromoCancelEdit')?.addEventListener('click',annulerModificationPublicite);
    document.getElementById('adminPromoFile')?.addEventListener('change', (e)=>{
      const f=e.target.files?.[0];
      if(!f) return;
      const reader=new FileReader();
      reader.onload=()=>{ document.getElementById('adminPromoPreview').innerHTML=`<img src="${reader.result}" alt="">`; };
      reader.readAsDataURL(f);
    });
  })();

  // ---------- LOGO DU SITE (configuration partagée entre tous les visiteurs) ----------
  (function(){
    const LOGO_CLE = 'site-logo-auraster';
    const LOGO_SETTING_KEY = 'site_logo';
    const LOGO_MIME_DEFAULT = 'image/png';
    const LOGO_URL_BASE = R2_PUBLIC_URL + '/' + LOGO_CLE;
    const LOGO_TYPES = ['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','image/svg+xml'];

    function appliquerLogo(url, mimeType) {
      const type = mimeType || LOGO_MIME_DEFAULT;
      const version = Date.now();
      const urlVersionnee = url + (url.includes('?') ? '&' : '?') + 'v=' + version;
      const cibles = [
        document.getElementById('brandLogo'),
        document.getElementById('adminLogoPreview'),
        document.getElementById('accessBrandLogo')
      ];
      cibles.forEach(conteneur => {
        if (!conteneur) return;
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = () => {
          img.alt = 'Eneles — Archives';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.display = 'block';
          img.style.objectFit = 'contain';
          conteneur.replaceChildren(img);
        };
        img.onerror = () => console.warn('[Logo] Image inaccessible :', url);
        img.src = urlVersionnee;
      });

      const manifest = document.querySelector('link[rel="manifest"]');
      if (manifest) manifest.href = 'manifest.json?v=' + version;
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(link => {
        link.href = urlVersionnee;
        link.type = type;
        if (link.rel === 'icon' && type === 'image/svg+xml') link.sizes = 'any';
      });
      document.querySelector('meta[property="og:image"]')?.setAttribute('content', urlVersionnee);
      document.querySelector('meta[property="og:image:type"]')?.setAttribute('content', type);
      document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', urlVersionnee);
      const preload = document.querySelector('link[rel="preload"][as="image"]');
      if (preload) preload.href = urlVersionnee;
      try {
        sessionStorage.setItem('aurore_logo_url', urlVersionnee);
        localStorage.setItem('aurore_logo_mime', type);
      } catch(e) {}
    }

    async function chargerLogoPartage() {
      try {
        const res = await fetch(
          SUPABASE_URL + '/rest/v1/aurore_admin_interface_settings?select=setting_value&setting_key=eq.' + encodeURIComponent(LOGO_SETTING_KEY),
          { headers: { 'apikey': SUPABASE_ANON_KEY }, cache: 'no-store' }
        );
        if (!res.ok) throw new Error('Lecture de la configuration du logo : HTTP ' + res.status);
        const rows = await res.json();
        const cfg = rows?.[0]?.setting_value;
        if (cfg?.url && typeof cfg.url === 'string') {
          appliquerLogo(cfg.url, LOGO_TYPES.includes(cfg.mimeType) ? cfg.mimeType : LOGO_MIME_DEFAULT);
        } else {
          appliquerLogo(LOGO_URL_BASE, LOGO_MIME_DEFAULT);
        }
      } catch(e) {
        console.warn('[Logo] Configuration partagée indisponible, logo par défaut conservé.', e);
        appliquerLogo(LOGO_URL_BASE, LOGO_MIME_DEFAULT);
      }
    }

    // Détecte le vrai format à partir de la signature binaire, pas du nom
    // choisi par Android (un SVG peut par exemple arriver sous l'extension .png).
    async function detecterTypeImage(fichier) {
      const head = new Uint8Array(await fichier.slice(0, 4096).arrayBuffer());
      const ascii = (debut, fin) => Array.from(head.slice(debut, fin), b => String.fromCharCode(b)).join('');
      const commencePar = (...octets) => octets.every((b, i) => head[i] === b);

      if (commencePar(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return 'image/png';
      if (commencePar(0xFF, 0xD8, 0xFF)) return 'image/jpeg';
      if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
      if (ascii(0, 2) === 'BM') return 'image/bmp';
      if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 32))) return 'image/avif';

      const texte = new TextDecoder('utf-8').decode(head).replace(/^\uFEFF/, '').trimStart();
      if (!texte.includes('\0') && /<svg(?:\s|>)/i.test(texte)) return 'image/svg+xml';

      throw new Error("Le contenu du fichier n'est pas une image PNG, JPG, WEBP, GIF, AVIF, BMP ou SVG reconnue. Vérifie le fichier sélectionné.");
    }

    async function verifierImage(url, typeAttendu) {
      const reponse = await fetch(url + '?verification=' + Date.now(), {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store'
      });
      if (!reponse.ok) {
        throw new Error('Le fichier est envoyé, mais sa lecture publique échoue (HTTP ' + reponse.status + ').');
      }
      const typeRecu = (reponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (typeRecu && typeRecu !== typeAttendu) {
        throw new Error('Le stockage renvoie le type ' + typeRecu + ' au lieu de ' + typeAttendu + '.');
      }
      const blob = await reponse.blob();
      if (!blob.size) throw new Error('Le stockage public renvoie un fichier vide (0 octet).');
      const image = new Image();
      const temporaire = URL.createObjectURL(blob);
      try {
        image.src = temporaire;
        if (typeof image.decode === 'function') await image.decode();
        else await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('Le navigateur ne sait pas décoder cette image.'));
        });
      } catch (_) {
        throw new Error('Le fichier est bien récupéré depuis R2, mais le navigateur ne peut pas décoder son image.');
      } finally {
        URL.revokeObjectURL(temporaire);
      }
      return true;
    }

    window.chargerLogoSite = chargerLogoPartage;
    window.AURORE_LOGO_URL = () => {
      try { return sessionStorage.getItem('aurore_logo_url') || LOGO_URL_BASE; }
      catch(e) { return LOGO_URL_BASE; }
    };

    document.getElementById('adminLogoSave')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('adminLogoFile');
      const msg = document.getElementById('adminLogoMsg');
      const btn = document.getElementById('adminLogoSave');
      const fichier = fileInput?.files?.[0];
      if (msg) { msg.className = 'form-msg'; msg.style.display = ''; }
      if (!fichier) {
        if (msg) { msg.textContent = "Choisis d'abord une image."; msg.className = 'form-msg err'; }
        return;
      }
      if (fichier.size <= 0) {
        if (msg) { msg.textContent = "Le fichier sélectionné est vide."; msg.className = 'form-msg err'; }
        return;
      }
      let typeFichier;
      try {
        typeFichier = await detecterTypeImage(fichier);
      } catch (erreurFormat) {
        if (msg) { msg.textContent = erreurFormat.message; msg.className = 'form-msg err'; }
        return;
      }
      const extensionsParType = {
        'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp',
        'image/gif':'gif', 'image/avif':'avif', 'image/bmp':'bmp',
        'image/svg+xml':'svg'
      };
      // L'extension envoyée à R2 suit le contenu réel : un SVG nommé .png
      // est donc stocké en .svg avec Content-Type: image/svg+xml.
      const extension = extensionsParType[typeFichier];
      if (!LOGO_TYPES.includes(typeFichier) || !extension) {
        if (msg) { msg.textContent = "Format non pris en charge. Utilise PNG, JPG, WEBP, GIF, AVIF, BMP ou SVG."; msg.className = 'form-msg err'; }
        return;
      }
      if (fichier.size > 5 * 1024 * 1024) {
        if (msg) { msg.textContent = "Image trop lourde (5 Mo maximum pour le logo)."; msg.className = 'form-msg err'; }
        return;
      }
      if (!session || session.role !== 'admin') {
        if (msg) { msg.textContent = "Cette action est réservée aux administrateurs."; msg.className = 'form-msg err'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
      try {
        const nomFichier = 'site-logo-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.' + extension;
        const url = R2_PUBLIC_URL + '/' + nomFichier;
        // Lire le fichier une seule fois et envoyer explicitement ses octets.
        // Certains sélecteurs Android exposent un File dont le flux direct est instable.
        const octets = await fichier.arrayBuffer();
        if (!octets || octets.byteLength !== fichier.size || octets.byteLength === 0) {
          throw new Error('Le fichier sélectionné est vide ou n’a pas pu être lu correctement sur cet appareil.');
        }
        const upload = await fetch(R2_WORKER_URL + '/' + nomFichier, {
          method: 'PUT',
          headers: { 'Content-Type': typeFichier },
          body: octets,
          cache: 'no-store'
        });
        const uploadBody = await upload.text().catch(() => '');
        if (!upload.ok) throw new Error('Envoi R2 refusé (HTTP ' + upload.status + '). ' + uploadBody);

        await verifierImage(url, typeFichier);

        const config = { url, mimeType: typeFichier, updatedAt: new Date().toISOString() };
        const save = await fetch(SUPABASE_URL + '/rest/v1/aurore_admin_interface_settings?on_conflict=setting_key', {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({
            setting_key: LOGO_SETTING_KEY,
            setting_value: config,
            updated_at: config.updatedAt
          })
        });
        const saveBody = await save.text().catch(() => '');
        if (!save.ok) throw new Error('Le fichier est envoyé mais sa configuration commune n’a pas été enregistrée (HTTP ' + save.status + '). ' + saveBody);

        appliquerLogo(url, typeFichier);
        try { await navigator.serviceWorker?.ready?.then(reg => reg.update()); } catch(e) {}
        if (fileInput) fileInput.value = '';
        if (msg) {
          msg.textContent = 'Logo changé et vérifié. Il est maintenant enregistré pour tous les visiteurs.';
          msg.className = 'form-msg ok';
        }
      } catch (err) {
        console.error('[Logo] Échec de mise à jour :', err);
        if (msg) {
          msg.textContent = err?.message || "Le logo n’a pas pu être activé. L’ancien logo est conservé.";
          msg.className = 'form-msg err';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Mettre à jour le logo'; }
      }
    });

    document.getElementById('adminLogoReset')?.addEventListener('click', async () => {
      const msg = document.getElementById('adminLogoMsg');
      const btn = document.getElementById('adminLogoReset');
      if (!session || session.role !== 'admin') {
        if (msg) { msg.textContent = "Cette action est réservée aux administrateurs."; msg.className = 'form-msg err'; }
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const updatedAt = new Date().toISOString();
        const res = await fetch(SUPABASE_URL + '/rest/v1/aurore_admin_interface_settings?on_conflict=setting_key', {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            setting_key: LOGO_SETTING_KEY,
            setting_value: { url: LOGO_URL_BASE, mimeType: LOGO_MIME_DEFAULT, updatedAt },
            updated_at: updatedAt
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + await res.text());
        appliquerLogo(LOGO_URL_BASE, LOGO_MIME_DEFAULT);
        if (msg) { msg.textContent = 'Logo d’origine réactivé pour tous les visiteurs.'; msg.className = 'form-msg ok'; }
      } catch (err) {
        if (msg) { msg.textContent = "Impossible de rétablir le logo d’origine : " + (err?.message || 'erreur inconnue'); msg.className = 'form-msg err'; }
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    chargerLogoPartage();
  })();

  // ---------- INITIALISATION ----------
  rendrePresentation();
  rendreAccueil();
  majFilAriane();
  chargerLogoSite();

  const VIDEO_TABLE='Videos';
  async function chargerVideosAccueil(){
    const section=document.getElementById('homeVideoSection'),player=document.getElementById('homeVideoPlayer'); if(!section||!player)return;
    try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?select=*&active=eq.true&order=updated_at.desc`,{headers:HEADERS});if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json(),v=rows[0];if(!v?.video_url){section.style.display='none';player.removeAttribute('src');player.load();return;}document.getElementById('homeVideoTitle').textContent=v.title||'Vidéo';const d=document.getElementById('homeVideoDesc');d.textContent=v.description||'';d.style.display=v.description?'block':'none';player.src=v.video_url;if(v.poster_url)player.poster=v.poster_url;else player.removeAttribute('poster');player.load();section.style.display='block';}catch(e){console.warn('[Vidéos] lecture indisponible.',e);section.style.display='none';}
  }
  function apercuVideoAdmin(url){const p=document.getElementById('adminVideoPreview');if(!p)return;if(!url){p.innerHTML='<span>Aucune vidéo sélectionnée.</span>';return;}p.innerHTML=`<video controls playsinline preload="metadata" src="${echapperHtmlPub(url)}"></video>`;}
  function resetVideoAdmin(){document.getElementById('adminVideoEditId').value='';document.getElementById('adminVideoFile').value='';document.getElementById('adminVideoTitleInput').value='';document.getElementById('adminVideoDescInput').value='';document.getElementById('adminVideoActive').checked=false;apercuVideoAdmin('');document.getElementById('adminVideoSave').textContent='Ajouter la vidéo';document.getElementById('adminVideoCancel').style.display='none';}
  document.getElementById('adminVideoFile')?.addEventListener('change',function(){const f=this.files?.[0];if(!f)return;const m=document.getElementById('adminVideoMsg');if(!['video/mp4','video/webm','video/ogg'].includes(f.type)){m.textContent='Ce format vidéo n’est pas pris en charge. Utilisez MP4, WEBM ou OGG.';m.className='form-msg err';this.value='';return;}if(f.size>100*1024*1024){m.textContent='Cette vidéo dépasse la taille maximale autorisée de 100 Mo.';m.className='form-msg err';this.value='';return;}apercuVideoAdmin(URL.createObjectURL(f));});
  async function chargerVideosAdmin(){const list=document.getElementById('adminVideoList');if(!list)return;list.innerHTML='<div class="pub-admin-empty">Chargement…</div>';try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?select=*&order=updated_at.desc`,{headers:headersAdmin()});if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json();document.getElementById('tabCountVideos').textContent=rows.length;list.innerHTML=rows.length?'':'<div class="pub-admin-empty">Aucune vidéo pour le moment.</div>';rows.forEach(v=>{const x=document.createElement('div');x.className='pub-admin-item';x.innerHTML=`<video src="${echapperHtmlPub(v.video_url||'')}" preload="metadata" muted playsinline></video><div class="pub-admin-item-body"><div class="pub-admin-item-title">${echapperHtmlPub(v.title||'(sans titre)')}</div>${v.description?`<div class="pub-admin-item-desc">${echapperHtmlPub(v.description)}</div>`:''}<div class="pub-admin-item-status ${v.active?'on':'off'}">${v.active?'● Active':'○ Désactivée'}</div></div><div class="pub-admin-item-actions"><button type="button" data-a="e">Modifier</button><button type="button" data-a="t">${v.active?'Désactiver':'Activer'}</button><button type="button" class="danger" data-a="d">Supprimer</button></div>`;x.querySelector('[data-a="e"]').onclick=()=>editVideo(v);x.querySelector('[data-a="t"]').onclick=()=>toggleVideo(v);x.querySelector('[data-a="d"]').onclick=()=>deleteVideo(v);list.appendChild(x);});}catch(e){list.innerHTML='<div class="pub-admin-empty">Impossible de charger les vidéos pour le moment. Veuillez réessayer.</div>';}}
  function editVideo(v){document.getElementById('adminVideoEditId').value=v.id;document.getElementById('adminVideoTitleInput').value=v.title||'';document.getElementById('adminVideoDescInput').value=v.description||'';document.getElementById('adminVideoActive').checked=v.active===true;document.getElementById('adminVideoFile').value='';apercuVideoAdmin(v.video_url||'');document.getElementById('adminVideoSave').textContent='Enregistrer les modifications';document.getElementById('adminVideoCancel').style.display='inline-flex';document.querySelector('.admin-video-manager')?.scrollIntoView({behavior:'smooth',block:'start'});}
  async function saveVideo(){const msg=document.getElementById('adminVideoMsg'),btn=document.getElementById('adminVideoSave');if(!session||session.role!=='admin'){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';return;}const id=document.getElementById('adminVideoEditId').value,title=document.getElementById('adminVideoTitleInput').value.trim(),description=document.getElementById('adminVideoDescInput').value.trim(),active=document.getElementById('adminVideoActive').checked,file=document.getElementById('adminVideoFile').files[0];if(!title){msg.textContent='Veuillez renseigner un titre pour continuer.';msg.className='form-msg err';return;}if(!id&&!file){msg.textContent='Veuillez sélectionner une vidéo avant de continuer.';msg.className='form-msg err';return;}btn.disabled=true;btn.textContent='Enregistrement en cours…';try{let url=null;if(file){const name='video_'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const up=await fetch(`${R2_WORKER_URL}/${name}`,{method:'PUT',headers:{'Content-Type':file.type},body:file});const b=await up.text().catch(()=> '');if(!up.ok)throw new Error('Le stockage a refusé la vidéo (HTTP '+up.status+'). '+b);url=`${R2_PUBLIC_URL}/${name}`;}const payload={title,description,active,updated_at:new Date().toISOString()};if(url)payload.video_url=url;let r;if(id){r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});}else{payload.video_url=url;payload.created_at=new Date().toISOString();r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});}if(!r.ok)throw new Error('HTTP '+r.status+' — '+await r.text());msg.textContent=id?'La vidéo a été mise à jour avec succès.':'La vidéo a été ajoutée avec succès.';msg.className='form-msg ok';resetVideoAdmin();await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){msg.textContent='Impossible d’enregistrer la vidéo pour le moment. Vérifiez les informations saisies et réessayez.';msg.className='form-msg err';}finally{btn.disabled=false;btn.textContent='Ajouter la vidéo';}}
  async function toggleVideo(v){try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(v.id)}`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({active:!v.active,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error('HTTP '+r.status);await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){document.getElementById('adminVideoMsg').textContent='Impossible de modifier l’état pour le moment. Veuillez réessayer.';}}
  async function deleteVideo(v){if(!confirm('Supprimer cette vidéo ?'))return;try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(v.id)}`,{method:'DELETE',headers:headersAdmin()});if(!r.ok)throw new Error('HTTP '+r.status);await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){document.getElementById('adminVideoMsg').textContent='Impossible de supprimer la vidéo pour le moment. Veuillez réessayer.';}}
  document.getElementById('adminVideoSave')?.addEventListener('click',saveVideo);document.getElementById('adminVideoCancel')?.addEventListener('click',resetVideoAdmin);

  const WELCOME_TABLE='message_bienvenue';
  async function chargerMessageBienvenue(){try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}?select=id,title,message,active&id=eq.1`,{headers:HEADERS});if(!r.ok)throw new Error('HTTP '+r.status);return (await r.json())[0]||null;}catch(e){console.warn('[Bienvenue] configuration indisponible.',e);return null;}}
  async function afficherBienvenueApresConnexion(sess){
    if(!sess)return;
    const cfg=await chargerMessageBienvenue(),modal=document.getElementById('welcomeModal');
    if(!cfg||cfg.active!==true||!cfg.message||!modal)return;
    const key='aurore_welcome_seen_'+(sess.id||sess.email||''),first=localStorage.getItem(key)!=='1';
    const title=document.getElementById('welcomeModalTitle'),textNode=document.getElementById('welcomeModalText');
    if(title)title.textContent=first?(cfg.title||'Bienvenue sur Aurore'):(cfg.title||'Content de vous revoir sur Aurore');
    if(textNode)textNode.textContent=String(cfg.message).replace(/\{nom\}/gi,sess.nom||'').replace(/\{email\}/gi,sess.email||'');
    const card=modal.querySelector('.welcome-modal-card');
    modal.hidden=false;
    modal.setAttribute('aria-hidden','false');
    if(card){
      card.classList.remove('is-opening');
      void card.offsetWidth;
      card.classList.add('is-opening');
    }
    localStorage.setItem(key,'1');
  }
  function fermerBienvenue(){const m=document.getElementById('welcomeModal');if(m){m.querySelector('.welcome-modal-card')?.classList.remove('is-opening');m.hidden=true;m.setAttribute('aria-hidden','true');}}
  function continuerDepuisBienvenue(){fermerBienvenue();const card=document.getElementById('homeRecentsCta');if(card){card.click();}else{afficherEcran('screen-recents');chargerDocumentsRecents();}}
  document.addEventListener('click',e=>{const target=e.target.closest?.('[data-welcome-close],#welcomeModalClose,#welcomeModalOk');if(!target)return;if(target.id==='welcomeModalOk')continuerDepuisBienvenue();else fermerBienvenue();});
  function initialiserEditeurBienvenueAdmin(){const panel=document.querySelector('.admin-tab-panel[data-panel="annonce"]');if(!panel||document.getElementById('adminWelcomeEditor'))return;const box=document.createElement('div');box.className='admin-service-editor';box.id='adminWelcomeEditor';box.innerHTML=`<div class="form-row"><label for="adminWelcomeTitle">Titre du message de bienvenue</label><input id="adminWelcomeTitle" type="text" maxlength="180" placeholder="Bienvenue sur Aurore"></div><div class="form-row"><label for="adminWelcomeMessage">Message</label><textarea id="adminWelcomeMessage" rows="7" maxlength="1200" placeholder="Bienvenue {nom} ! Nous sommes heureux de vous accueillir sur Aurore — Section Archives."></textarea><small>Variables disponibles : {nom} et {email}.</small></div><div class="form-row" style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="adminWelcomeActive" style="width:18px;height:18px;"><label for="adminWelcomeActive" style="margin:0;">Afficher après une connexion</label></div><div class="admin-promo-actions"><button type="button" class="admin-btn primary" id="adminWelcomeSave">Enregistrer le message de bienvenue</button></div><div class="form-msg" id="adminWelcomeMsg"></div>`;panel.appendChild(box);document.getElementById('adminWelcomeSave').onclick=saveWelcome;chargerMessageBienvenue().then(c=>{if(c){document.getElementById('adminWelcomeTitle').value=c.title||'';document.getElementById('adminWelcomeMessage').value=c.message||'';document.getElementById('adminWelcomeActive').checked=c.active===true;}});}
  async function saveWelcome(){const msg=document.getElementById('adminWelcomeMsg'),btn=document.getElementById('adminWelcomeSave');if(!session||session.role!=='admin'){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';return;}const title=document.getElementById('adminWelcomeTitle').value.trim()||'Bienvenue sur Aurore',message=document.getElementById('adminWelcomeMessage').value.trim(),active=document.getElementById('adminWelcomeActive').checked;if(!message){msg.textContent='Veuillez renseigner le message de bienvenue avant de continuer.';msg.className='form-msg err';return;}btn.disabled=true;try{const payload={id:1,title,message,active,updated_at:new Date().toISOString()};let r=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}?id=eq.1`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(payload)});if(!r.ok)throw new Error('HTTP '+r.status+' — '+await r.text());let body=await r.text().catch(()=> '');if(body===''||body==='[]'){const q=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});if(!q.ok)throw new Error('HTTP '+q.status+' — '+await q.text());}msg.textContent='Le message de bienvenue a été enregistré avec succès.';msg.className='form-msg ok';}catch(e){msg.textContent='Impossible d’enregistrer le message pour le moment. Veuillez réessayer.';msg.className='form-msg err';}finally{btn.disabled=false;}}
  initialiserEditeurBienvenueAdmin();document.querySelectorAll('.admin-tab').forEach(t=>t.addEventListener('click',()=>{if(t.dataset.tab==='videos')chargerVideosAdmin();if(t.dataset.tab==='annonce')initialiserEditeurBienvenueAdmin();}));chargerVideosAccueil();

