// Gas switch prompt of the multi-gas models: during the ascent, once the diver is shallower than the
// switch depth (MOD) of a richer programmed gas, the computer offers it; the diver accepts (the gas
// becomes the one breathed) or declines, or the offer expires. Each model shows it its own way and
// cites its manual; a gas is offered again only after the diver went back deeper than its MOD.
import type { DiveSession } from '../../engine/session';

/**
 * Margin (m) under the MOD before the diver counts as "deeper than the MOD" of a gas (not given by the
 * manuals, assumed): hovering at a stop at the MOD (e.g. 6 m for oxygen) must not re-include a gas or
 * cancel its exclusion.
 */
const BELOW_MOD = 0.3;

export class GasPrompt {
  /**
   * `sticky`: a declined gas stays out of the calculation for the rest of the dive, without a new offer,
   * until the diver switches to it by hand (Scubapro: "you will finish the dive without using the
   * excluded gas", G2 §3.4.2, Luna §3.19.3); otherwise going back below its MOD includes it again (Mares).
   */
  constructor(private readonly sticky = false) {}

  /** Gas offered now (index in DiveSession.allGases), or null. */
  offer: number | null = null;
  /** Gases declined (or whose offer expired) since the diver was last deeper than their MOD. */
  readonly declined = new Set<number>();
  private at = 0;
  /** Gases that may be offered: the diver has been deeper than their switch depth. */
  private armed = new Set<number>();

  reset(): void {
    this.offer = null;
    this.declined.clear();
    this.armed.clear();
    this.left = null;
    this.pending = null;
  }

  /**
   * `mods`: switch depth of each programmed gas (index as in allGases; the first, the bottom gas, is
   * ignored); `timeout`: seconds before an unanswered offer expires (null: never).
   * Returns the gases whose offer just expired, and those back in the plan after a dive below their MOD.
   */
  update(s: DiveSession, mods: number[], timeout: number | null): { expired: number | null; included: number[] } {
    const included: number[] = [];
    // A gas switched to by hand is in use again.
    this.declined.delete(s.breathing);
    for (let i = 1; i < mods.length; i++) {
      if (this.sticky && this.declined.has(i)) continue;
      if (s.depth > mods[i] + BELOW_MOD) {
        this.armed.add(i);
        if (this.declined.delete(i)) included.push(i);
      }
    }
    let expired: number | null = null;
    if (this.offer !== null) {
      const o = this.offer;
      if (s.breathing === o || s.depth > mods[o] + BELOW_MOD || !s.inDive) this.offer = null;
      else if (timeout !== null && s.clock - this.at > timeout) {
        this.declined.add(o);
        this.offer = null;
        expired = o;
      }
      return { expired, included };
    }
    if (!s.inDive) return { expired, included };
    const gases = s.allGases;
    const cur = gases[s.breathing]?.o2 ?? 0;
    let best: number | null = null;
    for (let i = 1; i < mods.length; i++) {
      if (!this.armed.has(i) || i === s.breathing || gases[i].o2 <= cur + 1e-9 || s.depth > mods[i]) continue;
      if (best === null || gases[i].o2 > gases[best].o2) best = i;
    }
    if (best !== null) {
      this.offer = best;
      this.at = s.clock;
      this.armed.delete(best);
    }
    return { expired, included };
  }

  /** Last switch to a leaner gas: the richer gas left, and when (session clock). */
  private left: { gas: number; at: number } | null = null;
  private lastBreathing = 0;

  /**
   * Not described by the Mares manuals (assumed, from user feedback, issue #19): back from a richer gas
   * to a leaner one while shallower than the MOD of the richer gas, it leaves the plan after `delay`
   * seconds, as when its prompt goes unanswered; no new offer is made above its MOD. Call after
   * `update`. Returns the gas just excluded, or null.
   */
  leave(s: DiveSession, mods: number[], delay: number): number | null {
    if (s.breathing !== this.lastBreathing) {
      const gases = s.allGases;
      const from = this.lastBreathing;
      this.left = s.inDive && from > 0 && (gases[s.breathing]?.o2 ?? 0) < (gases[from]?.o2 ?? 0) - 1e-9 ? { gas: from, at: s.clock } : null;
      this.lastBreathing = s.breathing;
    }
    const l = this.left;
    // Deeper than its MOD (same margin as the re-inclusion in update), the richer gas stays in the plan.
    const below = l !== null && s.depth > mods[l.gas] + BELOW_MOD;
    if (!l || !s.inDive || below) {
      if (!s.inDive || below) this.left = null;
      return null;
    }
    if (s.clock - l.at < delay) return null;
    this.left = null;
    if (this.declined.has(l.gas)) return null;
    this.declined.add(l.gas);
    return l.gas;
  }

  /** The diver accepts the gas offered. */
  accept(s: DiveSession): void {
    if (this.offer !== null) s.switchGas(this.offer);
    this.offer = null;
  }

  /** Gas whose offer was answered by opening a switch sequence (`handOff`), until `settle`. */
  private pending: number | null = null;

  /** A button opened the switch sequence on the gas offered: the offer ends, its outcome is pending. */
  handOff(): void {
    if (this.offer !== null) this.pending = this.offer;
    this.offer = null;
  }

  /**
   * Once the sequence opened by `handOff` is over (`open` false), the gas offered is declined unless
   * it is the one breathed now, as an unanswered prompt. Returns the gas just declined, or null.
   */
  settle(s: DiveSession, open: boolean): number | null {
    const g = this.pending;
    if (g === null || open) return null;
    this.pending = null;
    if (!s.inDive || s.breathing === g) return null;
    this.declined.add(g);
    return g;
  }

  /** The diver declines it (stays on the current gas). */
  decline(): void {
    if (this.offer !== null) this.declined.add(this.offer);
    this.offer = null;
  }
}
