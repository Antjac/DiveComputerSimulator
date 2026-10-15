import type { DiveSession } from '../../../engine/session';
import { depthUnit, pressUnit } from '../../../units';
import type { ButtonHelp, ComputerView, SettingDef } from '../../base';
import { mmss } from '../../base';
import { DescentXDevice, FICTIVE, GREY } from '../descentx/device';
import { DescentXRules } from '../descentx/rules';

/**
 * Garmin Descent X50i (owner's manual 2024): 3" rectangular colour touchscreen, four buttons on the
 * bottom edge, Descent T2 transceiver. Data screens after the figures of Single-Gas and Multi-Gas Data
 * Screens, Viewing Transceiver Data During a Dive, Performing a Safety Stop / a Decompression Stop and
 * Viewing Your Dynamic Depth (rules: descentx/rules.ts and ../rules.ts).
 */
export class GarminDescentX50i extends DescentXDevice {
  readonly id = 'garmin-x50i';
  readonly name = 'Garmin Descent X50i';
  readonly transmitter = 'Descent T2';
  readonly settingDefs: SettingDef[] = DescentXRules.xSettings(true);
  protected readonly vbW = 560;
  protected readonly frame = 'gx50';
  protected readonly prevScrolls = false;
  readonly notes = {
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient : Low, Medium, High ou Custom (valeurs des niveaux non données par le manuel : 45/95, 40/85, 35/70 repris du Descent Mk3 ; Custom 10 à 100 % par 5 supposé). Modes Single-Gas (par défaut supposé) et Multi-Gas ; CCR et Gauge non simulés. Écran principal (figure Single-Gas and Multi-Gas Data Screens) : barre de saturation (vert < 80 %, jaune 80–99 %, rouge ≥ 100 %), NDL, chevrons de vitesse (vert < 7,9 m/min, jaune jusqu’à 10,1 m/min, rouge au-delà ; nombre de chevrons allumés déduit), profondeur, durée, gaz et PO2 (masquée en Single-Gas à l’air), boussole, TTS, profondeur max., batterie, heure, température. Bandeau STOP vert (palier de sécurité à 5 m après 11 m : décompte à 1 m près, jaune plus de 2 m au-dessus, pause plus de 3 m au-dessus, remise à zéro sous 11 m) ou DECO jaune (profondeur et durée du palier ; plus de 0,6 m au-dessus : profondeur et palier clignotent en rouge, chronomètre en pause, verrouillage de 24 h après 3 min). NEXT : écran Dynamic Depth (@+5, Δ+5 ou NDL Δ 3M, STOPS, profil et plan de remontée), puis écran de l’émetteur (PSAC, ATR, pression). ENTER > Switch Gas : changement de gaz. Multi-Gas : à la MOD/Deco PO2 d’un gaz plus riche, « Switch to … now? » (réponses Yes / Not Now déduites) ; refusée ou ignorée (30 s supposées) : « Continuing on … Switch at any time. », le gaz reste compté et l’invite revient 2 min plus tard. Alertes du tableau Dive Alerts en fenêtres à deux lignes (texte exact ; présentation déduite : pas de figure) : 10 et 5 min de NDL, NDL exceeded, Approaching deco stop, Decompression cleared, Safety stop started / cleared, SLOW YOUR ASCENT (> 9,1 m/min pendant 5 s), DESCEND TO …, ASCEND OR SWITCH GAS (PO2 Critical, 1,6 bar supposé), DESCEND OR SWITCH GAS (PO2 < 0,18 bar), OTU (limite non donnée : 300 supposées), alertes personnalisées. Émetteur : réserve (50 bar supposé) et pression critique max(21 bar, réserve / 2). Valeurs fictives : batterie 100 %, cap de la boussole (non simulée). Non simulés : écran tactile, lampe, boussole, carte, messages entre plongeurs, bouée, fin de plongée anticipée, Add New, gaz de voyage, verrouillage désactivable.',
    en: 'Bühlmann ZHL-16C with gradient factors: Low, Medium, High or Custom (level values not given by the manual: 45/95, 40/85, 35/70 taken from the Descent Mk3; Custom 10 to 100 % by 5 assumed). Single-Gas (assumed default) and Multi-Gas modes; CCR and Gauge not simulated. Main screen (Single-Gas and Multi-Gas Data Screens figure): tissue load bar (green < 80 %, yellow 80–99 %, red ≥ 100 %), NDL, rate chevrons (green < 7.9 m/min, yellow up to 10.1 m/min, red beyond; number of lit chevrons deduced), depth, dive time, gas and PO2 (hidden in Single-Gas on air), compass, TTS, max depth, battery, time of day, temperature. Green STOP banner (safety stop at 5 m after 11 m: countdown within 1 m, yellow more than 2 m above, paused more than 3 m above, reset below 11 m) or yellow DECO banner (stop depth and time; more than 0.6 m above: depth and stop flash red, timer paused, 24 h lockout after 3 min). NEXT: Dynamic Depth screen (@+5, Δ+5 or NDL Δ 3M, STOPS, profile and ascent plan), then the transceiver screen (PSAC, ATR, pressure). ENTER > Switch Gas: gas switch. Multi-Gas: at the MOD/Deco PO2 of a richer gas, “Switch to … now?” (Yes / Not Now answers deduced); declined or ignored (30 s assumed): “Continuing on … Switch at any time.”, the gas stays counted and the prompt comes back 2 minutes later. Dive Alerts table alerts as two-line pop-ups (exact wording; presentation deduced: no figure): 10 and 5 min of NDL, NDL exceeded, Approaching deco stop, Decompression cleared, Safety stop started / cleared, SLOW YOUR ASCENT (> 9.1 m/min for 5 s), DESCEND TO …, ASCEND OR SWITCH GAS (PO2 Critical, 1.6 bar assumed), DESCEND OR SWITCH GAS (PO2 < 0.18 bar), OTU (limit not given: 300 assumed), custom alerts. Transceiver: reserve (50 bar assumed) and critical pressure max(21 bar, reserve / 2). Fictive values: battery 100 %, compass heading (not simulated). Not simulated: touchscreen, torch, compass, map, diver messages, buoy, early dive end, Add New, travel gas, disabling the lockout.',
  };

