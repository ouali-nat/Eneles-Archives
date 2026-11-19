# Eneles Atelier — service de compilation

Service de compilation isolé avec TeX Live, utilisé par l’API Eneles Atelier. Il propose les moteurs pdfLaTeX, XeLaTeX et LuaLaTeX ainsi que les outils bibliographiques et auxiliaires installés dans l’image.

Le déploiement se fait avec le Dockerfile présent dans ce dossier. L’API et le compilateur doivent partager le secret interne configuré côté serveur. Les processus de compilation doivent conserver leurs limites de temps, mémoire, concurrence, répertoire isolé et utilisateur non privilégié.
