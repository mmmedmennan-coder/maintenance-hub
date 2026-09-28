# Maintenance Hub (nom de travail provisoire)

Place de marché B2B pour la maintenance du froid commercial au Maroc (zone pilote : Rabat‑Salé).
Elle relie des commerces alimentaires (restaurants, boulangeries, boucheries, supérettes) à des
entreprises de maintenance frigorifique et coordonne tout le service :

**demande → comparaison d'offres → choix → confirmation par le prestataire → visite → diagnostic →
approbation du devis de réparation → travaux → rapport → prise en compte ou litige → paiement
déclaré/confirmé → historique d'entretien.**

« Maintenance Hub » est un nom de travail configurable (`APP_NAME`) ; ce n'est pas une marque
déposée. Interface en français, montants en MAD, dates affichées en heure de Casablanca
(stockées en UTC). Les chaînes d'interface sont dans `src/messages/fr.json` (l'arabe/RTL pourra
être ajouté sans refonte).

> Le logiciel coordonne des prestataires. Il ne réalise aucun diagnostic automatique et ne délivre
> aucune certification d'hygiène alimentaire. Les dépannages sont orientés manuellement, sans délai
> d'intervention garanti.

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Installation (PowerShell ou WSL/bash)](#2-installation)
3. [Lancer l'application](#3-lancer-lapplication)
4. [Comptes de démonstration](#4-comptes-de-démonstration)
5. [Tests et vérifications](#5-tests-et-vérifications)
6. [Scripts disponibles](#6-scripts-disponibles)
7. [Documentation](#7-documentation)

## 1. Prérequis

| Outil | Version | Remarque |
| --- | --- | --- |
| Node.js | 22 LTS (≥ 22.13, voir `.nvmrc`) | testé avec Node 22.22 |
| npm | fourni avec Node | le dépôt contient `package-lock.json` |
| Docker Desktop (Windows) ou Docker Engine (WSL/Linux) | récent, avec `docker compose` | PostgreSQL 16 + Mailpit |
| Git | récent | |

Environ 16 Go de RAM suffisent. Aucun Redis, Elasticsearch ou Kubernetes n'est nécessaire.

**Windows + WSL2** : clonez le dépôt *dans le système de fichiers WSL* (par exemple `~/code/maintenance-hub`)
et ouvrez-le avec VS Code (extension WSL). Évitez `/mnt/c/...` (lent) et ne mélangez pas chemins
Windows et WSL dans une même installation : utilisez soit PowerShell, soit WSL, du début à la fin.

## 2. Installation

Les commandes sont données pour **PowerShell** puis pour **WSL/bash**.

### 2.1 Dépendances et services locaux

```powershell
# PowerShell
npm ci
Copy-Item .env.example .env
docker compose up -d        # PostgreSQL 16 sur 127.0.0.1:5432, Mailpit sur 127.0.0.1:1025 / :8025
```

```bash
# WSL / bash
npm ci
cp .env.example .env
docker compose up -d
```

### 2.2 Configurer `.env`

Remplacez **toutes** les valeurs `change-me…` / `replace-with…` :

- `BETTER_AUTH_SECRET` : au moins 32 caractères aléatoires. Pour en générer
  (PowerShell comme bash) :
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- Les mots de passe des rôles PostgreSQL `mh_owner`, `mh_app`, `mh_auth`, `mh_worker` (12 caractères
  minimum) dans les quatre URL de base de données. Les noms de rôles sont fixes.
- `POSTGRES_SUPERUSER_PASSWORD` et `POSTGRES_SUPERUSER_URL` doivent correspondre (compte
  superutilisateur du conteneur, utilisé uniquement par `db:bootstrap`).

Ne commitez jamais `.env` (il est ignoré par Git).

### 2.3 Base de données

```powershell
npm run db:generate    # génère le client Prisma (src/generated/prisma)
npm run db:bootstrap   # crée les rôles mh_owner / mh_app / mh_auth / mh_worker et la base
npm run db:migrate     # applique prisma/migrations (schéma, contraintes, RLS, droits)
npm run db:seed        # données de démonstration fictives (refusé si NODE_ENV=production)
```

Les mêmes commandes fonctionnent à l'identique sous WSL/bash.

- `db:bootstrap` refuse de s'exécuter en production ; en production, les rôles sont créés selon
  `docs/DEPLOYMENT.md`.
- Sans données de démonstration, lancez `npm run db:reference` (catégories d'équipement, zone
  Rabat‑Salé, offre pilote) puis créez l'administrateur (section 4).

### 2.4 Premier administrateur (sans données de démo)

Il n'existe aucune inscription publique donnant le rôle d'administrateur plateforme. Créez-le en
local :

```powershell
npm run admin:create -- --email admin@exemple.ma --name "Admin" --password "un-mot-de-passe-long"
```

```bash
ADMIN_PASSWORD='un-mot-de-passe-long' npm run admin:create -- --email admin@exemple.ma --name "Admin"
```

## 3. Lancer l'application

Deux terminaux (web et worker) :

```powershell
# Terminal 1 — application web
npm run dev
# Terminal 2 — worker (e-mails, PDF, rappels, expirations)
npm run worker:dev
```

| URL | Contenu |
| --- | --- |
| http://localhost:3000 | application (site public et espaces connectés) |
| http://localhost:8025 | Mailpit : tous les e-mails (vérification, réinitialisation, invitations, notifications) |

Sans worker, les actions fonctionnent mais les e-mails, les PDF de rapports/devis et les
notifications restent en file d'attente (ils seront traités au démarrage du worker).

Mode production local (après `npm run build`) : `npm run start` et `npm run worker:start`.

## 4. Comptes de démonstration

Créés par `npm run db:seed`. Toutes les entreprises, personnes, contrôles et avis sont **fictifs**
et signalés « démo » dans l'interface. Mot de passe commun : `Demo-Pilote-2026` (modifiable via
`DEMO_PASSWORD` avant le seed).

| E-mail | Rôle | Espace |
| --- | --- | --- |
| `admin@demo.maintenance-hub.test` | administrateur plateforme | `/admin` |
| `client@demo.maintenance-hub.test` | propriétaire client (Supérette Al Amal) | `/client` |
| `responsable@demo.maintenance-hub.test` | responsable client (peut approuver) | `/client` |
| `lecteur@demo.maintenance-hub.test` | lecteur client (lecture seule) | `/client` |
| `restaurant@demo.maintenance-hub.test` | propriétaire du 2ᵉ client (Restaurant La Corniche) | `/client` |
| `prestataire@demo.maintenance-hub.test` | propriétaire prestataire (Froid Atlas) | `/prestataire` |
| `planificateur@demo.maintenance-hub.test` | planificateur (Froid Atlas) | `/prestataire` |
| `technicien@demo.maintenance-hub.test` | technicien (Froid Atlas) | `/technicien` |
| `prestataire2@demo.maintenance-hub.test` | propriétaire prestataire (Bouregreg Réfrigération) | `/prestataire` |
| `technicien2@demo.maintenance-hub.test` | technicien (Bouregreg) | `/technicien` |
| `prestataire3@demo.maintenance-hub.test` | prestataire dont le profil attend la vérification | `/prestataire` |

Les scénarios sont datés par rapport au jour du seed : visites passées (il y a ~2 mois, ~4 semaines,
~2 semaines), un devis en attente d'approbation (dernier jour ouvré), un chantier en attente de
pièces, un rendez-vous à confirmer (délai de 24 h), des rendez-vous confirmés à venir, une demande
avec deux offres concurrentes (dont une révisée), un dépannage à orienter, un litige ouvert, des
paiements déclarés et confirmés, un plan de maintenance accepté qui a généré un brouillon de demande.

Le seed est idempotent : le relancer ne duplique rien. Pour repartir de zéro en local :
`npm run db:reset-dev -- --yes`, puis `npm run db:migrate` et `npm run db:seed`.

Vous pouvez aussi vous inscrire (`/inscription`) : le lien de vérification arrive dans Mailpit.

## 5. Tests et vérifications

```powershell
npm run lint
npm run typecheck
npm run test               # tests unitaires (Vitest)
npm run build
```

**Tests d'intégration** (PostgreSQL réel, rôles de production, RLS) : ils utilisent une base de test
dédiée décrite dans `.env.test` (copie de `.env.example` avec `APP_URL=http://localhost:3100`,
une base dont le nom se termine par `_test`, `NODE_ENV=test` et `STORAGE_LOCAL_DIR=./storage/test-private`).

```powershell
Copy-Item .env.example .env.test     # puis adaptez les valeurs ci-dessus
$env:ENV_FILE=".env.test"; npm run db:bootstrap; Remove-Item Env:ENV_FILE
npm run test:integration             # réinitialise et migre la base de test à chaque exécution
```

```bash
cp .env.example .env.test            # puis adaptez
ENV_FILE=.env.test npm run db:bootstrap
npm run test:integration
```

**Tests de bout en bout** (Playwright, build de production sur le port 3100, base de test
ré-initialisée et seedée, Mailpit requis) :

```powershell
npx playwright install chromium      # une seule fois
npm run build
npm run test:e2e
```

## 6. Scripts disponibles

| Script | Rôle |
| --- | --- |
| `dev`, `build`, `start` | application Next.js |
| `worker:dev`, `worker:start` | worker (outbox, e-mails, PDF, tâches planifiées) |
| `lint`, `typecheck` | ESLint, TypeScript strict |
| `db:generate` | client Prisma |
| `db:bootstrap` | rôles et base PostgreSQL (local/préproduction uniquement) |
| `db:migrate` | migrations (`prisma/migrations`) avec le rôle propriétaire |
| `db:diff -- <nom>` | génère une migration à partir du schéma Prisma (ne jamais utiliser `prisma migrate dev`) |
| `db:reference` | données de référence (catégories, zone, offre pilote) |
| `db:seed` | données de démonstration (refusé en production, exige `ALLOW_DEMO_SEED=true`) |
| `db:reset-dev -- --yes` | vide la base locale (refusé hors hôte local) |
| `admin:create` | crée ou promeut un administrateur plateforme |
| `user:anonymize -- --email … [--confirm]` | anonymise un compte sur demande (voir `docs/DEPLOYMENT.md`) |
| `test`, `test:integration`, `test:e2e` | tests unitaires, intégration, navigateur |

## 7. Documentation

- `docs/ARCHITECTURE.md` — schéma du système, données, rôles, cycles de vie et transitions.
- `docs/API.md` — points d'accès `/api/v1`, validation, permissions, exemples.
- `docs/IMPLEMENTATION_STATUS.md` — état d'avancement honnête, matrice des exigences, vérifications exécutées.
- `docs/DEPLOYMENT.md` — hébergement web/worker, PostgreSQL, stockage privé, e-mail, secrets, sauvegardes.
- `docs/screenshots/` — captures d'écran (données de démonstration).

Paiements : la plateforme n'encaisse rien. Les paiements sont réglés directement entre client et
prestataire, puis déclarés (client) et confirmés (prestataire). Abonnement pilote prestataire :
399 MAD/mois hors taxes, 3 comptes, enregistré manuellement par l'administrateur — un tarif
configurable, pas un engagement de clients.