  constructor() {
    super();
    this.init();
  }

  protected screens(v: ComputerView): ('primary' | 'dynamic' | 'tank')[] {
    // NEXT: primary, (dive compass: not simulated), dynamic depth "during a gas dive", transceiver data.
    return v.tank.ai ? ['primary', 'dynamic', 'tank'] : ['primary', 'dynamic'];
  }

  /** Compass tape of the primary screen (heading fictive: the simulator has no compass). */
  private compass(): string {
    const cx = 375;
    let ticks = '';
    for (let a = -60; a <= 60; a += 10) {
      const x = cx + a * 2.9;
      const y = 22 + (a * a) / 300;
      ticks += `<line x1="${x}" y1="${y}" x2="${x + a / 30}" y2="${y + (a % 30 === 0 ? 16 : 9)}" stroke="#fff" stroke-width="2"/>`;
    }
    const lbl = (a: number, t: string) => this.t(cx + a * 2.9, 48 + (a * a) / 300, 22, t, { anchor: 'middle' });
    return `${ticks}${lbl(-45, 'NW')}${lbl(0, 'N')}${lbl(45, 'NE')}
      <path d="M ${cx} 6 L ${cx + 7} 20 L ${cx - 7} 20 Z" fill="#fff"/>
      ${this.t(cx, 98, 56, `${FICTIVE.heading}°`, { anchor: 'middle' })}`;
  }

  protected primary(v: ComputerView, s: DiveSession): string {
    // Single-Gas and Multi-Gas Data Screens ③: "In the single-gas dive mode, this field does not appear
    // if you are using air for your breathing gas."
    const showPo2 = this.multiGas || s.gas.o2 > 0.215 || s.gas.o2 < 0.205;
    return `${this.leftColumn(v, s, showPo2)}
      <line x1="188" y1="0" x2="188" y2="320" stroke="#333" stroke-width="2"/>
      ${this.compass()}
      <line x1="192" y1="108" x2="556" y2="108" stroke="#333" stroke-width="2"/>
      <line x1="373" y1="108" x2="373" y2="212" stroke="#333" stroke-width="2"/>
      ${this.t(282, 138, 24, 'TTS', { anchor: 'middle', fill: GREY })}
      ${this.t(282, 198, 60, mmss(v.plan.tts * 60), { anchor: 'middle' })}
      ${this.t(465, 138, 24, 'MAX. DEPTH', { anchor: 'middle', fill: GREY })}
      <text x="465" y="198" font-size="60" text-anchor="middle" font-weight="700" fill="#fff" class="gx-t">${this.depthText(v.maxDepth)}<tspan font-size="28">${depthUnit()}</tspan></text>
      <line x1="192" y1="212" x2="556" y2="212" stroke="#333" stroke-width="2"/>
      ${this.t(242, 244, 26, 'BATT.', { anchor: 'middle', fill: GREY })}
      ${this.battery(198, 290, 30)}${this.t(330, 290, 38, `${FICTIVE.battery}%`, { anchor: 'end' })}
      ${this.t(395, 244, 26, 'TOD', { anchor: 'middle', fill: GREY })}
      ${this.t(395, 290, 38, this.tod(s), { anchor: 'middle' })}
      ${this.t(505, 244, 26, 'TEMP.', { anchor: 'middle', fill: GREY })}
      ${this.t(505, 290, 38, this.tempText(v), { anchor: 'middle' })}`;
  }

