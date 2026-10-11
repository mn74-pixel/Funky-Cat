// Funky Cat – liczenie punktów po stronie serwera.
// Gra wysyła tylko zapis pozycji kota (co 50 ms). Serwer sam sprawdza, które nuty
// kot złapał, i liczy punkty tymi samymi zasadami co gra. Wpisanie „dowolnego wyniku”
// nic nie daje, bo wynik nie przychodzi z telefonu.
import { STAGES } from 'backend/funkycat-data';

export const TRACE_DT = 0.05;
const K_GOLD = 0, K_DROP = 1, K_BAD = 2, K_SOLO = 3, K_RAIN = 4, K_FINAL = 5;
const CATCH_HW = 0.082, R = 0.044, PERFECT_DX = 0.034;
const EARLY = 0.045, LATE = 0.09;     // okno czasowe złapania (gra: 0.045 / 0.075 + zapas na klatki)
const SLACK = 0.008;                   // drobny zapas na różnice ekranów

function multFor(c) { return c >= 50 ? 4 : (c >= 25 ? 3 : (c >= 10 ? 2 : 1)); }
function radius(n) {
  const k = n[2], a = n[3];
  if (k === K_BAD) return 0.05 + R * 0.55;
  const r = k === K_DROP ? R * 0.4 : (k === K_SOLO ? R * 1.6 : (k === K_FINAL ? R * 1.7 : R));
  let base = CATCH_HW + r * 0.6;
  if (k === K_SOLO || k === K_FINAL) base += 0.03;
  if (k === K_GOLD && a === 2) base += 0.012;
  if (k === K_RAIN) base += 0.015;
  return base + SLACK;
}

export function decodeTrace(str) {
  // base64 z Uint16 (little endian), wartości 0..1000 = pozycja kota 0..1
  const buf = Buffer.from(String(str || ''), 'base64');
  const out = new Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1000, buf.readUInt16LE(i * 2)) / 1000;
  return out;
}

export function scoreRun(stageIndex, variant, trace) {
  const S = STAGES[stageIndex];
  if (!S) throw new Error('bad stage');
  const last = trace.length - 1;
  const xAt = (t) => {
    const f = t / TRACE_DT, i = Math.floor(f);
    if (i < 0) return trace[0];
    if (i >= last) return trace[last];
    return trace[i] + (trace[i + 1] - trace[i]) * (f - i);
  };
  const minDist = (x, t0, t1) => {
    let best = 1;
    for (let t = t0; t <= t1 + 1e-9; t += 0.01) best = Math.min(best, Math.abs(xAt(t) - x));
    return best;
  };
  let score = 0, combo = 0, maxCombo = 0, mult = 1, gold = 0, goldTotal = 0, perfect = 0, bad = 0, bonus = 0;
  let soloUntil = -1;
  for (const n of S.notes) {
    const t = n[0], k = n[2], a = n[3];
    const x = variant === 1 ? 1 - n[1] : n[1];
    const soloF = t < soloUntil ? 2 : 1;
    if (k === K_GOLD || k === K_SOLO || k === K_FINAL) {
      goldTotal++;
      if (minDist(x, t - EARLY, t + LATE) <= radius(n)) {
        combo++; gold++; maxCombo = Math.max(maxCombo, combo);
        const isPerfect = minDist(x, t - EARLY, t + 0.03) <= PERFECT_DX + SLACK;
        if (isPerfect) perfect++;
        mult = multFor(combo);
        let base = k === K_SOLO ? 500 : (k === K_FINAL ? 1000 : (isPerfect ? 150 : 100));
        if (a === 1 && k === K_GOLD) base += 50;
        const bonusF = (k === K_GOLD && a === 2) ? 2 : 1;
        if (bonusF === 2) bonus++;
        score += base * mult * soloF * bonusF;
        if (k === K_SOLO) soloUntil = S.soloEnd;
      } else { combo = 0; mult = 1; }
    } else if (k === K_DROP) {
      if (minDist(x, t - EARLY, t + LATE) <= radius(n)) score += 10 * mult * soloF;
    } else if (k === K_RAIN) {
      if (minDist(x, t - EARLY, t + LATE) <= radius(n)) score += 50 * mult * soloF;
    } else if (k === K_BAD) {
      if (minDist(x, t - 0.02, t + 0.035) <= radius(n) - SLACK * 2) { bad++; combo = 0; mult = 1; score = Math.max(0, score - 200); }
    }
  }
  const acc = goldTotal ? gold / goldTotal : 0;
  const stars = acc >= 0.95 ? 3 : (acc >= 0.8 ? 2 : (acc >= 0.6 ? 1 : 0));
  return { score, gold, goldTotal, perfect, bad, bonus, maxCombo, stars, clipEnd: S.clipEnd };
}

// Sygnały, że grał program, a nie człowiek. Nie odrzucają wyniku – oznaczają go do sprawdzenia.
export function suspicionFlags(trace, stats) {
  const flags = [];
  let jumps = 0;
  for (let i = 1; i < trace.length; i++) if (Math.abs(trace[i] - trace[i - 1]) > 0.35) jumps++;
  if (jumps > 2) flags.push('skoki kota: ' + jumps);
  if (stats.goldTotal && stats.gold === stats.goldTotal && stats.perfect / stats.gold > 0.97) flags.push('nienaturalnie idealna gra');
  // człowiek nigdy nie trzyma palca idealnie nieruchomo przez większość utworu
  let still = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i] === trace[i - 1]) still++;
  if (trace.length > 200 && still / trace.length > 0.9) flags.push('brak ruchu');
  return flags;
}
