import type { DecoPlan } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import type { DiveComputer } from '../base';

/**
 * Shearwater TTS in the recreational modes: "the current time to ascend to the surface including the
 * ascent plus all required deco stops and safety stops" (Teric §3.4, Perdix 2 Recreational manual rev. C
 * §4.7, Peregrine §4.6). Teric §6.1 example dive: not included before going deeper than 11 m (9 m: TTS 1), then
 * included (13.9 m: TTS 7 with a 5 min Adapt stop; 5.5 m with 3:22 left: TTS 4, so the sum of the ascent
 * and of the countdown is rounded up). `on`: the model has a safety stop with an end (not in OC Tec, not
 * set to Off; Count Up: the manuals do not say what the TTS then includes, not verified: nothing added).
 */
export function ttsWithSafety(c: DiveComputer, plan: DecoPlan, s: DiveSession, on: boolean): number {
  if (!s.inDive || !on) return plan.tts;
  const st = c.safetyState;
  if (st === 'none' || st === 'done') return plan.tts;
  const left = st === 'pending' ? c.safetySeconds(s) : c.safetyRemaining;
  return Math.ceil(plan.time + left / 60 - 1e-6);
}
