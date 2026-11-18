/* TeXeR — entrée isolée dans l'administration Eneles.
   Aucun appel API, aucune lecture de données utilisateur et aucune modification métier.
   Ce module prépare uniquement le point d'entrée et la cartographie de l'architecture. */
(function () {
  'use strict';

  const GRID_ID = 'adminCategoryGrid';
  const DETAIL_ID = 'adminDetail';
  const TAB_ID = 'eneles-texer-admin-tab';
  const PANEL_ID = 'eneles-texer-admin-panel';

  function createCard() {
    const card = document.createElement('button');
    card.id = TAB_ID;
    card.type = 'button';
    card.className = 'admin-tab admin-category-card';
    card.dataset.tab = 'texer';
    card.dataset.accent = 'bleu';
    card.setAttribute('role', 'tab');
    card.setAttribute('aria-controls', PANEL_ID);
    card.innerHTML = `
      <span class="admin-category-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 5.5h16M4 18.5h16M7 5.5v13M17 5.5v13" />
          <path d="m10 9 2-1 2 1-2 1-2-1Zm0 5 2-1 2 1-2 1-2-1Z" />
        </svg>
      </span>
      <span class="admin-category-title">TeXeR</span>
      <span class="admin-category-desc">Éditeur LaTeX et chaîne de production PDF</span>
    `;
    return card;
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'admin-tab-panel eneles-texer-panel';
    panel.dataset.panel = 'texer';
    panel.setAttribute('aria-labelledby', TAB_ID);
    panel.innerHTML = `
      <div class="etx-header">
        <div>
          <span class="etx-kicker">ENELES · MODULE TECHNIQUE</span>
          <h3>TeXeR</h3>
          <p>Édition LaTeX, collaboration, conversion et compilation de documents PDF.</p>
        </div>
        <span class="etx-status"><span class="etx-status-dot"></span> Intégration en préparation</span>
      </div>

      <div class="etx-notice" role="status">
        <strong>Phase actuelle : reproduction de l’architecture</strong>
        <span>Les dépôts sources officiels sont étudiés séparément. Aucun compte, fichier ou service Eneles n’est encore raccordé à TeXeR.</span>
      </div>

      <div class="etx-section-head">
        <h4>Architecture d’origine</h4>
        <span>3 services principaux</span>
      </div>
      <div class="etx-service-grid">
        <article class="etx-service-card">
          <span class="etx-service-index">01 · INTERFACE</span>
          <h5>Frontend</h5>
          <p>Application Next.js 16 et React 19 : éditeur CodeMirror 6, aperçu PDF, arborescence de fichiers, panneaux de travail et interface d’administration.</p>
          <a href="https://github.com/TeXeR-org/frontend" target="_blank" rel="noopener noreferrer">Dépôt source officiel</a>
        </article>
        <article class="etx-service-card">
          <span class="etx-service-index">02 · API</span>
          <h5>Backend</h5>
          <p>API NestJS 11 : authentification, projets, fichiers, versions, invitations, collaboration Yjs, conversions, stockage et journal d’audit.</p>
          <a href="https://github.com/TeXeR-org/backend" target="_blank" rel="noopener noreferrer">Dépôt source officiel</a>
        </article>
        <article class="etx-service-card">
          <span class="etx-service-index">03 · COMPILATION</span>
          <h5>Compiler</h5>
          <p>Service Express isolé avec TeX Live : compilation LaTeX, génération PDF, journaux, erreurs, bibliographies et traitements associés.</p>
          <a href="https://github.com/TeXeR-org/compiler" target="_blank" rel="noopener noreferrer">Dépôt source officiel</a>
        </article>
      </div>

      <div class="etx-section-head">
        <h4>Fonctionnalités à reproduire</h4>
        <span>Cartographie initiale</span>
      </div>
      <div class="etx-feature-list">
        <div class="etx-feature"><strong>Éditeur LaTeX</strong><span>Coloration syntaxique, autocomplétion, palette d’insertion et commandes.</span></div>
        <div class="etx-feature"><strong>Aperçu PDF et SyncTeX</strong><span>Compilation avec aperçu et navigation entre le code source et le PDF.</span></div>
        <div class="etx-feature"><strong>Projets et collaboration</strong><span>Fichiers multiples, rôles owner/editor/viewer, historique et collaboration temps réel Yjs.</span></div>
        <div class="etx-feature"><strong>Assistant et conversion</strong><span>Suggestions sous forme de modifications à accepter/refuser, conversion d’images et de PDF en LaTeX.</span></div>
        <div class="etx-feature"><strong>Bibliothèque</strong><span>Modèles de documents, ressources TikZ, exemples et aperçus précompilés.</span></div>
        <div class="etx-feature"><strong>Administration</strong><span>Comptes, sessions, usage IA, facturation, audit et état des services.</span></div>
      </div>

      <div class="etx-footer-note">
        <strong>Règle d’intégration</strong>
        <span>Conserver d’abord le comportement et les frontières techniques de TeXeR. Le frontend TeXeR interdit actuellement l’affichage en iframe et utilise sa propre authentification. Son lancement restera séparé; les raccordements à l’identité Eneles, aux comptes, au stockage et aux documents ne seront étudiés qu’après vérification de chaque composant.</span>
      </div>
    `;
    return panel;
  }

  function init() {
    const grid = document.getElementById(GRID_ID);
    const detail = document.getElementById(DETAIL_ID);
    if (!grid || !detail || document.getElementById(TAB_ID) || document.querySelector('[data-panel="texer"]')) return;

    const card = createCard();
    const panel = createPanel();
    grid.appendChild(card);
    detail.appendChild(panel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
