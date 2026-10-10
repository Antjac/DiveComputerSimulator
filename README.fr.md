# Simulateur d'ordinateurs de plongée

[English](README.md) | **Français**

Simulateur pédagogique d'ordinateurs de plongée. On pilote un plongeur dans la colonne d'eau et on voit, en temps réel et côte à côte, comment différents ordinateurs réagissent : NDL, paliers, vitesse de remontée, alarmes, saturation, consommation de gaz, toxicité de l'oxygène.

Interface disponible en français et en anglais, unités métriques ou impériales.

> [!WARNING]
> **Outil pédagogique uniquement. Ne l'utilisez jamais pour planifier ou conduire une vraie plongée.**
> Les calculs sont des approximations et peuvent différer sensiblement de ceux d'un ordinateur réel. Suivez toujours votre formation, vos tables et les instructions du fabricant de votre équipement.
>
> **Encadrants :** vous restez responsables de votre enseignement. Le simulateur illustre des principes ; il ne remplace ni le manuel de l'ordinateur réel de chaque élève, ni les procédures et tables de votre fédération. Voir [Pour les encadrants](#pour-les-encadrants) et [Conditions d'utilisation](#conditions-dutilisation).

## Ordinateurs simulés

| Modèle | Algorithme | Fidélité |
| --- | --- | --- |
| Aqualung i330R (mode Dive) | Bühlmann ZHL-16C + GF | Approximation (≈) : l'appareil réel ajoute une marge non documentée (paliers plus longs de 2 à 3 min qu'en GF 90/90 lors de comparaisons réelles), non simulée |
| Aqualung i770R (mode Dive) | Pelagic Z+ | Approximation (≈) |
| Azoth Systems Odyssey (circuit ouvert) | Bühlmann ZHL-16C + GF | Approximation (≈) : première plongée avec les paramètres publiés ; la majoration brevetée des plongées successives (Standard par défaut) n'est pas publiée, non simulée |
| Shearwater Perdix 2 (modes Nitrox, 3 GasNx et OC Tec) | Bühlmann ZHL-16C + GF | Algorithme public, paramètres publiés |
| Shearwater Peregrine TX (modes Air / Nitrox et 3 GasNx) | Bühlmann ZHL-16C + GF | Algorithme public, paramètres publiés |
| Garmin Descent Mk3i (modes Single-Gas et Multi-Gas) | Bühlmann ZHL-16C + GF | Algorithme public, paramètres publiés |
| Suunto D5 | Fused RGBM 2 | Approximation (≈) |
| Suunto Zoop Novo | Suunto RGBM | Approximation (≈) |
| Suunto Nautic (modes Single gas et Multigas) | Suunto Bühlmann 16 GF (ZHL-16C + GF) | Algorithme public, paramètres publiés |
| Mares Puck Pro | Mares RGBM | Approximation (≈) |
| Mares Quad Ci | Bühlmann ZH-L16C + GF | Algorithme public, paramètres publiés (R1, R2, T1, T2 interpolés) |
| Mares Quad 2 | Bühlmann ZH-L16C + GF | Algorithme public, paramètres publiés (R1, R2, T1, T2 repris des autres Mares) |
| Mares Quad Air | Mares RGBM | Approximation (≈) |
| Mares Genius | Bühlmann ZH-L16C + GF | Algorithme public, paramètres publiés (R2, T1, T2 interpolés) |
| Scubapro Galileo 2 (G2) | ZH-L16 ADT MB | Approximation (≈) |
| Scubapro Luna 2.0 AI | ZH-L16 ADT MB ou ZH-L16C + GF | Approximation (≈) pour ADT MB, paramètres publiés pour ZH-L16C + GF |
| Cressi Goa | Cressi RGBM | Approximation (≈) |
| Cressi Donatello | Cressi RGBM | Approximation (≈) |

Les algorithmes propriétaires (RGBM, ZH-L16 ADT MB, Pelagic Z+) ne sont pas publiés : ils sont approchés à partir de Bühlmann ZHL-16C avec des facteurs de gradient et des pénalités calibrés sur des valeurs publiées. L'Aqualung i330R annonce Bühlmann ZHL-16C + GF mais s'en écarte d'une façon non documentée : il est simulé ici avec ses facteurs de gradient publiés, marqué ≈. De même, l'Azoth Systems Odyssey majore les plongées successives d'une façon non publiée : sa première plongée est un Bühlmann + GF pur, les suivantes ne sont pas majorées ici.

