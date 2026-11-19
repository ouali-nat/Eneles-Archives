# Eneles Atelier — déploiement durable

Ce dossier conserve les composants de TeXeR adaptés à Eneles : frontend, backend, compilateur TeX Live, documentation, cours, bibliothèque TikZ, ainsi que les modules impress, mobile et powerpoint. Les fichiers LICENSE MIT d’origine restent inchangés.

## Architecture cible

- **Site mère Eneles** : reste hébergé sur le projet Vercel actuel.
- **Interface Atelier Next.js** : déployée sur Vercel depuis `services/eneles-atelier/frontend/`, puis intégrée au site mère par l’entrée Atelier (iframe contrôlée par les origines autorisées).
- **API NestJS** : service persistant séparé, racine `backend/`, contrôle `/health`, migrations Prisma avant démarrage.
- **Compilateur TeX Live** : service séparé, racine `compiler/`, contrôle `/health`. Il ne doit pas être exposé sans authentification interne.
- **SQL et identité** : projet Supabase Archives existant. Supabase Auth vérifie l’identité Google du site mère ; les tables Prisma d’Atelier résident dans le schéma privé `atelier`, isolé des tables publiques d’Archives.
- **Fichiers** : Cloudflare R2 via API S3, dans un bucket privé dédié à Atelier. Les documents publiés du site mère peuvent rester dans le bucket public `lsnb-documents`, mais les projets, PDF personnels et images privés d’Atelier ne doivent pas y être déposés.

## Configuration

### Frontend Vercel

- `NEXT_PUBLIC_API_URL` : URL HTTPS de l’API NestJS.
- `NEXT_PUBLIC_ENELES_PARENT_ORIGINS` : origines exactes du site mère Eneles.
- `NEXT_PUBLIC_DOMAIN_NAME` : domaine public du frontend Atelier si nécessaire.

Le projet Vercel du site mère reste indépendant ; son entrée Atelier doit pointer vers l’URL du frontend Atelier après son premier déploiement.

### API NestJS

- `DATABASE_URL` : chaîne de connexion Supabase **session pooler** (port 5432) du projet Archives, avec `schema=atelier`. Utiliser le mot de passe PostgreSQL uniquement dans les variables secrètes de l’hébergeur.
- `ENELES_SUPABASE_URL` : URL du même projet Supabase.
- `ENELES_SUPABASE_ANON_KEY` : clé publique/anon du projet, jamais la clé service-role.
- `JWT_SECRET`, `ALLOWED_ORIGINS`, `COMPILER_URL` et `COMPILER_INTERNAL_SECRET`.
- Redis selon le mode d’exécution.
- R2 : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_REGION=auto`. Créer un bucket **privé** `eneles-atelier-private` dans le même compte Cloudflare et créer une clé S3 limitée à ce bucket. Ne pas activer l’accès public r2.dev pour ce bucket.

Voir `backend/.env.example` et `compiler/.env.example` pour les noms précis. Ne jamais enregistrer de secrets dans Git ni les envoyer dans une conversation.

### API et compilateur

Le fichier `backend/railway.toml` applique `npx prisma migrate deploy` avant le démarrage. Le compilateur reste isolé et n’accepte que les appels internes authentifiés du backend. Les disques temporaires des conteneurs ne doivent jamais être la seule copie des documents.

Le pont SSO reçoit le jeton d’accès Supabase depuis le site mère, le fait vérifier par Supabase Auth côté serveur et échange cette identité contre une session Atelier révocable. Le jeton Atelier reste en mémoire dans le navigateur. Les origines de `ALLOWED_ORIGINS` et `NEXT_PUBLIC_ENELES_PARENT_ORIGINS` doivent correspondre aux domaines réels après déploiement.

Toutes les fonctionnalités commerciales et quotas d’abonnement sont désactivés. Les limites techniques (taille maximale des fichiers, durée de compilation, débit et capacité globale) restent nécessaires à la stabilité. L’IA hébergée exige un fournisseur et ses clés configurés ; un fournisseur externe peut facturer son usage indépendamment d’Eneles.

## Vérifications avant production

1. Déployer le frontend Atelier et renseigner son URL dans l’entrée du site mère.
2. Configurer les variables Supabase et R2 dans l’environnement privé de l’API.
3. Déployer l’API : les migrations créent les tables dans le schéma privé `atelier`.
4. Déployer le compilateur et vérifier le secret interne.
5. Tester la connexion Google, la création d’un projet, l’enregistrement, la compilation PDF, les liens temporaires de téléchargement et la récupération des fichiers après redéploiement.
6. Vérifier qu’aucun PDF personnel n’est accessible par une URL publique permanente.


## Worker Cloudflare de stockage privé

Le Worker `eneles-atelier-storage` sert de passerelle R2 facultative pour les opérations directes du navigateur. Son bucket attaché est `eneles-atelier-private`, sans domaine public `r2.dev`.

- URL de contrôle : `https://eneles-atelier-storage.oualikevin9.workers.dev/health`.
- Objets : `GET`, `HEAD`, `PUT` et `DELETE` sur `/v1/objects/{chemin-relatif}`.
- Authentification : jeton d'accès Supabase signé avec une clé asymétrique publiée par le JWKS du projet. Les jetons HS256 ou non vérifiables sont refusés.
- Isolation : la clé physique est préfixée automatiquement par `users/{auth.uid}/`; un utilisateur ne peut donc adresser que son propre espace.
- Taille maximale acceptée par objet : 100 MiB.
- CORS limité aux origines Eneles configurées dans le Worker.

**Vérification avant raccordement frontend :** ouvrir `/health` et vérifier `authKeys: "available"`. Si la réponse indique `no_asymmetric_keys`, le projet Supabase n'expose pas de clé JWKS asymétrique ; il faudra choisir une vérification serveur adaptée avant d'utiliser cette passerelle. Ne pas modifier la clé de signature JWT de production sans plan de rotation et de test des sessions.

Le backend NestJS conserve son accès direct S3 à R2 pour les fichiers gérés côté serveur. Cette passerelle Worker est distincte et ne remplace pas encore les appels du backend.
