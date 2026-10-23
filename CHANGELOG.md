# Journal des corrections / Change log

Ce journal recense les corrections de calcul et de comportement (écarts avec un manuel, erreurs de
paliers, de NDL, d'alarmes…) et les changements notables du simulateur (nouvelles fonctions,
changements d'interface), avec leur date. Pour signaler une erreur : une issue GitHub ou
antoalex@free.fr. Le détail est dans l'historique Git.

This log records fixes to calculations and behaviour (gaps with a manual, wrong stops, NDL,
alarms…) and notable changes to the simulator (new features, interface changes), with their date.
To report an error: a GitHub issue or antoalex@free.fr. Details are in the Git history.

Format : `AAAA-MM-JJ` · modèle(s) · correction ou changement (FR) / fix or change (EN).

## 2026-10-23

- Outils / Tools · Nouveau script `npm run dsl` : rejoue les essais en caisson publiés par Deeply Safe Labs (2 × 30 m / 30 min et 6 × 30 m / 16 min) sur les modèles correspondants (Perdix 2, Descent, G2, Luna, Quad Air) et compare les paliers mesurés sur les vrais appareils à ceux du simulateur ; échoue si un modèle exact (Bühlmann + GF) s'en écarte trop / New `npm run dsl` script: replays the chamber tests published by Deeply Safe Labs (2 × 30 m / 30 min and 6 × 30 m / 16 min) on the matching models (Perdix 2, Descent, G2, Luna, Quad Air) and compares the stops measured on the real computers with the simulator's; fails if an exact model (Bühlmann + GF) strays too far.

## 2026-10-16

- Tous / All · Nouveau : volets redimensionnables sur grand écran (largeur de la colonne d'eau et des onglets, hauteur de la courbe de profil) en faisant glisser leurs bords ; double-clic pour revenir à la taille par défaut ; tailles mémorisées / New: resizable panes on wide screens (width of the water column and of the side panel, height of the profile chart) by dragging their edges; double-click for the default size; sizes remembered.
- Shearwater Perdix 2, Peregrine TX et Teric · Réglages : « Gaz 2 / Gaz 3 (Define Gas / Edit Gases) » deviennent « Gaz de déco 1 / 2 (gaz 2 / 3, …) », comme les gaz de déco de la page / Settings: “Gas 2 / Gas 3 (Define Gas / Edit Gases)” become “Deco gas 1 / 2 (gas 2 / 3, …)”, as the page's deco gases.

## 2026-10-15

- Tous / All · Téléphones : la bulle du bateau, plus haute que la colonne d'eau, avait son bas (dernier choix) caché sous les commandes de temps ; elle déborde maintenant sur l'ordinateur et reste entière. Les fenêtres (dont le récapitulatif de plongée) tiennent dans la partie visible de l'écran, sous la barre d'adresse ; dans le récapitulatif, les chiffres clés passent sur deux colonnes et les graphiques sont dessinés à la largeur de l'écran (leur texte devenait illisible) / Phones: the boat's speech bubble, taller than the water column, had its bottom (last choice) hidden under the time controls; it now spills over the computer and stays whole. Dialogs (the dive recap among them) fit in the visible part of the screen, under the address bar; in the recap, the key figures go in two columns and the charts are drawn at the screen's width (their text was unreadable).
- Shearwater Teric, Perdix 2 et Peregrine TX · Réglages « Gaz n » (On / Off) : proposés seulement pour les gaz réellement portés. Le Teric proposait les gaz 2 à 5 alors que le simulateur ne porte que 2 gaz de déco ; les gaz 4 et 5 n'avaient aucun effet / “Gas n” settings (On / Off): offered only for the gases actually carried. The Teric offered gases 2 to 5 while the simulator carries only 2 deco gases; gases 4 and 5 had no effect.
- Shearwater Peregrine TX et Perdix 2 · Champ RATE : en remontée, les chiffres passent sur fond jaune au-delà de 10,5 m/min et sur fond rouge au-delà de 19,5 m/min (notes de version du firmware 78, absent du manuel du Peregrine). Perdix 2 : RATE ajouté aux options de la ligne centrale du mode OC Tec (manuel technique, §4.4) / RATE field: while ascending, the digits turn to a yellow background above 10.5 m/min and a red one above 19.5 m/min (firmware 78 release notes, not in the Peregrine manual). Perdix 2: RATE added to the OC Tec centre row options (Technical manual, §4.4).
- Garmin Descent X50i · Boussole : cap du plongeur (tourné dans la vue 3D, rejoué dans le replay) sur la bande de l'écran principal et sur le cadran plein écran (NEXT) ; ENTER > Set Heading et Compass (Change Heading, Set to Recip., Set to 90L / 90R, Clear Heading), écart DEVIATION, arc vert vers le cap réglé, marque rouge au cap inverse / Compass: the diver's heading (turned in the 3D view, replayed in the replay) on the primary screen's tape and the full-screen dial (NEXT); ENTER > Set Heading and Compass (Change Heading, Set to Recip., Set to 90L / 90R, Clear Heading), DEVIATION, green arc to the set heading, red mark at the reciprocal.
- Cressi DaVinci · Nouveau modèle (mode Computer), d'après son manuel : écran couleur des figures (NO DECO, palier, DECO ENTRY, BACK TO STOP DEPTH, SLOW!), barre ASC selon la profondeur, pénalité de 1,5 min par minute au-dessus du palier et mode violation, palier de sécurité et deep stop, 4 gaz et SWITCH TO, alarmes acquittées par R / New model (Computer mode), after its manual: colour display of the figures (NO DECO, stop, DECO ENTRY, BACK TO STOP DEPTH, SLOW!), depth-dependent ASC bar, 1.5 min penalty per minute above the stop and violation mode, safety stop and deep stop, 4 gases and SWITCH TO, alarms acknowledged with R.
- Outil de mise en page (dev) · Les écrans SVG carrés ne sont plus contrôlés comme des écrans ronds / Layout tool (dev): square SVG screens are no longer checked as round ones.
- SEAC Screen et Tablet · Nouveaux modèles (mode SCUBA), d'après leurs manuels : écran à segments des figures, palier de sécurité et deep stop réglables, points de pénalité et verrouillage de 18 h, changement de mélange, sonde de bloc du Tablet ; GF des niveaux de protection non publiés (valeurs du SEAC Guru supposées) / New models (SCUBA mode), after their manuals: segmented display of the figures, settable safety stop and deep stop, penalty points and 18 h lock, mix change, Tablet tank probe; GF of the protection levels not published (SEAC Guru values assumed).
- Garmin Descent X30 et X50i · Nouveaux modèles (modes Single-Gas et Multi-Gas), d'après leurs manuels : écrans principaux, bandeaux STOP et DECO, écran Dynamic Depth, écran de l'émetteur (X50i), alertes du tableau Dive Alerts, invite de changement de gaz qui revient au bout de 2 min / New models (Single-Gas and Multi-Gas modes), after their manuals: main screens, STOP and DECO banners, Dynamic Depth screen, transceiver screen (X50i), alerts of the Dive Alerts table, gas switch prompt coming back after 2 minutes.

## 2026-10-14

- Tous / All · Replay : le bateau restait affiché pendant tout le replay quand il était venu en fin de
  plongée. Il suit maintenant la plongée rejouée : présent en surface (après 5 s, comme en direct) et
  après la fin de la plongée, absent sous l'eau. Un replay lancé pendant une pause à bord ne fait plus
  avancer la pause sur la plongée rejouée / Replay: the boat stayed on screen for the whole replay when
  it had come at the end of the dive. It now follows the replayed dive: there at the surface (after 5 s,
  as live) and once the dive is over, gone underwater. A replay opened during a break on board no longer
  runs the break on the replayed dive.
- Tous / All · Mises à jour de l'application : une nouvelle version n'efface plus les fichiers de la
  page encore ouverte (la vue 3D devenait « indisponible » jusqu'à une actualisation). Elle est
  cherchée aussi au retour dans l'application et toutes les heures, puis installée d'elle-même si
  rien n'est perdu (pas de plongée depuis l'ouverture) ; sinon un bandeau propose « Mettre à jour » /
  App updates: a new version no longer removes the files of the page still open (the 3D view became
  "unavailable" until a reload). It is also looked for when coming back to the app and every hour,
  then put in by itself when nothing is lost (no dive since the app was opened); otherwise a banner
  offers "Update".
- Tous / All · Replay sur téléphone : la barre du replay, trop haute, écrasait la colonne d'eau et
  passait sous les onglets. Elle tient désormais sur trois lignes courtes : boutons en icônes (libellé
  en infobulle) sauf « Reprendre », sans les sauts de ±1 min (le curseur les remplace), note dans
  l'infobulle du badge REPLAY / Replay on phones: the replay bar, too tall, squeezed the water column
  to nothing and ran under the tabs. It now fits in three short rows: buttons as icons (label as a
  tooltip) except "Resume", no ±1 min jumps (the slider does it), the note in the REPLAY badge's
  tooltip.
- Mares Quad Ci · Vitesse de remontée (§11) : pendant une remontée, la valeur en m/min (ou ft/min)
  s'affiche à côté de NO DECO / DECO dans les deux mises en page (elle n'apparaissait qu'avec l'alarme
  SLOW!), et en FULL les deux barres (N2 et pression) deviennent le graphique de vitesse (vert, jaune
  au-delà de 80 %, rouge au-delà de 100 %) au lieu de rester sur N2 / Ascent rate (§11): while
  ascending, the value in m/min (or ft/min) is shown next to NO DECO / DECO in both layouts (it only
  appeared with the SLOW! alarm), and in FULL both dividers (N2 and tank pressure) turn into the speed
  graph (green, yellow above 80 %, red above 100 %) instead of staying on N2.
- Tous / All · Nouveau : mode replay dans le récapitulatif de plongée (« Revoir la plongée »). La
  plongée est rejouée en 2D sur les ordinateurs : pause, vitesses, avance et retour, saut à un instant
  ou à une alerte, changement d'ordinateur ; le plongeur ne peut plus être manœuvré. Réservé aux
  plongées faites après cette version ; les appuis sur les boutons de l'ordinateur ne sont pas
  rejoués / New: replay mode in the dive recap ("Replay the dive"). The dive is played again in 2D on
  the computers: pause, speeds, forward and back, jump to a moment or an alert, switch computers; the
  diver can no longer be steered. Only for dives made after this version; button presses on the
  computer are not replayed. Mettre la plongée en pause passe automatiquement en replay, sans
  l'interrompre ; « Reprendre » la relance là où elle en était / Pausing the dive switches to the
  replay by itself, without interrupting it; "Resume" carries on where it left off.
- Tous / All · Alerte de secours : « Recommencer » devient « Faire une nouvelle plongée », un bouton
  « Voir le récapitulatif de cette plongée » est ajouté et « Masquer » (qui ne laissait rien faire)
  disparaît / Rescue alert: "Start over" becomes "Start a new dive", a "See this dive's recap" button
  is added and "Hide" (which left nothing to do) is gone.
- Tous / All · Quand l'alerte de secours arrête la simulation (panne d'air, remontée trop rapide,
  paliers non faits), la plongée est maintenant ajoutée au carnet avec le signe ⛔ « Interrompue » et
  son récapitulatif s'ouvre, replay compris / When the rescue alert stops the simulation (out of air,
  ascent too fast, stops not done), the dive is now added to the logbook with a ⛔ "Cut short" sign
  and its recap opens, replay included.

