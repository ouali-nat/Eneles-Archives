# Eneles Atelier — déploiement durable

Ce dossier conserve les composants de TeXeR adaptés à Eneles : frontend, backend, compilateur TeX Live, documentation, cours, bibliothèque TikZ, ainsi que les modules impress, mobile et powerpoint. Les fichiers LICENSE MIT d’origine restent inchangés.

## Services persistants requis
- Frontend Next.js : racine `frontend/`, fichier `railway.toml`, contrôle `/api/health`.
- API NestJS : racine `backend/`, fichier `railway.toml`, contrôle `/health`, migration Prisma avant démarrage.
- Compilateur TeX Live : racine `compiler/`, Dockerfile et `railway.toml`, contrôle `/health`.
- PostgreSQL persistant, Redis si activé, et stockage objet S3/R2 persistant pour documents, PDF, images et fichiers de projet. Les disques temporaires d’un conteneur ne doivent pas être la seule copie des documents.

## Configuration
Frontend : `NEXT_PUBLIC_API_URL` = URL HTTPS publique de l’API ; `NEXT_PUBLIC_ENELES_PARENT_ORIGINS` = origines exactes du site mère ; `NEXT_PUBLIC_DOMAIN_NAME` = domaine public du frontend si nécessaire.

API : `DATABASE_URL`, `JWT_SECRET`, `ENELES_SUPABASE_URL`, `ENELES_SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, variables Redis, variables S3/R2, `COMPILER_URL` et le secret interne du compilateur. Voir `backend/.env.example` et `compiler/.env.example` pour les noms précis. Ne jamais enregistrer de secrets dans Git.

Le pont SSO reprend le jeton Google/Supabase du site mère, le fait vérifier par Supabase Auth côté serveur et échange cette identité contre une session Atelier révocable. Le jeton Atelier reste en mémoire dans le navigateur ; toutes les données demeurent protégées par l’API. Les origines des deux listes (`ALLOWED_ORIGINS` et `NEXT_PUBLIC_ENELES_PARENT_ORIGINS`) doivent correspondre aux domaines réels après le premier déploiement.

Toutes les formules commerciales et quotas d’abonnement sont supprimés. Les limites techniques (taille maximale des fichiers, durée de compilation, débit et capacité globale) restent nécessaires à la stabilité. L’IA hébergée exige un fournisseur et ses clés configurés ; un service externe peut facturer son usage indépendamment d’Eneles.

Ne pas remplacer l’URL provisoire de `atelier/config.js` avant que frontend, API, compilateur, base, stockage et secrets soient provisionnés. Puis contrôler les trois points de santé, l’échange Google, la création d’un projet, la compilation PDF et la récupération des fichiers après redéploiement.
