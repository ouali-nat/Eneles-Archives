# Eneles Atelier — API

API NestJS 11 avec PostgreSQL/Prisma, Redis, stockage objet compatible S3, collaboration WebSocket et sessions d’atelier. Le service de compilation TeX Live est séparé du backend.

## Développement

```bash
npm ci
npm run start:dev
```

## Configuration requise

Voir `.env.example`. Les variables indispensables en production incluent `DATABASE_URL`, `JWT_SECRET`, `ENELES_SUPABASE_URL`, `ENELES_SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, les paramètres S3/R2 et `COMPILER_URL`. Configurez Redis selon le mode d’exécution. Ne jamais versionner de valeurs secrètes.

## Authentification Eneles

Le endpoint `POST /auth/eneles-sso` reçoit un jeton d’accès Supabase depuis l’iframe de l’atelier. Le backend le vérifie directement auprès de Supabase Auth et utilise uniquement l’identité confirmée retournée par Supabase. Il lie le compte existant par identifiant Supabase ou par adresse e-mail confirmée, puis émet une session propre à l’atelier. Les appels API et WebSocket utilisent cette session.

## Accès et quotas

Toutes les fonctionnalités sont ouvertes sans abonnement. Les quotas commerciaux de formule sont supprimés ; les limites techniques de taille, débit, durée et concurrence protègent la disponibilité du service. Les abonnements/checkout sont désactivés. Les fournisseurs IA externes restent soumis à leur configuration et conditions propres.

## Base de données

Appliquer les migrations Prisma avec `npx prisma migrate deploy` avant de lancer le service. Le dossier de stockage éphémère du conteneur ne doit jamais être la seule copie des projets ou PDF.
