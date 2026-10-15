import type { DiveSession } from '../../../engine/session';
import { depthUnit } from '../../../units';
import type { ButtonHelp, ComputerView, SettingDef } from '../../base';
import { mmss } from '../../base';
import { DescentXDevice, FICTIVE, GREY } from '../descentx/device';
import { DescentXRules } from '../descentx/rules';

/**
 * Garmin Descent X30 (owner's manual 2025): rectangular colour display, four buttons on the bottom
 * edge, no transceiver. The Single-Gas and Multi-Gas modes have different primary screens (Single-Gas
 * Data Screens and Multi-Gas Data Screens figures); safety and decompression stops after the figures
 * of Performing a Safety Stop / a Decompression Stop (Single-Gas layout), dynamic depth after Viewing
 * Your Dynamic Depth (rules: descentx/rules.ts and ../rules.ts).
 */
export class GarminDescentX30 extends DescentXDevice {
  readonly id = 'garmin-x30';
  readonly name = 'Garmin Descent X30';
  readonly transmitter = null;
  readonly gasTimeName = '';
  // The dive mode changes the primary screen: it is the display setting of this model.
  readonly settingDefs: SettingDef[] = DescentXRules.xSettings(false).map((d) => (d.key === 'diveMode' ? { ...d, essential: true } : d));
  protected readonly vbW = 430;
  protected readonly frame = 'gx30';
  protected readonly prevScrolls = true;
  readonly notes = {
    fr: 'Bühlmann ZHL-16C avec facteurs de gradient : Low, Medium, High ou Custom (valeurs des niveaux non données par le manuel : 45/95, 40/85, 35/70 repris du Descent Mk3 ; Custom 10 à 100 % par 5 supposé). Modes Single-Gas (par défaut supposé) et Multi-Gas, chacun avec son écran principal ; Gauge non simulé. Single-Gas (figure) : barre de saturation, NDL et profondeur en grands chiffres, chevrons de vitesse, durée (TIME), PO2, gaz ; pendant un palier, bandeau STOP vert ou DECO jaune à la place du NDL. Multi-Gas (figure) : NDL, profondeur, durée, gaz et PO2 à gauche, SURF. GF, MAX. DEPTH, batterie, heure et température à droite. Couleurs : saturation verte < 80 %, jaune 80–99 %, rouge ≥ 100 % ; vitesse verte < 7,9 m/min, jaune jusqu’à 10,1 m/min, rouge au-delà (nombre de chevrons allumés déduit). Palier de sécurité à 5 m après 11 m (décompte à 1 m près, jaune plus de 2 m au-dessus, pause plus de 3 m au-dessus, remise à zéro sous 11 m). Palier de déco : plus de 0,6 m au-dessus, profondeur et palier clignotent en rouge, chronomètre en pause, verrouillage de 24 h après 3 min. PREV / NEXT : écrans de données (principal, Dynamic Depth : TTS, Δ+5 ou NDL Δ 3M, STOPS, profil et plan de remontée). ENTER > Switch Gas. Multi-Gas : « Switch to … now? » (Yes / Not Now déduits) ; refusée ou ignorée (30 s supposées) : « Continuing on … Switch at any time. », l’invite revient 2 min plus tard. Alertes du tableau Dive Alerts en fenêtres (texte exact, présentation déduite), comme sur le X50i sans les alertes CCR, émetteur et lampe. Pas d’émetteur. Valeur fictive : batterie 100 %. Non simulés : boussole, chronomètre, mode piscine, fin de plongée anticipée, Add New, verrouillage désactivable.',
    en: 'Bühlmann ZHL-16C with gradient factors: Low, Medium, High or Custom (level values not given by the manual: 45/95, 40/85, 35/70 taken from the Descent Mk3; Custom 10 to 100 % by 5 assumed). Single-Gas (assumed default) and Multi-Gas modes, each with its own primary screen; Gauge not simulated. Single-Gas (figure): tissue load bar, NDL and depth in big figures, rate chevrons, dive time (TIME), PO2, gas; during a stop, green STOP or yellow DECO banner instead of the NDL. Multi-Gas (figure): NDL, depth, dive time, gas and PO2 on the left, SURF. GF, MAX. DEPTH, battery, time of day and temperature on the right. Colours: load green < 80 %, yellow 80–99 %, red ≥ 100 %; rate green < 7.9 m/min, yellow up to 10.1 m/min, red beyond (number of lit chevrons deduced). Safety stop at 5 m after 11 m (countdown within 1 m, yellow more than 2 m above, paused more than 3 m above, reset below 11 m). Deco stop: more than 0.6 m above, depth and stop flash red, timer paused, 24 h lockout after 3 min. PREV / NEXT: data screens (primary, Dynamic Depth: TTS, Δ+5 or NDL Δ 3M, STOPS, profile and ascent plan). ENTER > Switch Gas. Multi-Gas: “Switch to … now?” (Yes / Not Now deduced); declined or ignored (30 s assumed): “Continuing on … Switch at any time.”, the prompt comes back 2 minutes later. Dive Alerts table alerts as pop-ups (exact wording, presentation deduced), as on the X50i without the CCR, transceiver and torch alerts. No transceiver. Fictive value: battery 100 %. Not simulated: compass, stopwatch, pool mode, early dive end, Add New, disabling the lockout.',
  };

  constructor() {
    super();
    this.init();
  }

  protected screens(): ('primary' | 'dynamic' | 'tank')[] {
    return ['primary', 'dynamic'];
  }

