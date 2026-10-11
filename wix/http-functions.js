// Funky Cat – serwer konkursów (Wix Velo), wersja 2.
// Wklej do pliku backend/http-functions.js. Do folderu backend dodaj też dwa pliki:
//   backend/funkycat-scorer.js  oraz  backend/funkycat-data.js   (z folderu wix/ w repozytorium gry)
// i opublikuj stronę. Adresy: https://www.nowakowski.net.pl/_functions/...
//
// Kolekcje CMS (tworzą się same w panelu – są już założone):
//   FunkyCatChallenges – konkursy (kod, rodzaj, daty, etap, nagrody, limit podejść, weryfikacja e-mail)
//   FunkyCatScores     – najlepszy wynik każdego gracza w konkursie (+ flagi podejrzanych gier, zatwierdzenie)
//   FunkyCatRuns       – jednorazowe „bilety” na rozgrywkę
//   FunkyCatVerify     – kody potwierdzające adres e-mail
//
// Weryfikacja e-mail: w panelu Wix utwórz wiadomość automatyczną (Triggered Email) z zmienną ${code}
// i wpisz jej ID poniżej. Dopóki pole jest puste, konkursy działają bez weryfikacji e-maila.
const VERIFY_EMAIL_TEMPLATE_ID = '';

import { ok, badRequest, forbidden, notFound, serverError } from 'wix-http-functions';
import wixData from 'wix-data';
import { contacts, triggeredEmails } from 'wix-crm-backend';
import { scoreRun, decodeTrace, suspicionFlags, TRACE_DT } from 'backend/funkycat-scorer';

const OPTS = { suppressAuth: true };
const ALLOWED = ['https://mn74-pixel.github.io', 'https://www.nowakowski.net.pl', 'https://nowakowski.net.pl'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
const fail = (fn, request, msg) => reply(fn, request, { ok: false, error: msg });
const clean = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, max);
const normCode = (c) => clean(c, 24).toUpperCase().replace(/\s+/g, '');
const normEmail = (e) => clean(e, 120).toLowerCase();
function rnd(n, abc) { abc = abc || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)]; return s; }

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
const isOnline = (ch) => ch.type === 'online';
const needsVerify = (ch) => isOnline(ch) && ch.verifyEmail !== false && !!VERIFY_EMAIL_TEMPLATE_ID;
function publicChallenge(ch) {
  return {
    code: ch.title, name: ch.place || '', type: isOnline(ch) ? 'online' : 'koncert', stage: ch.stage || 1,
    startsAt: ch.startsAt || null, endsAt: ch.endsAt || null, prizes: ch.prizes || 3,
    state: state(ch, new Date()), verify: needsVerify(ch), attemptsPerDay: ch.attemptsPerDay || 0
  };
}
async function topScores(code, n) {
  const r = await wixData.query('FunkyCatScores').eq('challenge', code)
    .descending('score').ascending('_updatedDate').limit(n).find(OPTS);
  return r.items;
}
const publicRow = (it, i) => ({ rank: i + 1, nick: it.title, score: it.score, stars: it.stars || 0 });
async function settle(ch) {
  const top = await topScores(ch.title, ch.prizes || 3);
  for (const it of top) if (!it.winCode) { it.winCode = 'KOT-' + rnd(5); await wixData.update('FunkyCatScores', it, OPTS); }
  return top;
}
async function addContact(nick, email) {
  try {
    const c = await contacts.appendOrCreateContact({ name: { first: nick }, emails: [email] });
    const lab = await contacts.findOrCreateLabel('Funky Cat');
    await contacts.labelContact(c.contactId, [lab.label.key], OPTS);
    return c.contactId;
  } catch (e) { console.error('contact', e); return null; }
}

export function options_contests(r) { return reply(ok, r, {}); }
export function options_challenge(r) { return reply(ok, r, {}); }
export function options_verifySend(r) { return reply(ok, r, {}); }
export function options_verifyCheck(r) { return reply(ok, r, {}); }
export function options_start(r) { return reply(ok, r, {}); }
export function options_finish(r) { return reply(ok, r, {}); }
export function options_board(r) { return reply(ok, r, {}); }
export function options_status(r) { return reply(ok, r, {}); }

// GET /_functions/contests – otwarte konkursy online bez kodu (pokazuje je gra w menu)
export async function get_contests(request) {
  try {
    const now = new Date();
    const r = await wixData.query('FunkyCatChallenges').eq('type', 'online').ne('codeRequired', true).limit(20).find(OPTS);
    const list = r.items.filter(ch => ['open', 'soon'].includes(state(ch, now))).map(publicChallenge);
    return reply(ok, request, { ok: true, contests: list });
  } catch (e) { return fail(serverError, request, 'Błąd serwera.'); }
}

