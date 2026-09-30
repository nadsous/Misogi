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

### Ce qui marche avec quel agent

| | Claude Code | Kimi Code | Codex |
| --- | :---: | :---: | :---: |
| Contrôle « c'est vraiment fini ? » à la fin du tour | ✅ | ✅ | ✅ |
| Relecture du diff (affirmations, fichiers hors sujet et sensibles, test à lancer) | ✅ | ✅ | ✅ |
| Relecture de ta demande (claire ? quel modèle ? quel skill ?) | ✅ | ✅ | ✅ |
| Garde-fou shell avant les commandes risquées | ✅ | ✅ | ✅ |
| Routeur de modèle | ✅ par projet | ✅ si Kimi passe par Misogi | ✅ si Codex passe par Misogi |
| Lectures resserrées des gros fichiers | ✅ réécrites | ✅ redirigées | ✅ redirigées (`cat`) |
| `misogi find` / `misogi ask` en skill | ✅ | ✅ | ✅ |
| Mémoire à la compaction | ✅ | — | — |
| Agent qui tourne en rond, statut des sessions, son | ✅ | ✅ | ✅ |

Pour Codex, tout suit ses formats documentés de hooks et de fournisseurs ; Claude Code et Kimi sont testés de bout en bout.

### Vérifier le travail

| | |
| --- | --- |
| **« C'est vraiment fini ? »** | Les faits d'abord : rien de modifié → rien à vérifier ; un test, un build, un lint ou un typecheck réussi après la dernière modification → c'est prouvé, Jev n'est même pas appelé. Sinon, Jev lit le message final à la lumière de ces faits et signale un « fini » sans preuve, un « j'ai vérifié » sans vérification, ou un « fini » alors qu'une vérification échoue. |
| **Relecture du diff** | Chaque affirmation de l'agent (« j'ai ajouté les tests ») est confrontée au diff, les fichiers hors sujet sont signalés, les sensibles (auth, facturation, migrations, secrets) passent en tête de la liste à relire, et Misogi donne la commande de vérification du projet à lancer (`cd apps/backend && npm run test`). Ne bloque jamais à elle seule. |
| **Relecture de ta demande** | Avant que l'agent parte : ta demande est-elle assez claire, ou manque-t-il le résultat attendu, l'endroit à modifier, jusqu'où aller ? Quel skill, sous-agent ou section de `CLAUDE.md` s'applique ? En mode Protéger, les pistes utiles sont données à Claude. |
| **Tickets** | La branche (`feat/123-contact`, `ENG-42-login`) ou la demande (`#123`) relie la session à son ticket GitHub, GitLab ou Linear ; Jev vérifie les **critères d'acceptation**, pas seulement « fini ? ». |
| **Garde-fou shell** | Avant qu'une commande risquée parte (`rm -rf`, `git push --force`, lecture d'un `.env`, envoi de données…), Jev juge si elle est destructrice ou fait fuir des secrets, et Misogi la refuse en mode Protéger. Les commandes ordinaires passent sans délai, en mode auto et bypass aussi. |
| **Agent qui tourne en rond** | La même vérification échoue encore et encore ? Jev distingue l'agent qui tourne en rond de celui qui échoue différemment à chaque fois et avance ; seul le premier déclenche un son et une notification. Aucun hook, aucune attente pour l'agent. |

### Économiser les tokens et ton forfait

| | |
| --- | --- |
| **Routeur de modèle** | Pour chaque message, Jev choisit le modèle selon la taille du travail : Haiku, Sonnet ou Opus pour Claude Code (un renommage sur Haiku, une refonte de la facturation sur Opus) ; `kimi-for-coding-highspeed`, `kimi-for-coding` ou `k3` pour Kimi ; un « mini » ou le plus capable de ta liste pour Codex. Seuls les tours principaux changent, le modèle ne redescend jamais dans une session, ta connexion (Claude, Kimi, ChatGPT ou clé API) est relayée telle quelle, et si le modèle choisi refuse une requête elle repart sur le modèle d'origine. Désactivé par défaut. |
| **Lectures resserrées** | Quand l'agent lit un gros fichier (400 lignes ou plus) en entier, Jev choisit la partie qu'il cherche. Claude Code ne reçoit que cette fenêtre (un cinquième environ) ; Kimi et Codex sont invités à relire ces lignes-là, et ont tout le fichier s'ils insistent. Les cas ambigus restent entiers. |
| **Recherche par le sens** | `misogi find "où l'utilisateur s'inscrit"` trouve du code en le décrivant, même quand les mots diffèrent ; `misogi ask "construit-il du SQL par concaténation ?" api/` pose une question oui/non à chaque fichier. Les trois agents les ont en skill : seule la réponse entre dans leur contexte. |
| **Mémoire à la compaction** | Quand Claude Code compacte la conversation, Jev choisit tes consignes durables (« ne touche pas à migrations/ », « utilise pnpm ») et elles lui sont redonnées mot pour mot juste après le résumé. |

