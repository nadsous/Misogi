# Bien utiliser Jev dans tes projets

Ce guide explique comment brancher Jev sur un projet avec Misogi, et comment le régler pour qu'il te fasse gagner du temps au lieu de te déranger.

## Comment Misogi juge un « c'est fini »

Misogi s'inspire de ce qui a été mesuré sur de vrais arrêts d'agents (jev-belay : AUROC 0,976 avec les faits, 0,777 en jugeant la phrase seule). Les **faits** passent avant les mots (avec Claude Code, les modifications et vérifications des sous-agents comptent aussi) :

1. **Rien n'a été modifié** pendant le tour (une question, une explication) → rien à vérifier, Jev n'est pas appelé.
2. **Un test, un build, un lint ou un typecheck a réussi après la dernière modification** → c'est prouvé, Jev n'est pas appelé.
3. Sinon, Jev lit le message final à la lumière des faits : *annonce-t-il « fini » ? dit-il avoir vérifié ? une vérification aurait-elle un sens ici ? quel est le résultat (complet, partiel, bloqué, simple explication) ?* Misogi signale un « fini » sans preuve, un « j'ai vérifié » sans vérification, ou un « fini » alors qu'une vérification échoue.

Les faits viennent du transcript de l'agent **et de git** : un fichier modifié par un script ou une commande shell compte aussi, et un test lancé *avant* la dernière modification ne prouve plus rien. Les résultats des tests ne sont jamais redemandés à Jev, pour qu'il ne soit pas trompé par du texte collé dans la demande.

## 1. Obtenir une clé

