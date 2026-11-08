// Loads and caches everything about one team (used by team pages, matchups and the spotting board).
import { L, isPro, isCollege } from './league.js?v=f76d549b88';
import { espn, repo, safe } from './api.js?v=f76d549b88';
import { seasonYear } from './ctx.js?v=f76d549b88';
import { loadRoster } from './views/players.js?v=f76d549b88';
import { wikiTeam, wikiCoach, parseAthleteStats } from './notes.js?v=f76d549b88';
import { num, normName } from './util.js?v=f76d549b88';

const rosterStore = new Map();
/** Roster with progressive player enrichment. subscribe(fn) gets called on every update. */
export function roster(lg, team) {
  const key = lg + ':' + team.id;
  let s = rosterStore.get(key);
  if (s && Date.now() - s.t < 15 * 60 * 1000) return s;
  s = { t: Date.now(), players: [], coach: null, tm: null, done: false, subs: new Set(), ready: false };
  const fire = (p) => s.subs.forEach(fn => { try { fn(p); } catch (e) { console.error(e); } });
  s.promise = loadRoster(lg, team, {
    onRoster: (ps, coach, tm) => { s.players = ps; s.coach = coach; s.tm = tm; s.ready = true; fire(null); },
    onUpdate: (p) => fire(p),
  }).then(r => { s.done = true; fire(null); return r; }).catch(e => { s.error = e; s.done = true; fire(null); });
  s.subscribe = (fn) => { s.subs.add(fn); return () => s.subs.delete(fn); };
  rosterStore.set(key, s);
  return s;
}

const NET_ALIAS = { uconn: 'connecticut', olemiss: 'mississippi', 'saintmarysca': 'saintmarys', 'miamifl': 'miami', 'miamioh': 'miamiohio', usc: 'southerncalifornia', lsu: 'lsu', vcu: 'vcu', byu: 'byu', smu: 'smu', tcu: 'tcu', ucf: 'ucf', unlv: 'unlv', utep: 'utep', 'uncwilmington': 'uncw', 'ncstate': 'ncstate', 'ncstatewolfpack': 'ncstate' };
export function netFor(team, net) {
  if (!net?.rows) return null;
  const cands = new Set([team.location, team.short, team.name?.replace(new RegExp(' ' + (team.nick || '') + '$'), '')].filter(Boolean).map(normName));
  for (const c of [...cands]) if (NET_ALIAS[c]) cands.add(NET_ALIAS[c]);
  const row = net.rows.find(r => cands.has(normName(r.School))) || net.rows.find(r => { const k = normName(r.School); return [...cands].some(c => c && (k === c.replace(/state$/, 'st') || c === k.replace(/st$/, 'state'))); });
  return row || null;
}

