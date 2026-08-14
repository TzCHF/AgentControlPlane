# AgentControlPlane

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [繁體中文](../zh-TW/README.md) | **Français** | [Español](../es/README.md) | [日本語](../ja/README.md)

> Logiciel expérimental, local-first, destiné à l'évaluation par un utilisateur unique.

AgentControlPlane relie une IA web compatible MCP à des agents d'ingénierie interchangeables exécutés sur l'ordinateur de l'utilisateur. La conversation web clarifie le besoin une seule fois ; le control plane transforme ensuite ce besoin en brief d'ingénierie compact et structuré, conserve l'état des tâches, récupère les preuves d'exécution et renvoie les résultats à l'IA web sans boucle manuelle de copier-coller.

Le cœur local d'AgentControlPlane est open source sous [Apache License 2.0](../../../LICENSE). Un relay hébergé, un service managé, une distribution de marque ou des fonctions d'exploitation d'entreprise peuvent être proposés séparément.

## Pourquoi ce projet existe

Les transferts manuels entre une IA web et un coding agent dupliquent le contexte et introduisent facilement des erreurs de traduction de besoin. AgentControlPlane rend cette boucle lisible par machine :

```text
IA web -> brief compact -> AgentControlPlane -> executor local
IA web <- résultat/preuves/état <- Task Store <- executor local
```

Le projet ne convertit pas un quota de chat en quota d'ingénierie et ne contourne aucune limite fournisseur. Chaque executor utilise toujours son propre compte, abonnement ou configuration API.

## Interfaces prises en charge

L'interface northbound utilise le standard MCP et n'est liée à aucun modèle particulier. La connexion ChatGPT est actuellement documentée ; tout autre client web compatible MCP peut utiliser les mêmes outils.

Executors locaux actuellement pris en charge :

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- endpoints locaux compatibles OpenAI, dont OpenCodex
- DeepSeek via l'adaptateur OpenAI-compatible

Claude Code est optionnel. L'installation du CLI ne suffit pas : l'adaptateur devient disponible après connexion à un compte Claude Pro/Max ou configuration d'une clé API Anthropic. Sinon, la découverte renvoie `not_authenticated` et le routage automatique l'ignore.

Au démarrage, `executor.provider: "auto"` découvre les backends installés/configurés et choisit le premier disponible dans `executor.routing.order`. Une tâche peut aussi imposer `executor: "opencode"`, `"codex"`, `"claude"`, `"openai-compatible"` ou `"deepseek"`.

Les threads de projet sont isolés par executor : un même workspace peut donc conserver des sessions Codex, OpenCode et Claude Code indépendantes. Une IA web peut également transférer un travail terminé d'un executor vers un autre en ne transmettant que les preuves compactes utiles, sans rejouer toute la conversation.

## Démarrage rapide

Prérequis : Node.js 22 ou plus récent et au moins un executor local pris en charge.

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

Le service écoute sur `http://127.0.0.1:4318`. `npm.cmd run doctor` affiche tous les executors détectés ainsi que la route automatique par défaut.

Pour connecter ChatGPT, voir [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md). Selon le fournisseur web, une configuration unique de connector, de permissions ou de tunnel peut encore être nécessaire.

## Exemple de délégation

Demandez à l'IA web connectée :

```text
Utilise le profil balanced avec sélection automatique de l'executor. Inspecte le
projet, implémente et teste GET /hello, vérifie le résultat puis renvoie les
fichiers modifiés et les preuves de test. En cas de blocage ou de mauvaise
compréhension, corrige le brief et poursuis le même projet. Si une revue
indépendante est utile, transfère le résultat terminé à un autre executor.
```

L'IA appelle `dispatch_project`, interroge `task_status`, utilise `continue_project` pour poursuivre avec le même executor et `handoff_project` pour une revue ou une continuation par un autre executor.

## Profils et utilisation

| Profil | Usage | Effort | Sous-agents | Budget |
|---|---|---|---:|---:|
| economy | Modifications petites et bien définies | low | 0 | 30k |
| balanced | Fonctionnalités et corrections courantes | high | jusqu'à 2 | 90k |
| deep | Architecture, refactoring large, débogage complexe | ultra | jusqu'à 4 | 220k |

Les profils sont des politiques par défaut. Le modèle, l'effort, le nombre de sous-agents et le budget de tokens peuvent être surchargés par tâche. La précision des mesures dépend de la télémétrie de l'executor.

Voir [BENCHMARKING.md](../../BENCHMARKING.md) pour comparer le mode contrôlé à l'exécution directe.

## Outils MCP

- `dispatch_project` — déléguer un brief compact avec routage automatique ou explicite
- `dispatch_opencode` — raccourci de compatibilité OpenCode
- `task_status` — lire état, résultat, preuves, usage et événements optionnels
- `continue_project` — corriger ou poursuivre dans le même thread d'executor
- `handoff_project` — transmettre des preuves compactes à un autre executor
- `cancel_task` — arrêter une tâche en attente ou active
- `list_tasks` — lister les tâches récentes
- `list_executors` — afficher découverte, disponibilité, capacités et route par défaut
- `list_profiles` — afficher les politiques d'exécution
- `list_models` — afficher le catalogue de modèles mis en cache pour un executor
- `usage_report` — agréger l'usage de tokens d'ingénierie mesuré

## Sécurité par défaut

- Les workspaces doivent rester dans les racines explicitement autorisées.
- Le service HTTP refuse une écoute hors loopback.
- Codex utilise workspace-write avec réseau désactivé et vérifie le sandbox Windows avant exécution.
- Les autres CLI et adaptateurs OpenAI-compatible s'exécutent avec les droits de l'utilisateur local ; utilisez-les uniquement sur des workspaces de confiance.
- Une authentification Bearer optionnelle est disponible via `AGENT_CONTROL_TOKEN`.
- L'état et les journaux d'audit append-only restent hors des workspaces projet.

N'exposez pas directement le serveur local sur Internet. Utilisez un tunnel privé authentifié ou un relay hébergé séparément durci.

## Documentation

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [PROTOCOL.md](../../PROTOCOL.md)
- [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)
- [BENCHMARKING.md](../../BENCHMARKING.md)
- [SECURITY-REVIEW.md](../../SECURITY-REVIEW.md)
- [COMMERCIALIZATION.md](../../COMMERCIALIZATION.md)
- [SECURITY.md](../../../SECURITY.md)
- [CHANGELOG.md](../../../CHANGELOG.md)

Par défaut, l'allowlist des workspaces correspond au dossier parent de ce dépôt. Utilisez `AGENT_CONTROL_CONFIG` pour les réglages propres à une machine et ne versionnez jamais les chemins locaux ni les identifiants.