  /**
   * Viewing Your Dynamic Depth (figure): @+5 (TTS after 5 more minutes here), Δ+5 (its difference with
   * the TTS) or, out of a decompression stop, NDL Δ 3M / NDL Δ 10FT; STOPS (upcoming stops); the chart;
   * MAX and TTS below.
   */
  protected dynamicScreen(v: ComputerView, s: DiveSession): string {
    const showPo2 = this.multiGas || s.gas.o2 > 0.215 || s.gas.o2 < 0.205;
    const { at, delta } = this.at5(v, s);
    const ft = depthUnit() === 'ft';
    const second = v.inDeco
      ? [this.t(370, 26, 24, 'Δ+5', { anchor: 'middle', fill: GREY }), this.t(370, 66, 44, `+${mmss(delta * 60)}`, { anchor: 'middle' })]
      : [this.t(370, 26, 24, ft ? 'NDL Δ 10FT' : 'NDL Δ 3M', { anchor: 'middle', fill: GREY }), this.t(370, 66, 44, String(Math.min(99, this.ndlUp3(v, s, this.decoParams(s)))), { anchor: 'middle' })];
    return `${this.leftColumn(v, s, showPo2)}
      <line x1="188" y1="0" x2="188" y2="320" stroke="#333" stroke-width="2"/>
      ${this.t(250, 26, 24, '@+5', { anchor: 'middle', fill: GREY })}
      ${this.t(250, 66, 44, mmss(at * 60), { anchor: 'middle' })}
      ${second.join('')}
      ${this.t(500, 26, 24, 'STOPS', { anchor: 'middle', fill: GREY })}
      ${this.t(500, 66, 44, String(v.inDeco ? v.plan.stops.length : 0), { anchor: 'middle' })}
      ${this.chart(250, 84, 300, 180, v, s, true)}
      ${this.t(196, 312, 28, 'MAX', { fill: GREY })}
      <text x="258" y="312" font-size="40" font-weight="700" fill="#fff" class="gx-t">${this.depthText(v.maxDepth)}<tspan font-size="22" fill="${GREY}">${depthUnit()}</tspan></text>
      ${this.t(384, 312, 28, 'TTS', { fill: GREY })}
      ${this.t(554, 312, 40, mmss(v.plan.tts * 60), { anchor: 'end' })}`;
  }

  /**
   * Viewing Transceiver Data During a Dive (figure): gas consumption (PSAC), ATR, and the pinned
   * transceivers' pressures (here only the diver's own, "T1": default name not given, deduced).
   */
  protected tankScreen(v: ComputerView, s: DiveSession): string {
    const p = this.tankText(v);
    const psac = v.tank.sacBar * (pressUnit() === 'psi' ? 14.5038 : 1);
    const atr = v.tank.gasTime === null ? '--' : v.tank.gasTime > 99 ? '99+' : String(v.tank.gasTime);
    return `${this.leftColumn(v, s, true)}
      <line x1="188" y1="0" x2="188" y2="320" stroke="#333" stroke-width="2"/>
      ${this.compass()}
      <line x1="192" y1="108" x2="556" y2="108" stroke="#333" stroke-width="2"/>
      <line x1="373" y1="108" x2="373" y2="212" stroke="#333" stroke-width="2"/>
      ${this.t(282, 138, 24, 'PSAC', { anchor: 'middle', fill: GREY })}
      ${this.t(282, 198, 60, psac.toFixed(pressUnit() === 'psi' ? 0 : 1), { anchor: 'middle' })}
      ${this.t(465, 138, 24, this.gasTimeName, { anchor: 'middle', fill: GREY })}
      ${this.t(465, 198, 60, atr, { anchor: 'middle' })}
      <line x1="192" y1="212" x2="556" y2="212" stroke="#333" stroke-width="2"/>
      ${this.t(200, 248, 28, 'T1')}
      ${this.t(200, 302, 50, p.text, { fill: p.fill, cls: p.cls })}`;
  }

  buttons(): Record<string, ButtonHelp> {
    const b = this.baseButtons();
    b.back.name = 'BACK · PWR';
    b.enter.name = 'ENTER · TORCH';
    b.enter.hold = { real: { fr: 'Allume la lampe', en: 'Turns on the torch' }, simulated: false };
    return b;
  }
}
