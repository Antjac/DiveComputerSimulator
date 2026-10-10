# Contribuer

[English](CONTRIBUTING.md) | **Français**

Merci de vouloir améliorer le simulateur d'ordinateurs de plongée ! Toutes les contributions sont
bienvenues : un écart repéré entre un ordinateur et son manuel, une correction de traduction, un
nouveau modèle, un bug corrigé.

Le but du projet guide chaque contribution : **un comportement et un affichage aussi proches que
possible de l'appareil réel, tel que le décrit son manuel officiel**, dans un but uniquement
pédagogique.

## Signaler une erreur ou un écart avec un manuel

C'est la contribution la plus utile, et elle ne demande pas de code. Ouvre une
[issue GitHub](https://github.com/Antjac/DiveComputerSimulator/issues) ou écris à
[antoalex@free.fr](mailto:antoalex@free.fr), en indiquant :

- le **modèle**, le **mode** simulé (ex. Perdix 2 en mode 3 GasNx) et, si tu la connais, la version
  du firmware de ton appareil ;
- **ce que fait le simulateur** et **ce que fait l'appareil réel** ;
- la **source** : la section ou la page du manuel officiel, une photo de l'écran de l'appareil, un
  carnet de plongée exporté de l'appareil… C'est la source qui permet la correction ;
- comment **reproduire** l'écart : réglages, gaz, profil (ex. « 40 m pendant 25 min en GF 40/85,
  puis remontée à 9 m/min »).

Les corrections de calcul et de comportement sont consignées dans le
[journal des corrections](CHANGELOG.md).

Pour proposer un nouveau modèle, ouvre une issue avec le lien vers son manuel officiel (PDF sur le
site du fabricant).

## Règles de base

1. **Le manuel officiel fait foi.** Travailler à partir du manuel du modèle exact et du mode
   simulé, jamais d'un modèle voisin, d'une ancienne génération ou de mémoire. Lire les figures
   autant que le texte : libellés exacts, ordre des champs, couleurs et décimales ne figurent
   souvent que dans les captures d'écran.
2. **Citer la section** du manuel dans un commentaire à côté de chaque règle implémentée :
   `// §5.2: ...`.
3. **Ne rien inventer.** Si le manuel ne dit rien, le dire (« non vérifié » dans le code et dans la
   pull request) plutôt que présenter une supposition comme un fait. Une déduction tirée des
   figures est signalée comme telle. Les valeurs fictives (n° de série, batterie…) sont marquées
   comme telles dans le code.
4. **Pas de marque sur les appareils.** Aucun logo, nom ni dessin de fabricant n'est représenté sur
   les boîtiers ou les écrans des ordinateurs simulés ; les noms n'apparaissent que dans les listes
   et les textes, pour identifier les modèles.
5. **Deux langues.** Tout texte de l'interface existe en français **et** en anglais
   (`src/i18n.ts`, ou les champs `{ fr, en }` des modèles).

## Installation

Prérequis : Node.js 18 ou plus récent (la CI utilise Node 20).

```bash
npm install
npm run dev        # serveur de développement Vite
npm run build      # vérification TypeScript + build de production : doit passer
```