// GET /_functions/challenge?code=ROZOWO
export async function get_challenge(request) {
  try {
    const ch = await findChallenge(normCode(request.query.code));
    if (!ch) return fail(notFound, request, 'Nie ma takiego kodu.');
    return reply(ok, request, Object.assign({ ok: true }, publicChallenge(ch)));
  } catch (e) { return fail(serverError, request, 'Błąd serwera.'); }
}

// POST /_functions/verifySend {email}
export async function post_verifySend(request) {
  try {
    if (!VERIFY_EMAIL_TEMPLATE_ID) return reply(ok, request, { ok: true, skipped: true });
    const b = await request.body.json();
    const email = normEmail(b.email);
    if (!EMAIL_RE.test(email)) return fail(badRequest, request, 'Podaj poprawny e-mail.');
    const code = rnd(4, '0123456789');
    const prev = await wixData.query('FunkyCatVerify').eq('title', email).limit(1).find(OPTS);
    const row = Object.assign(prev.items[0] || { title: email }, { code, expiresAt: new Date(Date.now() + 15 * 60000), tries: 0 });
    if (prev.items[0] && prev.items[0].sentAt && Date.now() - new Date(prev.items[0].sentAt) < 45000) return fail(forbidden, request, 'Kod został już wysłany. Sprawdź skrzynkę (także spam).');
    row.sentAt = new Date();
    await wixData.save('FunkyCatVerify', row, OPTS);
    const contactId = await addContact(clean(b.nick, 16) || 'Gracz', email);
    await triggeredEmails.emailContact(VERIFY_EMAIL_TEMPLATE_ID, contactId, { variables: { code } });
    return reply(ok, request, { ok: true });
  } catch (e) { console.error(e); return fail(serverError, request, 'Nie udało się wysłać kodu.'); }
}

// POST /_functions/verifyCheck {email, code} → {verifyToken}
export async function post_verifyCheck(request) {
  try {
    const b = await request.body.json();
    const email = normEmail(b.email);
    const r = await wixData.query('FunkyCatVerify').eq('title', email).limit(1).find(OPTS);
    const row = r.items[0];
    if (!row || !row.code) return fail(badRequest, request, 'Najpierw poproś o kod.');
    if ((row.tries || 0) >= 5 || new Date(row.expiresAt) < new Date()) return fail(forbidden, request, 'Kod wygasł. Poproś o nowy.');
    if (String(b.code).trim() !== row.code) { row.tries = (row.tries || 0) + 1; await wixData.update('FunkyCatVerify', row, OPTS); return fail(badRequest, request, 'Zły kod.'); }
    row.token = rnd(24); row.verified = true; row.code = '';
    await wixData.update('FunkyCatVerify', row, OPTS);
    return reply(ok, request, { ok: true, verifyToken: row.token });
  } catch (e) { return fail(serverError, request, 'Błąd serwera.'); }
}

// POST /_functions/start {code, nick, email, consent, verifyToken} → jednorazowy bilet na rozgrywkę
export async function post_start(request) {
  try {
    const b = await request.body.json();
    const ch = await findChallenge(normCode(b.code));
    if (!ch) return fail(notFound, request, 'Nie ma takiego konkursu.');
    const st = state(ch, new Date());
    if (st !== 'open') return fail(forbidden, request, st === 'soon' ? 'Konkurs jeszcze się nie zaczął.' : 'Konkurs jest zamknięty.');
    const email = normEmail(b.email), nick = clean(b.nick, 16) || 'Gracz';
    if (!EMAIL_RE.test(email)) return fail(badRequest, request, 'Podaj poprawny e-mail.');
    if (needsVerify(ch)) {
      const v = await wixData.query('FunkyCatVerify').eq('title', email).eq('token', clean(b.verifyToken, 40)).limit(1).find(OPTS);
      if (!v.items.length || !b.verifyToken) return fail(forbidden, request, 'Potwierdź adres e-mail kodem z wiadomości.');
    }
    if (ch.attemptsPerDay) {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const n = await wixData.query('FunkyCatRuns').eq('challenge', ch.title).eq('email', email).ge('_createdDate', since).count(OPTS);
      if (n >= ch.attemptsPerDay) return fail(forbidden, request, 'Wykorzystano dzisiejsze podejścia (' + ch.attemptsPerDay + '). Wróć jutro!');
    }
    const token = rnd(28);
    const variant = Math.random() < 0.5 ? 0 : 1;   // lustrzany układ nut losowany na każdą rozgrywkę
    await wixData.insert('FunkyCatRuns', { title: token, challenge: ch.title, email, nick, consent: !!b.consent, stage: ch.stage || 1, variant, issuedAt: new Date(), used: false }, OPTS);
    if (b.consent) addContact(nick, email);
    return reply(ok, request, { ok: true, token, stage: ch.stage || 1, variant });
  } catch (e) { console.error(e); return fail(serverError, request, 'Błąd serwera.'); }
}

