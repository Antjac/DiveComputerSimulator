// Rules shared by the Cressi computers (Goa, Donatello), whose manuals describe them in the same
// terms: Cressi RGBM with SF0/SF1/SF2, ascent rate dots (SLOW from 12 m/min), 3 min safety stop
// between 5 and 3 m, deep stop, deco prewarning at 3 min, omitted stop for more than 2 min = ERROR
// mode for 48 h, 12 / 24 / 48 h no-fly, penalty after prolonged fast ascents.
import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, desaturationTime, type AlertExplain } from '../base';

/** Approximate GF equivalent of each safety factor (Cressi RGBM is proprietary). */
export const SAFETY: Record<string, number> = { SF0: 0.88, SF1: 0.82, SF2: 0.76 };

export abstract class CressiRules extends DiveComputer {
  readonly algorithm = 'Cressi RGBM (≈)';
  readonly exact = false;

  protected deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  protected deepTarget = 0;
  protected deepRemaining = 60;
  protected missedSec = 0;
  protected fastSec = 0;
  protected hadDeco = false;
  protected repetitiveDive = false;
  protected desatUntil = -Infinity;
  /** Prolonged fast ascent on the last dive: the next dive during desaturation is more conservative. */
  protected penaltyUntil = -Infinity;
  protected penaltyActive = false;
  protected noFlyHours = 12;

  constructor() {
    super();
    // Safety stop after any dive to 10 m or more, 3 minutes between 5 and 3 m.
    this.safetyStop = { trigger: 10, start: 5.1, top: 3, bottom: 5.1, reset: 10 }; // 5 m, as displayed
    this.ceilingMargin = 0; // "rising above the depth specified by the computer": no margin
    this.lockAfter = null; // ERROR mode handled in tick
    this.lockHours = 48;
    this.stopWindow = 1;
  }

  baseParams(): DecoParams {
    const g = SAFETY[this.settings.sf] ?? SAFETY.SF0;
    return { gfLow: g - 0.1, gfHigh: g, lastStop: 3, stopStep: 3, ascentRate: 10 };
  }

  algoParams(s: DiveSession): DecoParams {
    const p = this.baseParams();
    let drop = 0;
    if (s.lastDiveEnd !== null) {
      const si = ((s.inDive ? s.diveStart : s.clock) - s.lastDiveEnd) / 60;
      drop += 0.08 * Math.exp(-si / 150);
    }
    if (this.penaltyActive) drop += 0.05;
    return { ...p, gfLow: p.gfLow - drop, gfHigh: p.gfHigh - drop };
  }

  /** Dots: 1 from 4 m/min, 2 from 8, 3 + SLOW from 12. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 12 ? 2 : rate >= 8 ? 1 : 0;
  }

  /** Number of ascent rate dots lit (0 below 4 m/min). */
  protected ascentDots(rate: number): number {
    return rate >= 12 ? 3 : rate >= 8 ? 2 : rate >= 4 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deepState = 'none';
    this.deepRemaining = 60;
    this.missedSec = 0;
    this.fastSec = 0;
    this.hadDeco = false;
    this.repetitiveDive = s.clock < this.desatUntil;
    this.penaltyActive = s.clock < this.penaltyUntil;
  }

  onDiveEnd(s: DiveSession): void {
    const desat = desaturationTime(s.tissues) * 60;
    this.desatUntil = s.clock + desat;
    // "If the maximum ascent rate of 12 m/min is exceeded for a prolonged period of time", the next
    // dive during the desaturation is more conservative. The duration is not given: 30 s assumed.
    this.penaltyUntil = this.fastSec > 30 ? s.clock + desat : -Infinity;
    this.noFlyHours = this.locked ? 48 : this.hadDeco || this.repetitiveDive ? 24 : 12;
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive || this.locked) return;
    if (s.ascentRate >= 12) this.fastSec += dt;

    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    if (inDeco) this.hadDeco = true;

