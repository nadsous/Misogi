<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
    <img src="docs/brand/logo.svg" width="120" alt="Misogi">
  </picture>
</p>

<h1 align="center">Misogi</h1>

<p align="center">
  <b>Un second avis sur chaque « c'est fini » de ton agent de code.</b><br>
  Une fenêtre sidecar pour Claude Code, Codex et Kimi Code, avec un juge (Jev) qui vérifie le travail avant que l'agent s'arrête.
</p>

<p align="center"><a href="README.md">Read in English</a></p>

<p align="center">
  <img src="docs/screenshots/feed.png" width="300" alt="Flux en direct, quotas et sessions">
  <img src="docs/screenshots/projects.png" width="300" alt="Projets et clés Jev">
  <img src="docs/screenshots/feed-rosee.png" width="300" alt="Thème clair Rosée">
</p>

---

*Misogi* (禊) est le rite shintô de purification sous l'eau d'une rivière ou d'une cascade. Le travail de ton agent descend le courant ; Misogi veille à ce que seul un travail propre arrive au bout.

## Claude, Jev, Misogi : qui fait quoi ?

Imagine un chantier.

| | Rôle | Sur le chantier |
| --- | --- | --- |
| **Claude Code** (ou Codex, Kimi Code) | L'**agent de code**. Tu lui donnes une tâche, il lit ton code, modifie des fichiers, lance des commandes, puis dit « c'est fait ». | Le **maçon**. Rapide et infatigable, mais il annonce parfois que le mur est fini avant que la peinture soit sèche. |
| **Jev** (de TypeSafe) | Un **modèle de jugement**. Il n'écrit pas de code : il lit un court résumé de ce qui s'est passé et répond à des questions précises (« terminé ? oui / non, avec un niveau de confiance »). En une demi-seconde environ, pour une fraction de centime. | L'**inspecteur**. Il regarde le travail et coche les cases : fini ? testé ? des affirmations sans preuve ? |
| **Misogi** (ce projet) | Le **lien entre les deux, et ta fenêtre sur tout ça**. Quand l'agent veut s'arrêter, Misogi résume le tour, interroge Jev, t'affiche le verdict en direct et, si tu le veux, renvoie l'agent au travail. | Le **bureau de chantier**. Il appelle l'inspecteur au bon moment, affiche chaque rapport au mur, et peut dire au maçon « pas encore, termine le travail ». |

En une phrase : **Claude fait le travail, Jev le juge, Misogi les relie et te montre tout.**

Un exemple concret :

1. Tu demandes à Claude : *« Ajoute une page contact et teste-la. »*
2. Claude écrit la page, oublie de lancer les tests, et répond *« C'est fait, tout fonctionne ! »*
3. Misogi intercepte ce moment et envoie à Jev : la demande, les fichiers modifiés, le résultat des tests (aucun), le message final de Claude.
4. Jev répond : *tâche terminée à 40 %, tests pas lancés, affirmation non vérifiée à 85 %*.
5. Dans la fenêtre Misogi, une carte rouge apparaît : **« Jev pense que les tests n'ont pas été lancés. »**
6. En mode **Protéger**, Claude reçoit *« Les tests n'ont pas été lancés, vérifie avant de t'arrêter »* et reprend tout seul.

Sans Misogi, tu découvres l'étape 2 plus tard. Avec Misogi, tu la vois tout de suite, et l'agent peut se corriger seul.

## Pourquoi

Les agents de code vont vite, et disent souvent « c'est fait ». Parfois les tests n'ont jamais tourné. Parfois la moitié de la demande est restée en TODO. Parfois le message final affirme des choses que rien ne prouve.