// POST /_functions/finish {token, trace} → oficjalny wynik policzony przez serwer
export async function post_finish(request) {
  try {
    const b = await request.body.json();
    const runQ = await wixData.query('FunkyCatRuns').eq('title', clean(b.token, 40)).limit(1).find(OPTS);
    const run = runQ.items[0];
    if (!run) return fail(notFound, request, 'Nieznana rozgrywka.');
    if (run.used) return fail(forbidden, request, 'Ten wynik został już zapisany.');
    run.used = true; await wixData.update('FunkyCatRuns', run, OPTS);
    const ch = await findChallenge(run.challenge);
    // 2 minuty zapasu na koniec konkursu – ktoś mógł zacząć grać tuż przed końcem
    if (!ch || (ch.endsAt && Date.now() > new Date(ch.endsAt).getTime() + 2 * 60000)) return fail(forbidden, request, 'Konkurs jest już zamknięty.');
    const trace = decodeTrace(b.trace);
    const stats = scoreRun((run.stage || 1) - 1, run.variant || 0, trace);
    const flags = suspicionFlags(trace, stats);
    const elapsed = (Date.now() - new Date(run.issuedAt).getTime()) / 1000;
    if (trace.length * TRACE_DT < stats.clipEnd - 2) flags.push('niepełny zapis gry');
    if (elapsed < stats.clipEnd - 3) flags.push('za szybko: ' + Math.round(elapsed) + ' s');
    if (elapsed > 60 * 30) flags.push('bilet sprzed ' + Math.round(elapsed / 60) + ' min');
    const reject = flags.some(f => /niepełny|za szybko/.test(f));
    let best = stats.score;
    if (!reject) {
      const prev = await wixData.query('FunkyCatScores').eq('challenge', run.challenge).eq('email', run.email).limit(1).find(OPTS);
      const row = {
        title: run.nick, email: run.email, challenge: run.challenge, score: stats.score, stars: stats.stars,
        stage: run.stage, combo: stats.maxCombo, consent: run.consent,
        flags: flags.join(', '), perfectPct: stats.gold ? Math.round(stats.perfect * 100 / stats.gold) : 0
      };
      if (!prev.items.length) await wixData.insert('FunkyCatScores', Object.assign(row, { claimed: false, approved: false }), OPTS);
      else if (stats.score > (prev.items[0].score || 0)) await wixData.update('FunkyCatScores', Object.assign(prev.items[0], row), OPTS);
      else best = prev.items[0].score;
    }
    const better = await wixData.query('FunkyCatScores').eq('challenge', run.challenge).gt('score', best).count(OPTS);
    const top = await topScores(run.challenge, 10);
    return reply(ok, request, {
      ok: true, rejected: reject, official: stats.score, best, rank: reject ? null : better + 1,
      stats: { gold: stats.gold, goldTotal: stats.goldTotal, stars: stats.stars, combo: stats.maxCombo, bad: stats.bad },
      top: top.map(publicRow), contest: publicChallenge(ch)
    });
  } catch (e) { console.error(e); return fail(serverError, request, 'Błąd serwera.'); }
}

// GET /_functions/board?code=ROZOWO – ranking na żywo
export async function get_board(request) {
  try {
    const ch = await findChallenge(normCode(request.query.code));
    if (!ch) return fail(notFound, request, 'Nie ma takiego konkursu.');
    if (state(ch, new Date()) === 'ended') await settle(ch);
    const top = await topScores(ch.title, 10);
    return reply(ok, request, Object.assign({ ok: true, top: top.map(publicRow) }, publicChallenge(ch)));
  } catch (e) { return fail(serverError, request, 'Błąd serwera.'); }
}

// GET /_functions/status?code=ROZOWO&email=... – czy wygrałem?
// Koncert: kod zwycięzcy od razu po końcu konkursu (odbiór osobiście).
// Online: kod dopiero, gdy Marcin zaznaczy w tabeli „Zatwierdzony”.
export async function get_status(request) {
  try {
    const ch = await findChallenge(normCode(request.query.code));
    if (!ch) return fail(notFound, request, 'Nie ma takiego konkursu.');
    const st = state(ch, new Date());
    if (st !== 'ended') return reply(ok, request, { ok: true, state: st });
    await settle(ch);
    const me = await wixData.query('FunkyCatScores').eq('challenge', ch.title).eq('email', normEmail(request.query.email)).limit(1).find(OPTS);
    const it = me.items[0];
    if (!it) return reply(ok, request, { ok: true, state: st, played: false });
    const better = await wixData.query('FunkyCatScores').eq('challenge', ch.title).gt('score', it.score).count(OPTS);
    const won = !!it.winCode;
    const showCode = won && (!isOnline(ch) || it.approved === true);
    return reply(ok, request, { ok: true, state: st, played: true, rank: better + 1, won, pending: won && !showCode, winCode: showCode ? it.winCode : null, type: isOnline(ch) ? 'online' : 'koncert' });
  } catch (e) { return fail(serverError, request, 'Błąd serwera.'); }
}