1. Crée un compte sur la [console TypeSafe](https://console.typesafe.ai) et génère une clé API.
2. Une clé suffit pour tous tes projets. Tu peux aussi en créer une par projet pour suivre les coûts séparément.

Prix indicatif : 0,042 $ par million de tokens d'entrée, rien pour la sortie. Une vérification Misogi fait 1 000 à 2 000 tokens, soit environ **0,00005 à 0,0001 $**. Mille vérifications coûtent moins de 10 centimes.

## 2. Brancher un projet

Misogi ne surveille que les projets connectés. Dans la fenêtre :

- **Un agent travaille dans un projet non connecté** : un bandeau le signale en haut de la fenêtre, clique sur **Connecter**.
- **Projets et clés → Projets récents sans Misogi** : tous les dossiers où un agent a travaillé ces 30 derniers jours, avec un bouton **Connecter**.
- **Un autre dossier** : **+** (colonne de gauche) → choisis le dossier.

La clé Jev déjà utilisée pour un autre projet est reprise. Sinon, colle-la dans la fiche du projet puis clique sur **Tester**. Coche « Utiliser cette clé pour tous mes projets » si tu veux la même partout.

En ligne de commande, dans le dossier du projet :

```sh
misogi install        # hooks pour chaque agent trouvé (Claude Code, Codex, Kimi)
misogi key set        # la clé va dans le trousseau du système, jamais dans un fichier
misogi doctor --ping  # vérifie clé, hooks, journal, et que Jev répond
```

La clé n'est jamais écrite dans le dépôt. En CI ou sur un serveur, passe-la par la variable `TYPESAFE_API_KEY` (secret du dépôt).

## 3. La semaine d'observation

Laisse le projet en mode **Observer** quelques jours. Misogi note ce que Jev *aurait* fait, sans jamais bloquer.

Regarde ensuite le fil :
- Les cartes rouges « aurait bloqué » étaient-elles justes ? Si oui, passe en **Protéger**.
- Trop de fausses alertes ? Monte le **seuil** (0,80 au lieu de 0,70) ou améliore ce que Jev voit (section 5). Le rejeu te montre l'effet avant d'appliquer.

## 4. Épingler la version de Jev

Par défaut, Misogi utilise `jev-latest`. Quand tu es content des résultats, clique **Épingler** dans les réglages du projet : la version actuelle (ex. `jev-1.13.0`) est figée. Une nouvelle version de Jev ne changera plus tes résultats du jour au lendemain ; tu choisis quand passer à la suivante.

## 5. Aider Jev à bien juger

Jev juge sur un résumé court du tour (le « state »). Plus ce résumé est clair, plus Jev est fiable.

- **Des tests qui se voient.** Misogi repère les commandes de test (`npm test`, `pytest`, `vitest`, `cargo test`, `go test`…). Donne à ton projet une commande de test standard et écris-la dans `CLAUDE.md` / `AGENTS.md` : « Lance `npm test` avant de dire que c'est fini. »
- **Des demandes précises.** « Ajoute la page contact et ses tests » se juge mieux que « améliore le site ».
- **Le bon niveau de state.**
  - *Réduit* (par défaut) : demande, noms de fichiers, résultat des tests, message final. Le bon compromis.
  - *Complet* : ajoute la sortie des tests. Utile quand Jev se trompe faute de contexte.
  - *Minimal* : métadonnées seulement, pour le code sensible (profil « code client »).
- **Les secrets restent chez toi.** Clés, tokens, valeurs `.env` et e-mails sont masqués avant l'envoi, à tous les niveaux. Le state est limité à ~30 000 tokens ; au-delà, Misogi coupe proprement le milieu des textes trop longs.

## 6. Protéger sans boucler

En mode **Protéger**, Jev peut renvoyer l'agent au travail. Trois garde-fous :

- **Relances max** (2 par défaut) : après deux relances d'affilée, Misogi laisse passer et te prévient. Pas de boucle infinie.
- **Me laisser trancher** : si la fenêtre est ouverte, tu as quelques secondes pour cliquer « Laisser passer » ou « Relancer maintenant ». Sans réponse, la règle s'applique.
- **Consignes** : sur une carte rouge, « Laisser passer au prochain arrêt » ou « Relancer au prochain arrêt » s'appliquent au prochain arrêt de cette session.

## 7. Le garde-fou shell

Active **Garde-fou shell** dans les réglages du projet. Avant chaque commande *risquée* (`rm -rf`, `git push --force`, `git reset --hard`, lecture d'un `.env`, envoi de données avec `curl -d`…), Jev juge si elle est destructrice, si elle fait fuir des secrets ou si elle touche aux fichiers de secrets. Les commandes ordinaires (`ls`, `npm test`, `git status`) passent sans appel ni délai.

Commence en **Observer**, puis passe en **Protéger** : la commande dangereuse est refusée et l'agent cherche une autre solution. Ça marche aussi en mode auto et en bypass de Claude Code, où c'est justement le plus utile.

## 7 bis. Les aides autour du tour

Dans **Réglages du projet → Aides de Jev**, quatre aides sont actives par défaut (coût : environ 0,0001 à 0,0005 $ chacune) :

- **Relire ma demande** (Claude Code) : avant que l'agent parte, Jev dit si ta demande est claire, ce qui manque sinon, quel modèle suffit et quel skill ou quelle section de `CLAUDE.md` s'applique. En mode Protéger, ces pistes sont données à l'agent. Les relectures sans rien à signaler ne s'affichent pas dans le fil.
- **Relire le diff** : à la fin du tour, chaque affirmation de l'agent est confrontée au diff, les fichiers hors sujet et sensibles sont signalés, et la commande de vérification du projet est proposée. En mode Protéger, c'est cette commande qui est donnée à l'agent quand il doit continuer. Ces constats ne bloquent jamais à eux seuls.
- **Repérer l'agent qui tourne en rond** : la fenêtre surveille les sessions en cours ; quand la même vérification échoue encore et encore, Jev juge si l'agent tourne en rond ou avance. S'il tourne en rond : son et notification.
- **Garder mes consignes à la compaction** (Claude Code) : tes consignes durables sont choisies avant la compaction et redonnées mot pour mot juste après.

Avec le profil *code client* ou le niveau *minimal*, rien de ton code ni de tes messages ne part : seule la détection de boucle reste possible.

## 7 ter. Économiser le forfait : routeur, lectures resserrées, recherche

- **Routeur de modèle** (Réglages du projet → Routeur, désactivé par défaut) : Claude Code passe par Misogi (`ANTHROPIC_BASE_URL` dans `.claude/settings.local.json`). Pour chaque message, la relecture de la demande donne la taille du travail et Misogi choisit Haiku, Sonnet ou Opus ; dans une session, le modèle ne redescend jamais. L'appli doit rester ouverte, et les sessions Claude déjà ouvertes doivent être redémarrées. Le panneau Quotas montre la part de chaque modèle.
- **Lectures resserrées** (activées par défaut) : pour un fichier de 400 lignes à 80 Ko lu en entier, Jev choisit la partie utile ; il ne resserre que s'il est net (mesuré : 0,96 à 0,98 quand il sait) et laisse le fichier entier quand deux endroits éloignés correspondent.
- **Recherche par le sens** : `misogi find "<ce que fait le code>"` et `misogi ask "<question oui/non>" [dossier]`, dans le terminal ou par l'agent (skill `misogi-search`). Grep reste meilleur quand tu connais le nom exact.

## 8. Sans interface (CI, `claude -p`)

Personne ne peut cliquer : Misogi applique la règle tout de suite, sans attendre, et écrit sa raison sur la sortie d'erreur. Le mode est détecté avec les variables `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`… ou `MISOGI_HEADLESS=1`.

## 9. Sessions à distance

SSH, conteneur de dev : lance `misogi remote` pour la marche à suivre. Le hook distant envoie ses décisions à ta fenêtre avec un jeton ; sans fenêtre joignable, il garde son propre journal et fonctionne quand même.

## 10. Relier les tickets

Nomme ta branche avec le numéro du ticket (`feat/123-contact`, `ENG-42-login`) ou cite-le dans ta demande (`#123`). Misogi récupère le ticket (GitHub via ta connexion `gh`, GitLab et Linear avec un jeton dans Réglages → Tickets) et Jev juge ses **critères d'acceptation** : écris-les en cases à cocher ou sous un titre « Critères d'acceptation » dans le ticket.

## 11. Régler Jev sur tes données

Sous chaque décision : « Jev avait-il raison ? Oui / Non ». Après une dizaine d'avis, les réglages du projet affichent sa **fiabilité** (fausses alertes, problèmes ratés). Quand tu bouges le **seuil**, Misogi rejoue les décisions passées et te dit combien d'erreurs ce seuil aurait corrigées ou créées, avant de l'appliquer.

## Checklist rapide

- [ ] Clé ajoutée et **Tester** au vert
- [ ] Une commande de test écrite dans `CLAUDE.md` / `AGENTS.md`
- [ ] Quelques jours en **Observer**, puis **Protéger**
- [ ] Version de Jev **épinglée**
- [ ] **Garde-fou shell** activé
- [ ] Profil **code client** sur les projets sous NDA
