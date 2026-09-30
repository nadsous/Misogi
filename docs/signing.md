# Signature des applis Misogi

Trois signatures différentes, trois rôles :

| Signature | À quoi elle sert | État | Coût |
| --- | --- | --- | --- |
| **Mises à jour** (clé Tauri) | L'appli n'installe une mise à jour que si elle est signée par toi. Personne ne peut pousser une fausse mise à jour. | ✅ Configurée | Gratuit |
| **macOS** (Developer ID + notarisation) | macOS ouvre l'appli sans avertissement « développeur non identifié ». | À faire | 99 $/an (Apple Developer Program) |
| **Windows** (Azure Trusted Signing) | SmartScreen n'affiche plus « Windows a protégé votre ordinateur ». | À faire | ~10 $/mois |

Le workflow `.github/workflows/release.yml` utilise chaque signature **dès que ses secrets existent** dans le dépôt GitHub. Sans eux, les paquets sont construits quand même, non signés.

## 1. Mises à jour : déjà en place

- Clé privée : `~/.tauri/misogi.key`, mot de passe : `~/.tauri/misogi.key.password` (sur ton PC uniquement).
- Clé publique : dans `app/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- Secrets GitHub : `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

⚠️ **Sauvegarde la clé privée et son mot de passe** (gestionnaire de mots de passe). Si tu les perds, les applis déjà installées ne pourront plus se mettre à jour : il faudrait réinstaller à la main.

Build local signé (optionnel) :

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/misogi.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat ~/.tauri/misogi.key.password)
npm run tauri -- build
```

## 2. macOS : Developer ID et notarisation

1. Inscris-toi à l'[Apple Developer Program](https://developer.apple.com/programs/) (99 $/an).
2. Dans Xcode ou sur le portail, crée un certificat **Developer ID Application**, puis exporte-le en `.p12` avec un mot de passe.
3. Crée un **mot de passe d'application** sur [appleid.apple.com](https://appleid.apple.com) (pour la notarisation).
4. Ajoute les secrets au dépôt :

```sh
base64 -i certificat.p12 | gh secret set APPLE_CERTIFICATE -R nadsous/Misogi
gh secret set APPLE_CERTIFICATE_PASSWORD -R nadsous/Misogi      # mot de passe du .p12
gh secret set APPLE_SIGNING_IDENTITY -R nadsous/Misogi          # ex. "Developer ID Application: Nadir X (TEAMID)"
gh secret set APPLE_ID -R nadsous/Misogi                        # ton e-mail Apple
gh secret set APPLE_PASSWORD -R nadsous/Misogi                  # le mot de passe d'application
gh secret set APPLE_TEAM_ID -R nadsous/Misogi
```

## 3. Windows : Azure Trusted Signing

1. Crée un compte **Trusted Signing** dans le [portail Azure](https://portal.azure.com) (validation d'identité requise), puis un **profil de certificat**.
2. Crée une **inscription d'application** (Microsoft Entra) avec un secret client, et donne-lui le rôle *Trusted Signing Certificate Profile Signer*.
3. Ajoute les secrets :

```sh
gh secret set AZURE_CLIENT_ID -R nadsous/Misogi
gh secret set AZURE_CLIENT_SECRET -R nadsous/Misogi
gh secret set AZURE_TENANT_ID -R nadsous/Misogi
gh secret set AZURE_TRUSTED_SIGNING_ENDPOINT -R nadsous/Misogi   # ex. https://weu.codesigning.azure.net
gh secret set AZURE_TRUSTED_SIGNING_ACCOUNT -R nadsous/Misogi
gh secret set AZURE_TRUSTED_SIGNING_PROFILE -R nadsous/Misogi
```

## 4. Publier une version

```sh
# 1. monter la version dans app/src-tauri/tauri.conf.json (ex. 0.2.0)
git commit -am "Misogi 0.2.0"
git tag v0.2.0 && git push && git push --tags
# 2. relire le brouillon de release sur GitHub, puis « Publish »
```

Une fois publiée, les applis installées proposent la mise à jour d'elles-mêmes (notification au démarrage, installation depuis le menu de l'icône).
