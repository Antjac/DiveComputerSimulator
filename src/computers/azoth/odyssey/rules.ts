import { type DecoParams, COMPARTMENTS, SURFACE_PRESSURE, Tissues, AIR, depthToPressure, ndl } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef, type AlertExplain } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';

export type OdysseyNotice = 'pn2' | 'density';

const on = { fr: 'Actif', en: 'On' };
const off = { fr: 'Inactif', en: 'Off' };

// §6 (figure « Facteurs de gradient ») : « La valeur du GF Low entre 20 et 100 % », « La valeur du
// GF High entre 40 et 100 % ». La figure règle les valeurs chiffre par chiffre ; le simulateur les
// propose par pas de 5.
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Densité des gaz purs vers 20 °C (g/l à 1 bar) : O₂, N₂, He. */
const RHO = { o2: 1.331, n2: 1.165, he: 0.166 };

/**
 * Azoth Systems Odyssey (firmware 2.0.x), circuit ouvert (CO).
 * Règles d'après le manuel utilisateur version 2.0 du 26/10/2026, en français et en anglais (sections
 * citées en commentaire ; numérotation identique dans les deux langues). L'écran suit la langue de
 * l'appareil (menu Personnel, « Langue », figure du §10) : ici celle du simulateur.
 */
export abstract class OdysseyRules extends DiveComputer {
  readonly id = 'odyssey';
  readonly name = 'Azoth Systems Odyssey';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  // §2 : Bühlmann ZHL-16C, GF du plongeur (§6). Mais §11 : un « dispositif breveté » de gestion des
  // plongées successives (niveau Standard par défaut) majore la décompression des plongées suivantes
  // d'une façon non publiée : variante non documentée.
  readonly exact = false;
  get undocumentedVariant(): boolean {
    return true;
  }
  readonly calibration = {
    fr: ['Bühlmann ZHL-16C avec les GF du plongeur (§2, §6) ; la majoration brevetée des plongées successives (§11) n’est pas publiée ni mesurée : non simulée.'],
    en: ['Bühlmann ZHL-16C with the diver\'s GF (§2, §6); the patented repetitive-dive increase (§11) is neither published nor measured: not simulated.'],
  };
  readonly transmitter = 'ODC SENSOR';
  readonly notes = {
    fr: 'Mode circuit ouvert (CO). L’écran suit la langue du simulateur, comme celle de l’appareil (menu Personnel, figure du §10) : libellés des figures du manuel français ou anglais (Durée / Run, Profondeur / Depth, Palier / Stop, DTR / Ascent…). Plusieurs gaz (§6, menu Gaz : gaz un à huit ; ici le bloc principal puis les gaz de déco de la page) : changement par la surbrillance du champ gaz puis OK, écran « Changement de gaz » (G / D : gaz, OK : validation ; déduit des figures du §8) ; seuls les gaz activés sont proposés. Bühlmann ZHL-16C avec les facteurs de gradient du plongeur (GF bas 20 à 100 %, GF haut 40 à 100 % ; 80/80 par défaut supposé, d’après les figures). La majoration brevetée des plongées successives (§11, niveau Standard par défaut) n’est pas publiée et n’est pas simulée : les plongées successives sont celles d’un Bühlmann pur. Boutons G et D : déplacent la surbrillance entre les champs modulables (§8) ; OK : change le contenu du champ en surbrillance (DTR → DTR/+5’ → DTR/HS → DTR/DTP → DTR/BG ; bloc, pile, CNS, température, profondeur max., graphique des tissus ; en haut à droite : Plafond → Tissus → P moy. → GFsurf → GF). DTR (§8) : vitesse réglée (menu Personnel, 8 à 15 m/min) jusqu’au premier palier, ou jusqu’au dernier palier sans palier, puis 6 m/min ; palier O’Dive compris ; arrondie aux 5 s supérieures, puis à la minute supérieure au-delà de 60 s ; la DTR compte les gaz de déco disponibles, DTR/BG le gaz fond seul. GF et GFsurf (§8) : GF maximal des 16 compartiments à la profondeur actuelle, ou en surface pour un retour instantané ; 0 sans sursaturation. Tissus (§8) : une barre par compartiment, hauteur = charge en gaz inerte rapportée à ce que tolère le compartiment à la profondeur actuelle avec le GF qui s’y applique (bas de l’échelle : ppN₂ de l’air en surface ; trait à 80 % de la hauteur : la limite), couleur selon la valeur, recalculé toutes les 2 s. P moy. (profondeur moyenne, en nombre entier) absent du manuel, ajouté d’après un utilisateur de l’appareil (firmware 2.0.14.0), comme l’ordre de défilement ; son libellé anglais (« Avg ») est supposé. En surface, OK passe de l’écran d’accueil à la page plongée. Paliers (§8) : surbrillance marron à plus de 10 cm au-dessus du palier, rouge à plus de 10 cm au-dessus du plafond ; aucun verrouillage. NDL : « +240’ » au-delà de 240 min, surbrillance grise et deux séries de vibrations sous 3 min. Vitesse de remontée (§10.4) : flèches rouges au-delà de la consigne VR, sans vibration. Alarmes (§10) : ppO2 du gaz fond (champ rouge), PN2 et densité du gaz (boîte « Alertes » acquittée par un bouton), pression de réserve (35 bar si la plongée n’a pas dépassé 10 m, 50 bar sinon : vibrations ; champ du bloc rouge sous 50 bar). Le « Palier O’Dive » est le palier de sécurité (§8), sans autre précision : simulé à la profondeur du dernier palier, désactivé (0’00) par défaut. Non simulés : circuit fermé, mode OC Rec, trimix, boussole, planificateur, carnet, menus, TGR (temps de gaz restant), taille de police agrandie, eau douce, perte de liaison ODC SENSOR.',
    en: 'Open circuit (CO) mode. The screen follows the simulator’s language, like the device’s own (Personal menu, §10 figure): labels from the figures of the French or English manual (Durée / Run, Profondeur / Depth, Palier / Stop, DTR / Ascent…). Several gases (§6, Gases menu: gases one to eight; here the main tank, then the deco gases set on the page): switched by highlighting the gas field then OK, “Change gas” screen (L / R: gas, OK: confirm; deduced from the §8 figures); only the activated gases are offered. Bühlmann ZHL-16C with the diver’s gradient factors (GF low 20 to 100 %, GF high 40 to 100 %; 80/80 by default assumed, from the figures). The patented repetitive dive penalty (§11, Standard level by default) is not published and is not simulated: repetitive dives are those of plain Bühlmann. L and R buttons: move the highlight between the selectable fields (§8); OK: changes the content of the highlighted field (Ascent → Asc/+5’ → Asc/Time → Asc/Run → Asc/BG; tank, battery, CNS, temperature, max. depth, tissue graph; top right: Ceiling → Tissues → Avg → GFsurf → GF). Ascent time (§8): set rate (Personal menu, 8 to 15 m/min) to the first stop, or to the last stop depth without stops, then 6 m/min; O’Dive stop included; rounded up to 5 s, then up to the minute beyond 60 s; it counts the deco gases available, Asc/BG the bottom gas only. GF and GFsurf (§8): highest GF of the 16 compartments at the current depth, or at the surface for an instantaneous return; 0 without supersaturation. Tissues (§8): one bar per compartment, height = inert gas loading relative to what the compartment tolerates at the current depth with the GF that applies there (bottom of the scale: ppN₂ of air at the surface; line at 80 % of the height: the limit), colour by value, recomputed every 2 s. Avg (average depth, a whole number) is not in the manual, added from a user of the device (firmware 2.0.14.0), as is the scrolling order; its English label (“Avg”) is assumed. At the surface, OK switches between the home screen and the dive page. Stops (§8): brown highlight more than 10 cm above the stop, red more than 10 cm above the ceiling; no lock-out. NDL: “+240’” beyond 240 min, grey highlight and two series of vibrations below 3 min. Ascent rate (§10.4): red arrows beyond the set VR, no vibration. Alarms (§10): bottom gas ppO2 (red field), PN2 (“Narcotic”) and gas density (“Alerts” box acknowledged with a button), reserve pressure (35 bar if the dive stayed within 10 m, 50 bar otherwise: vibration; tank field red below 50 bar). The “O’Dive stop” is the safety stop (§8), with no further detail: simulated at the last stop depth, off (0’00) by default. Not simulated: closed circuit, OC Rec mode, trimix, compass, planner, logbook, menus, TGR (gas time remaining), large font size, fresh water, ODC SENSOR link loss.',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §6 : GF Low de 20 à 100 %. Valeur par défaut non donnée : les figures montrent surtout 80/80
      // (écran d'accueil, exemple d'altitude §9) ; 80 supposé.
      key: 'gfLow',
      label: { fr: 'GF bas', en: 'GF low' },
      options: range(20, 100, 5).map((v) => ({ value: String(v), label: `${v} %` })),
      default: '80',
      group: 'deco',
    },
    {
      // §6 : GF High de 40 à 100 %. 80 supposé (figures).
      key: 'gfHigh',
      label: { fr: 'GF haut', en: 'GF high' },
      options: range(40, 100, 5).map((v) => ({ value: String(v), label: `${v} %` })),
      default: '80',
      group: 'deco',
    },
    {
      // §6, menu Déco (figures) : « Dernier palier 3m » ou « 6m ».
      key: 'lastStop',
      label: { fr: 'Dernier palier', en: 'Last stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
    {
      // §6, menu Déco (figures) : « Palier O'Dive 0'00 » ou « 4' ». §8 : « Le palier de sécurité
      // (« Palier O'Dive ») est inclus dans la DTR lorsqu'il est programmé ». Profondeur, seuils de
      // déclenchement et durées possibles non donnés : simulé au dernier palier ; 0'00 (désactivé) supposé.
      key: 'odive',
      label: { fr: 'Palier O’Dive', en: 'O’Dive stop' },
      options: range(0, 10, 1).map((v) => ({ value: String(v), label: v ? `${v}'` : "0'00" })),
      default: '0',
      group: 'deco',
    },
    {
      // §8 : « Personnel / Vitesse de remontée » : 8, 10, 11, 12 ou 15 m/min, utilisée pour la DTR,
      // l'indicateur VR (§10.4) et l'alarme de vitesse (§10.1). Valeur par défaut non donnée : 12 m/min
      // supposé (figure « Personnel » du §10, exemples du §10.4).
      key: 'vr',
      label: { fr: 'Consigne de vitesse de remontée (VR)', en: 'Ascent rate setpoint (VR)' },
      options: [8, 10, 11, 12, 15].map((v) => ({ value: String(v), label: `${v} m/min` })),
      default: '12',
      group: 'deco',
    },
    // §10 (figure « Alertes ») : « Alerte PO₂ fond 1,30b » ; plage et valeur par défaut non données.
    { ...ppo2Setting(1.2, 1.6, 1.3, 'Alerte PO₂ fond', 0.05), group: 'alerts' },
    {
      // §10 (figure « Alertes ») : « Alerte PO₂ déco 1,50b » ; §10.1 : « Pression partielle Oxygène du gaz
      // de décompression ». Plage et valeur par défaut non données.
      key: 'po2Deco',
      label: { fr: 'Alerte PO₂ déco', en: 'Deco PO₂ alert' },
      options: [1.4, 1.45, 1.5, 1.55, 1.6].map((v) => ({ value: v.toFixed(2), label: `${v.toFixed(2)} bar` })),
      default: '1.50',
      group: 'alerts',
    },
    {
      // §10 (figure « Alertes ») : « Alerte PEN₂ 50m » (en anglais « EN₂D limit ») ; plage et valeur
      // par défaut non données.
      key: 'pen2',
      label: { fr: 'Alerte PEN₂ (profondeur équivalente)', en: 'EN₂D limit (equivalent narcotic depth)' },
      options: range(30, 70, 5).map((v) => ({ value: String(v), label: `${v} m` })),
      default: '50',
      group: 'alerts',
    },
    {
      // §10 (figure « Alertes ») : « Alerte densité gaz 5,20g/l » ; plage et valeur par défaut non données.
      key: 'density',
      label: { fr: 'Alerte densité gaz', en: 'Gas density alert' },
      options: range(40, 65, 1).map((v) => ({ value: (v / 10).toFixed(1), label: `${(v / 10).toFixed(2)} g/l` })),
      default: '5.2',
      group: 'alerts',
    },
    {
      // §10 : « La fonction d'alarme par vibrations peut être désactivée » (figures : Actif / Inactif).
      // Valeur par défaut non donnée : Actif supposé.
      key: 'vibration',
      label: { fr: 'Vibreur', en: 'Vibration' },
      options: [{ value: 'on', label: on }, { value: 'off', label: off }],
      default: 'on',
    },
    {
      // Champ en haut à droite, changé en plongée (surbrillance + OK, §8). §8 (texte et figures) :
      // Plafond, GFsurf, GF et Tissus. « P moy. » n'est dans aucun document : ajouté d'après le
      // témoignage d'un utilisateur de l'appareil (ticket GitHub n° 17, firmware 2.0.14.0, photo :
      // nombre entier), comme l'ordre de défilement (confirmé dans le ticket) ; son libellé anglais
      // (« Avg ») est supposé. Choix par défaut non donné.
      key: 'top',
      essential: true,
      label: { fr: 'Champ en haut à droite', en: 'Top right field' },
      options: [
        { value: 'ceil', label: { fr: 'Plafond', en: 'Ceiling' } },
        { value: 'tissues', label: { fr: 'Tissus', en: 'Tissues' } },
        { value: 'avg', label: { fr: 'P moy.', en: 'Avg' } },
        { value: 'gfsurf', label: 'GFsurf' },
        { value: 'gf', label: 'GF' },
      ],
      default: 'gfsurf',
    },
  ];

  /** §10 : boîtes de dialogue « Alertes », affichées jusqu'à l'appui sur un bouton. */
  protected notices = new Notices<OdysseyNotice>(['pn2', 'density']);
  /** La plongée a demandé des paliers (§8 : NDL grisée une fois les paliers terminés, d'après la figure). */
  protected hadDeco = false;

  constructor() {
    super();
    // §8 : « Si la profondeur est inférieure au plafond théorique de décompression, le champ
    // d'affichage du palier est mis en surbrillance rouge au-delà de -10cm » (la surbrillance marron,
    // au-dessus de la consigne, est gérée par l'écran). Aucun verrouillage n'est décrit.
    this.violationRef = 'ceiling';
    this.ceilingMargin = 0.1;
    this.stopWindow = 1.0; // non donné par le manuel
    this.ndlCap = 241; // §8 : « +240' » au-delà de 240 min
    this.init();
  }

  baseParams(): DecoParams {
    const hi = Number(this.settings.gfHigh) || 80;
    const lo = Math.min(Number(this.settings.gfLow) || 80, hi); // contrôle de l'appareil non décrit
    // §8 : remontée à la vitesse réglée (VR) jusqu'au premier palier (la DTR compte 6 m/min ensuite, voir dtrSec()).
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop) || 3, stopStep: 3, ascentRate: this.vr };
  }

  /** §6 (figure, menu Gaz) : « Gaz un » à « Gaz huit ». */
  get maxGases(): number {
    return 8;
  }

  /** Alerte PO₂ déco (§10) : MOD des gaz de décompression. */
  decoPpo2(): number {
    return Number(this.settings.po2Deco) || 1.5;
  }

  /** Alerte PO₂ du gaz respiré : fond ou déco (§10.1). */
  po2Limit(s: DiveSession): number {
    return s.breathing > 0 ? this.decoPpo2() : this.modPpo2;
  }

  /** Consigne VR (§8, §10.4). */
  get vr(): number {
    return Number(this.settings.vr) || 12;
  }

  /** §10.1 : pression de réserve : 35 bar si la profondeur maximale atteinte est d'au plus 10 m, 50 bar au-delà. */
  reserveBar(maxDepth: number): number {
    return maxDepth <= 10 ? 35 : 50;
  }

  /**
   * §10.1 : alarme « Instantanée si Vm/min > à la consigne enregistrée ». §10.4 (figures, VR = 12) :
   * 10 lente (blanc), 12 normale (vert), 14 et plus rapide (rouge).
   */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > this.vr ? 2 : 0;
  }

  /** Le « Palier O'Dive », palier de sécurité (§8), est programmé. */
  get hasSafetyStop(): boolean {
    return this.settings.odive !== '0';
  }

  safetySeconds(): number {
    return (Number(this.settings.odive) || 0) * 60;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.notices.clear();
    this.hadDeco = false;
  }

  /** ppN₂ (bar) au-delà de laquelle l'alarme PN2 se déclenche : celle de l'air à la profondeur PEN₂. */
  pn2Limit(): number {
    return 0.79 * depthToPressure(Number(this.settings.pen2) || 50);
  }

  /** Densité du gaz respiré à la pression ambiante (g/l). */
  gasDensity(s: DiveSession): number {
    const n2 = 1 - s.gas.o2 - s.gas.he;
    return (s.gas.o2 * RHO.o2 + n2 * RHO.n2 + s.gas.he * RHO.he) * s.pressure;
  }

  ppn2(s: DiveSession): number {
    return (1 - s.gas.o2 - s.gas.he) * s.pressure;
  }

  tick(s: DiveSession, dt: number): void {
    // Palier O'Dive (§8 : palier de sécurité, sans autre détail) : au dernier palier, compté entre 1 m
    // au-dessus et 1,5 m en dessous, après une plongée plus profonde que 10 m (seuils supposés).
    const last = Number(this.settings.lastStop) || 3;
    this.safetyStop = { trigger: 10, start: last + 1.5, top: last - 1, bottom: last + 1.5, reset: 10 };
    super.tick(s, dt);
    if (!this.hasSafetyStop) this.safetyState = 'none';
    if (!s.inDive) return;
    if (!s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) this.hadDeco = true;
    // §10.1 : « Profondeur liée à la pression partielle Azote » et « à la densité du gaz respiré ».
    const now: OdysseyNotice[] = [];
    if (this.ppn2(s) > this.pn2Limit()) now.push('pn2');
    if (this.gasDensity(s) > (Number(this.settings.density) || 5.2)) now.push('density');
    this.notices.update(now);
  }

  /** Les boîtes « Alertes » s'effacent par l'appui sur un bouton (voir press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  /**
   * §5.1 : interdiction de vol tant que la « Tension d'Azote Résiduelle » d'un compartiment dépasse
   * 0,8 bar. Les deux figures montrent environ 12 h juste après une plongée courte (« Vol possible dans
   * 11:57 ») : un minimum de 12 h en est déduit.
   */
  noFlyMinutes(t: Tissues, sinceEnd: number): number {
    const sim = t.clone();
    let m = 0;
    const loaded = () => {
      for (let i = 0; i < COMPARTMENTS; i++) if (sim.n2[i] + sim.he[i] > 0.8) return true;
      return false;
    };
    while (loaded() && m < 72 * 60) {
      sim.expose(SURFACE_PRESSURE, AIR, 5);
      m += 5;
    }
    return Math.max(m, 12 * 60 - sinceEnd / 60, 0);
  }

  /** NDL en secondes (§8 : affichée en m'ss sous 3 min). */
  ndlSeconds(s: DiveSession, gfHigh: number): number {
    const m = ndl(s.tissues, s.depth, s.gas, gfHigh, this.ndlCap);
    if (m >= 3) return m * 60;
    const sim = s.tissues.clone();
    const p = s.pressure;
    sim.expose(p, s.gas, m);
    let sec = m * 60;
    while (sec < 180 && sim.tolerates(SURFACE_PRESSURE, gfHigh)) {
      sim.expose(p, s.gas, 5 / 60);
      sec += 5;
    }
    return Math.max(0, sec - 5);
  }

  compute(s: DiveSession): ComputerView {
    const v = super.compute(s);
    if (!s.inDive && s.log.length > 0) v.noFly = this.noFlyMinutes(s.tissues, s.surfaceInterval ?? 0);
    return v;
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const r = super.summary(v);
    if (!v.inDeco && v.ndl > 240) r.ndl = '+240';
    return r;
  }

  /**
   * Bulle d'explication (app/alertHelp.ts) : §8 (NDL, paliers, pas de verrouillage), §10 alertes
   * et §10.1 (PO₂ fond, PN2, densité, pression de réserve), §10.4 vitesse de remontée.
   */
  alertExplain(key: string): AlertExplain | null {
    switch (key) {
      case 'ndl3':
        return { code: 'NDL_LOW', what: { fr: 'Sous 3 min, la NDL passe en m’ss sur fond gris et l’Odyssey vibre (deux séries d’avertissement).', en: 'Below 3 minutes, the NDL switches to m’ss on a grey background and the Odyssey vibrates (two warning series).' } };
      case 'low-gas':
        return { code: 'LOW_GAS', what: { fr: 'Avec l’émetteur : la pression passe sous la réserve (35 bar si la plongée n’a pas dépassé 10 m, 50 bar sinon, §10.1) et l’Odyssey vibre ; le champ du bloc est rouge sous 50 bar, orange de 100 à 50 bar (§8).', en: 'With the transmitter: the pressure drops below the reserve (35 bar if the dive stayed within 10 m, 50 bar otherwise, §10.1) and the Odyssey vibrates; the tank field is red below 50 bar, orange from 100 to 50 bar (§8).' } };
      case 'pn2':
        return { screen: 'PN2 / Narcotic', what: { fr: 'Boîte « Alertes » (« Narcotic » en anglais) : la pression partielle d’azote du gaz respiré dépasse celle de la profondeur d’alerte réglée (« Alerte PEN₂ », 50 m sur la figure) : risque de narcose. Elle reste affichée jusqu’à l’appui sur un bouton (vibration supposée).', en: '“Alerts” box (“PN2” in French): the nitrogen partial pressure of the gas breathed exceeds that of the set alert depth (“EN₂D limit”, 50 m on the figure): narcosis risk. It stays until a button is pressed (vibration assumed).' }, todo: { fr: 'Remontez de quelques mètres.', en: 'Ascend a few metres.' } };
      case 'density':
        return { screen: 'Densité / Density', what: { fr: 'Boîte « Alertes » : la densité du gaz respiré dépasse l’alerte réglée (5,20 g/l sur la figure) ; un gaz trop dense augmente l’effort respiratoire et le CO₂. Elle reste affichée jusqu’à l’appui sur un bouton (vibration supposée).', en: '“Alerts” box: the density of the gas breathed exceeds the set alert (5.20 g/l on the figure); too dense a gas raises the breathing effort and CO₂. It stays until a button is pressed (vibration assumed).' }, todo: { fr: 'Remontez et réduisez l’effort.', en: 'Ascend and reduce the effort.' } };
      case 'CEILING':
        return { what: { fr: 'Surbrillance marron à plus de 10 cm au-dessus du palier, rouge à plus de 10 cm au-dessus du plafond. L’Odyssey ne se verrouille pas.', en: 'Brown highlight more than 10 cm above the stop, red more than 10 cm above the ceiling. The Odyssey does not lock.' } };
      case 'ASCENT':
        return { what: { fr: 'Flèches rouges au-delà de la consigne de vitesse VR (menu Personnel : 8 à 15 m/min), sans vibration.', en: 'Red arrows beyond the set ascent rate VR (Personal menu: 8 to 15 m/min), with no vibration.' } };
      default:
        return null;
    }
  }

  get soundKind(): AlertCue['kind'] {
    return 'buzz';
  }

  /**
   * Vibrations (§10) : NDL sous 3 min, « deux séries d'avertissement par vibration » (§8) ; pression
   * bouteille faible « avec vibrations », vitesse de remontée « sans vibration » (légende des figures
   * du §10), sous la pression de réserve du §10.1. Boîtes « Alertes » PN2 et densité : vibration
   * supposée (non précisé), jusqu'à l'acquittement.
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if ((!all && this.settings.vibration === 'off') || !v.inDive) return [];
    const cues: AlertCue[] = [];
    if (!v.inDeco && v.ndl < 3 && v.depth > 1) cues.push({ key: 'ndl3', kind: 'buzz', level: 'warning', until: 'once', first: 2 });
    if (v.tank.ai && v.tank.pressure < this.reserveBar(v.maxDepth)) cues.push({ key: 'low-gas', kind: 'buzz', level: 'warning', until: 'once' });
    for (const key of this.notices.all) cues.push({ key, kind: 'buzz', level: 'alarm', until: 'ack', every: 10 });
    return cues;
  }
}
