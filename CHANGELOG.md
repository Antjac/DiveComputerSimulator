# Journal des corrections / Change log

Ce journal recense les corrections de calcul et de comportement (écarts avec un manuel, erreurs de
paliers, de NDL, d'alarmes…) et les changements notables du simulateur (nouvelles fonctions,
changements d'interface), avec leur date. Pour signaler une erreur : une issue GitHub ou
antoalex@free.fr. Le détail est dans l'historique Git.

This log records fixes to calculations and behaviour (gaps with a manual, wrong stops, NDL,
alarms…) and notable changes to the simulator (new features, interface changes), with their date.
To report an error: a GitHub issue or antoalex@free.fr. Details are in the Git history.

Format : `AAAA-MM-JJ` · modèle(s) · correction ou changement (FR) / fix or change (EN).

## 2026-10-14

- Tous / All · Nouveau : mode replay dans le récapitulatif de plongée (« Revoir la plongée »). La
  plongée est rejouée en 2D sur les ordinateurs : pause, vitesses, avance et retour, saut à un instant
  ou à une alerte, changement d'ordinateur ; le plongeur ne peut plus être manœuvré. Réservé aux
  plongées faites après cette version ; les appuis sur les boutons de l'ordinateur ne sont pas
  rejoués / New: replay mode in the dive recap ("Replay the dive"). The dive is played again in 2D on
  the computers: pause, speeds, forward and back, jump to a moment or an alert, switch computers; the
  diver can no longer be steered. Only for dives made after this version; button presses on the
  computer are not replayed.

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
