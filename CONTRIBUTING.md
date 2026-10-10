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

A model lives in its own folder (`src/computers/<brand>/` or `<brand>/<model>/`): `rules.ts`, an
abstract class `XRules extends DiveComputer` holding what is checked against the manual (settings,
algorithm, stops, alarms), and `index.ts`, the final class (screens, buttons, HTML rendering), with
its style sheet. Register it in `src/computers/index.ts` and import its sheet in `src/style.css`.

### Finding and reading the manual

- Use the official manual of the exact model, in its latest revision, from the manufacturer's
  site. If the site cannot be reached, a mirror (ManualsLib…) will do, after checking that it is
  the same model and a recent revision.
- Text: `pdftotext -layout manual.pdf manual.txt`, then search it. Manuals on several columns
  extract poorly: split the lines by column.
- Figures: `pdftoppm -f N -l N -r 220 -png manual.pdf page` renders page N at a readable
  resolution. Read the figures: exact labels, field order, colours and decimals are often only
  there, and the text is sometimes incomplete.

### Checklist

Copy it into the pull request. Tick each point once it is implemented, or once it is recorded as
not simulated (in the code and the model's notes).

**1. Identity and algorithm**

- [ ] Exact name, simulated mode, algorithm.
- [ ] `exact = true` only if the algorithm is public and reproduced (Bühlmann + GF); otherwise an
      approximation (≈) calibrated on the published NDL tables (`npm run calib`).
- [ ] Deco parameters: GF (or equivalent) for each conservatism level, last stop depth (3/6 m),
      step between stops, **ascent rate assumed by the calculation**, fresh/salt water, altitude.
- [ ] Model-specific penalties: repetitive dives, multi-day, fast ascent, missed stop…

**2. Settings (`settingDefs`)**

- [ ] Every setting useful for the dive, with the **manufacturer's default** values.
- [ ] `essential: true` only for the screen's display setting (layout), and for the settings that
      only appear with one of its values (`showIf`); the others go to "Advanced settings".

**3. Buttons (`buttons()`, `press()`, `hold()`)**

- [ ] Each button, short and long press, during the dive: real function from the manual,
      `simulated` true/false and a `note` when the simulation differs.
- [ ] Exact sequence of screens: order, conditional screens (surface only, with a transmitter,
      nitrox only…), return to the main screen, **return delay and its exceptions**.

**4. Main screen, in every state**

- [ ] Fields, **exact labels** (case, abbreviations), units, decimals, rounding, colours,
      blinking, in each state: surface, pre-dive, descent, no stop, low NDL, entering deco,
      approaching a stop, at the stop, above the stop, safety stop (waiting, running, paused,
      done), fast ascent, surfacing during the dive, after the dive, locked computer.
- [ ] For **each layout** of the model: every value fits in its box, including with an alarm or a
      banner on top. No text overflows or is cut.

**5. Info screens and alternative fields**

- [ ] Exact order and content of each screen, compared with the figures.
- [ ] A default screen, or a custom screen to set up on the device: say so in the notes.

**6. Decompression stops**

- [ ] GF low anchor as in Subsurface: deepest GF low ceiling of the dive, unrounded, at least 1 bar
      below the surface (`updateAnchor`), also updated during the ascent simulated by
      `planAscent`. It only goes deeper: neither ceiling nor stop rises while staying at the
      bottom. **Never bring the anchor back to the diver's depth**: a stop's time must never grow
      on arrival.
- [ ] Stop display: depth, time (minutes or mm:ss, rounding), total ascent time (TTS/DTR),
      continuous ceiling or 3 m stops.
- [ ] Approach indicator, if any (colour, arrow, message, distance).
- [ ] "At the stop" window (`stopWindow`).
- [ ] **Above the stop**: reference (`violationRef`: stop depth or ceiling), margin
      (`ceilingMargin`), alarm (exact text, colours), and what happens to the calculation
      (timer paused, calculation or off-gassing stopped → `withPausedDeco`).
- [ ] Missed stop: time and distance thresholds, lock (`lockAfter`, `lockHours`), gauge mode, SOS,
      backup GF, how the lock shows at the surface and on the next dive.
- [ ] End of the stops: message, safety stop starting afterwards.
- [ ] Deep stops (conditions, depth, time, optional or not) and options such as CEIL-CON.

**7. Safety stop (`safetyStop`, `safetySeconds`)**

- [ ] Trigger depth, depth where the countdown starts, window, reset, possible durations,
      adaptive, pause and colours, ascending before the end, mandatory after a violation.

**8. Ascent rate**

- [ ] Thresholds (possibly by depth), display (arrows, segments, %), colours, delay before the
      alarm, consequences (penalties, lock).

**9. NDL and warnings**

- [ ] Cap (99), warnings (e.g. 2, 3, 5 or 10 min), labels.

**10. GF values (if the device shows them)**

- [ ] GF99, SurfGF (and its exact label), @+5, Δ+5, rate of change…: exact definition, colour rules,
      "On Gas" / "On-Gassing" (`leadingOnGas`).

**11. Gas and oxygen**

- [ ] O₂ %, MOD ppO₂, ppO₂ alarms, CNS thresholds and colours, OTU.
- [ ] Multi-gas: `maxGases`, `decoPpo2` / `decoMod`, `planGases` (gases counted in the plan), switch
      prompts and procedure.
- [ ] Transmitter: name, remaining time (GTR, ATR, RBT, TTR) with its definition and delays,
      reserve, consumption.

**12. Surface and after the dive**

- [ ] Surfacing mode duration, surface interval, no-fly time, desaturation, last dive, repetitive
      dive penalties, logbook.

**13. Alarms**

- [ ] **The whole alarm table** of the manual: exact text, priority, colours, acknowledgement by a
      button or not.
- [ ] Each alert explained by `alertExplain(key)` in `rules.ts`, in French and English, section
      cited: exact text on screen (`screen`, or `title`), trigger and consequences on this device
      (`what`), action to take (`todo`), matching common alarm (`code`), `critical` if it must
      pause. Keys: those of `alertCues(v, all)`, the `AlarmCode`s, and `msg:<text>` for the
      visual-only messages declared in `screenAlerts`.

**14. Wrapping up**

- [ ] Model notes (`notes.fr` / `notes.en`): what is simulated, assumed or deduced, and not
      simulated. They are shown in the "ⓘ Simulation details" dialog.
- [ ] Every rule has its manual section in a comment; every deduction or assumption is flagged.
- [ ] The checks below pass.
- [ ] In the pull request: what was checked (with the sections), what remains **not verified**,
      the gaps spotted but not fixed.

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

- **Work on `develop`:** branch from `develop` and open the pull request against `develop`.
  `main` is the published version: every push to `main` deploys the site to GitHub Pages, so
  `develop` is merged into `main` only once it has been checked.
- One subject per pull request (one model, one fix…).
- In the description, list: the manual sections checked, what remains **not verified**, and the
  gaps spotted but not fixed.
- Commit messages and pull requests may be written in French or English.

## Licence

The project is under the [GNU AGPL v3.0 or later](LICENSE). By contributing, you agree that your
contribution is distributed under that licence. Do not include code, images or artwork you do not
have the right to share (manufacturer logos or firmware, for instance); quote manuals only as much
as needed to cite a rule.