  protected primary(v: ComputerView, s: DiveSession): string {
    return this.multiGas ? this.multiScreen(v, s) : this.singleScreen(v, s);
  }

  /** Single-Gas Data Screens figure, and the stop figures (STOP / DECO banner over the NDL). */
  private singleScreen(v: ComputerView, s: DiveSession): string {
    const b = this.stopBanner(v);
    const warn = b?.warn === 'red' ? `fill="#ff3b30" class="gx-t blink"` : b?.warn === 'yellow' ? 'fill="#f6a821" class="gx-t"' : 'fill="#fff" class="gx-t"';
    const top = b
      ? this.bannerBox(b, 2, 2, 262, 150, true)
      : v.locked
        ? `<rect x="2" y="30" width="262" height="90" rx="4" fill="#ff3b30"/>${this.t(133, 88, 30, 'DECO LOCKOUT', { anchor: 'middle' })}`
        : `${this.tissueBar(8, 12, 140, v.n2Load)}
           ${this.t(34, 42, 36, 'NDL', { fill: GREY })}
           <text x="34" y="146" font-size="112" font-weight="700" fill="#fff" class="gx-t">${this.ndlText(v)}</text>`;
    const po2 = this.po2Cls(v, s);
    return `${top}
      ${this.chevrons(8, 196, v)}
      <text x="34" y="302" font-size="${this.depthText(v.depth).length > 3 ? 92 : 124}" font-weight="700" ${warn}>${this.depthText(v.depth)}<tspan font-size="38" fill="${GREY}">${depthUnit()}</tspan></text>
      ${this.t(350, 40, 30, 'TIME', { anchor: 'middle', fill: GREY })}
      ${this.t(350, 106, mmss(v.diveTime).length > 5 ? 50 : 66, mmss(v.diveTime), { anchor: 'middle' })}
      ${this.t(350, 160, 30, 'PO2', { anchor: 'middle', fill: GREY })}
      ${this.t(350, 224, 66, v.ppO2.toFixed(2), { anchor: 'middle', fill: po2.fill, cls: po2.cls })}
      <rect x="272" y="246" width="154" height="70" rx="4" fill="#202022"/>
      ${this.t(349, 296, 44, this.gasLabel(s), { anchor: 'middle' })}`;
  }

  private gasLabel(s: DiveSession): string {
    const o2 = Math.round(s.gas.o2 * 100);
    return o2 === 21 && !(s.gas.he ?? 0) ? 'Air' : o2 === 100 ? 'O2' : `EAN${o2}`;
  }

  /** Multi-Gas Data Screens figure. */
  private multiScreen(v: ComputerView, s: DiveSession): string {
    return `${this.leftColumn(v, s, true)}
      <line x1="190" y1="0" x2="190" y2="320" stroke="#333" stroke-width="2"/>
      ${this.t(310, 30, 28, 'SURF. GF', { anchor: 'middle', fill: GREY })}
      <text x="310" y="92" font-size="62" text-anchor="middle" font-weight="700" fill="#fff" class="gx-t">${Math.round(v.surfGf)}<tspan font-size="32">%</tspan></text>
      <line x1="194" y1="104" x2="426" y2="104" stroke="#333" stroke-width="2"/>
      ${this.t(310, 134, 28, 'MAX. DEPTH', { anchor: 'middle', fill: GREY })}
      ${this.t(310, 198, 62, this.depthText(v.maxDepth), { anchor: 'middle' })}
      <line x1="194" y1="210" x2="426" y2="210" stroke="#333" stroke-width="2"/>
      ${this.t(200, 244, 28, 'BATT.', { fill: GREY })}${this.t(424, 244, 34, `${FICTIVE.battery}%`, { anchor: 'end' })}
      ${this.t(200, 278, 28, 'TOD', { fill: GREY })}${this.t(424, 278, 34, this.tod(s), { anchor: 'end' })}
      ${this.t(200, 312, 28, 'TEMP.', { fill: GREY })}${this.t(424, 312, 34, this.tempText(v), { anchor: 'end' })}`;
  }

  /** Viewing Your Dynamic Depth (X30 figure): TTS, Δ+5 (or NDL Δ 3M), STOPS, then the chart. */
  protected dynamicScreen(v: ComputerView, s: DiveSession): string {
    const { delta } = this.at5(v, s);
    const ft = depthUnit() === 'ft';
    const row = (y: number, l: string, val: string) => `${this.t(200, y, 30, l, { fill: GREY })}${this.t(424, y, 36, val, { anchor: 'end' })}`;
    return `${this.leftColumn(v, s, true)}
      <line x1="190" y1="0" x2="190" y2="320" stroke="#333" stroke-width="2"/>
      ${row(34, 'TTS', mmss(v.plan.tts * 60))}
      ${v.inDeco ? row(72, 'Δ+5', `+${mmss(delta * 60)}`) : row(72, ft ? 'NDL Δ 10FT' : 'NDL Δ 3M', String(Math.min(99, this.ndlUp3(v, s, this.decoParams(s)))))}
      ${row(110, 'STOPS', String(v.inDeco ? v.plan.stops.length : 0))}
      ${this.chart(200, 128, 222, 184, v, s, false)}`;
  }

  protected tankScreen(v: ComputerView, s: DiveSession): string {
    return this.primary(v, s);
  }

  buttons(): Record<string, ButtonHelp> {
    const b = this.baseButtons();
    b.back.name = 'BACK · PWR';
    return b;
  }
}