### La fenêtre

| | |
| --- | --- |
| **À côté de ton éditeur** | Une fenêtre de 380 px ancrée au bord de l'écran, toujours au-dessus, qui ne vole jamais le focus. Elle se reconnecte seule après une veille et relance son serveur local si besoin. |
| **Un son quand c'est fini** | Une goutte quand un agent termine son tour (dans tous tes projets, connectés ou non), deux notes quand Misogi attend ta décision, et une notification système quand la fenêtre est cachée. |
| **Des décisions lisibles** | Le verdict en une phrase, pourquoi, ce que Misogi a fait, que faire ; puis les faits, ce que Jev a lu, et la demande et la réponse de l'agent rendues en Markdown. Les chiffres bruts sont dans « Détails techniques ». |
| **Connecter en un clic** | Un bandeau apparaît quand un agent travaille dans un projet sans Misogi, et *Projets et clés* liste les dossiers où un agent a travaillé ces 30 derniers jours, chacun avec un bouton **Connecter**. |
| **Tu gardes la main** | Quand Jev veut renvoyer l'agent au travail, la fenêtre te laisse quelques secondes : **Laisser passer** ou **Relancer**. Au plus 2 relances d'affilée (réglable). |
| **Quotas, sessions, ce qui guide l'agent** | Limites des forfaits Claude et Codex, tokens par agent, coût de Jev, part de chaque modèle avec le routeur et tokens gardés hors contexte ; travaille / terminé / attend pour chaque session ; les fichiers qui orientent ton agent (`CLAUDE.md`, skills, hooks, serveurs MCP). |
| **Tes projets, tes clés** | Icônes trouvées toutes seules (ou un blobatar), agents branchés, clé Jev dans le trousseau du système, reprise quand tu connectes un nouveau projet. |
| **13 gouttes** | Des thèmes nommés d'après les gouttes qui tombent dans le courant : eau, rosée, lait, café, latte, feu, aube, matcha, washi, sakura, sel… Ton thème et tes préférences survivent aux mises à jour. |

### Fiable et discret