**Algorithme public ne veut pas dire valeurs identiques.** Pour les modèles marqués « algorithme public » (✓), le simulateur applique Bühlmann ZHL-16C avec les facteurs de gradient publiés par le fabricant. L'appareil réel peut toutefois s'en écarter : arrondis des paliers et des durées, vitesse de remontée supposée par le calcul, profondeur du dernier palier, plafond continu ou paliers de 3 m, densité de l'eau et pression de surface, définition du NDL, marges de sécurité non documentées, mises à jour du firmware. Des écarts de quelques minutes sur les paliers sont donc normaux. Quand un écart est constaté et documenté (comme pour l'Aqualung i330R), le modèle passe en ≈ avec une explication, et le changement est noté dans le [journal des corrections](CHANGELOG.md). Les écrans et les règles (alarmes, paliers, verrouillages…) s'inspirent des manuels utilisateurs publics de chaque modèle.

Dans l'application, un avertissement s'affiche à chaque visite (usage pédagogique, algorithmes approchés, absence d'affiliation) et une légende ✓ / ≈ au-dessus de chaque ordinateur rappelle qu'il s'agit d'une interprétation non officielle. Dans l'onglet Comparer, la profondeur et la durée du palier et la DTR des ordinateurs ≈ ne sont pas affichées en décompression (seulement « Palier obligatoire », avec l'estimation extrapolée non vérifiée au survol) : seul leur temps sans palier est calé sur des valeurs publiées ; on compare donc leurs réactions, pas les minutes.

> [!NOTE]
> **Les interfaces sont des interprétations, pas des reproductions.** Elles sont inspirées des modèles cités et peuvent en différer sur de nombreux points : disposition, couleurs, polices, textes, menus, comportements, alarmes, réglages disponibles ou valeurs calculées. Seule une partie des modes et des fonctions de chaque appareil est simulée, et les fabricants peuvent faire évoluer leurs produits (firmware, affichage) sans que ce simulateur soit mis à jour. En cas de doute, le manuel officiel et l'appareil réel font foi.

