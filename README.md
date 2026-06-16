# Job Tracker v0

Interface web de suivi de candidatures professionnelles, hébergée en auto-hébergement.

## Stack

- **Backend** : Node.js v24 + Express + SQLite (module natif `node:sqlite`)
- **Auth** : JWT (httpOnly cookie) + bcryptjs
- **Frontend** : SPA vanilla JS (pas de framework)
- **Reverse proxy** : Nginx
- **Process manager** : PM2
- **Hébergement** : LXC Debian 12 sur Proxmox

## Fonctionnalités

- Suivi complet des candidatures (statuts, priorités, sources)
- Vue liste et Kanban
- Timeline par candidature
- Gestion des contacts recruteurs
- Upload de documents (CV, lettres, etc.) avec prévisualisation inline sécurisée
- Dashboard avec statistiques et graphiques
- Système d'authentification multi-utilisateurs (login/register, bcrypt, JWT)
- Panel d'administration (gestion des utilisateurs, rôles)
- Premier compte créé = admin automatiquement

## Installation

```bash
npm install
node server.js
```

### Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT`   | `3000` | Port du serveur |

Le secret JWT et la base SQLite sont créés automatiquement au premier démarrage dans `./data/`.

## Structure

```
job-tracker/
├── server.js          # API Express + auth + SQLite
├── public/
│   ├── index.html     # Shell SPA
│   ├── app.js         # Logique frontend (router, vues, API client)
│   └── app.css        # Thème sombre
├── nginx.conf         # Config reverse proxy
├── data/              # Base SQLite + secret JWT (gitignored)
└── uploads/           # Fichiers uploadés (gitignored)
```
