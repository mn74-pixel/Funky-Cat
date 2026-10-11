// Funky Cat – backend dla challenge'u na koncercie (Wix Velo).
// Wklej całość do pliku backend/http-functions.js na stronie nowakowski.net.pl
// i opublikuj stronę. Adresy będą pod https://www.nowakowski.net.pl/_functions/...
//
// Dane trafiają do kolekcji CMS:
//   FunkyCatChallenges – koncerty (kod ze sceny, start, koniec, liczba nagród)
//   FunkyCatScores     – wyniki graczy (nick, e-mail, punkty, kod zwycięzcy)
// Gracz, który zgodził się na e-maile, trafia też do Kontaktów z etykietą „Funky Cat”.

import { ok, badRequest, forbidden, notFound, serverError } from 'wix-http-functions';
import wixData from 'wix-data';
import { contacts } from 'wix-crm-backend';

const OPTS = { suppressAuth: true };
const ALLOWED = ['https://mn74-pixel.github.io', 'https://www.nowakowski.net.pl', 'https://nowakowski.net.pl'];

function cors(request) {
  const origin = (request.headers && (request.headers.origin || request.headers.Origin)) || '';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
const reply = (fn, request, body) => fn({ headers: cors(request), body });
const clean = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const normCode = (c) => clean(c, 24).toUpperCase().replace(/\s+/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function findChallenge(code) {
  if (!code) return null;
  const r = await wixData.query('FunkyCatChallenges').eq('title', code).limit(1).find(OPTS);
  return r.items[0] || null;
}
function state(ch, now) {
  if (!ch || ch.active === false) return 'closed';
  if (ch.startsAt && now < new Date(ch.startsAt)) return 'soon';
  if (ch.endsAt && now > new Date(ch.endsAt)) return 'ended';
  return 'open';
}
async function topScores(code, n) {
  const r = await wixData.query('FunkyCatScores').eq('challenge', code)
    .descending('score').ascending('_createdDate').limit(n).find(OPTS);
  return r.items;
}
function winCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'KOT-';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
// After the challenge ends, give the top N their winner codes (once).
async function settle(ch) {
  const n = ch.prizes || 3;
  const top = await topScores(ch.title, n);
  for (const it of top) {
    if (!it.winCode) { it.winCode = winCode(); await wixData.update('FunkyCatScores', it, OPTS); }
  }
  return top;
}
const publicRow = (it, i) => ({ rank: i + 1, nick: it.title, score: it.score, stars: it.stars || 0 });

export function options_challenge(request) { return reply(ok, request, {}); }
export function options_score(request) { return reply(ok, request, {}); }
export function options_board(request) { return reply(ok, request, {}); }
export function options_status(request) { return reply(ok, request, {}); }

// GET /_functions/challenge?code=ROZOWO
export async function get_challenge(request) {
  try {
    const code = normCode(request.query.code);
    const ch = await findChallenge(code);
    if (!ch) return reply(notFound, request, { ok: false, error: 'Nie ma takiego kodu.' });
    const st = state(ch, new Date());
    return reply(ok, request, { ok: true, code, state: st, place: ch.place || '', stage: ch.stage || 1, endsAt: ch.endsAt || null, prizes: ch.prizes || 3 });
  } catch (e) { return reply(serverError, request, { ok: false, error: 'Błąd serwera.' }); }
}

// POST /_functions/score  {code, nick, email, consent, score, stars, stage, combo}
export async function post_score(request) {
  try {
    const b = await request.body.json();
    const code = normCode(b.code);
    const ch = await findChallenge(code);
    if (!ch) return reply(notFound, request, { ok: false, error: 'Nie ma takiego kodu.' });
    if (state(ch, new Date()) !== 'open') return reply(forbidden, request, { ok: false, error: 'Challenge jest zamknięty.' });
    const email = clean(b.email, 120).toLowerCase();
    const nick = clean(b.nick, 16) || 'Gracz';
    const score = Math.max(0, Math.min(2000000, Math.floor(Number(b.score) || 0)));
    if (!EMAIL_RE.test(email)) return reply(badRequest, request, { ok: false, error: 'Podaj poprawny e-mail.' });
    const prev = await wixData.query('FunkyCatScores').eq('challenge', code).eq('email', email).limit(1).find(OPTS);
    const row = {
      title: nick, email, score,
      stars: Math.max(0, Math.min(3, Math.floor(Number(b.stars) || 0))),
      stage: Math.floor(Number(b.stage) || 1),
      combo: Math.max(0, Math.floor(Number(b.combo) || 0)),
      challenge: code, consent: !!b.consent, claimed: false
    };
    let saved;
    if (prev.items.length) {
      const old = prev.items[0];
      if (score > (old.score || 0)) saved = await wixData.update('FunkyCatScores', Object.assign(old, row, { claimed: old.claimed, winCode: old.winCode }), OPTS);
      else saved = old;
    } else {
      saved = await wixData.insert('FunkyCatScores', row, OPTS);
    }
    if (row.consent) {
      try {
        const c = await contacts.appendOrCreateContact({ name: { first: nick }, emails: [email] });
        const lab = await contacts.findOrCreateLabel('Funky Cat');
        await contacts.labelContact(c.contactId, [lab.label.key], OPTS);
      } catch (e) { console.error('contact', e); }
    }
    const better = await wixData.query('FunkyCatScores').eq('challenge', code).gt('score', saved.score).count(OPTS);
    const top = await topScores(code, 10);
    return reply(ok, request, { ok: true, rank: better + 1, best: saved.score, top: top.map(publicRow) });
  } catch (e) { console.error(e); return reply(serverError, request, { ok: false, error: 'Błąd serwera.' }); }
}

// GET /_functions/board?code=ROZOWO  – ranking na żywo
export async function get_board(request) {
  try {
    const code = normCode(request.query.code);
    const ch = await findChallenge(code);
    if (!ch) return reply(notFound, request, { ok: false, error: 'Nie ma takiego kodu.' });
    const st = state(ch, new Date());
    const top = st === 'ended' ? await settle(ch).then(() => topScores(code, 10)) : await topScores(code, 10);
    return reply(ok, request, { ok: true, state: st, place: ch.place || '', prizes: ch.prizes || 3, top: top.map(publicRow) });
  } catch (e) { return reply(serverError, request, { ok: false, error: 'Błąd serwera.' }); }
}

// GET /_functions/status?code=ROZOWO&email=...  – czy wygrałem? (kod tylko dla właściciela adresu)
export async function get_status(request) {
  try {
    const code = normCode(request.query.code);
    const email = clean(request.query.email, 120).toLowerCase();
    const ch = await findChallenge(code);
    if (!ch) return reply(notFound, request, { ok: false });
    const st = state(ch, new Date());
    if (st !== 'ended') return reply(ok, request, { ok: true, state: st });
    await settle(ch);
    const me = await wixData.query('FunkyCatScores').eq('challenge', code).eq('email', email).limit(1).find(OPTS);
    const it = me.items[0];
    if (!it) return reply(ok, request, { ok: true, state: st, played: false });
    const better = await wixData.query('FunkyCatScores').eq('challenge', code).gt('score', it.score).count(OPTS);
    return reply(ok, request, { ok: true, state: st, played: true, rank: better + 1, winCode: it.winCode || null });
  } catch (e) { return reply(serverError, request, { ok: false }); }
}