Misogi se branche au moment où l'agent veut s'arrêter, pose trois questions à [Jev](https://docs.typesafe.ai) (le modèle de jugement typé de TypeSafe) en un seul appel, et t'affiche la réponse en direct, en français clair :

- **La tâche est-elle vraiment terminée ?**
- **Les tests ont-ils été lancés après la dernière modification, et passent-ils ?**
- **Le message final affirme-t-il des choses que rien ne vérifie ?**

Tu commences en mode **Observer** : Misogi note seulement ce que Jev *aurait* fait. Quand tu lui fais confiance, passe un projet en **Protéger** : si le travail n'est pas fini, l'agent est renvoyé au travail (une fois par tour).

## Fonctionnalités

| | |
| --- | --- |
| **Sidecar en direct** | Une fenêtre de 380 px collée au bord de l'écran. Toujours au-dessus, sans voler le focus, repliée en bande de 40 px quand tout est calme. |
| **Trois agents, un format** | Claude Code, Codex et Kimi Code, chacun avec un petit adaptateur. |
| **Quotas en un coup d'œil** | Limites 5 h et 7 jours de Claude, 5 h et semaine de Codex, tokens consommés par agent, appels et coût de Jev. |
| **Statut des sessions** | Travaille, terminé ou attend ton approbation, lu dans les fichiers de session des agents, même sans hook. |
| **Ce qui guide ton agent** | Les fichiers souvent invisibles qui l'orientent : `CLAUDE.md`, `AGENTS.md`, skills, sous-agents, commandes, hooks, serveurs MCP. |
| **Tes projets, tes clés** | Chaque projet montre son icône (trouvée automatiquement), les agents branchés et l'état de sa clé Jev. Colle une clé une fois, teste-la, ou utilise-la pour tous tes projets. |
| **Des décisions lisibles** | « Jev pense que les tests n'ont pas été lancés », pas du JSON brut. Le state exact et les probabilités sont à un clic. |
| **Garde-fou shell** | Avant qu'une commande risquée parte (`rm -rf`, `git push --force`, lecture d'un `.env`, envoi de données…), Jev juge si elle est destructrice ou fait fuir des secrets, et Misogi la refuse en mode Protéger. Les commandes ordinaires passent sans délai. Marche aussi en mode auto et bypass de Claude Code. |
| **Tu gardes la main** | Quand Jev veut relancer l'agent, la fenêtre te laisse quelques secondes : **Laisser passer** ou **Relancer maintenant**. Les cartes rouges proposent la même chose pour le prochain arrêt. |
| **Pas de boucle infinie** | Au plus 2 relances d'affilée (réglable) ; ensuite Misogi laisse passer et te prévient. |
| **Sans interface et à distance** | `claude -p` et la CI n'attendent jamais de clic. Les sessions SSH et les conteneurs de dev envoient leurs décisions à ta fenêtre avec un jeton (`misogi remote`). |
| **Relié aux tickets** | La branche (`feat/123-contact`, `ENG-42-login`) ou la demande (`#123`) relie la session à son ticket GitHub, GitLab ou Linear ; Jev vérifie les **critères d'acceptation**, pas seulement « c'est fini ? ». |
| **Réglé sur tes données** | Dis « Jev avait raison / tort » sur chaque décision pour mesurer sa fiabilité sur ton projet, et rejoue les décisions passées avec un autre seuil avant de l'appliquer. |
| **Résultats stables** | Épingle une version de Jev par projet. Le state envoyé est limité à ~30 000 tokens et coupé proprement. |
| **Sûr par défaut** | Fail-open, mode shadow d'abord, secrets masqués avant tout envoi, clés dans le trousseau du système, journaux purgés après 30 jours (réglable). |
| **Accessible** | Navigation au clavier (flèches entre les décisions, palette ⌘K), annonces pour lecteurs d'écran, contrastes WCAG AA vérifiés en CI sur chaque thème. |
| **Désinstallation propre** | Les configs des agents sont sauvegardées avant toute modification ; « Tout désinstaller » ne retire que ce que Misogi a ajouté. |
| **13 gouttes** | Des thèmes nommés d'après les gouttes qui tombent dans le courant : eau, rosée, lait, café, crème, feu, aube, matcha, washi, sakura, sel... |

## FAQ

**« Claude Opus est plus intelligent que Jev. Pourquoi demander à Jev ? »**
Jev ne remplace pas Claude et n'écrit jamais de code. C'est un contrôle indépendant, comme un détecteur de fumée à côté du chef. Trois raisons d'en faire un modèle séparé :
1. **Un modèle ne devrait pas corriger sa propre copie.** Claude qui dit « c'est fini » et Claude qui vérifie « ai-je fini ? » ont les mêmes angles morts.
2. **Vitesse et coût.** Faire relire chaque tour par Opus prendrait 10 à 60 s et mangerait ton forfait. Jev répond en ~0,5 s pour environ 0,0001 $, avec une note de confiance *calibrée*, pas un avis.
3. **Des réponses typées.** Jev répond à des questions précises par oui ou non (« tests lancés après la dernière modification ? »), exactement ce qu'il faut pour un contrôle automatique.