| | |
| --- | --- |
| **Sûr par défaut** | Fail-open (si quelque chose casse, l'agent continue), mode Observer d'abord, secrets masqués avant que quoi que ce soit ne quitte ta machine, clés dans le trousseau, journaux purgés après 30 jours (réglable). |
| **Réglé sur tes données** | Dis « Jev avait raison / tort » sur chaque décision : fiabilité aide par aide, rejeu des décisions passées avec un autre seuil, et après 8 avis Misogi te conseille le seuil qui aurait fait le moins d'erreurs. |
| **Résultats stables** | Épingle une version de Jev par projet. Le state envoyé est plafonné à ~30k tokens et coupé proprement. |
| **Sans interface et à distance** | `claude -p` et la CI n'attendent jamais un clic. Les sessions SSH et les conteneurs de dev envoient leurs décisions à ta fenêtre avec un jeton (`misogi remote`). |
| **Mises à jour signées** | L'appli (Windows, macOS, Linux) se met à jour depuis les Releases GitHub, vérifiées par signature. |
| **Accessible** | Navigation au clavier (flèches entre les décisions, palette ⌘K), annonces pour lecteurs d'écran, chaque thème vérifié au contraste WCAG AA en CI. |
| **Désinstallation propre** | Les configs des agents sont sauvegardées avant toute modification ; retirer un projet ne reprend que ce que Misogi a ajouté. |

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

**« J'ai codé sur un projet et Jev n'a rien fait. »**
Misogi n'était sans doute pas connecté à ce projet : il ne surveille que ceux où tu l'as activé. Clique sur **Connecter** dans le bandeau ou dans **Projets et clés** (voir [Connecter Misogi à un projet](#connecter-misogi-à-un-projet)). Si le projet est déjà connecté, lance `npx misogi doctor` dans son dossier.

**« Combien ça coûte ? »**
Misogi est gratuit et open source. Jev coûte environ 0,0001 $ par vérification. Rien n'est envoyé sans clé.

## Zéro télémétrie

Misogi n'envoie **rien** sur toi, ton code ou ton usage, à personne : pas d'analytics, pas de rapport de plantage. Ce qui sort de ta machine :

- les appels à Jev (`hooks/src/jev.ts`), seulement pour les projets où tu as mis une clé ;
- si tu actives le routeur, les requêtes de tes agents, relayées telles quelles à leur fournisseur (Anthropic, Kimi, OpenAI) avec ta propre connexion (`hooks/src/router.ts`) ; Misogi n'en garde que le modèle utilisé et le nombre de tokens ;
- au démarrage de l'appli, la lecture de `latest.json` sur GitHub pour savoir s'il y a une mise à jour, sans aucun identifiant ;
- en option, les sessions à distance écrivent à *ta* fenêtre avec *ton* jeton.

C'est tout, et tu peux le vérifier dans le code.

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

### Connecter Misogi à un projet

Misogi ne surveille que les projets où tu l'as connecté. Tant qu'un projet n'est pas connecté, ton agent y travaille normalement, mais Jev ne voit rien : aucune décision n'apparaît.

**Le plus simple : depuis la fenêtre**

1. **Quand un agent travaille dans un projet sans Misogi**, un bandeau apparaît en haut de la fenêtre : *« Claude travaille dans mon-projet sans Misogi »*. Clique sur **Connecter**.
2. **Pour tes autres projets**, ouvre **Projets et clés**. La section *Projets récents sans Misogi* liste les dossiers où Claude, Codex ou Kimi ont travaillé ces 30 derniers jours. Clique sur **Connecter** à côté de celui que tu veux.
3. **Pour un projet jamais ouvert avec un agent**, utilise *Ajouter un projet* en bas de **Projets et clés** (bouton **Parcourir** dans l'appli).

Connecter un projet :
- installe les hooks de chaque agent trouvé sur ta machine ;
- les met en mode **Observer** : Misogi note l'avis de Jev mais ne bloque jamais rien ;
- reprend ta clé Jev si tu l'as déjà mise pour un autre projet. Sinon, colle-la une fois dans la fiche du projet ([console TypeSafe](https://console.typesafe.ai)).

**Depuis le terminal, dans le dossier du projet**

```sh
npx misogi install       # hooks pour chaque agent trouvé (ou : install claude)
npx misogi key set       # clé Jev, rangée dans le trousseau du système
npx misogi doctor        # vérifie en une fois : projet suivi, hooks, clé, journal
```

**Ce que ça change dans ton projet**
- `.claude/settings.local.json` (Claude Code) ou `.codex/hooks.json` (Codex) reçoivent le hook. Le fichier d'origine est sauvegardé à côté (`.misogi-backup`).
- Pour Kimi, le hook va dans `~/.kimi/config.toml`, et ne réagit qu'aux projets connectés.
- `.misogi/config.json` garde les réglages du projet (mode, seuil, garde-fou). Commite-le pour partager les réglages avec ton équipe, ou ajoute `.misogi/` à ton `.gitignore`.

**Le vérifier.** Termine un tour avec ton agent dans ce projet : une décision apparaît dans le fil. Si c'était une simple question sans modification de fichier, Misogi l'affiche sans appeler Jev : il n'y avait rien à vérifier.

**Le déconnecter.** Dans **Projets et clés**, ouvre le projet puis clique sur **Retirer de Misogi** : les hooks sont enlevés et tes fichiers de config remis comme avant.

Pas encore de clé ? `MISOGI_MOCK=1` donne des réponses simulées.

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