export function netIsCurrent(net, year) {
  const m = /(\w{3})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(net?.updated || '');
  if (!m) return false;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]}`);
  return d > new Date(`${year - 1}-10-15`);
}

const teamStore = new Map();
export function teamData(lg, team) {
  const key = lg + ':' + team.id;
  const hit = teamStore.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.p;
  const p = (async () => {
    const year = await seasonYear(lg);
    const [live, ranks, bpi, sched, news, standings, extra] = await Promise.all([
      safe(espn.teamStats(lg, team.id), null),
      safe(repo(`${lg}/teamstats.json`), null),
      safe(repo(`${lg}/bpi.json`), null),
      safe(espn.schedule(lg, team.id), null),
      safe(espn.news(lg, team.id, 12), null),
      isPro(lg) ? safe(espn.standings(lg), null) : safe(repo(`${lg}/standings.json`), null),
      isPro(lg) ? Promise.all([safe(repo(`${lg}/power.json`), null), lg === 'nba' ? safe(repo('nba/cup.json'), null) : null]) : Promise.all([safe(espn.rankings(lg), null), safe(repo(`${lg}/net.json`), null)]),
    ]);
    const d = { year, team, ranks: ranks?.teams?.[team.id] || null, n: ranks?.n || 0, avg: ranks?.avg || {}, bpi: bpi?.teams?.[team.id] || null, bpiAll: bpi?.teams || {}, news: news?.articles || [] };
    // schedule (regular season + postseason if any)
    d.events = (sched?.events || []).map(e => simplifyEvent(e, team.id)).filter(Boolean);
    // postseason schedule
    if (sched?.requestedSeason?.type !== 3) {
      const post = await safe(espn.schedule(lg, team.id, year, 3), null);
      for (const e of post?.events || []) { const s = simplifyEvent(e, team.id); if (s && !d.events.find(x => x.id === s.id)) d.events.push(s); }
    }
    d.events.sort((a, b) => new Date(a.date) - new Date(b.date));
    d.liveStats = live;
    if (isPro(lg)) {
      d.std = nbaStanding(standings, team.id);
      if (lg === 'wnba' && d.std) { d.std.conf = 'WNBA'; d.std.confAbbr = 'WNBA'; }
      d.power = extra[0]?.rows?.find(r => r.id === team.id) || null;
      d.powerAll = extra[0];
      d.cup = extra[1];
    } else {
      for (const [conf, rows] of Object.entries(standings || {})) {
        const r = rows.find(x => x.id === team.id);
        if (r) { d.std = { ...r, confName: conf, confSize: rows.length, confRows: rows }; break; }
      }
      const rk = extra[0];
      d.polls = (rk?.rankings || []).map(p => ({ name: p.name, rank: p.ranks?.find(r => r.team?.id === team.id) })).filter(x => x.rank);
      d.pollsAll = rk;
      d.netAll = extra[1];
      d.net = netFor(team, extra[1]);
      d.netCurrent = netIsCurrent(extra[1], year);
    }
    return d;
  })();
  teamStore.set(key, { t: Date.now(), p });
  return p;
}

export function simplifyEvent(e, teamId) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const me = c.competitors.find(x => x.id === teamId || x.team?.id === teamId);
  const op = c.competitors.find(x => x !== me);
  if (!me || !op) return null;
  const sc = x => (typeof x.score === 'object' ? num(x.score?.value ?? x.score?.displayValue) : num(x.score));
  const st = c.status?.type || e.status?.type || {};
  return {
    id: e.id, date: e.date, home: me.homeAway === 'home', neutral: c.neutralSite, oppId: op.team?.id || op.id, opp: op.team?.abbreviation, oppName: op.team?.displayName || op.team?.shortDisplayName,
    oppLogo: op.team?.logos?.[0]?.href, oppRank: op.curatedRank?.current && op.curatedRank.current <= 25 ? op.curatedRank.current : null,
    us: sc(me), them: sc(op), win: me.winner, state: st.state, detail: st.shortDetail || st.detail, completed: st.completed,
    tv: (c.broadcasts || []).map(b => b.media?.shortName || b.names?.[0]).filter(Boolean).join(', '),
    note: (c.notes || []).map(n => n.headline).join(' · '), venue: c.venue?.fullName, conf: c.conferenceCompetition, type: e.seasonType?.type,
    ot: /OT/.test(st.shortDetail || ''),
  };
}

function nbaStanding(st, id) {
  const confs = st?.children?.length ? st.children : (st?.standings ? [st] : []);
  for (const conf of confs) {
    const entries = conf.standings?.entries || [];
    const e = entries.find(x => x.team.id === id);
    if (!e) continue;
    const v = {}, dv = {};
    for (const s of e.stats || []) { v[s.name || s.type] = s.value; dv[s.name || s.type] = s.displayValue ?? s.summary; if (s.type) dv[s.type] = s.summary ?? s.displayValue; }
    return { conf: conf.name, confAbbr: conf.abbreviation, seed: v.playoffSeed, gb: dv.gamesBehind, streak: dv.streak, home: dv.Home ?? dv.home, road: dv.Road ?? dv.road, last10: dv['Last Ten Games'] ?? dv.lasttengames, vsConf: dv['vs. Conf.'] ?? dv.vsconf, vsDiv: dv['vs. Div.'] ?? dv.vsdiv, w: v.wins, l: v.losses, diff: v.differential ?? v.pointDifferential, ppg: v.avgPointsFor, oppg: v.avgPointsAgainst, overall: dv.overall || dv.total, rows: entries };
  }
  return null;
}

/** Last N seasons' regular-season records (ESPN core API). */
export async function history(lg, teamId, year, n = 5) {
  const ys = Array.from({ length: n }, (_, i) => year - 1 - i);
  const res = await Promise.all(ys.map(y => safe(espn.record(lg, y, teamId), null)));
  return ys.map((y, i) => {
    const items = res[i]?.items || [];
    const ov = items.find(x => x.name === 'overall' || x.type === 'total') || items[0];
    const confRec = items.find(x => /conf/i.test(x.name || x.type || ''));
    return ov ? { year: y, label: `${y - 1}-${String(y).slice(2)}`, rec: ov.summary, conf: confRec?.summary } : null;
  }).filter(Boolean);
}

export async function teamWiki(team, lg) { return safe(wikiTeam(team, lg), null); }

/** Auto-generated team facts from the schedule. */
export function scheduleFacts(events, team, lg) {
  const done = events.filter(e => e.state === 'post' && e.us != null);
  const f = [];
  if (!done.length) return f;
  const W = done.filter(e => e.win).length, L = done.length - W;
  let cur = 0, curType = null;
  for (const e of [...done].reverse()) { if (curType === null) curType = e.win; if (e.win === curType) cur++; else break; }
  if (cur >= 3) f.push(`On a ${cur}-game ${curType ? 'winning' : 'losing'} streak.`);
  let best = 0, run = 0;
  for (const e of done) { run = e.win ? run + 1 : 0; best = Math.max(best, run); }
  if (best >= 4 && best !== cur) f.push(`Longest win streak this season: ${best} games.`);
  const close = done.filter(e => Math.abs(e.us - e.them) <= 5);
  if (close.length >= 2) f.push(`${close.filter(e => e.win).length}-${close.filter(e => !e.win).length} in games decided by 5 points or fewer.`);
  const ot = done.filter(e => e.ot);
  if (ot.length) f.push(`${ot.filter(e => e.win).length}-${ot.filter(e => !e.win).length} in overtime games.`);
  const home = done.filter(e => e.home && !e.neutral), road = done.filter(e => !e.home && !e.neutral);
  if (home.length && road.length) f.push(`${home.filter(e => e.win).length}-${home.filter(e => !e.win).length} at home, ${road.filter(e => e.win).length}-${road.filter(e => !e.win).length} on the road.`);
  const big = done.filter(e => e.win).sort((a, b) => (b.us - b.them) - (a.us - a.them))[0];
  if (big) f.push(`Biggest win: by ${big.us - big.them} ${big.home ? 'vs' : 'at'} ${big.oppName} (${big.us}-${big.them}, ${new Date(big.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}).`);
  const worst = done.filter(e => !e.win).sort((a, b) => (a.us - a.them) - (b.us - b.them))[0];
  if (worst) f.push(`Worst loss: by ${worst.them - worst.us} ${worst.home ? 'vs' : 'at'} ${worst.oppName} (${worst.us}-${worst.them}).`);
  const hi = done.reduce((m, e) => (e.us > (m?.us ?? -1) ? e : m), null);
  if (hi) f.push(`Season-high ${hi.us} points ${hi.home ? 'vs' : 'at'} ${hi.oppName}.`);
  const s100 = L(lg).scoreHi;
  const over = done.filter(e => e.us >= s100);
  if (over.length >= 3) f.push(`${over.filter(e => e.win).length}-${over.filter(e => !e.win).length} when scoring ${s100}+.`);
  if (isCollege(lg)) {
    const vr = done.filter(e => e.oppRank);
    if (vr.length) f.push(`${vr.filter(e => e.win).length}-${vr.filter(e => !e.win).length} against AP-ranked opponents.`);
    const conf = done.filter(e => e.conf);
    if (conf.length) f.push(`${conf.filter(e => e.win).length}-${conf.filter(e => !e.win).length} in conference play.`);
  }
  void W; void L; void team;
  return f;
}


// ---------------------------------------------------------------- coach profile (ESPN record + Wikipedia background)
const coachStore = new Map();
export function coachProfile(lg, team, coach, year) {
  if (!coach) return Promise.resolve(null);
  const key = lg + ':' + coach.id;
  if (coachStore.has(key)) return coachStore.get(key);
  const p = (async () => {
    const name = `${coach.firstName} ${coach.lastName}`;
    const out = { name, id: coach.id, exp: coach.experience };
    if (isPro(lg)) {
      const c = await safe(espn.coach(lg, coach.id), null);
      if (c) {
        const ref = Array.isArray(c.careerRecords) ? c.careerRecords[0]?.$ref : c.careerRecords?.$ref;
        const [car, cur] = await Promise.all([ref ? safe(espn.core(ref), null) : null, safe(espn.coachSeason(lg, year, coach.id), null)]);
        out.career = car?.summary?.replace(/-0$/, '');
        out.season = cur?.summary?.replace(/-0$/, '');
        out.seasons = (c.coachSeasons || []).length || null;
        out.born = c.birthPlace ? [c.birthPlace.city, c.birthPlace.state || c.birthPlace.country].filter(Boolean).join(', ') : '';
        out.age = c.dateOfBirth ? Math.floor((Date.now() - new Date(c.dateOfBirth)) / 3.15576e10) : null;
      }
    }
    out.wiki = await safe(wikiCoach(name, lg, team), null);
    return out;
  })();
  coachStore.set(key, p);
  return p;
}

// ---------------------------------------------------------------- last meeting between two teams
export async function lastMeeting(lg, A, B, da, year) {
  let ev = [...da.events].reverse().find(e => e.oppId === B.id && e.state === 'post');
  for (let back = 1; !ev && back <= 2; back++) {
    const sc = await safe(espn.schedule(lg, A.id, year - back), null);
    ev = (sc?.events || []).map(e => simplifyEvent(e, A.id)).filter(e => e && e.oppId === B.id && e.state === 'post').pop();
  }
  if (!ev) return null;
  const s = await safe(espn.summary(lg, ev.id, 86400), null);
  const top = {};
  for (const tp of s?.boxscore?.players || []) {
    const st = tp.statistics?.[0];
    if (!st) continue;
    const keys = st.keys || st.names || [], labels = st.labels || [];
    const ix = (k, lab) => { let i = keys.indexOf(k); if (i < 0) i = labels.indexOf(lab); return i; };
    const pi = ix('points', 'PTS'), ri = ix('rebounds', 'REB'), ai = ix('assists', 'AST');
    const rows = (st.athletes || []).filter(r => r.stats?.length).map(r => ({ name: r.athlete.displayName, id: r.athlete.id, pts: +r.stats[pi] || 0, reb: +r.stats[ri] || 0, ast: +r.stats[ai] || 0 }));
    rows.sort((a, b) => b.pts - a.pts);
    top[tp.team.id] = rows.slice(0, 3);
  }
  return { ev, top, article: s?.article ? { h: s.article.headline, d: s.article.description } : null, venue: s?.gameInfo?.venue?.fullName };
}

// ---------------------------------------------------------------- roster changes since last season
// Last season's roster = everyone in three of last season's box scores (early, middle, final game).
// A current player counts as new only if he isn't in those games AND his own stats don't show this team last season.
const changeStore = new Map();
export function rosterChanges(lg, team, players, year) {
  const key = lg + ':' + team.id;
  if (changeStore.has(key)) return changeStore.get(key);
  const p = (async () => {
    const sc = await safe(espn.schedule(lg, team.id, year - 1, 2), null);
    const done = (sc?.events || []).map(e => simplifyEvent(e, team.id)).filter(e => e && e.state === 'post').sort((a, b) => new Date(a.date) - new Date(b.date));
    if (done.length < 3) return null;
    const picks = [...new Set([Math.floor(done.length / 4), Math.floor(done.length * 0.6), done.length - 1])].map(i => done[i]);
    const sums = await Promise.all(picks.map(e => safe(espn.summary(lg, e.id, 86400), null)));
    const prev = new Map();
    for (const s of sums) {
      for (const tp of s?.boxscore?.players || []) {
        if (tp.team?.id !== team.id) continue;
        for (const r of tp.statistics?.[0]?.athletes || []) prev.set(r.athlete.id, r.athlete.displayName);
      }
    }
    if (!prev.size) return null;
    const cur = new Set(players.map(x => x.id));
    const additions = players.filter(x => !prev.has(x.id) && x.prev?.teamId !== team.id);
    const goneIds = [...prev.keys()].filter(id => !cur.has(id)).slice(0, 16);
    const gone = await Promise.all(goneIds.map(async id => {
      const parsed = parseAthleteStats(await safe(espn.athleteStats(lg, id), null));
      const last = (parsed?.seasons || []).filter(r => r.year === year - 1 && r.teamId === team.id)[0] || (parsed?.seasons || []).filter(r => r.year === year - 1)[0];
      const now = (parsed?.seasons || []).find(r => r.year === year && r.teamId !== team.id);
      return { id, name: prev.get(id), last: last?.a || null, nowTeamId: now?.teamId || null };
    }));
    gone.sort((a, b) => (b.last?.avgMinutes || 0) - (a.last?.avgMinutes || 0));
    return { additions, departures: gone };
  })();
  changeStore.set(key, p);
  return p;
}
