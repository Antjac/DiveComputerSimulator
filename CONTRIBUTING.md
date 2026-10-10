# Contributing

**English** | [Français](CONTRIBUTING.fr.md)

Thank you for helping improve the dive computer simulator! Contributions of every size are welcome:
a gap spotted between a computer and its manual, a translation fix, a new model, a bug fix.

The aim of the project guides every contribution: **behaviour and displays as close as possible to
the real device, as described by its official manual**, for teaching purposes only.

## Reporting an error or a gap with a manual

This is the most useful contribution, and it needs no code. Open a
[GitHub issue](https://github.com/Antjac/DiveComputerSimulator/issues) or write to
[antoalex@free.fr](mailto:antoalex@free.fr), with:

- the **model**, the **mode** simulated (e.g. Perdix 2 in 3 GasNx mode) and, if you know it, the
  firmware version of your device;
- **what the simulator does** and **what the real device does**;
- the **source**: the section or page of the official manual, a photo of the device's screen, a dive
  log exported from the device… A source is what allows the fix;
- how to **reproduce** it: settings, gas, profile (e.g. "40 m for 25 min with GF 40/85, then ascent
  at 9 m/min").

Fixes to calculations and behaviour are recorded in the [change log](CHANGELOG.md).

To suggest a new model, open an issue with a link to its official manual (PDF on the manufacturer's
site).

## Ground rules

1. **The official manual prevails.** Work from the manual of the exact model and mode simulated,
   never from a neighbouring model, an older generation or memory. Read the figures as well as the
   text: exact labels, field order, colours and decimals are often only in the screenshots.
2. **Cite the section** of the manual in a comment next to each rule implemented:
   `// §5.2: ...`.
3. **Invent nothing.** When the manual says nothing, say so ("not verified" in the code and in the
   pull request) rather than presenting a guess as a fact. A deduction drawn from the figures is
   flagged as such. Made-up values (serial number, battery…) are marked as such in the code.
4. **No brand on the devices.** No manufacturer logo, name or artwork is drawn on the simulated
   computers' cases or screens; names only appear in the lists and texts, to identify the models.
5. **Two languages.** Every text of the interface exists in French **and** English
   (`src/i18n.ts`, or the `{ fr, en }` fields of the models).

## Development setup

Requirements: Node.js 18 or later (the CI uses Node 20).

```bash
npm install
npm run dev        # Vite development server
npm run build      # TypeScript check + production build: must pass
```

The project is written in TypeScript with Vite, without a UI framework. The
[Structure](README.md#structure) section of the README describes the folders; in short:

- `src/engine/`: the physics (Bühlmann ZHL-16C + GF, dive session, gases, MN90 tables). The diver's
  state lives in `session.ts`; computers read it and never change it (except for a gas switch made
  with their buttons). Tissues are shared by every computer.
- `src/computers/`: one folder per model, with `rules.ts` (settings, algorithm, stops, alarms: what
  is checked against the manual), `index.ts` (screens, buttons, HTML rendering) and its style sheet,
  imported in `src/style.css`. Each model is registered in `src/computers/index.ts`. Shared code is
  in `base/`, `common/` and the brand folders (`mares/common.ts`, `scubapro/common.ts`,
  `cressi/common.ts`).
- `src/app/`: the interface, one module per function, wired in order by `src/main.ts`.
- `src/ui/`: 2D scene, charts, 3D view (`scene3d/`, three.js loaded on demand).

Code comments and identifiers are in English.

## Adding or reviewing a computer

Go through **every** point of the checklist against the manual, and implement it or record that it
is not simulated. The detailed checklist, with examples, is in [CLAUDE.md](CLAUDE.md) (in French);
it covers:

1. identity and algorithm (`exact = true` only for a public algorithm reproduced as published;
   otherwise an approximation ≈ calibrated on the published NDL tables with `npm run calib`),
   deco parameters, model-specific penalties;
2. settings (`settingDefs`) with the manufacturer's defaults; `essential: true` only for the
   screen layout setting, the others go to "Advanced settings";
3. buttons (short and long press), sequence of screens and return delay;
4. main screen in every state (surface, descent, NDL, deco, at the stop, above the stop, safety
   stop, fast ascent, after the dive, locked) and in every layout, with exact labels;
5. info screens and alternative fields;
6. decompression stops (GF low anchor, stop window, what happens above the stop, missed stop,
   deep stops);
7. safety stop; 8. ascent rate; 9. NDL and warnings; 10. GF values shown; 11. gases and oxygen,
   transmitter; 12. surface and after the dive;
13. **the whole alarm table** of the manual, each alert with its explanation in `alertExplain()`
    (French and English, section cited).

Summarise what is simulated and what is not in the model's notes (`notes.fr` / `notes.en`), shown
in the "ⓘ Simulation details" dialog.

## Checks before a pull request

```bash
npm run build      # must pass
npm run exercises  # "✓ every exercise passed on every computer"
npm run stops      # "✓ stops OK" (or: npm run stops -- <id>)
npm run snapshot   # display regression against .snapshots/baseline.json
```

- **Snapshots:** before a refactoring, save a baseline with `npm run snapshot -- --save`, then
  compare after the change. An intended display change makes the baseline obsolete: say so in the
  pull request.
- **Layout:** with `npm run dev`, pause the simulation and run in the page console
  `__divesim.layout.sweep(['decoDeep', 'safetyActive'], '<id>')` (states listed in
  `__divesim.layout.states`). It reports any text overflowing its box or overlapping another, in
  every layout, metric and imperial. Check each report on screen: some are intended.
- **In the browser:** show each screen in the states above (e.g. 40 m for 25 min, then ascent) and
  compare it with the manual's figures.

## Documentation

- **README:** update the table of models (and the text if needed) in both `README.md` (English)
  and `README.fr.md` (French).
- **Change log:** every fix to a calculation or a behaviour (gap with a manual, stops, NDL,
  alarms…) gets an entry in [CHANGELOG.md](CHANGELOG.md), in French and English:
  `YYYY-MM-DD · model(s) · correction (FR) / fix (EN)`, with the issue number. New features and
  interface changes are left to the Git history.

## Pull requests

- Branch from `main` and open the pull request against `main`. Every push to `main` deploys the
  site to GitHub Pages.
- One subject per pull request (one model, one fix…).
- In the description, list: the manual sections checked, what remains **not verified**, and the
  gaps spotted but not fixed.
- Commit messages and pull requests may be written in French or English.

## Licence

The project is under the [GNU AGPL v3.0 or later](LICENSE). By contributing, you agree that your
contribution is distributed under that licence. Do not include code, images or artwork you do not
have the right to share (manufacturer logos or firmware, for instance); quote manuals only as much
as needed to cite a rule.
