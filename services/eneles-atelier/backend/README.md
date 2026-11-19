# Eneles Atelier — API

API NestJS 11 avec Supabase Postgres/Prisma (schéma privé `atelier`), Supabase Auth pour l’identité Eneles, Redis, Cloudflare R2 privé, collaboration WebSocket et sessions d’atelier. Le service de compilation TeX Live est séparé du backend.

## Développement

```bash
npm ci
npm run start:dev
```

## Configuration requise

Voir `.env.example`. Les variables indispensables en production incluent `DATABASE_URL` (Supabase session pooler, port 5432, `schema=atelier`), `JWT_SECRET`, `ENELES_SUPABASE_URL`, `ENELES_SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, les paramètres `R2_*` et `COMPILER_URL`. Configurez Redis selon le mode d’exécution. Utilisez un bucket R2 privé dédié aux fichiers Atelier ; ne réutilisez pas le bucket public de documents publiés pour les fichiers personnels. Ne jamais versionner de valeurs secrètes.

## Authentification Eneles

Le endpoint `POST /auth/eneles-sso` reçoit un jeton d’accès Supabase depuis l’iframe de l’atelier. Le backend le vérifie directement auprès de Supabase Auth et utilise uniquement l’identité confirmée retournée par Supabase. Il lie le compte existant par identifiant Supabase ou par adresse e-mail confirmée, puis émet une session propre à l’atelier. Les appels API et WebSocket utilisent cette session.

## Accès et quotas

Toutes les fonctionnalités sont ouvertes sans abonnement. Les quotas commerciaux de formule sont supprimés ; les limites techniques de taille, débit, durée et concurrence protègent la disponibilité du service. Les abonnements/checkout sont désactivés. Les fournisseurs IA externes restent soumis à leur configuration et conditions propres.

## Base de données

Appliquer les migrations Prisma avec `npx prisma migrate deploy` avant de lancer le service. Elles créent les tables dans le schéma privé `atelier`, non exposé au Data API public. Le schéma `atelier` doit exister avant le premier `migrate deploy`. Le dossier de stockage éphémère du conteneur ne doit jamais être la seule copie des projets ou PDF.
