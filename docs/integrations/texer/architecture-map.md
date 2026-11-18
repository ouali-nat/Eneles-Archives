# TeXeR — cartographie de l’architecture source

État au 18 novembre 2026. Cette note décrit les dépôts publics étudiés avant raccordement à Eneles.

## Dépôts principaux

| Dépôt | Rôle | Architecture confirmée |
|---|---|---|
| [frontend](https://github.com/TeXeR-org/frontend) | Interface web, site public, éditeur, bibliothèques, PDF et console admin | Next.js 16, React 19, TypeScript, CodeMirror 6, PDF.js/React-PDF, Yjs et Socket.IO |
| [backend](https://github.com/TeXeR-org/backend) | API et logique applicative | NestJS 11, Prisma, PostgreSQL, Redis optionnel, stockage compatible S3, Resend, Stripe |
| [compiler](https://github.com/TeXeR-org/compiler) | Compilation LaTeX isolée | Node.js/Express, Docker, TeX Live 2024, pdflatex, xelatex, lualatex et latex |

## Dépendances et flux principaux

1. Le frontend appelle l’API par `lib/api/*`. Les requêtes passent par `apiFetch`, qui envoie les cookies HttpOnly avec `credentials: include`.
2. L’API porte l’authentification, les sessions, les projets multi-fichiers, les droits de collaboration, l’historique, les conversions, les métadonnées PDF, les modèles et les ressources TikZ.
3. Le backend transmet les travaux de compilation au microservice Compiler. Le navigateur ne reçoit pas de secret interne de compilation.
4. PostgreSQL conserve les données métier; Redis est optionnel; deux espaces de stockage objet sont prévus pour les ressources et les résultats de compilation.
5. Yjs et Socket.IO assurent la collaboration en temps réel; le backend persiste les mises à jour.

## Modules frontend relevés

- `(site)`: accueil, documentation, bibliothèque, TikZ, modèles, tarifs et pages légales.
- `(auth)`: connexion et inscription.
- `(user)`: tableau de bord, projets/éditeur, extraits, PDF, statistiques et paramètres.
- `admin`: utilisateurs, sessions, usage IA, facturation, contenus, stockage, e-mails, audit et état du système.
- `components/editor`: CodeMirror, aperçu PDF, arbre de fichiers, assistant IA, commentaires, SyncTeX, panneaux de travail et dessin TikZ.

## Sécurité observée dans les documents source

- Connexion sans mot de passe via code e-mail, échange contre JWT et cookie HttpOnly; TOTP est disponible.
- Les ressources sont limitées au propriétaire/projet; les ressources non accessibles répondent 404.
- Les appels du backend au Compiler utilisent un secret interne; les clés de clients externes sont prévues pour rester côté serveur.
- Le panneau admin est contrôlé par l’API et son accès est limité aux comptes administrateurs.

## Vérification de la production publique — 18 novembre 2026

Les contrôles HTTP exécutés depuis Termux ont obtenu les résultats suivants :

- `https://texer.org/` : HTTP 200.
- `https://api.texer.org/health` : HTTP 200, état `healthy`, base de données indiquée `connected`.
- `https://compile.texer.org/health` : HTTP 200, état `ok`; moteurs `pdflatex`, `xelatex`, `lualatex` et `latex`; 0 compilation active, 0 en attente, capacité annoncée de 8.

Le contrôle est ponctuel et ne remplace pas une supervision durable. Aucun identifiant, secret ou jeton de production n’a été lu ni modifié.

## Frontière d’intégration avec Eneles

Eneles Archives est une application web statique organisée autour de index.html, CSS et JavaScript. TeXeR reste une application Next.js distincte, avec une API et un compilateur séparés. Pour conserver son architecture et éviter de réécrire l’éditeur dans Archives, un point d’accès dédié est placé dans la dernière section de l’accueil, après l’espace personnel. Il ouvre l’instance TeXeR de développement, et non le site officiel.

La politique CSP observée sur la production de `texer.org` annonce `frame-ancestors 'self' https://t.texer.org`; le domaine Eneles n’y figure pas. L’intégration ne doit donc pas reposer sur un iframe sans modification explicite et auditée de cette politique. L’authentification TeXeR (code e-mail, JWT et cookie HttpOnly) est distincte de l’authentification Supabase d’Eneles; aucun partage de session ne doit être supposé.

## État de la récupération

- Récupérés localement dans Termux : `frontend`, `backend`, `compiler`, `docs`, `learn` et `library` (clones shallow, branche source `main`).
- Les sources de contenu attendues par `scripts/sync-content.mjs` sont présentes : navigation des docs, des cours et de la bibliothèque.
- La première tentative de récupération a subi des coupures réseau; les six clones ont ensuite été récupérés avec succès.

## Décision d’intégration provisoire

Ne pas fusionner le backend TeXeR avec Supabase ni faire pointer le compilateur vers le navigateur. Préserver les trois services et leurs limites tant que l’inventaire n’est pas terminé. Les raccordements Eneles (identité, comptes, stockage, documents et droits) feront l’objet d’une phase distincte, avec tests isolés.


## Instance de développement Eneles

L’instance de test actuelle est démarrée dans un Vercel Sandbox temporaire, avec une base PostgreSQL dédiée, Redis, un émulateur S3 de développement et le compilateur TeX Live. Les comptes et projets de démonstration proviennent du seed backend/prisma/seed-dev.ts. Elle ne réutilise ni la base ni le stockage d’Eneles et n’est pas une instance de production. Le plan Hobby limite la durée d’une session Sandbox active ; le lien d’essai de l’accueil n’est donc pas une adresse permanente.

Pour une mise en service durable, il reste à provisionner des services persistants, configurer l’envoi des codes e-mail et valider le comportement de compilation longue durée. Aucun raccordement d’identité, de documents, de droits ou de stockage Eneles n’est activé.