## 2026-10-13

- Mares Quad 2, Quad Ci, Genius · Deep stop : la profondeur proposée n'est plus recalculée pendant
  la remontée vers le palier (le tissu de 27 min charge encore en montant, le palier s'éloignait du
  plongeur) / Deep stop: the suggested depth is no longer recomputed while ascending toward the stop
  (the 27 min tissue still loads on the way up, the stop moved away from the diver).
- Mares Puck Pro, Quad Air · Deep stop : même règle que les Quad 2 et Quad Ci (profondeur où le 5ᵉ
  tissu passe de la saturation à la désaturation), au lieu de la moitié de la pression absolue de la
  profondeur maximale au-delà de 20 m ; fenêtre de ±1 m (§3.3). Profondeur non donnée par les
  manuels : règle supposée / Deep stop: same rule as the Quad 2 and Quad Ci (depth where the 5th
  tissue switches from ongassing to offgassing), instead of half the absolute pressure of the
  maximum depth beyond 20 m; ±1 m window (§3.3). Depth not given by the manuals: assumed rule.
- Mares Quad Air · Deep stop ajouté (absent jusqu'ici), affiché en haut à droite avec DEEP,
  premier palier d'une plongée avec déco et compté dans l'ASC (§3.3) ; réglage DEEp (§2.2.1) /
  Deep stop added (missing until now), shown top right with DEEP, first stop of a deco dive and
  counted in the ASC (§3.3); DEEp setting (§2.2.1).
- Mares Puck Pro · Réglage DEEp pour masquer le deep stop (notes de version du firmware V4.0, absent
  du manuel) / DEEp setting to hide the deep stop (firmware V4.0 release notes, not in the manual).

## 2026-10-11

- Mares Quad 2, Quad Ci, Quad Air, Genius, Puck Pro · Redescendu sous 6 m pendant le palier de
  sécurité, l'écran revient à NO DECO au lieu de laisser SAFETY STOP figé ; le décompte reprend
  entre 6 et 3 m et repart de zéro au-delà de 10 m. Non décrit par les manuels : comportement
  rapporté sur un Quad et un Matrix (remise à zéro supposée) / Back below 6 m during the safety
  stop, the screen returns to NO DECO instead of leaving SAFETY STOP frozen; the countdown resumes
  between 6 and 3 m and restarts from zero beyond 10 m. Not described by the manuals: behaviour
  reported on a Quad and a Matrix (reset assumed).

## 2026-10-09

- Mares Quad 2, Quad Ci, Genius · PREDICTIVE : au retour sur un gaz moins riche au-dessus du MOD du
  gaz quitté, ce gaz sort du calcul tout de suite, et non plus après 20 s (Quad 2) ou 30 s (Quad Ci,
  Genius) ; comportement supposé, non décrit par les manuels (#19) / PREDICTIVE: back to a leaner
  gas above the MOD of the gas left, that gas leaves the calculation at once, no longer after 20 s
  (Quad 2) or 30 s (Quad Ci, Genius); assumed behaviour, not described by the manuals (#19).
- Tous / All · Avertissement aux encadrants, conditions d'utilisation, mention « non officiel » sur
  les tables MN90 (pas une correction de calcul) / Notice for instructors, terms of use,
  "unofficial" notice on the MN90 tables (not a calculation fix).
- Modèles ✓ / ✓ models · « Algorithme public, reproduit » devient « Algorithme public, paramètres
  publiés » ; l'appareil réel peut s'écarter de l'algorithme publié. Retrait de l'affirmation non
  vérifiée « à une ou deux minutes près de l'appareil réel » (onglet Comparer) / "Public algorithm,
  reproduced" becomes "Public algorithm, published parameters"; the real device may depart from
  the published algorithm. Unverified claim "within a minute or two of the real device" removed
  (Compare tab).

## Corrections antérieures / Earlier fixes

Reconstituées à partir des titres des commits (le détail est dans l'historique Git).
Rebuilt from the commit titles (details are in the Git history).

- 2026-10-08 · Multigaz / Multi-gas · Calcul du gaz en mode prédictif / Gas calculation in
  predictive mode.
- 2026-10-06 · Mares Quad 2, Quad Ci, Genius · Deep stop recalculé à l'approche de la limite /
  Deep stop recalculated when nearing the limit.
- 2026-10-03 · Multigaz / Multi-gas · Gaz connu de chaque ordinateur, écarts aux manuels corrigés /
  Gas known to each computer, gaps with the manuals fixed.
- 2026-09-29 · Scubapro Luna 2.0 AI · Plongée sans palier / No-stop dive.
- 2026-09-27 · Tous / All · Palier de 9 m annoncé brièvement à la fin du temps sans palier (puis
  3 m) / Brief 9 m stop announced when the NDL runs out (then 3 m).
