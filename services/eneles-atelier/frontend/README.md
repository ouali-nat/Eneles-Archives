# Eneles Atelier — frontend

Application Next.js de l’atelier scientifique Eneles. Elle est intégrée au site mère par `/atelier/` et reçoit sa session Google depuis Eneles via un échange SSO vérifié par l’API.

## Développement

```bash
npm ci
NEXT_PUBLIC_API_URL=http://localhost:2161 npm run dev
```

Le backend et le compilateur doivent être démarrés séparément. Le script de synchronisation de contenu met à jour les guides, cours et exemples à partir des dossiers frères `docs/`, `learn/` et `library/`.

## Variables de production

- `NEXT_PUBLIC_API_URL` : URL HTTPS publique de l’API NestJS.
- `NEXT_PUBLIC_ENELES_PARENT_ORIGINS` : liste séparée par des virgules des origines exactes du site mère.
- `NEXT_PUBLIC_DOMAIN_NAME` : domaine public de l’atelier, si la génération des URL canoniques en a besoin.

Ne pas ajouter de secret dans les variables `NEXT_PUBLIC_*`. Les identifiants restent côté serveur.
