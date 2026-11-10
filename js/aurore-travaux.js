
(function () {
  'use strict';

  const ROOT_ID = 'etw-root';
  const state = {
    documentId: 0,
    document: null,
    works: [],
    workById: new Map(),
    highlightedWorkId: 0,
    editorMode: false,
    toolsOpen: false,
    editingWork: null,
    draft: null,
    reportWorkId: 0,
    historyWork: null,
    dragActive: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    ballStartX: 0,
    ballStartY: 0
  };

  const $ = (selector, root) => (root || document).querySelector(selector);
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };

  function currentSession() {
    try { return typeof session !== 'undefined' ? session : null; } catch (_) { return null; }
  }
  function currentUserId() {
    const s = currentSession();
    return s && (s.id || (s.user && s.user.id)) || null;
  }
  function isModerator() {
    const role = String(currentSession()?.role || '').toLowerCase();
    return role === 'admin' || role === 'administrateur' || role === 'admin_limite';
  }
  function apiHeaders(extra) {
    const key = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
    const s = currentSession();
    const token = s && s.access_token ? s.access_token : key;
    return Object.assign({ apikey: key, Authorization: 'Bearer ' + token }, extra || {});
  }
  function apiUrl(path) {
    const base = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
    return base + '/rest/v1/' + path;
  }
  async function rest(path, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = apiHeaders(opts.headers || {});
    const response = await fetch(apiUrl(path), opts);
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (_) { data = raw; }
    }
    if (!response.ok) {
      const message = data && data.message ? data.message : (typeof data === 'string' ? data : 'HTTP ' + response.status);
      throw new Error(message);
    }
    return data;
  }
  function formatDate(value) {
    try {
      return new Date(value).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) { return ''; }
  }
  function typeLabel(type) {
    return ({
      contribution: 'Contribution',
      analyse: 'Analyse',
      commentaire: 'Commentaire',
      synthese: 'Synthèse',
      fiche_revision: 'Fiche de révision',
      etude_texte: 'Étude de texte',
      explication: 'Explication',
      exercice_corrige: 'Exercice corrigé',
      recherche: 'Recherche documentaire',
      dissertation: 'Dissertation',
      lecon: 'Leçon',
      correction: 'Correction',
      resume: 'Résumé',
      autre: 'Autre travail'
    })[type] || 'Contribution';
  }
  function requireLogin() {
    const signup = document.getElementById('accessSignupBtn');
    if (signup) signup.click();
    setTimeout(() => {
      const login = document.getElementById('showLoginBtn');
      if (login) login.click();
    }, 40);
    const message = document.getElementById('loginMessage');
    if (message) {
      message.textContent = 'Connectez-vous pour proposer ou modifier une contribution. La consultation reste ouverte.';
      message.className = 'access-message ok';
      message.style.display = 'block';
    }
  }

  function ensureRoot() {
    if ($('#' + ROOT_ID)) return;
    const root = create('section', 'etw-root');
    root.id = ROOT_ID;
    root.setAttribute('aria-label', 'Travaux collaboratifs');
    root.innerHTML =
      '<header class="etw-topbar">' +
        '<button type="button" class="etw-icon" id="etw-menu-trigger" aria-label="Options">···</button>' +
        '<button type="button" class="etw-icon" id="etw-back" aria-label="Retour">←</button>' +
        '<div class="etw-top-title"><strong>Travaux collaboratifs</strong><span id="etw-doc-mini">Eneles Archives</span></div>' +
      '</header>' +
      '<div class="etw-menu" id="etw-menu" hidden>' +
        '<button type="button" id="etw-start-edit">Passer en édition</button>' +
        '<button type="button" id="etw-refresh">Actualiser les contributions</button>' +
      '</div>' +
      '<main class="etw-stage" id="etw-stage">' +
        '<div class="etw-content">' +
          '<section class="etw-context"><span class="etw-kicker">Espace collaboratif</span><h1 id="etw-doc-title">Travaux sur le document</h1><p id="etw-doc-subtitle"></p></section>' +
          '<div class="etw-intro">Cet espace permet aux lecteurs d’enrichir le document avec des résumés, des leçons, des dissertations, des corrections et des explications complémentaires. Chaque publication est visible immédiatement et conserve son historique.</div>' +
          '<section><div class="etw-section-head"><h2>Contributions publiées</h2><span class="etw-count" id="etw-count"></span></div><div class="etw-work-list" id="etw-work-list"><div class="etw-state">Chargement des contributions…</div></div></section>' +
        '</div>' +
      '</main>' +
      '<button type="button" class="etw-float-ball" id="etw-float-ball" aria-label="Outils d’édition" hidden>+</button>' +
      '<section class="etw-tools" id="etw-tools" hidden><h3>Outils d’édition</h3><div class="etw-tool-grid">' +
        '<button type="button" data-add-block="heading">Ajouter un titre</button>' +
        '<button type="button" data-add-block="text">Zone de texte</button>' +
        '<button type="button" data-add-block="image">Ajouter une image</button>' +
        '<button type="button" class="etw-read-mode" id="etw-read-mode">Revenir en mode lecture</button>' +
      '</div></section>' +
      '<section class="etw-composer" id="etw-composer" hidden>' +
        '<h3 id="etw-composer-heading">Nouvelle contribution</h3>' +
        '<div class="etw-field"><label for="etw-draft-title">Titre de la contribution</label><input id="etw-draft-title" maxlength="180" placeholder="Ex. : Résumé du chapitre 1"></div>' +
        '<div class="etw-field"><label for="etw-draft-type">Type de travail</label><select id="etw-draft-type"><option value="contribution">Contribution générale</option><option value="analyse">Analyse</option><option value="commentaire">Commentaire</option><option value="synthese">Synthèse</option><option value="fiche_revision">Fiche de révision</option><option value="etude_texte">Étude de texte</option><option value="explication">Explication</option><option value="exercice_corrige">Exercice corrigé</option><option value="recherche">Recherche documentaire</option><option value="dissertation">Dissertation</option><option value="lecon">Leçon</option><option value="correction">Correction</option><option value="resume">Résumé</option><option value="autre">Autre</option></select></div>' +
        '<div id="etw-block-editor-list"></div>' +
        '<div id="etw-editor-message" class="etw-meta" aria-live="polite"></div>' +
        '<div class="etw-composer-actions"><button type="button" class="etw-secondary" id="etw-cancel-edit">Annuler</button><button type="button" class="etw-primary" id="etw-publish">Publier la contribution</button></div>' +
      '</section>' +
      '<section class="etw-history" id="etw-history" hidden><div class="etw-history-inner"><div class="etw-section-head"><h2>Historique des versions</h2><button type="button" class="etw-small-btn" id="etw-history-close">Fermer</button></div><div id="etw-history-list"></div></div></section>' +
      '<div class="etw-dialog-wrap" id="etw-dialog" hidden><form class="etw-dialog" id="etw-report-form"><h3>Signaler cette contribution</h3><p>Le signalement sera transmis aux administrateurs. Il ne sera pas affiché publiquement.</p><div class="etw-field"><label for="etw-report-reason">Motif</label><select id="etw-report-reason" required><option value="contenu_inapproprie">Contenu inapproprié</option><option value="plagiat">Plagiat ou copie non autorisée</option><option value="information_erronee">Information erronée</option><option value="spam">Spam ou publicité</option><option value="droits_auteur">Droits d’auteur</option><option value="autre">Autre motif</option></select></div><div class="etw-field"><label for="etw-report-details">Précisions (facultatif)</label><textarea id="etw-report-details" maxlength="1000" rows="3" placeholder="Expliquez brièvement le problème."></textarea></div><div class="etw-composer-actions"><button type="button" class="etw-secondary" id="etw-report-cancel">Annuler</button><button type="submit" class="etw-primary">Envoyer le signalement</button></div></form></div>';
    document.body.appendChild(root);
    bindRootEvents(root);
  }

  function openRoot() {
    const root = $('#' + ROOT_ID);
    if (!root) return;
    root.style.display = '';
    root.classList.add('is-open');
    root.removeAttribute('hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeRoot() {
    const root = $('#' + ROOT_ID);
    if (!root) return;
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    root.style.display = 'none';
    document.body.style.overflow = '';
    $('#etw-menu', root).hidden = true;
    $('#etw-tools', root).hidden = true;
    $('#etw-composer', root).hidden = true;
    $('#etw-float-ball', root).hidden = true;
    $('#etw-history', root).hidden = true;
    $('#etw-dialog', root).hidden = true;
    state.editorMode = false;
    state.toolsOpen = false;
    state.editingWork = null;
    state.draft = null;
  }

  function bindRootEvents(root) {
    $('#etw-menu-trigger', root).addEventListener('click', () => {
      $('#etw-menu', root).hidden = !$('#etw-menu', root).hidden;
    });
    $('#etw-back', root).addEventListener('click', closeRoot);
    $('#etw-refresh', root).addEventListener('click', async () => {
      $('#etw-menu', root).hidden = true;
      await loadWorks();
    });
    $('#etw-start-edit', root).addEventListener('click', () => {
      $('#etw-menu', root).hidden = true;
      enterEdit(null);
    });
    $('#etw-float-ball', root).addEventListener('click', () => {
      if (state.dragMoved) { state.dragMoved = false; return; }
      state.toolsOpen = !state.toolsOpen;
      $('#etw-tools', root).hidden = !state.toolsOpen;
    });
    root.querySelectorAll('[data-add-block]').forEach(button => {
      button.addEventListener('click', () => addBlock(button.dataset.addBlock));
    });
    $('#etw-read-mode', root).addEventListener('click', returnToReadMode);
    $('#etw-cancel-edit', root).addEventListener('click', returnToReadMode);
    $('#etw-publish', root).addEventListener('click', publishDraft);
    $('#etw-report-cancel', root).addEventListener('click', () => { $('#etw-dialog', root).hidden = true; });
    $('#etw-report-form', root).addEventListener('submit', submitReport);
    $('#etw-history-close', root).addEventListener('click', () => { $('#etw-history', root).hidden = true; });
    $('#etw-work-list', root).addEventListener('click', event => {
      const button = event.target.closest('[data-work-action]');
      if (!button) return;
      const action = button.dataset.workAction;
      const id = Number(button.dataset.workId);
      const work = state.workById.get(id);
      if (!work) return;
      if (action === 'report') openReport(id);
      if (action === 'edit') enterEdit(work);
      if (action === 'history') openHistory(work);
    });
    const ball = $('#etw-float-ball', root);
    ball.addEventListener('pointerdown', startBallDrag);
    document.addEventListener('pointermove', moveBallDrag);
    document.addEventListener('pointerup', stopBallDrag);
  }

  async function openWorks(documentId, highlightedId) {
    ensureRoot();
    state.documentId = Number(documentId);
    state.highlightedWorkId = Number(highlightedId || 0);
    if (!Number.isSafeInteger(state.documentId) || state.documentId <= 0) return;
    openRoot();
    $('#etw-work-list').innerHTML = '<div class="etw-state">Chargement des contributions…</div>';
    try {
      const docs = await rest('Document?select=id,Titre,Niveau,Classe&id=eq.' + state.documentId, { method: 'GET', cache: 'no-store' });
      state.document = Array.isArray(docs) ? docs[0] : null;
      if (!state.document) throw new Error('Ce document n’est pas disponible.');
      $('#etw-doc-title').textContent = 'Travaux sur le document';
      $('#etw-doc-mini').textContent = state.document.Titre || 'Document';
      $('#etw-doc-subtitle').textContent = [state.document.Titre, state.document.Niveau, state.document.Classe].filter(Boolean).join(' · ');
      await loadWorks();
    } catch (error) {
      $('#etw-work-list').innerHTML = '';
      $('#etw-work-list').appendChild(create('div', 'etw-state', error.message || 'Impossible d’ouvrir cet espace.'));
    }
  }

  async function loadWorks() {
    if (!state.documentId) return;
    try {
      const rows = await rest('travaux?select=*&document_id=eq.' + state.documentId + '&order=created_at.desc', { method: 'GET', cache: 'no-store' });
      state.works = Array.isArray(rows) ? rows : [];
      state.workById = new Map(state.works.map(work => [Number(work.id), work]));
      renderWorks();
    } catch (error) {
      $('#etw-work-list').innerHTML = '';
      $('#etw-work-list').appendChild(create('div', 'etw-state', 'Les contributions n’ont pas pu être chargées. ' + (error.message || '')));
    }
  }

  function renderBlocks(container, blocks) {
    const wrap = create('div', 'etw-work-blocks');
    (Array.isArray(blocks) ? blocks : []).forEach(block => {
      if (!block || typeof block !== 'object') return;
      if (block.type === 'heading') {
        wrap.appendChild(create('h4', '', block.text || ''));
      } else if (block.type === 'text') {
        wrap.appendChild(create('p', '', block.text || ''));
      } else if (block.type === 'image' && typeof block.url === 'string' && block.url.indexOf('https://') === 0) {
        const figure = create('figure');
        const img = create('img');
        img.src = block.url;
        img.alt = block.caption || 'Image ajoutée à la contribution';
        img.loading = 'lazy';
        figure.appendChild(img);
        if (block.caption) figure.appendChild(create('figcaption', '', block.caption));
        wrap.appendChild(figure);
      }
    });
    container.appendChild(wrap);
  }

  function renderWorks() {
    const list = $('#etw-work-list');
    if (!list) return;
    list.innerHTML = '';
    $('#etw-count').textContent = state.works.length + (state.works.length === 1 ? ' contribution' : ' contributions');
    if (!state.works.length) {
      list.appendChild(create('div', 'etw-empty', 'Aucune contribution pour le moment. Tu peux ouvrir le menu en haut de la page et passer en édition pour commencer.'));
      return;
    }
    state.works.forEach(work => {
      const card = create('article', 'etw-work-card' + (work.statut === 'masque' ? ' is-masked' : ''));
      const header = create('div', 'etw-work-card-head');
      const titleWrap = create('div');
      titleWrap.appendChild(create('h3', '', work.titre));
      titleWrap.appendChild(create('div', 'etw-meta', (work.auteur_nom || 'Contributeur') + ' · ' + formatDate(work.created_at)));
      header.appendChild(titleWrap);
      header.appendChild(create('span', 'etw-type', typeLabel(work.type)));
      card.appendChild(header);
      if (work.statut === 'masque') card.appendChild(create('div', 'etw-meta', 'Contribution masquée — visible uniquement pour son auteur et la modération.'));
      renderBlocks(card, work.contenu);
      const actions = create('div', 'etw-work-actions');
      if (work.statut === 'publie') {
        const report = create('button', 'etw-small-btn', 'Signaler');
        report.type = 'button'; report.dataset.workAction = 'report'; report.dataset.workId = work.id;
        actions.appendChild(report);
      }
      if (currentUserId() && currentUserId() === work.auteur_id && work.statut === 'publie') {
        const edit = create('button', 'etw-small-btn', 'Modifier');
        edit.type = 'button'; edit.dataset.workAction = 'edit'; edit.dataset.workId = work.id;
        actions.appendChild(edit);
      }
      const history = create('button', 'etw-small-btn', 'Historique');
      history.type = 'button'; history.dataset.workAction = 'history'; history.dataset.workId = work.id;
      actions.appendChild(history);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  function enterEdit(work) {
    if (!currentUserId() || !currentSession()?.access_token) {
      requireLogin();
      return;
    }
    if (work && work.auteur_id !== currentUserId() && !isModerator()) {
      alert('Tu peux modifier uniquement tes propres contributions.');
      return;
    }
    state.editorMode = true;
    state.editingWork = work || null;
    state.draft = work ? {
      title: work.titre || '',
      type: work.type || 'autre',
      blocks: (Array.isArray(work.contenu) ? work.contenu : []).map(block => ({
        key: Math.random().toString(36).slice(2),
        type: block.type,
        text: block.text || '',
        caption: block.caption || '',
        url: block.url || '',
        file: null
      }))
    } : { title: '', type: 'contribution', blocks: [] };
    const ball = $('#etw-float-ball');
    ball.style.left = '50%';
    ball.style.top = '50%';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
    ball.style.transform = 'translate(-50%, -50%)';
    $('#etw-composer').hidden = true;
    ball.hidden = false;
    $('#etw-tools').hidden = true;
    state.toolsOpen = false;
    $('#etw-composer').hidden = true;
    $('#etw-composer-heading').textContent = work ? 'Modifier la contribution' : 'Préparer une contribution';
    $('#etw-publish').textContent = work ? 'Enregistrer les modifications' : 'Publier la contribution';
    $('#etw-draft-title').value = state.draft.title;
    $('#etw-draft-type').value = state.draft.type;
    drawComposerBlocks();
  }

  function addBlock(type) {
    if (!state.editorMode || !state.draft) return;
    state.draft.blocks.push({ key: Math.random().toString(36).slice(2), type: type, text: '', caption: '', url: '', file: null });
    $('#etw-composer').hidden = false;
    $('#etw-tools').hidden = true;
    state.toolsOpen = false;
    drawComposerBlocks();
  }

  function drawComposerBlocks() {
    const list = $('#etw-block-editor-list');
    if (!list || !state.draft) return;
    const title = $('#etw-draft-title');
    const type = $('#etw-draft-type');
    title.value = state.draft.title;
    type.value = state.draft.type;
    title.oninput = () => { state.draft.title = title.value; };
    type.onchange = () => { state.draft.type = type.value; };
    list.innerHTML = '';
    state.draft.blocks.forEach((block, index) => {
      const box = create('div', 'etw-block-editor');
      const top = create('div', 'etw-block-editor-top');
      top.appendChild(create('span', '', block.type === 'heading' ? 'Titre' : block.type === 'image' ? 'Image' : 'Zone de texte'));
      const remove = create('button', 'etw-remove-block', 'Retirer');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        state.draft.blocks.splice(index, 1);
        drawComposerBlocks();
      });
      top.appendChild(remove);
      box.appendChild(top);
      if (block.type === 'heading' || block.type === 'text') {
        const field = block.type === 'heading' ? create('input') : create('textarea');
        field.value = block.text || '';
        field.placeholder = block.type === 'heading' ? 'Saisir le titre de cette partie' : 'Rédiger le contenu de cette partie…';
        field.maxLength = block.type === 'heading' ? 180 : 12000;
        field.addEventListener('input', () => { block.text = field.value; });
        box.appendChild(field);
      } else if (block.type === 'image') {
        const field = create('input');
        field.type = 'file';
        field.accept = 'image/jpeg,image/png,image/webp,image/gif';
        field.addEventListener('change', () => {
          const file = field.files && field.files[0];
          if (!file) return;
          block.file = file;
          const old = box.querySelector('img');
          if (old) old.remove();
          const preview = create('img', 'etw-image-preview');
          preview.src = URL.createObjectURL(file);
          preview.alt = 'Aperçu de l’image';
          box.appendChild(preview);
        });
        box.appendChild(field);
        const caption = create('input');
        caption.placeholder = 'Légende de l’image (facultatif)';
        caption.maxLength = 240;
        caption.value = block.caption || '';
        caption.addEventListener('input', () => { block.caption = caption.value; });
        box.appendChild(caption);
        if (block.url && !block.file) {
          const preview = create('img', 'etw-image-preview');
          preview.src = block.url;
          preview.alt = 'Image déjà ajoutée';
          box.appendChild(preview);
        }
      }
      list.appendChild(box);
    });
  }

  async function uploadImage(file) {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Format d’image non pris en charge.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Chaque image doit peser 5 Mo ou moins.');
    const uid = currentUserId();
    if (!uid) throw new Error('Connecte-toi pour ajouter une image.');
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
    const path = uid + '/' + state.documentId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extension;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(SUPABASE_URL + '/storage/v1/object/travaux-images/' + encodedPath, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': file.type, 'x-upsert': 'false' }),
      body: file
    });
    if (!response.ok) throw new Error('Le téléversement de l’image a échoué (HTTP ' + response.status + ').');
    return SUPABASE_URL + '/storage/v1/object/public/travaux-images/' + encodedPath;
  }

  async function publishDraft() {
    if (!state.draft || !currentUserId()) { requireLogin(); return; }
    const title = String($('#etw-draft-title').value || '').trim();
    const type = $('#etw-draft-type').value || 'autre';
    if (title.length < 3) { alert('Ajoute un titre d’au moins 3 caractères.'); return; }
    const button = $('#etw-publish');
    const isEditing = Boolean(state.editingWork);
    const message = $('#etw-editor-message');
    button.disabled = true;
    button.textContent = 'Publication…';
    message.textContent = 'Préparation du contenu…';
    try {
      const blocks = [];
      for (const block of state.draft.blocks) {
        if (block.type === 'heading' || block.type === 'text') {
          const value = String(block.text || '').trim();
          if (value) blocks.push({ type: block.type, text: value });
        } else if (block.type === 'image') {
          let url = block.url || '';
          if (block.file) {
            message.textContent = 'Envoi de l’image…';
            url = await uploadImage(block.file);
          }
          if (url) blocks.push({ type: 'image', url: url, caption: String(block.caption || '').trim() });
        }
      }
      if (!blocks.length) throw new Error('Ajoute au moins un titre, un texte ou une image.');
      const s = currentSession();
      const userMeta = s && s.user && s.user.user_metadata ? s.user.user_metadata : {};
      const authorName = String((s && s.nom) || userMeta.full_name || userMeta.name || 'Contributeur').trim().slice(0, 80);
      const payload = {
        titre: title,
        type: type,
        contenu: blocks,
        updated_at: new Date().toISOString()
      };
      let result;
      if (state.editingWork) {
        result = await rest('travaux?id=eq.' + state.editingWork.id + '&auteur_id=eq.' + encodeURIComponent(currentUserId()), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        });
      } else {
        payload.document_id = state.documentId;
        payload.auteur_id = currentUserId();
        payload.auteur_nom = authorName || 'Contributeur';
        payload.statut = 'publie';
        result = await rest('travaux', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        });
      }
      if (!Array.isArray(result) || !result.length) throw new Error('La contribution n’a pas été enregistrée. Vérifie tes droits puis réessaie.');
      $('#etw-editor-message').textContent = 'Contribution publiée. Elle est maintenant visible par les lecteurs.';
      state.editorMode = false;
      state.editingWork = null;
      state.draft = null;
      $('#etw-composer').hidden = true;
      $('#etw-tools').hidden = true;
      $('#etw-float-ball').hidden = true;
      await loadWorks();
    } catch (error) {
      message.textContent = error.message || 'La publication a échoué.';
      alert(error.message || 'La publication a échoué.');
    } finally {
      button.disabled = false;
      button.textContent = isEditing ? 'Enregistrer les modifications' : 'Publier la contribution';
    }
  }

  function returnToReadMode() {
    if (state.draft && (state.draft.title || state.draft.blocks.length)) {
      if (!confirm('Quitter le mode édition et abandonner les modifications non publiées ?')) return;
    }
    state.editorMode = false;
    state.editingWork = null;
    state.draft = null;
    state.toolsOpen = false;
    $('#etw-float-ball').hidden = true;
    $('#etw-tools').hidden = true;
    $('#etw-composer').hidden = true;
  }

  function openReport(workId) {
    state.reportWorkId = Number(workId);
    $('#etw-report-details').value = '';
    $('#etw-dialog').hidden = false;
  }
  async function submitReport(event) {
    event.preventDefault();
    if (!state.reportWorkId) return;
    const button = $('#etw-report-form button[type="submit"]');
    button.disabled = true;
    try {
      await rest('signalements_travaux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          travail_id: state.reportWorkId,
          signale_par: currentUserId(),
          motif: $('#etw-report-reason').value,
          details: String($('#etw-report-details').value || '').trim() || null
        })
      });
      $('#etw-dialog').hidden = true;
      alert('Signalement transmis aux administrateurs. Merci de contribuer à la qualité de cet espace.');
    } catch (error) {
      alert(error.message || 'Le signalement n’a pas pu être transmis.');
    } finally { button.disabled = false; }
  }

  async function openHistory(work) {
    state.historyWork = work;
    const panel = $('#etw-history');
    const list = $('#etw-history-list');
    list.innerHTML = '<div class="etw-state">Chargement de l’historique…</div>';
    panel.hidden = false;
    try {
      const rows = await rest('versions_travaux?select=*&travail_id=eq.' + work.id + '&order=numero.desc', { method: 'GET', cache: 'no-store' });
      list.innerHTML = '';
      if (!Array.isArray(rows) || !rows.length) {
        list.appendChild(create('div', 'etw-state', 'Aucune version archivée pour le moment.'));
        return;
      }
      rows.forEach(version => {
        const card = create('div', 'etw-history-row');
        card.appendChild(create('strong', '', 'Version ' + version.numero));
        card.appendChild(create('div', 'etw-meta', formatDate(version.created_at)));
        card.appendChild(create('div', 'etw-meta', version.titre || 'Sans titre'));
        const allowed = isModerator();
        if (allowed) {
          const restore = create('button', 'etw-small-btn', 'Créer une nouvelle version depuis celle-ci');
          restore.type = 'button';
          restore.addEventListener('click', () => restoreVersion(work, version));
          card.appendChild(restore);
        }
        list.appendChild(card);
      });
    } catch (error) {
      list.innerHTML = '';
      list.appendChild(create('div', 'etw-state', error.message || 'Historique indisponible.'));
    }
  }
  async function restoreVersion(work, version) {
    if (!isModerator()) {
      alert('Seuls les modérateurs peuvent rétablir un contenu antérieur. Les lecteurs et contributeurs ne peuvent pas remplacer la version commune.');
      return;
    }
    if (!confirm('Créer une nouvelle version à partir de la version ' + version.numero + ' ? La version actuelle restera dans l’historique.')) return;
    try {
      const result = await rest('travaux?id=eq.' + work.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          titre: version.titre,
          type: version.type,
          contenu: version.contenu,
          updated_at: new Date().toISOString()
        })
      });
      if (!Array.isArray(result) || !result.length) throw new Error('Restauration non autorisée.');
      $('#etw-history').hidden = true;
      await loadWorks();
    } catch (error) { alert(error.message || 'La restauration a échoué.'); }
  }

  function startBallDrag(event) {
    const ball = $('#etw-float-ball');
    if (event.button !== undefined && event.button !== 0) return;
    state.dragActive = true;
    state.dragMoved = false;
    const rect = ball.getBoundingClientRect();
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.ballStartX = rect.left;
    state.ballStartY = rect.top;
    ball.setPointerCapture?.(event.pointerId);
  }
  function moveBallDrag(event) {
    if (!state.dragActive) return;
    const dx = event.clientX - state.dragStartX;
    const dy = event.clientY - state.dragStartY;
    if (Math.abs(dx) + Math.abs(dy) > 5) state.dragMoved = true;
    if (!state.dragMoved) return;
    const ball = $('#etw-float-ball');
    const maxX = Math.max(8, window.innerWidth - ball.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - ball.offsetHeight - 8);
    const left = Math.min(maxX, Math.max(8, state.ballStartX + dx));
    const top = Math.min(maxY, Math.max(8, state.ballStartY + dy));
    ball.style.left = left + 'px';
    ball.style.top = top + 'px';
    ball.style.transform = 'none';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
  }
  function stopBallDrag() {
    state.dragActive = false;
  }

  async function loadAdminReports() {
    const root = $('#adminTravauxReportsRoot');
    if (!root) return;
    const list = $('#adminListTravauxReports');
    const count = $('#adminCountTravauxReports');
    if (!list) return;
    list.innerHTML = '<div class="etw-state">Chargement des signalements…</div>';
    try {
      const rows = await rest('signalements_travaux?select=id,travail_id,motif,details,statut,created_at,travaux(id,titre,type,document_id,statut,auteur_nom)&statut=neq.traite&order=created_at.desc', { method: 'GET', cache: 'no-store' });
      const reports = Array.isArray(rows) ? rows : [];
      if (count) count.textContent = String(reports.length);
      list.innerHTML = '';
      if (!reports.length) {
        list.appendChild(create('div', 'etw-state', 'Aucun signalement de contribution à traiter.'));
        return;
      }
      reports.forEach(report => {
        const work = report.travaux || {};
        const card = create('article', 'etw-admin-report-card');
        card.appendChild(create('strong', '', work.titre || ('Contribution #' + report.travail_id)));
        card.appendChild(create('div', 'meta', typeLabel(work.type) + ' · Motif : ' + report.motif + ' · ' + formatDate(report.created_at)));
        if (report.details) card.appendChild(create('p', 'meta', report.details));
        card.appendChild(create('div', 'meta', 'Auteur : ' + (work.auteur_nom || 'Contributeur') + ' · Statut : ' + (work.statut || 'inconnu')));
        const actions = create('div', 'etw-admin-report-actions');
        const open = create('button', '', 'Ouvrir');
        open.type = 'button';
        open.addEventListener('click', () => openWorks(work.document_id, work.id));
        actions.appendChild(open);
        if (work.statut === 'masque') {
          const restore = create('button', '', 'Rétablir la contribution');
          restore.type = 'button';
          restore.addEventListener('click', () => moderateWork(work.id, false));
          actions.appendChild(restore);
        } else {
          const hide = create('button', 'danger', 'Masquer la contribution');
          hide.type = 'button';
          hide.addEventListener('click', () => moderateWork(work.id, true));
          actions.appendChild(hide);
        }
        const treat = create('button', '', 'Clôturer le signalement');
        treat.type = 'button';
        treat.addEventListener('click', () => closeReport(report.id));
        actions.appendChild(treat);
        card.appendChild(actions);
        list.appendChild(card);
      });
    } catch (error) {
      if (count) count.textContent = '—';
      list.innerHTML = '';
      list.appendChild(create('div', 'etw-state', 'Accès aux signalements refusé ou service indisponible. ' + (error.message || '')));
    }
  }

  async function moderateWork(workId, hide) {
    const question = hide ? 'Masquer cette contribution pour les lecteurs ? Son historique restera conservé.' : 'Rétablir cette contribution pour tous les lecteurs ?';
    if (!confirm(question)) return;
    try {
      const uid = currentUserId();
      const payload = hide
        ? { statut: 'masque', moderation_note: 'Masquée depuis l’espace Admin', masked_at: new Date().toISOString(), masked_by: uid }
        : { statut: 'publie', moderation_note: null, masked_at: null, masked_by: null };
      const rows = await rest('travaux?id=eq.' + workId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      if (!Array.isArray(rows) || !rows.length) throw new Error('Action non autorisée.');
      await loadAdminReports();
    } catch (error) { alert(error.message || 'La modération a échoué.'); }
  }
  async function closeReport(reportId) {
    if (!confirm('Clôturer ce signalement ? Il restera conservé dans la base.')) return;
    try {
      await rest('signalements_travaux?id=eq.' + reportId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ statut: 'traite' })
      });
      await loadAdminReports();
    } catch (error) { alert(error.message || 'Impossible de clôturer le signalement.'); }
  }

  function ensureWorksBadges(container) {
    if (!container) return;
    const badges = [];
    if (container.matches && container.matches('.document-views-badge')) badges.push(container);
    if (container.querySelectorAll) badges.push(...container.querySelectorAll('.document-views-badge'));
    badges.forEach(view => {
      const id = Number(view.dataset.documentId);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      const parent = view.parentElement;
      if (!parent || parent.querySelector('[data-open-document-works][data-document-id="' + id + '"]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'document-works-badge';
      button.dataset.openDocumentWorks = '';
      button.dataset.documentId = String(id);
      button.title = 'Consulter les travaux associés';
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20"/><path d="M8 7h8M8 10.5h6"/></svg><span>Travaux</span>';
      view.insertAdjacentElement('afterend', button);
    });
  }

  const worksBadgeObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.matches?.('.document-views-badge') || node.querySelector?.('.document-views-badge')) ensureWorksBadges(node);
    }));
  });
  if (document.body) {
    worksBadgeObserver.observe(document.body, { childList: true, subtree: true });
    ensureWorksBadges(document);
  }

  document.addEventListener('click', event => {
    const openButton = event.target.closest('[data-open-document-works]');
    if (openButton) {
      event.preventDefault();
      openWorks(Number(openButton.dataset.documentId));
      return;
    }
    if (event.target.closest('[data-tab="reclamations"]')) {
      setTimeout(loadAdminReports, 180);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#' + ROOT_ID)?.classList.contains('is-open')) {
      if (!$('#etw-dialog').hidden) $('#etw-dialog').hidden = true;
      else if (!$('#etw-history').hidden) $('#etw-history').hidden = true;
      else if (!$('#etw-menu').hidden) $('#etw-menu').hidden = true;
      else if (state.editorMode) returnToReadMode();
      else closeRoot();
    }
  });
  window.auroreOuvrirTravauxDocument = openWorks;
  window.auroreChargerSignalementsTravauxAdmin = loadAdminReports;
  ensureRoot();
})();