## Démarrage

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm run dev       # serveur de développement Vite
npm run build     # vérification TypeScript + build de production dans dist/
npm run preview   # sert le build de production
```

Scripts d'analyse en ligne de commande :

```bash
npm run calib     # tables de NDL par profondeur et par GF (calibration)
npm run scenario  # rejoue un profil de plongée sur tous les ordinateurs
npm run stops     # contrôle le comportement aux paliers de déco de chaque ordinateur
```

## Commandes

- Toucher ou cliquer (et glisser) dans l'eau, ou la molette, pour aller à une profondeur (à la dernière vitesse choisie ; 9 m/min en montée et 18 m/min en descente par défaut).
- ▲ / ▼ (boutons ou flèches du clavier) pour régler la vitesse de montée ou de descente par pas de 1 m/min ; ■ ou `0` pour se stabiliser.
- Pause et vitesse du temps (×1 à ×300) dans la barre sous la colonne d'eau (ou la vue 3D), toujours visible ; au clavier, `+` / `−` pour accélérer ou ralentir le temps, `Espace` pour mettre en pause.
- **Comment s'en servir ?** (à côté du titre, ou « Visite guidée » dans l'avertissement d'accueil) lance une visite guidée de l'interface.
- Les boutons des ordinateurs sont cliquables, avec appui long quand le modèle en a un. Au survol de la souris, une info-bulle indique la fonction réelle de chaque bouton pendant la plongée (d'après le manuel du fabricant) et précise ce qui n'est pas simulé ; les boutons sans aucune fonction simulée apparaissent grisés.

- 🔇 / 🔊 (dans l'en-tête) active ou coupe les sons des alarmes des ordinateurs (coupés par défaut, le choix est mémorisé). Chaque modèle sonne comme le décrit son manuel : bips (Mares, Scubapro, Cressi, Aqualung), sons et vibrations (Garmin, Suunto), vibrations seules pour le Perdix 2 et le Peregrine TX. Une vibration est jouée comme un bourdonnement, fait trembler l'ordinateur à l'écran et, sur les téléphones qui le permettent (Android), vibre vraiment. Les alarmes qui se répètent jusqu'à acquittement s'arrêtent quand on appuie sur un bouton de l'ordinateur (SELECT sur le Perdix 2, l'un ou l'autre bouton sur le Peregrine TX). Les réglages de chaque modèle comprennent son propre interrupteur (ALRM, All silent, Silent diving…).
- **Alertes** : chaque ordinateur affiche toutes les alarmes, avertissements et notifications de son manuel (texte, couleurs, sons, acquittement). Celles qui se règlent sur l'appareil (profondeur, durée, NDL, CNS, pression du bloc : réserve, demi-bloc, demi-tour…) sont dans « Réglages avancés › Réglage des alertes », avec les possibilités et les valeurs par défaut de son manuel. Les réglages avancés sont rangés par thème : plongée, algorithme et paliers, alertes, sons et vibrations, affichage.
- 🎓 (dans l'en-tête) **explique les alertes** : quand une alarme se déclenche, une bulle à côté de l'ordinateur dit ce qui se passe et ce qu'il faut faire : conseils généraux de formation pour les alarmes communes et, pour **chaque alerte de chaque modèle**, son libellé à l'écran, ce qui la déclenche sur cet appareil (seuils, couleurs, sons, verrouillage, pénalités, d'après son manuel) et ce qu'il faut y faire (acquittement, action requise). Le bouton passe de « bulles » (par défaut) à « bulles + pause » (la simulation s'arrête sur les alertes graves : remontée rapide, palier manqué, ppO₂ trop élevée, verrouillage, bloc vide), puis à « désactivé ». Un temps accéléré revient à ×1 quand une alerte est expliquée, pour laisser le temps de réagir. Sur téléphone, l'alerte s'affiche d'abord dans un bandeau d'une ligne sous l'ordinateur, pour que la colonne d'eau et ses commandes restent utilisables ; « Pourquoi ? » ouvre la bulle et met en pause le temps de la lire. Chaque alerte est expliquée une fois par plongée, jamais pendant un exercice ; « Ne plus expliquer cette alerte » la fait taire jusqu'à ce qu'on désactive puis réactive les explications. **Débriefing** : les alertes de l'ordinateur affiché sont marquées sur le profil de la plongée (en cours de plongée et pour chaque plongée du carnet), colorées selon leur gravité ; le survol d'un repère donne l'heure, la profondeur et le nom de l'alerte, un clic ouvre son explication.
- **ⓘ Détails de la simulation** (onglet Réglages) ouvre une fenêtre qui présente le modèle : ce qui est simulé d'après le manuel, les valeurs supposées ou déduites quand le manuel ne les donne pas, ce qui n'est pas simulé, et ses alertes réglables avec les valeurs en cours.

## Exercices

L'onglet **Exercices** propose des situations à provoquer et observer, pour un élève en autonomie : arriver au bout du temps sans palier, remonter trop vite, faire le palier de sécurité, faire ses paliers de décompression, passer au-dessus d'un palier, dépasser la profondeur maximale du mélange, faire une plongée successive, passer sur un gaz de déco (ordinateurs multigaz seulement). Chaque exercice remet la plongée à zéro et démarre, en pause, dans une situation décrite (par exemple « à 25 m depuis 10 min ») ; le simulateur vérifie l'état du plongeur pour savoir s'il est réussi. Le bilan liste ce que l'ordinateur choisi a signalé et quand, et ce que disent ses règles (d'après son manuel). Les exercices portent sur les comportements (quel signal, quand, quelles conséquences), pas sur les durées de palier, qui ne sont qu'approchées pour les algorithmes propriétaires. Les exercices réussis sont mémorisés dans le navigateur, par ordinateur : refaire un exercice avec un autre modèle montre à quel point leurs réactions diffèrent.

## Plusieurs gaz

L'onglet Réglages permet d'emporter jusqu'à deux gaz de décompression (nitrox de 40 à 80 % ou oxygène pur), chacun dans un bloc relais (7 L, AL40 ou AL80, rempli avant la plongée). On change de gaz en plongée avec les boutons de l'ordinateur affiché, selon la procédure de son manuel (invite au MOD du gaz, menu ou liste des gaz, confirmation) ; le gaz respiré change alors pour tous les ordinateurs comparés, et la consommation est prise sur son bloc. Les gaz de déco sont classés par teneur croissante en oxygène (G2 sous G3, comme l'exigent les Mares) ; un bloc relais vide (ou sur lequel on rebascule une fois vide) renvoie le plongeur sur son bloc principal, avec un avis sous l'ordinateur pendant 30 s et une note au carnet, au lieu de déclencher l'alerte secours de panne d'air. L'émetteur est sur le bloc principal : les ordinateurs qui associent un émetteur à chaque gaz (Mares, Scubapro, Suunto D5 et Nautic, Garmin, Aqualung i770R) n'affichent pas de pression sur un gaz de déco, les Shearwater et l'Odyssey continuent d'afficher T1. Les ordinateurs dont le mode simulé gère plusieurs gaz : Mares Quad Ci, Genius, Quad 2, Quad Air (3 gaz) et Puck Pro (2) ; Scubapro G2 et Luna 2.0 AI (option PMG à activer) ; Suunto D5 (option Multiple gases à activer) et Nautic (mode Multigas, jusqu'à 5 gaz, invite SWITCH GAS) ; Aqualung i330R (3) et i770R (4) ; Azoth Systems Odyssey ; Garmin Descent Mk3i (mode Single-Gas : gaz de secours, hors calcul tant qu'ils ne sont pas activés ; mode Multi-Gas : gaz de décompression, invite « Safe to switch to… », Not Now / Never font du gaz un gaz de secours) ; Shearwater Perdix 2 (mode 3 GasNx, par défaut, jusqu'à 3 gaz ; mode OC Tec avec son écran technique, jusqu'à 5 gaz, GF 30/70, sans palier de sécurité) et Peregrine TX (mode 3 GasNx, par défaut), avec le menu Select Gas (les gaz 2 et 3 peuvent être désactivés dans les réglages, comme dans Define Gas : affichés en magenta et hors calcul, ils sont réactivés s'ils sont sélectionnés sous l'eau). Selon le manuel, le temps de remontée compte tous les gaz emportés (Quad Ci, Quad 2 et Genius en mode PREDICTIVE, G2 et Luna sauf gaz exclu après une invite sans réponse, D5, Nautic, Shearwater sauf gaz désactivés, Garmin en mode Multi-Gas sauf gaz de secours, DTR de l'Odyssey) ou seulement le gaz respiré (Quad Air, comme le dit son manuel ; Puck Pro, i330R et i770R, non précisé par leurs manuels). Tous les ordinateurs multigaz permettent de revenir au gaz fond par leur menu ou leur liste de gaz. Le Goa, le Donatello et la Zoop Novo n'ont qu'un gaz dans le mode simulé, comme la Perdix 2 et la Peregrine TX en mode Nitrox. Un ordinateur qui ne connaît pas le gaz respiré (modèle monogaz, ou plus de gaz emportés qu'il n'en gère) garde le dernier gaz programmé : son affichage, sa MOD, son temps sans palier et son plan de remontée utilisent ce gaz, les tissus restant ceux du plongeur (partagés par tous les ordinateurs, une limite du simulateur). L'exercice « Passer sur le gaz de déco » est proposé sur les ordinateurs multigaz ; les autres se font avec un seul gaz.

## Surface, bateau et plongées successives

Le bloc n'est pas rempli automatiquement entre deux plongées. Cinq secondes après être remonté en surface au cours d'une plongée, un bateau vient se placer près du plongeur et propose trois choix, dans une bulle de BD, en vue 2D comme en 3D. **Pause à bord** (de 15 min à 4 h, durée choisie dans une liste) : le plongeur monte à bord, la plongée est terminée, l'intervalle surface s'écoule pendant une courte animation (le plongeur nage jusqu'à l'échelle descendue du bateau et y grimpe, pendant que la bulle raconte une blague de plongeur tirée au hasard), puis le plongeur est remis à l'eau avec un bloc plein ; la descente suivante est une nouvelle plongée. **Repartir avec un bloc plein** : le bloc est passé dans l'eau ; redescendre dans les 3 minutes poursuit la même plongée, comme pour les ordinateurs. **Continuer avec ce bloc** : le bateau repart. Après une remontée clairement trop rapide (plus de 15 m/min en moyenne sur ses 10 derniers mètres, le critère de l'alerte secours, quel que soit l'ordinateur), le bateau signale d'abord que la remontée était trop rapide et qu'il faut déclencher la procédure adaptée selon sa formation. Le manomètre affiché à côté de l'ordinateur s'ouvre d'un clic ou d'un toucher en fenêtre flottante, que l'on peut déplacer où l'on veut et redimensionner par son coin (pour le suivre à côté de l'ordinateur, par exemple pour vérifier une règle de planification de l'air pendant la remontée) ; un toucher ou sa croix le remet en place. Sa position et sa taille sont mémorisées. La plongée est aussi clôturée après 3 minutes en surface. Les tissus restent chargés d'une plongée à l'autre ; le carnet indique le type de chaque plongée : consécutive (moins de 15 min d'intervalle surface), successive (moins de 12 h) ou simple.

## Tables MN90

> [!NOTE]
> Transcription non officielle, ni publiée ni approuvée par la FFESSM : seul le livret fédéral fait foi.

Le bouton **MN90** (dans l’en-tête, à côté de la liste des ordinateurs) ouvre à tout moment les tables fédérales à l’air (tables FFESSM établies à partir des MN90 de la Marine nationale, livret de juillet 2005) et montre où en est le plongeur (la plongée est en pause tant qu’elle est ouverte et reprend à la fermeture), sous forme d’un livre dont on tourne les pages (◀ ▶ ou flèches du clavier) : d’abord la plongée (type, profondeur, durée, résultat), puis chaque table utilisée dans l’ordre de lecture — tableau I (GPS de la plongée précédente × intervalle de surface → azote résiduel), tableau II (azote résiduel × profondeur de la 2ᵉ plongée → majoration) pour une plongée successive, puis la table de la profondeur (ligne → paliers, DTR, GPS) — avec la ligne, la colonne et la valeur lue en surbrillance et la lecture expliquée (valeur immédiatement supérieure ou inférieure, comme le veut le livret). En plongée : les paliers si le plongeur quittait le fond maintenant et le passage à la ligne suivante ; en surface : la dernière plongée et les tables à lire avant de replonger. Règles du livret appliquées : durée comptée jusqu’au départ du fond, toute minute entamée compte ; une remontée plus lente que 15 m/min ajoute sa durée jusqu’au premier palier (remontée lente), la durée s’arrête donc à l’arrivée au premier palier (en surface sans palier) ; plongées consécutives (moins de 15 min) : durées additionnées, profondeur la plus grande ; successives (15 min à 12 h) : majoration ; nitrox : profondeur équivalente ; avertissements pour les tables de secours au-delà de 60 m, une plongée précédente sans GPS (*), hors table, plus de deux plongées en 24 heures, remontée rapide. Non simulés : procédures de remontée rapide et de palier interrompu, paliers à l’oxygène pur, tableau III (oxygène en surface), altitude. L’onglet Comparer a aussi une ligne MN90 pour la plongée en cours : temps sans palier restant, premier palier, DTR (colonne TTS) et GPS ; un clic ouvre les tables. Une case vide du tableau I est lue comme « plus d’azote résiduel à compter » (le livret ne le précise pas).

## Vue 3D

Le bouton **2D | 3D** en haut de la zone de plongée bascule vers une vue 3D ludique, avec trois environnements : récif corallien (platier, tombant vers le sable et patates de corail), épave (colonisée par les coraux) et tombant (plateau et paroi plongeant dans le bleu). Le plongeur nage librement : glisser horizontalement, les flèches ◀ / ▶ du clavier ou les boutons à l'écran le font tourner (tour complet possible), glisser verticalement change la profondeur visée. Clic droit ou Maj + glisser pour pivoter la caméra, double-clic pour la recentrer. Le fond, l'épave, les rochers et les coraux sont solides : le plongeur les longe au lieu de les traverser et se pose dessus s'il descend ; ils ne le font jamais remonter, le profil reste entièrement sous le contrôle de l'utilisateur. Rendu : caustiques, lumière qui s'assombrit et bleuit avec la profondeur (une lampe prend le relais), fenêtre de Snell, coraux, herbiers et algues ondulants ; en surface, la caméra passe au-dessus de l'eau : ciel, houle avec de l'écume sur les crêtes, plongeur et bateau qui la suivent. Faune : bancs de poissons, tortue, anémones dont les poissons-clowns se cachent à l'approche du plongeur, étoiles de mer et oursins, méduses qui pulsent, raies aigles qui planent et requins de récif qui gardent leurs distances. La simulation est identique dans les deux vues ; three.js n'est chargé qu'à la première ouverture de la vue 3D.

## Structure

```
src/engine/      moteur : Bühlmann ZHL-16C + GF, gaz, toxicité O2 (CNS/OTU), session de plongée, tables MN90
src/computers/   un dossier par ordinateur simulé (regroupés par marque quand ils partagent des
                 règles : mares/, scubapro/, cressi/, suunto/) : rules.ts (règles propres au modèle),
                 index.ts (affichage et boutons), sa feuille de style ; base/ et common/ sont partagés