Le projet est écrit en TypeScript avec Vite, sans framework d'interface. La section
[Structure](README.fr.md#structure) du README décrit les dossiers ; en bref :

- `src/engine/` : la physique (Bühlmann ZHL-16C + GF, session de plongée, gaz, tables MN90). L'état
  du plongeur est dans `session.ts` ; les ordinateurs le lisent et ne le modifient jamais (sauf un
  changement de gaz fait avec leurs boutons). Les tissus sont partagés par tous les ordinateurs.
- `src/computers/` : un dossier par modèle, avec `rules.ts` (réglages, algorithme, paliers,
  alarmes : ce qu'on vérifie dans le manuel), `index.ts` (écrans, boutons, rendu HTML) et sa
  feuille de style, importée dans `src/style.css`. Chaque modèle est enregistré dans
  `src/computers/index.ts`. Le code partagé est dans `base/`, `common/` et les dossiers de marque
  (`mares/common.ts`, `scubapro/common.ts`, `cressi/common.ts`).
- `src/app/` : l'interface, un module par fonction, branchés dans l'ordre par `src/main.ts`.
- `src/ui/` : scène 2D, graphiques, vue 3D (`scene3d/`, three.js chargé à la demande).

Les commentaires et les identifiants du code sont en anglais.

## Ajouter ou revoir un ordinateur

Passer **chaque** point de la checklist en revue dans le manuel, et l'implémenter ou noter qu'il
n'est pas simulé. La checklist détaillée, avec des exemples, est dans [CLAUDE.md](CLAUDE.md) ; elle
couvre :

1. identité et algorithme (`exact = true` seulement pour un algorithme public reproduit tel que
   publié ; sinon une approximation ≈ calibrée sur les tables de NDL publiées avec
   `npm run calib`), paramètres de déco, pénalités propres au modèle ;
2. réglages (`settingDefs`) avec les valeurs par défaut du fabricant ; `essential: true` seulement
   pour le réglage de mise en page de l'écran, les autres vont dans « Réglages avancés » ;
3. boutons (appui court et long), enchaînement des écrans et délai de retour ;
4. écran principal dans chaque état (surface, descente, NDL, déco, au palier, au-dessus du palier,
   palier de sécurité, remontée rapide, après la plongée, verrouillé) et dans chaque mise en page,
   avec les libellés exacts ;
5. écrans d'info et champs alternatifs ;
6. paliers de décompression (ancre du GF bas, fenêtre du palier, ce qui se passe au-dessus du
   palier, palier manqué, deep stops) ;
7. palier de sécurité ; 8. vitesse de remontée ; 9. NDL et avertissements ; 10. valeurs de GF
   affichées ; 11. gaz et oxygène, émetteur ; 12. surface et après la plongée ;
13. **toute la table des alarmes** du manuel, chaque alerte avec son explication dans
    `alertExplain()` (en français et en anglais, section citée).

Résumer ce qui est simulé et ce qui ne l'est pas dans les notes du modèle (`notes.fr` /
`notes.en`), affichées dans la fenêtre « ⓘ Détails de la simulation ».

## Vérifications avant une pull request

```bash
npm run build      # doit passer
npm run exercises  # « ✓ every exercise passed on every computer »
npm run stops      # « ✓ stops OK » (ou : npm run stops -- <id>)
npm run snapshot   # non-régression de l'affichage par rapport à .snapshots/baseline.json
```

- **Snapshots :** avant un refactoring, enregistrer une référence avec
  `npm run snapshot -- --save`, puis comparer après la modification. Un changement d'affichage
  voulu rend la référence obsolète : le signaler dans la pull request.
- **Mise en page :** avec `npm run dev`, mettre la simulation en pause et lancer dans la console de
  la page `__divesim.layout.sweep(['decoDeep', 'safetyActive'], '<id>')` (situations listées dans
  `__divesim.layout.states`). Le balayage signale tout texte qui déborde de sa case ou en
  chevauche un autre, dans chaque mise en page, en métrique et en impérial. Confirmer chaque
  signalement à l'écran : certains sont voulus.
- **Dans le navigateur :** afficher chaque écran dans les états ci-dessus (ex. 40 m pendant 25 min,
  puis remontée) et le comparer aux figures du manuel.

## Documentation

- **README :** mettre à jour le tableau des modèles (et le texte si besoin) dans les deux fichiers,
  `README.md` (anglais) et `README.fr.md` (français).
- **Journal des corrections :** toute correction de calcul ou de comportement (écart avec un
  manuel, paliers, NDL, alarmes…) a son entrée dans [CHANGELOG.md](CHANGELOG.md), en français et
  en anglais : `AAAA-MM-JJ · modèle(s) · correction (FR) / fix (EN)`, avec le numéro de l'issue. Les
  nouvelles fonctions et les changements d'interface restent dans l'historique Git.

## Pull requests

- Créer une branche à partir de `main` et ouvrir la pull request vers `main`. Chaque push sur
  `main` déploie le site sur GitHub Pages.
- Un sujet par pull request (un modèle, une correction…).
- Dans la description, lister : les sections du manuel vérifiées, ce qui reste **non vérifié**, et
  les écarts repérés mais non corrigés.
- Les messages de commit et les pull requests peuvent être en français ou en anglais.

## Licence

Le projet est sous [licence GNU AGPL v3.0 ou ultérieure](LICENSE). En contribuant, tu acceptes que
ta contribution soit distribuée sous cette licence. N'inclus pas de code, d'image ni de dessin que
tu n'as pas le droit de partager (logos ou firmware de fabricants, par exemple) ; ne cite les
manuels que dans la mesure nécessaire pour référencer une règle.