    // Omitted stop (rising above the stop depth): 2 minutes to go back down, then ERROR mode for 48 hours.
    const stop = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    if (inDeco && s.depth < stop - 0.05) {
      this.missedSec += dt;
      if (this.missedSec > 120) this.lock(s);
    } else {
      this.missedSec = 0;
    }

    // Deep stop: suggested when the profile requires it (1 min, 2 min in a decompression dive).
    if (this.settings.deepstop === 'on' && this.deepState === 'none' && s.maxDepth > 20) {
      const near = inDeco || ndl(s.tissues, s.depth, s.gas, p.gfHigh) <= 10;
      if (near) {
        this.deepTarget = Math.round(pressureToDepth(depthToPressure(s.maxDepth) / 2));
        this.deepRemaining = inDeco ? 120 : 60;
        this.deepState = this.deepTarget >= 10 ? 'pending' : 'done';
      }
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepTarget) <= 1) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepTarget - 1) {
        this.deepState = 'done'; // skipped: the warning is deleted
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }

  /**
   * Alert bubble (app/alertHelp.ts), after the Goa and Donatello manuals (same rules, same words):
   * SLOW, NO DECO prewarning, deco, PO2 limit, omitted stop and ERROR mode, CNS bar, deep stop,
   * maximum depth alarm (Donatello).
   */
  alertExplain(key: string): AlertExplain | null {
    switch (key) {
      case 'slow':
        return { screen: 'SLOW', code: 'ASCENT', what: { fr: 'Les points de vitesse s’allument : 1 dès 4 m/min, 2 dès 8, 3 et « SLOW » dès 12 m/min, avec une alarme sonore. Une remontée trop rapide prolongée rend la plongée suivante plus prudente (pendant la désaturation).', en: 'The rate dots light up: 1 from 4 m/min, 2 from 8, 3 and “SLOW” from 12 m/min, with an audible alarm. A prolonged fast ascent makes the next dive more conservative (during desaturation).' } };
      case 'ndl-3':
        return { code: 'NDL_LOW', what: { fr: 'Pré-alarme sonore quand le temps sans palier descend à 3 min ; « NO DECO » clignote.', en: 'Audible prewarning when the no-deco time drops to 3 minutes; “NO DECO” blinks.' } };
      case 'deco':
        return { code: 'DECO', what: { fr: 'Alarme sonore à la sortie de la courbe de sécurité ; l’icône DECO s’affiche avec le palier (profondeur et durée) et le temps total de remontée. Des flèches indiquent s’il faut monter ou descendre vers le palier.', en: 'Audible alarm when leaving the safety curve; the DECO icon is shown with the stop (depth and time) and the total ascent time. Arrows show whether to go up or down to the stop.' } };
      case 'po2':
        return { code: 'PPO2_HIGH', what: { fr: 'Alarme sonore et profondeur clignotante au-delà de la profondeur limite de la PO2 réglée (MOD), jusqu’au retour au-dessus.', en: 'Audible alarm and blinking depth beyond the depth limit of the set PO2 (MOD), until you are back above it.' } };
      case 'missed-stop':
        return { code: 'CEILING', what: { fr: 'Palier omis : alarme sonore continue dès que vous remontez au-dessus de la profondeur du palier (aucune marge). Après plus de 2 min au-dessus, mode ERROR pendant 48 h : « StOP » clignote, profondeur et durée seulement.', en: 'Omitted stop: continuous audible alarm as soon as you go above the stop depth (no margin). After more than 2 min above it, ERROR mode for 48 h: “StOP” flashes, depth and time only.' }, todo: { fr: 'Vous avez 2 minutes pour redescendre au palier.', en: 'You have 2 minutes to go back down to the stop.' } };
      case 'LOCKED':
        return { screen: 'StOP', what: { fr: 'Mode ERROR pendant 48 h après un palier omis plus de 2 min : « StOP » clignote, l’ordinateur ne donne plus que la profondeur et la durée ; interdiction de vol de 48 h.', en: 'ERROR mode for 48 h after a stop omitted for more than 2 minutes: “StOP” flashes, the computer only gives depth and time; 48 h no-fly.' } };
      case 'cns-4':
        return { code: 'CNS', what: { fr: 'La barre de CNS (5 segments) atteint 4 segments, plus de 60 % : alarme sonore temporaire.', en: 'The CNS bar (5 segments) reaches 4 segments, over 60 %: temporary audible alarm.' } };
      case 'cns-100':
        return { code: 'CNS', what: { fr: 'CNS à 100 % : l’alarme se répète tant que la PO2 reste au-dessus de 0,6 (intervalle non précisé : chaque minute dans le simulateur).', en: 'CNS at 100 %: the alarm repeats while the PO2 stays above 0.6 (interval not given: every minute in the simulator).' }, todo: { fr: 'Terminez la plongée.', en: 'End the dive.' } };
      case 'deep-stop':
        return { screen: 'DEEP STOP', what: { fr: 'Palier profond proposé (réglage activé) sur une plongée de plus de 20 m qui approche de la limite sans palier : à la moitié de la pression absolue maximale, 1 min (2 min en décompression), à ±1 m. Remonter au-dessus l’efface.', en: 'Deep stop offered (setting on) on a dive deeper than 20 m nearing the no-deco limit: at half the maximum absolute pressure, 1 minute (2 in decompression), within ±1 m. Going above it deletes it.' }, todo: { fr: 'Arrêtez-vous à sa profondeur pendant le décompte.', en: 'Stop at its depth during the countdown.' } };
      case 'depth-max':
        return { title: { fr: 'Alarme de profondeur maximale', en: 'Maximum depth alarm' }, what: { fr: 'Trois bips : vous dépassez la profondeur d’alarme réglée ; la profondeur clignote jusqu’au retour au-dessus.', en: 'Three beeps: you are deeper than the set depth alarm; the depth flashes until you are back above it.' }, todo: { fr: 'Remontez au-dessus de la profondeur prévue.', en: 'Ascend above the planned depth.' } };
      default:
        return null;
    }
  }

  /** The fast ascent alarm sounds (the Donatello's AL.SP setting can silence it). */
  protected ascentSound(): boolean {
    return true;
  }

  /**
   * Acoustic alarms (instruction manuals): SLOW (ascent over 12 m/min) while it lasts; NO DECO time
   * down to 3 minutes; leaving the safety curve (deco); PO2 limit depth exceeded, until back
   * shallower; CNS bar at 4 segments out of 5, i.e. above 60 % (temporary alarm), repeated at 100 %
   * until the PO2 drops below 0.6 (interval not given: every minute assumed); a skipped deco stop is
   * signalled by a continuous alarm.
   */
  alertCues(v: ComputerView, all = false): AlertCue[] {
    if (!v.inDive) return [];
    const cues: AlertCue[] = [];
    if (v.alarms.includes('ASCENT') && this.ascentSound()) cues.push({ key: 'slow', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (!v.inDeco && v.ndl <= 3) cues.push({ key: 'ndl-3', kind: 'beep', level: 'warning', until: 'once' });
    if (v.inDeco) cues.push({ key: 'deco', kind: 'beep', level: 'warning', until: 'once' });
    if (v.depth > v.mod) cues.push({ key: 'po2', kind: 'beep', level: 'alarm', until: 'clear', every: 2 });
    if (v.alarms.includes('CEILING')) cues.push({ key: 'missed-stop', kind: 'beep', level: 'alarm', until: 'clear', every: 1 });
    if (v.cns >= 100 && v.ppO2 >= 0.6) cues.push({ key: 'cns-100', kind: 'beep', level: 'warning', until: 'clear', every: 60 });
    else if (v.cns > 60) cues.push({ key: 'cns-4', kind: 'beep', level: 'info', until: 'once' });
    // Alert bubble: the deep stop on display (the Goa's has no sound of its own).
    if (all && (this.deepState === 'pending' || this.deepState === 'active')) cues.push({ key: 'deep-stop', kind: 'beep', level: 'info', until: 'once' });
    return cues;
  }
}
