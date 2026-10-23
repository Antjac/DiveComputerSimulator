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

- Scubapro G2, Luna 2.0 AI et G3 · Recalage de ZH-L16 ADT MB sur des mesures d'appareils réels (essais en caisson Deeply Safe Labs du G2 et du Luna 2.0, planificateurs comparés par divetable.info) : tissus qui dégazent 1,25 fois plus lentement qu'ils ne se chargent, temps sans palier à 100 % des valeurs M pour les compartiments rapides et moins pour les lents (12 m : 100 min au lieu de près de 200 ; table : 121 ; de 18 à 48 m à 1 min près), paliers à un GF de 94 % une fois en déco, pénalité des plongées successives sur les compartiments rapides (2e plongée à 30 m : 8 min sans palier au lieu de 17, 38 min de paliers au lieu de 11 ; mesuré : 8 et 39), paliers de mètre en mètre de 6 à 3 m. G3 : calage repris, non vérifié sur l'appareil / ZH-L16 ADT MB recalibrated on measurements of real computers (Deeply Safe Labs chamber tests of the G2 and the Luna 2.0, planners compared by divetable.info): tissues off-gassing 1.25 times more slowly than they load, no-stop times at 100 % of the M-values for the fast compartments and less for the slow ones (12 m: 100 min instead of nearly 200; table: 121; within 1 min from 18 to 48 m), stops at a GF of 94 % once in deco, repetitive-dive penalty on the fast compartments (second dive to 30 m: 8 min no-stop time instead of 17, 38 min of stops instead of 11; measured: 8 and 39), stops every metre from 6 to 3 m. G3: same calibration, not checked on the device.
- Scubapro Luna 2.0 AI et G3 · Algorithme ZH-L16C + GF : calculé sur les tissus Scubapro (dégazage plus lent mesuré sur le Luna 2.0 en GF 30/70 : 36 min de paliers pour 30 m / 30 min, 28 avec ZH-L16C ; simulé : 34) et, en plongée successive, compartiments plus rapides remontés à la charge du plus lent encore chargé ; marqué ≈ (variante non documentée) au lieu de ✓ / ZH-L16C + GF algorithm: computed on the Scubapro tissues (slower off-gassing measured on the Luna 2.0 at GF 30/70: 36 min of stops for 30 m / 30 min, 28 with ZH-L16C; simulated: 34) and, on a repetitive dive, faster compartments raised to the load of the slowest one still loaded; marked ≈ (undocumented variant) instead of ✓.
- Mares Quad Air et Puck Pro · Recalage du RGBM Mares sur les essais en caisson du Quad Air : P0 à 100 % des valeurs M (temps sans palier à 30 m : 17 min au lieu de 14, comme mesuré), tissus qui dégazent 2,25 fois plus lentement dans l'eau et 1,4 fois en surface (paliers de 14 et 33 min à 3 m mesurés, 15 et 32 simulés, au lieu de 10,5 et 20,5 avec un palier à 6 m), plus de pénalité forfaitaire des plongées successives (le temps sans palier mesuré ne change pas) / Mares RGBM recalibrated on the chamber tests of the Quad Air: P0 at 100 % of the M-values (no-stop time at 30 m: 17 min instead of 14, as measured), tissues off-gassing 2.25 times more slowly in the water and 1.4 times at the surface (stops of 14 and 33 min at 3 m measured, 15 and 32 simulated, instead of 10.5 and 20.5 with a 6 m stop), no more flat repetitive-dive penalty (the measured no-stop time does not change).
- Aqualung i770R · Pelagic Z+ : paliers et plongées successives calés sur les essais en caisson de l'i100 et de l'i300C (même algorithme) : tissus qui dégazent 2,5 fois plus lentement dans l'eau et 1,25 fois en surface, pénalité des plongées successives sur les compartiments rapides (2 × 30 m / 30 min : 22 et 40 min de paliers au lieu de 8 et 13 ; mesuré : 20–24 et 38–41) ; temps sans palier toujours calés sur la table du manuel / Pelagic Z+: stops and repetitive dives fitted to the chamber tests of the i100 and the i300C (same algorithm): tissues off-gassing 2.5 times more slowly in the water and 1.25 times at the surface, repetitive-dive penalty on the fast compartments (2 × 30 m / 30 min: 22 and 40 min of stops instead of 8 and 13; measured: 20–24 and 38–41); no-stop times still fitted to the manual's table.
- Tous / All · Nouveau : section « Calibrage de l'algorithme et sources » dans « Détails de la simulation » (sources, modèle retenu, écarts restants, ce qui n'est pas vérifié) ; la fenêtre « Ordinateurs simulés » et les README indiquent d'où viennent les valeurs de calibrage. Onglet Comparer : paliers et DTR affichés aussi pour les modèles ≈ dont les paliers sont calés sur des mesures (Scubapro, Mares RGBM, i770R) / New: "Algorithm calibration and sources" section in "Simulation details" (sources, model used, remaining gaps, what is not checked); the "Simulated computers" dialog and the READMEs say where the calibration values come from. Compare tab: stops and TTS also shown for the ≈ models whose stops are fitted to measurements (Scubapro, Mares RGBM, i770R).
- Outils / Tools · Nouveau script `npm run dsl` : rejoue les essais en caisson publiés par Deeply Safe Labs (2 × 30 m / 30 min et 6 × 30 m / 16 min) sur les modèles correspondants (Perdix 2, Descent, G2, Luna, Quad Air) et compare les paliers mesurés sur les vrais appareils à ceux du simulateur ; échoue si un modèle exact (Bühlmann + GF) s'en écarte trop / New `npm run dsl` script: replays the chamber tests published by Deeply Safe Labs (2 × 30 m / 30 min and 6 × 30 m / 16 min) on the matching models (Perdix 2, Descent, G2, Luna, Quad Air) and compares the stops measured on the real computers with the simulator's; fails if an exact model (Bühlmann + GF) strays too far.