**« Ça m'empêche d'utiliser le mode auto ? »**
Non, c'est l'inverse. Les hooks tournent dans tous les modes de permission, auto et bypass compris. Le contrôle de fin ne te demande jamais rien. Et le garde-fou shell rend le mode auto *plus sûr* : les commandes dangereuses sont arrêtées avant de partir, le reste passe sans rien toucher.

**« T3 Code fait déjà le suivi de tâches. »**
T3 Code est une interface : il affiche joliment le travail de l'agent, il ne vérifie rien. Misogi tourne à côté (et à côté du terminal, de Cursor, de tout ce qui pilote Claude Code, Codex ou Kimi) et ajoute la vérification, les quotas et le garde-fou shell.

**« Flemme de combiner 50 trucs. »**
Une installation, une fenêtre : statut des sessions, quotas du forfait, ce qui guide l'agent, « c'est vraiment fini ? », garde-fou shell. Le reste est optionnel.

**« Pourquoi je ne vois pas mes pourcentages de forfait Claude ? »**
Claude Code ne donne ses limites 5 h et 7 jours qu'à sa *statusline*, qui n'existe que dans le terminal (`claude`). Les applis construites sur le SDK de Claude, comme T3 Code, ne lancent jamais de statusline : les pourcentages n'apparaissent qu'après avoir utilisé `claude` dans un terminal, une fois « Voir mes quotas Claude » activé. Les tokens consommés, eux, s'affichent toujours, quelle que soit l'appli. Les limites de Codex sont lues dans ses fichiers de session et marchent toujours.

**« Combien ça coûte ? »**
Misogi est gratuit et open source. Jev coûte environ 0,0001 $ par vérification. Rien n'est envoyé sans clé.

## Zéro télémétrie

Misogi n'envoie **rien** sur toi, ton code ou ton usage, à personne : pas d'analytics, pas de rapport de plantage, pas de ping de mise à jour. La seule requête sortante est l'appel à Jev (`hooks/src/jev.ts`), et seulement pour les projets où tu as mis une clé. En option, les sessions à distance écrivent à *ta* fenêtre avec *ton* jeton. C'est tout, et tu peux le vérifier dans le code.

## Les gouttes

<p align="center"><img src="docs/brand/drops.svg" alt="Les 13 gouttes de Misogi"></p>

Chaque thème recolore la goutte de verre du logo. Choisis-la dans **Réglages → Goutte**, ou laisse **Système** passer d'*Eau* à *Rosée* avec ton OS.

## Démarrer

Il faut Node 20+ et au moins un agent parmi Claude Code, Codex et Kimi Code.

Le plus rapide, sans rien cloner :

```sh
npx misogi               # ouvre la fenêtre
npx misogi install       # dans ton projet : hooks pour chaque agent trouvé
```

Ou l'appli desktop depuis les [Releases](https://github.com/nadsous/Misogi/releases) (Windows, macOS, Linux, mises à jour automatiques). Ou depuis les sources :

```sh
git clone https://github.com/nadsous/Misogi && cd Misogi
npm install
npm run build
npm run serve            # ouvre http://127.0.0.1:4317
```

Dans la fenêtre, clique sur **+** pour ajouter le dossier d'un projet, colle ta [clé TypeSafe](https://console.typesafe.ai), c'est tout. Pas encore de clé ? `MISOGI_MOCK=1` donne des réponses simulées.

📘 **[Bien utiliser Jev dans tes projets](docs/jev-guide.fr.md)** : clé, semaine d'observation, version épinglée, tests, garde-fou shell, CI, sessions à distance.

**Quotas Claude** : clique sur *Voir mes quotas Claude* dans le panneau Quotas. Misogi ajoute une statusline à Claude Code qui enregistre tes limites ; si tu en avais déjà une, elle est gardée et continue de s'afficher.

Application desktop : `npm run tauri -- build` (il faut Rust). Raccourci global <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>M</kbd>, palette <kbd>Ctrl</kbd>+<kbd>K</kbd>.

## Confidentialité

- Rien ne quitte ta machine, sauf le court state envoyé à Jev, et seulement pour les projets où tu as mis une clé.
- Par projet, tu choisis ce qui part : **minimal**, **réduit** ou **complet**. Le profil *code client* force le minimal.
- Clés API, tokens, valeurs `.env`, e-mails et clés privées sont masqués avant l'envoi, à tous les niveaux.

Le reste de la documentation (réglages, développement, feuille de route) est dans le [README anglais](README.md).

## Licence

[MIT](LICENSE)