src/app/         interface : réglages, onglets, dialogues, visite guidée, carnet, exercices, boucle de simulation
src/ui/          scène 2D (colonne d'eau), vue 3D (scene3d/, three.js), graphiques, jauges, visite
src/styles/      feuilles de style de la page (celles des ordinateurs sont à côté de leur code)
scripts/         scripts de calibration, de scénarios et de non-régression (snapshot)
```

## Pour les encadrants

De nombreux encadrants utilisent le simulateur en cours. Dans ce cas :

- **Vous restez responsable de votre enseignement.** Le simulateur illustre des principes (saturation, paliers, réactions des ordinateurs à une erreur) ; il ne remplace ni le manuel de l'ordinateur réel de chaque élève, ni les procédures, tables et contenus de formation de votre fédération.
- **Vérifiez ce que vous présentez** dans le manuel officiel du modèle affiché (la fenêtre « ⓘ Détails de la simulation » liste, pour chaque modèle, ce qui est simulé, supposé ou non simulé).
- **Rappelez aux élèves** que leur propre ordinateur peut se comporter autrement (firmware, réglages, modèle), et que les durées de palier des ordinateurs ≈ ne sont qu'approchées.
- Signalez tout écart constaté (issue ou e-mail) : il sera corrigé et noté dans le [journal des corrections](CHANGELOG.md).

## Conditions d'utilisation

Ces conditions sont aussi affichées dans l'application (À propos › Conditions d'utilisation).

- **Usage prévu :** découverte et enseignement de la plongée, uniquement. N'utilisez jamais le simulateur pour planifier, conduire ou vérifier une vraie plongée, ni pour choisir ou régler un équipement.
- **Absence de garantie :** le simulateur est fourni gratuitement, « tel quel », sans garantie d'exactitude, de complétude ni d'adéquation à un usage particulier (GNU AGPL v3, articles 15 et 16). Dans les limites permises par la loi, ses auteurs ne sauraient être tenus responsables de son utilisation.
- **Limites connues :** les algorithmes marqués ≈ sont approchés et leurs valeurs diffèrent de l'appareil réel ; même un algorithme public (✓) peut être appliqué autrement par l'appareil réel (arrondis, hypothèses de calcul, marges non documentées) ; les écrans sont des interprétations ; seule une partie des modes et des fonctions est simulée ; les tissus sont communs à tous les ordinateurs comparés ; les fabricants peuvent modifier leurs appareils sans que le simulateur suive.
- **Tables MN90 :** transcription non officielle du livret FFESSM de juillet 2005, ni publiée ni approuvée par la FFESSM. Seul le livret fédéral fait foi.
- **Corrections :** une erreur signalée (écart avec un manuel, calcul erroné) est corrigée dès que possible et notée dans le [journal des corrections](CHANGELOG.md).
- **Contact :** [antoalex@free.fr](mailto:antoalex@free.fr) ou une issue GitHub.

## Marques et affiliation

Ce projet est indépendant et **n'est ni affilié, ni approuvé, ni sponsorisé** par les fabricants cités. Aqualung, Aqua Lung, Azoth Systems, Odyssey, Shearwater, Perdix, Peregrine, Garmin, Descent, Suunto, Zoop, Nautic, Mares, Puck, Quad, Genius, Scubapro, Galileo, Luna, Cressi, Goa et Donatello sont des marques de leurs propriétaires respectifs ; elles sont citées uniquement pour identifier les modèles dont les interfaces sont inspirées. Aucun logo, code ou élément graphique des fabricants n'est inclus.

Si vous représentez l'un de ces fabricants et souhaitez qu'un élément soit modifié ou retiré, ouvrez une issue.

## Licence

Copyright © 2026 Antoine ALEXANDRE — [https://github.com/Antjac/DiveComputerSimulator](https://github.com/Antjac/DiveComputerSimulator)

Logiciel libre sous [licence publique générale GNU Affero v3.0](LICENSE) (GNU AGPL) ou, à votre choix, toute version ultérieure.

- **Chacun peut utiliser librement le simulateur**, y compris les moniteurs, les clubs et les centres de plongée commerciaux.
- **Vous pouvez étudier, modifier et redistribuer le code**, à condition de conserver cette mention de copyright et de diffuser votre version sous la même licence, avec son code source complet.
- **Cela vaut aussi en ligne :** quiconque met une version modifiée à disposition sous forme de site ou de service doit proposer à ses utilisateurs le code source complet de cette version (AGPL, article 13).

Le logiciel est fourni « tel quel », sans aucune garantie. Les auteurs ne sauraient être tenus responsables de son utilisation.
