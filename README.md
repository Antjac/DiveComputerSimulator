# Dive Computers simulator

**English** | [Français](README.fr.md)

Educational dive computer simulator. You steer a diver in the water column and watch, in real time and side by side, how different dive computers react: NDL, stops, ascent rate, alarms, tissue loading, gas consumption, oxygen toxicity.

User interface in English and French, metric or imperial units.

> [!WARNING]
> **Educational tool only. Never use it to plan or conduct a real dive.**
> Calculations are approximations and may differ significantly from those of a real dive computer. Always follow your training, your tables and your equipment manufacturer's instructions.
>
> **Instructors:** you remain responsible for your teaching. The simulator illustrates principles; it does not replace the manual of each student's real computer, nor your agency's procedures and tables. See [For instructors](#for-instructors) and [Terms of use](#terms-of-use).

## Simulated computers

| Model | Algorithm | Fidelity |
| --- | --- | --- |
| Aqualung i330R (Dive mode) | Bühlmann ZHL-16C + GF | Approximation (≈): the real device adds an undocumented margin (stops 2–3 min longer than GF 90/90 in field comparisons), not simulated |
| Aqualung i770R (Dive mode) | Pelagic Z+ | Approximation (≈) |
| Azoth Systems Odyssey (open circuit) | Bühlmann ZHL-16C + GF | Approximation (≈): first dive with the published parameters; the patented repetitive dive penalty (Standard by default) is unpublished, not simulated |
| Shearwater Perdix 2 (Nitrox, 3 GasNx and OC Tec modes) | Bühlmann ZHL-16C + GF | Public algorithm, published parameters |
| Shearwater Peregrine TX (Air / Nitrox and 3 GasNx modes) | Bühlmann ZHL-16C + GF | Public algorithm, published parameters |
| Garmin Descent Mk3i (Single-Gas and Multi-Gas modes) | Bühlmann ZHL-16C + GF | Public algorithm, published parameters |
| Suunto D5 | Fused RGBM 2 | Approximation (≈) |
| Suunto Zoop Novo | Suunto RGBM | Approximation (≈) |
| Suunto Nautic (Single gas and Multigas modes) | Suunto Bühlmann 16 GF (ZHL-16C + GF) | Public algorithm, published parameters |
| Mares Puck Pro | Mares RGBM | Approximation (≈) |
| Mares Quad Ci | Bühlmann ZH-L16C + GF | Public algorithm, published parameters (R1, R2, T1, T2 interpolated) |
| Mares Quad 2 | Bühlmann ZH-L16C + GF | Public algorithm, published parameters (R1, R2, T1, T2 taken from the other Mares) |
| Mares Quad Air | Mares RGBM | Approximation (≈) |
| Mares Genius | Bühlmann ZH-L16C + GF | Public algorithm, published parameters (R2, T1, T2 interpolated) |
| Scubapro Galileo 2 (G2) | ZH-L16 ADT MB | Approximation (≈) |
| Scubapro Luna 2.0 AI | ZH-L16 ADT MB or ZH-L16C + GF | Approximation (≈) for ADT MB, published parameters for ZH-L16C + GF |
| Cressi Goa | Cressi RGBM | Approximation (≈) |
| Cressi Donatello | Cressi RGBM | Approximation (≈) |

Proprietary algorithms (RGBM, ZH-L16 ADT MB, Pelagic Z+) are unpublished: they are approximated from Bühlmann ZHL-16C with gradient factors and penalties calibrated on published values. The Aqualung i330R states Bühlmann ZHL-16C + GF but departs from it in an undocumented way: it runs here with its published gradient factors, marked ≈. Likewise the Azoth Systems Odyssey adds an unpublished penalty to repetitive dives: its first dive is plain Bühlmann + GF, the following ones are not penalised here.

**Public algorithm does not mean identical values.** For the models marked "public algorithm" (✓), the simulator applies Bühlmann ZHL-16C with the gradient factors published by the manufacturer. The real device may still depart from it: rounding of stops and times, ascent rate assumed by the calculation, last stop depth, ceiling or 3 m stops, water density and surface pressure, definition of the NDL, undocumented safety margins, firmware updates. Stops differing by a few minutes are therefore normal. When a gap is observed and documented (as for the Aqualung i330R), the model is moved to ≈ with an explanation, and the change is recorded in the [change log](CHANGELOG.md). Displays and rules (alarms, stops, lockouts…) are inspired by each model's public user manual.

In the app, a notice is shown on every visit (educational use, approximated algorithms, no affiliation), and a ✓ / ≈ caption above each computer reminds you that it is an unofficial interpretation. In the Compare tab, the stop depth and time and the TTS of the ≈ computers are not shown during decompression (only "Stop required", with the unverified extrapolated estimate on hover): only their no-deco limit is calibrated on published values, so compare how they react, not the minutes.

> [!NOTE]
> **The displays are interpretations, not reproductions.** They are inspired by the listed models and may differ from them in many ways: layout, colours, fonts, texts, menus, behaviour, alarms, available settings or computed values. Only part of each device's modes and features is simulated, and manufacturers may update their products (firmware, display) without this simulator being updated. When in doubt, the official manual and the real device prevail.

## Getting started

Requirements: Node.js 18 or later.

```bash
npm install
npm run dev       # Vite development server
npm run build     # TypeScript check + production build in dist/
npm run preview   # serves the production build
```

Command-line analysis scripts:

```bash
npm run calib     # NDL tables by depth and GF (calibration)
npm run scenario  # replays a dive profile on every computer
npm run stops     # checks each computer's behaviour at deco stops
```

To report a gap with a manual or contribute code, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Controls

- Tap or click (and drag) in the water, or use the mouse wheel, to go to a depth (at the last chosen speed; 9 m/min ascending and 18 m/min descending by default).
- ▲ / ▼ (buttons or arrow keys) to set the ascent or descent speed in 1 m/min steps; ■ or `0` to hold depth.
- Pause and time speed (×1 to ×300) in the bar under the water column (or 3D view), always in view; on the keyboard, `+` / `−` to speed up or slow down time, `Space` to pause.
- **How to use it?** (next to the title, or "Guided tour" in the welcome notice) starts a guided tour of the interface.
- The computers' buttons can be clicked, with a long press when the model has one. On mouse hover, a tooltip shows each button's real function during the dive (from the manufacturer's manual) and what is not simulated; buttons with no simulated function are greyed out.

- 🔇 / 🔊 (in the header) turns the computers' alarm sounds on or off (off by default, the choice is remembered). Each model sounds as its manual describes: beeps (Mares, Scubapro, Cressi, Aqualung), tones and vibration (Garmin, Suunto), vibration only for the Perdix 2 and the Peregrine TX. A vibration is played as a buzzing sound, shakes the computer on screen and, on phones that allow it (Android), really vibrates. Alarms that repeat until acknowledged stop when a button of the computer is pressed (SELECT on the Perdix 2, either button on the Peregrine TX). Each model's settings include its own switch (ALRM, All silent, Silent diving…).
- **Alerts**: each computer shows every alarm, warning and notification of its manual (text, colours, sounds, acknowledgement). Those set on the device (depth, time, NDL, CNS, tank pressure: reserve, half tank, turn pressure…) are under "Advanced settings › Alert settings", with the options and defaults of its manual. The advanced settings are sorted by theme: dive, algorithm and stops, alerts, sounds and vibration, display.
- 🎓 (in the header) **explains the alerts**: when an alarm goes off, a bubble next to the computer says what is happening and what to do: general training advice for the common alarms, and for **every alert of each model** its wording on screen, what triggers it on that device (thresholds, colours, sounds, lock, penalties, from its manual) and what to do there (acknowledgement, required action). The button switches between bubbles (default), bubbles + pause (the simulation stops on serious alerts: fast ascent, missed stop, high ppO₂, lock, out of gas) and off. An accelerated time goes back to ×1 when an alert is explained, to leave time to react. On a phone, the alert first shows as a one-line banner under the computer, so the water column and its controls stay usable; "Why?" opens the bubble and pauses while it is read. Each alert is explained once per dive, never during an exercise; "Don't explain this alert again" mutes one until the explanations are turned off and on again. **Debrief**: the alerts of the shown computer are marked on the dive profile (during the dive, and for each logbook dive), coloured by severity; hovering one shows its time, depth and name, clicking it opens its explanation.
- **ⓘ Simulation details** (Settings tab) opens a dialog presenting the model: what is simulated from the manual, the values assumed or deduced when the manual does not give them, what is not simulated, and its configurable alerts with the values in use.

## Exercises

The **Exercises** tab offers situations to provoke and observe, for a student on their own: run out of no-deco time, ascend too fast, do the safety stop, do decompression stops, go above a stop, go past the gas's maximum depth, make a repetitive dive, switch to a deco gas (multi-gas computers only). Each exercise resets the dive and starts, paused, from a described situation (e.g. "at 25 m for 10 min"); the simulator checks the diver's state to tell whether it is passed. The debrief lists what the chosen computer signalled and when, and what its rules say (from its manual). Exercises are about behaviour (which signal, when, what follows), not about stop times, which are only approximated for proprietary algorithms. Passed exercises are remembered in the browser, per computer: doing one again with another model shows how differently they react.

## Several gases

The Settings tab lets the diver carry up to two decompression gases (nitrox from 40 to 80 % or pure oxygen), each in a stage tank (7 L, AL40 or AL80, filled before the dive). The gas is switched during the dive with the buttons of the computer shown, following the procedure of its manual (prompt at the gas MOD, menu or list of gases, confirmation); the gas breathed then changes for every computer compared, and it is drawn from its own tank. The deco gases are sorted by rising oxygen content (G2 below G3, as the Mares require); when a stage tank runs empty (or the diver switches back to it once empty), the diver goes back to the main tank, with a notice under the computer for 30 s and a note in the logbook, instead of raising the out-of-air rescue alert. The transmitter is on the main tank: the computers that tie a transmitter to each gas (Mares, Scubapro, Suunto D5 and Nautic, Garmin, Aqualung i770R) show no tank pressure on a deco gas, while the Shearwater and the Odyssey keep showing T1. Computers whose simulated mode holds several gases: Mares Quad Ci, Genius, Quad 2, Quad Air (3 gases) and Puck Pro (2); Scubapro G2 and Luna 2.0 AI (PMG option to enable); Suunto D5 (Multiple gases option to enable) and Nautic (Multigas mode, up to 5 gases, SWITCH GAS prompt); Aqualung i330R (3) and i770R (4); Azoth Systems Odyssey; Garmin Descent Mk3i (Single-Gas mode: backup gases, left out of the calculation until activated; Multi-Gas mode: decompression gases, "Safe to switch to…" prompt, Not Now / Never turning the gas into a backup gas); Shearwater Perdix 2 (3 GasNx mode, the default, up to 3 gases; OC Tec mode with its technical screen, up to 5 gases, GF 30/70, no safety stop) and Peregrine TX (3 GasNx mode, the default), with the Select Gas menu (gases 2 and 3 can be turned off in the settings, as in Define Gas: shown in magenta and left out of the calculation, they are turned on again when selected under water). Depending on the manual, the ascent time counts every gas carried (Quad Ci, Quad 2 and Genius in PREDICTIVE mode, G2 and Luna except a gas excluded after an unanswered prompt, D5, Nautic, Shearwater except gases turned off, Garmin in Multi-Gas mode except backup gases, the Odyssey's DTR) or only the gas breathed (Quad Air, as its manual states; Puck Pro, i330R and i770R, not stated by their manuals). Every multi-gas computer lets the diver switch back to the bottom gas from its menu or gas list. The Goa, the Donatello and the Zoop Novo hold a single gas in the simulated mode, like the Perdix 2 and the Peregrine TX in Nitrox mode. A computer that does not hold the gas breathed (single-gas model, or more gases carried than it holds) keeps the last gas programmed in it: its display, MOD, no-deco time and ascent plan use that gas, while the tissues stay the diver's (shared by every computer, a limit of the simulator). The "Switch to the deco gas" exercise is offered on the multi-gas computers; the others use a single gas.

## Surface, boat and repetitive dives

The tank is not refilled automatically between dives. Five seconds after surfacing during a dive, a boat comes alongside the diver and offers three choices in a comic speech bubble, in both the 2D and 3D views. **Break on board** (15 min to 4 h, chosen in a list): the diver climbs aboard, the dive ends, the surface interval runs by in a short animation (the diver swims to the boat's lowered ladder and climbs it, while the bubble tells a random divers' joke) and the diver is put back in the water with a full tank; the next descent is a new dive. **Go again with a full tank**: the tank is handed down in the water; going back down within 3 minutes carries on the same dive, as the computers do. **Carry on with this tank**: the boat leaves. After an ascent clearly too fast (average above 15 m/min over its last 10 m, the rescue alert's criterion, whatever the computer), the boat first says the ascent was too fast and that the procedure from your training should be started. The analog pressure gauge shown beside the computer opens with a click or a tap as a floating gauge that can be dragged anywhere and resized from its corner (to follow it next to the computer, e.g. to check a gas planning rule during the ascent); a tap or its ✕ puts it back. Its position and size are remembered. A dive is also closed after 3 minutes at the surface. Tissues stay loaded from one dive to the next; the logbook shows each dive's type: consecutive (surface interval under 15 min), repetitive (under 12 h) or single.

## MN90 tables

> [!NOTE]
> This is an unofficial transcription, neither published nor endorsed by the FFESSM: only the federal booklet prevails.

The **MN90** button (in the header, next to the computer list) opens, at any time, the French federal air tables (FFESSM tables based on the French Navy's MN90, July 2005 booklet) and shows where the diver stands in them (the dive is paused while it is open and resumes on closing), as a book whose pages are turned (◀ ▶ or the arrow keys): first the dive (type, depth, time, result), then each table used in the order it is read — Table I (previous dive's group × surface interval → residual nitrogen), Table II (residual nitrogen × depth of the second dive → penalty time) for a repetitive dive, then the depth's stop table (line → stops, DTR, group) — with the row, the column and the value read highlighted and the reading explained (next value up or down as the booklet requires). During the dive it shows the stops if the diver left the bottom now and when the next line is reached; at the surface, the last dive and the tables to read before diving again. Rules applied from the booklet: dive time counted until leaving the bottom, any minute started counts; an ascent slower than 15 m/min adds its time up to the first stop (slow ascent), so the time stops on reaching the first stop (the surface without stops); consecutive dives (under 15 min apart): times added, deepest depth; repetitive dives (15 min to 12 h): penalty time; nitrox: equivalent air depth; warnings for the emergency tables beyond 60 m, a previous dive without group (*), out of the tables, more than two dives in 24 hours, rapid ascent. Not simulated: the rapid-ascent and missed-stop procedures, pure-oxygen stops, Table III (oxygen at the surface), altitude. The Compare tab also has an MN90 row for the dive in progress: no-stop time left, first stop, DTR (in the TTS column) and group; a click opens the tables. A blank cell of Table I is read as no residual nitrogen left to count (the booklet does not say).

## 3D view

The **2D | 3D** button at the top of the dive area switches to a playful 3D view with three environments: coral reef (reef flat, slope down to the sand and coral heads), wreck (overgrown with corals) and wall (plateau and a wall dropping into the blue). The diver swims freely: drag horizontally, use the ◀ / ▶ arrow keys or the on-screen buttons to turn (full turns allowed), drag vertically to change the target depth. Right-click or Shift + drag to orbit the camera, double-click to recentre it. The seabed, the wreck, the rocks and the corals are solid: the diver swims along them instead of through them and rests on them when descending; they never lift the diver, so the depth profile stays entirely under the user's control. Rendering: caustics, light getting darker and bluer with depth (a torch takes over), Snell's window, swaying corals, seagrass and algae; at the surface the camera rises above the water: sky, swell with foam on the crests, the diver and the boat riding it. Sea life: schools of fish, a turtle, anemones whose clownfish hide when the diver comes close, starfish and sea urchins, pulsing jellyfish, gliding eagle rays and reef sharks keeping their distance. The simulation is the same in both views; three.js is only loaded the first time the 3D view is opened.

## Structure

```
src/engine/      engine: Bühlmann ZHL-16C + GF, gases, O2 toxicity (CNS/OTU), dive session, MN90 tables
src/computers/   one folder per simulated computer (grouped by brand when they share rules:
                 mares/, scubapro/, cressi/, suunto/): rules.ts (model-specific rules),
                 index.ts (display and buttons), its style sheet; base/ and common/ are shared
src/app/         interface: settings, tabs, dialogs, guided tour, logbook, exercises, simulation loop
src/ui/          2D scene (water column), 3D view (scene3d/, three.js), charts, gauges, tour
src/styles/      page style sheets (the computers' sheets live next to their code)
scripts/         calibration, scenario and regression (snapshot) scripts
```

## For instructors

Many instructors use the simulator in class. If you do:

- **You remain responsible for your teaching.** The simulator illustrates principles (tissue loading, stops, how computers react to an error); it does not replace the manual of each student's real computer, nor your agency's procedures, tables and training material.
- **Check what you present** against the official manual of the model shown (the "ⓘ Simulation details" dialog lists, for each model, what is simulated, assumed or not simulated).
- **Remind students** that their own computer may behave differently (firmware, settings, model), and that the ≈ computers' stop times are only approximations.
- Report any gap you notice (issue or e-mail): it will be fixed and recorded in the [change log](CHANGELOG.md).

## Terms of use

These terms are also shown in the app (About › Terms of use).

- **Intended use:** learning and teaching diving, only. Never use the simulator to plan, conduct or check a real dive, nor to choose or set up equipment.
- **No warranty:** the simulator is provided free of charge, "as is", with no warranty of accuracy, completeness or fitness for a particular purpose (GNU AGPL v3, sections 15 and 16). To the extent permitted by law, its authors cannot be held liable for its use.
- **Known limits:** algorithms marked ≈ are approximated and their values differ from the real device; even a public algorithm (✓) may be applied differently by the real device (rounding, calculation assumptions, undocumented margins); displays are interpretations; only part of the modes and features is simulated; tissues are shared by every computer compared; manufacturers may change their devices without the simulator following.
- **MN90 tables:** an unofficial transcription of the FFESSM booklet of July 2005, neither published nor endorsed by the FFESSM. Only the federal booklet prevails.
- **Corrections:** a reported error (gap with a manual, wrong calculation) is fixed as soon as possible and recorded in the [change log](CHANGELOG.md).
- **Contact:** [antoalex@free.fr](mailto:antoalex@free.fr) or a GitHub issue.

## Trademarks and affiliation

This project is independent and **is not affiliated with, endorsed or sponsored by** the manufacturers mentioned. Aqualung, Aqua Lung, Azoth Systems, Odyssey, Shearwater, Perdix, Peregrine, Garmin, Descent, Suunto, Zoop, Nautic, Mares, Puck, Quad, Genius, Scubapro, Galileo, Luna, Cressi, Goa and Donatello are trademarks of their respective owners; they are only mentioned to identify the models whose displays inspired this simulator. No manufacturer logo, code or artwork is included.

If you represent one of these manufacturers and would like something changed or removed, please open an issue.

## Licence

Copyright © 2026 Antoine ALEXANDRE — [https://github.com/Antjac/DiveComputerSimulator](https://github.com/Antjac/DiveComputerSimulator)

Free software under the [GNU Affero General Public License v3.0](LICENSE) or (at your option) any later version.

- **Everyone may use the simulator freely**, including dive instructors, clubs and commercial dive centres.
- **You may study, modify and redistribute the code**, provided that you keep this copyright notice and distribute your version under the same licence, with its complete source code.
- **This also applies online:** anyone who makes a modified version available as a website or service must offer its users the complete source code of that version (AGPL, section 13).

The software is provided "as is", without any warranty. The authors cannot be held liable for its use.