## 2026-10-17

- Shearwater Teric · Personnalisation de l’écran d’accueil (§3.7) : en mode OC Rec (dispositions Big et Standard), emplacement droit de la ligne Déco réglable (TTS par défaut, T1, GTR, GF99, SurGF, CNS, MAX, AVG, @+5, heure) ; en disposition Standard (modes OC Rec et OC Tec), ligne Info réglable avec 1 à 3 zones personnalisables parmi les options du §3.7 ou pré-réglages (Gaz/PPO2, T1/SAC/GTR, Déco) ; gaz actif reporté en bas d'écran quand la ligne Info ne le contient pas (§3.4) / Home screen customization (§3.7): in OC Rec mode (Big and Standard layouts), settable Deco row right slot (TTS by default, T1, GTR, GF99, SurGF, CNS, MAX, AVG, @+5, clock); in Standard layout (OC Rec and OC Tec modes), settable Info row with 1 to 3 customizable slots among §3.7 options or presets (Gas/PPO2, T1/SAC/GTR, Deco); active gas shown at bottom when the Info row does not show it (§3.4).

## 2026-10-16

- Azoth Odyssey · Champ en haut à droite : P moy. s'affiche en nombre entier, sans décimale (« 11 » et non « 11,2 »), comme sur les photos de l'appareil (ticket n° 17) / Top-right field: P moy. is shown as a whole number, without decimals (“11”, not “11,2”), as on the device's photos (issue #17).
- Tous / All · Replay : les vitesses ×1, ×2 et ×5 restaient à ×10 dans l'eau (le replay avançait d'un pas de 0,5 s à chaque tick de 50 ms) ; la vitesse choisie est maintenant respectée / Replay: speeds ×1, ×2 and ×5 stayed at ×10 in the water (the replay moved one 0.5 s step on every 50 ms tick); the chosen speed is now kept.
- Tous / All · Carnet : bouton « Revoir la plongée » sur chaque plongée enregistrée qui peut être rejouée, sans passer par le récapitulatif ; en sortant du replay, on revient au carnet / Logbook: “Replay the dive” button on each saved dive that can be replayed, without going through the recap; leaving the replay goes back to the logbook.
- Tous / All · Téléphone : le bouton ✕ du panneau des onglets a sa propre bande en haut, avec le nom de l'onglet ouvert ; le contenu défile dessous au lieu de passer sous le bouton / Phone: the close button of the tabs sheet has a band of its own at the top, with the name of the open tab; the content scrolls below it instead of under the button.
- Tous / All · Réglages avancés : dans le groupe des alertes, le libellé est désormais au-dessus de sa liste, comme partout ailleurs (il était à gauche), avec la même largeur de liste / Advanced settings: in the alerts group, the name is now above its list, as everywhere else (it was on its left), with the same list width.
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
