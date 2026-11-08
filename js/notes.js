// Turns raw ESPN / Wikipedia / data-branch numbers into commentator notes:
// advanced stats (with what they mean), play style, role, background and talking points.
import { L, isPro, isCollege, scope, gender } from './league.js?v=fb64bb9f50';
import { num, f1, pct, ordinal, normName } from './util.js?v=fb64bb9f50';
import { wiki, safe } from './api.js?v=fb64bb9f50';

// ---------------------------------------------------------------- glossary (shown next to every advanced stat)
export const GLOSSARY = {
  ts: { label: 'TS%', name: 'True Shooting %', what: 'Scoring efficiency that counts threes and free throws. Points ÷ (2 × (FGA + 0.44 × FTA)).', nba: 'NBA average ≈ 57–58%. 60%+ is very good, 64%+ elite.', cbb: 'D-I average ≈ 54%. 58%+ is very good, 62%+ elite.', wnba: 'WNBA average ≈ 54%. 57%+ is very good, 61%+ elite.', wcbb: 'Women\u2019s D-I average ≈ 51%. 55%+ is very good, 59%+ elite.' },
  efg: { label: 'eFG%', name: 'Effective FG %', what: 'Field-goal % with threes worth 1.5 makes: (FGM + 0.5 × 3PM) ÷ FGA.', nba: 'NBA average ≈ 54%.', cbb: 'D-I average ≈ 50%.' },
  usg: { label: 'USG%', name: 'Usage Rate', what: 'Share of team possessions a player uses (shot, free throws or turnover) while on the floor.', nba: '20% is average for a starter; 28%+ is a primary option; 32%+ is a heliocentric star.', cbb: '20% is average; 26%+ is a go-to scorer.' },
  ast: { label: 'AST%', name: 'Assist Rate', what: 'Share of teammates’ made baskets this player assisted while on the floor.', nba: '30%+ is a lead playmaker; 15–20% is a capable passer.', cbb: '25%+ is a lead playmaker.' },
  ato: { label: 'AST/TO', name: 'Assist-to-Turnover', what: 'Assists per turnover. Measures ball security for creators.', nba: '2.0 is good, 3.0+ excellent for a guard.', cbb: '1.5 is good, 2.5+ excellent.' },
  tpar: { label: '3PAr', name: '3-Point Attempt Rate', what: 'Share of field-goal attempts that are threes.', nba: 'League average ≈ 40%. Above 55% is a spacer; under 15% lives in the paint.', cbb: 'D-I average ≈ 38%.' },
  ftr: { label: 'FTr', name: 'Free Throw Rate', what: 'Free-throw attempts per field-goal attempt. How often a player draws fouls.', nba: '.25 is average, .40+ is elite at getting to the line.', cbb: '.33 is average, .45+ is elite.' },
  gmsc: { label: 'GmSc', name: 'Game Score (avg)', what: 'John Hollinger’s single-number box-score rating per game. Roughly on a points scale.', nba: '10 is an average game, 20+ is a strong game, 30+ is a monster night.', cbb: '10 is average, 20+ is a great game.' },
  per: { label: 'PER', name: 'Player Efficiency Rating', what: 'Hollinger’s per-minute production rating, adjusted for pace. Published by ESPN.', nba: 'League average is 15. 20+ is All-Star caliber, 25+ is MVP territory.', cbb: '' },
  stocks: { label: 'STK', name: 'Stocks per 36', what: 'Steals + blocks per 36 minutes (per 40 in college). Disruptive defensive plays.', nba: '2.5+ is a disruptive defender.', cbb: '3+ is a disruptive defender.' },
  ortg: { label: 'ORtg', name: 'Offensive Rating', what: 'Points scored per 100 possessions (possessions estimated from box score).', nba: 'League average ≈ 114–116.', cbb: 'D-I average ≈ 105–108.' },
  drtg: { label: 'DRtg', name: 'Defensive Rating', what: 'Points allowed per 100 possessions. Lower is better.', nba: 'League average ≈ 114–116.', cbb: 'D-I average ≈ 105–108.' },
  net: { label: 'Net', name: 'Net Rating', what: 'Offensive rating minus defensive rating: point margin per 100 possessions.', nba: '+5 is a contender, +10 is historically great.', cbb: '+15 is a top-25 team, +25 is a title favorite.' },
  pace: { label: 'Pace', name: 'Pace', what: 'Estimated possessions per game. Higher = faster tempo.', nba: 'League average ≈ 99–100.', cbb: 'D-I average ≈ 68.', wnba: 'League average ≈ 79–80 (40-minute games).', wcbb: 'Women\u2019s D-I average ≈ 70.' },
  tovPct: { label: 'TOV%', name: 'Turnover %', what: 'Turnovers per 100 possessions. Lower is better.', nba: '≈ 13% is average.', cbb: '≈ 17% is average.' },
  bpi: { label: 'BPI', name: 'ESPN Basketball Power Index', what: 'ESPN’s predictive team rating: expected point margin vs an average team on a neutral floor.', nba: '', cbb: '' },
  net_rank: { label: 'NET', name: 'NCAA Evaluation Tool', what: 'The NCAA selection committee’s primary sorting tool for the tournament field.', nba: '', cbb: 'Quad 1 wins (home vs top 30, neutral vs top 50, road vs top 75) are what résumés are judged on.' },
  sor: { label: 'SOR', name: 'Strength of Record', what: 'ESPN: how hard the team’s record would be for an average top-25 team to achieve. Résumé, not predictive.', nba: '', cbb: '' },
};

// ---------------------------------------------------------------- stat parsing
/** Parse ESPN athlete /stats into {seasons:[{year,label,team,s:{..}}], career:{..}} using the averages + totals categories. */
export function parseAthleteStats(js) {
  if (!js?.categories) return null;
  const cat = name => js.categories.find(c => c.name === name);
  const avg = cat('averages'), tot = cat('totals'), misc = cat('miscellaneous');
  const toMap = (names, vals) => {
    const m = {};
    (names || []).forEach((n, i) => {
      const v = vals?.[i];
      if (n.includes('-') && typeof v === 'string' && v.includes('-')) {
        const [a, b] = n.split('-'), [x, y] = v.split('-');
        m[a] = num(x); m[b] = num(y);
      } else m[n] = num(v);
    });
    return m;
  };
  const seasons = (avg?.statistics || []).map((row, i) => {
    const t = tot?.statistics?.find(r => r.season?.year === row.season?.year && r.teamId === row.teamId);
    const ms = misc?.statistics?.find(r => r.season?.year === row.season?.year && r.teamId === row.teamId);
    return {
      year: row.season?.year, label: row.season?.displayName, teamId: row.teamId, teamSlug: row.teamSlug, pos: row.position,
      a: toMap(avg.names, row.stats), t: t ? toMap(tot.names, t.stats) : {}, m: ms ? toMap(misc.names, ms.stats) : {}, idx: i,
    };
  });
  const teams = {};
  (js.teams ? Object.values(js.teams) : []).forEach(t => { if (t?.id) teams[t.id] = t; });
  return {
    seasons,
    career: avg?.totals ? toMap(avg.names, avg.totals) : null,
    careerTot: tot?.totals ? toMap(tot.names, tot.totals) : null,
    careerMisc: misc?.totals ? toMap(misc.names, misc.totals) : null,
    teams,
  };
}

export function currentSeason(parsed, year, teamId) {
  if (!parsed) return null;
  const rows = parsed.seasons.filter(s => s.year === year);
  if (!rows.length) return null;
  return rows.find(r => r.teamId === teamId) || rows[rows.length - 1];
}

/** Team season totals (live ESPN team statistics) for usage / assist-rate denominators. */
export function teamTotals(teamStatsJs, minutesPerGame) {
  const m = {};
  for (const c of teamStatsJs?.results?.stats?.categories || []) for (const s of c.stats) m[s.name] = s.value ?? num(s.displayValue);
  const gp = m.gamesPlayed || 0;
  if (!gp) return null;
  return {
    gp, fga: m.fieldGoalsAttempted ?? (m.avgFieldGoalsAttempted * gp), fta: m.freeThrowsAttempted ?? (m.avgFreeThrowsAttempted * gp),
    tov: (m.turnovers ?? (m.avgTurnovers * gp)), fgm: m.fieldGoalsMade ?? (m.avgFieldGoalsMade * gp),
    pts: m.points ?? (m.avgPoints * gp), reb: m.totalRebounds ?? m.rebounds, ast: m.assists ?? (m.avgAssists * gp), mp: gp * minutesPerGame, raw: m,
  };
}

/** Advanced numbers for a player season. a = per-game averages map from parseAthleteStats. */
export function advanced(a, tm, lg) {
  if (!a || !a.gamesPlayed) return null;
  const per = L(lg).per;
  const gp = a.gamesPlayed, min = a.avgMinutes || 0, mp = min * gp;
  const fga = a.avgFieldGoalsAttempted || 0, fgm = a.avgFieldGoalsMade || 0, fta = a.avgFreeThrowsAttempted || 0, ftm = a.avgFreeThrowsMade || 0;
  const tpa = a.avgThreePointFieldGoalsAttempted || 0, tpm = a.avgThreePointFieldGoalsMade || 0;
  const pts = a.avgPoints || 0, tov = a.avgTurnovers || 0, ast = a.avgAssists || 0, orb = a.avgOffensiveRebounds || 0, drb = a.avgDefensiveRebounds || 0;
  const reb = a.avgRebounds || orb + drb, stl = a.avgSteals || 0, blk = a.avgBlocks || 0, pf = a.avgFouls || 0;
  const o = {};
  o.ts = fga + fta > 0 ? 100 * pts / (2 * (fga + 0.44 * fta)) : null;
  o.efg = fga > 0 ? 100 * (fgm + 0.5 * tpm) / fga : null;
  o.tpar = fga > 0 ? 100 * tpa / fga : null;
  o.ftr = fga > 0 ? fta / fga : null;
  o.ato = tov > 0 ? ast / tov : null;
  o.gmsc = pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.7 * orb + 0.3 * drb + stl + 0.7 * ast + 0.7 * blk - 0.4 * pf - tov;
  if (min > 0) {
    const k = per / min;
    o.p36 = { pts: pts * k, reb: reb * k, ast: ast * k, stl: stl * k, blk: blk * k, orb: orb * k, tov: tov * k, tpa: tpa * k, fta: fta * k };
    o.stocks = (stl + blk) * k;
  }
  if (tm && mp > 0) {
    const den = tm.fga + 0.44 * tm.fta + tm.tov;
    o.usg = den > 0 ? 100 * ((fga + 0.44 * fta + tov) * gp * (tm.mp / 5)) / (mp * den) : null;
    const astDen = (mp / (tm.mp / 5)) * tm.fgm - fgm * gp;
    o.ast = astDen > 0 ? 100 * ast * gp / astDen : null;
    o.minShare = 100 * mp / (tm.mp / 5) / 1; // % of available team minutes at one position slot
  }
  o.per = isPro(lg) ? null : null;
  o.perMin = per;
  return o;
}

const T = lg => L(lg).ts; // lower efficiency benchmarks for the WNBA and college

export function tsTier(ts, lg) {
  if (ts == null) return '';
  const d = T(lg);
  if (ts >= 64 - d) return 'elite';
  if (ts >= 60 - d) return 'very good';
  if (ts >= 56.5 - d) return 'above average';
  if (ts >= 52 - d) return 'below average';
  return 'poor';
}
export function usgTier(u) {
  if (u == null) return '';
  if (u >= 32) return 'heliocentric star load';
  if (u >= 27) return 'primary option';
  if (u >= 22) return 'secondary option';
  if (u >= 17) return 'complementary role';
  return 'low-usage role player';
}

// ---------------------------------------------------------------- play style (rule-based scouting summary)
export function playStyle(p, lg) {
  let a = p.cur?.a, x = p.adv;
  const notes = [];
  if ((!a || (a.gamesPlayed || 0) < 5) && p.prev?.a?.gamesPlayed >= 8) {
    a = p.prev.a; x = advanced(a, null, lg);
    notes.push(`(Small sample this season, so this profile uses his ${p.prev.label} season: ${a.gamesPlayed} games${p.prevSchool ? ' at ' + p.prevSchool : ''}.)`);
  }
  if (!a || !x || !a.gamesPlayed) return notes.map(x2 => gender(lg, x2));
  const pm = L(lg).per;
  const d = T(lg);
  const pos = (p.pos || '').toUpperCase();
  const big = /C|PF|F-C|C-F/.test(pos) || (p.htIn && p.htIn >= 82);
  if (x.usg != null) notes.push(`${cap(usgTier(x.usg))}: uses ${f1(x.usg)}% of possessions when on the floor.`);
  else if (x.p36 && notes.length) notes.push(`Scored ${f1(x.p36.pts)} points per ${pm} minutes (${f1(a.avgPoints)} per game).`);
  else if (x.p36) notes.push(`Scores ${f1(x.p36.pts)} points per ${pm} minutes.`);
  // shot profile
  if (x.tpar != null && a.avgFieldGoalsAttempted >= 3) {
    if (x.tpar >= 55) notes.push(`Perimeter-oriented: ${Math.round(x.tpar)}% of his shots are threes (${f1(a.avgThreePointFieldGoalsAttempted)} 3PA/game).`);
    else if (x.tpar <= 12) notes.push(x.tpar < 1 ? 'Works entirely inside the arc. He has not attempted a three.' : `Works almost entirely inside the arc. Only ${Math.round(x.tpar)}% of his attempts are threes.`);
    else if (x.tpar >= 40) notes.push(`Balanced shooter with range: ${Math.round(x.tpar)}% of attempts from three.`);
  }
  const tpp = a.threePointFieldGoalPct ?? a.threePointPct;
  if (a.avgThreePointFieldGoalsAttempted >= 3 && tpp != null) {
    if (tpp >= 39 - d / 2) notes.push(`Knockdown shooter: ${f1(tpp)}% from three on real volume. Closeouts have to be hard.`);
    else if (tpp < 31) notes.push(`Streaky from deep (${f1(tpp)}% from three). Defenses can go under screens.`);
  }
  if (x.ftr != null && x.ftr >= 0.38 && a.avgFieldGoalsAttempted >= 5) notes.push(`Gets to the line: ${f1(a.avgFreeThrowsAttempted)} FTA/game (FT rate ${x.ftr.toFixed(2)}). He's aggressive attacking contact.`);
  const ftp = a.freeThrowPct;
  if (a.avgFreeThrowsAttempted >= 2 && ftp != null) {
    if (ftp >= 88) notes.push(`Automatic at the line (${f1(ftp)}% FT). A good late-game ball handler.`);
    else if (ftp < 65) notes.push(`Struggles at the line (${f1(ftp)}% FT). A possible hack/foul target late.`);
  }
  if (x.ts != null && a.avgPoints >= 8) notes.push(`Efficiency: ${f1(x.ts)}% true shooting, ${tsTier(x.ts, lg)} for ${isPro(lg) ? 'the ' + L(lg).name : 'D-I'}.`);
  // creation
  if (x.ast != null && x.ast >= 28) notes.push(`Primary playmaker. Assists on ${Math.round(x.ast)}% of teammate baskets while he plays.`);
  else if (x.p36 && x.p36.ast >= 5.5) notes.push(`Creates for others: ${f1(x.p36.ast)} assists per ${pm}.`);
  if (x.ato != null && a.avgAssists >= 3) {
    if (x.ato >= 3) notes.push(`Elite ball security: ${x.ato.toFixed(1)} assists per turnover.`);
    else if (x.ato < 1.4) notes.push(`Turnover-prone (${x.ato.toFixed(1)} AST/TO). Pressure him with traps.`);
  }
  // glass + defense
  if (x.p36) {
    if (x.p36.reb >= (big ? 12 : 9)) notes.push(`Strong rebounder: ${f1(x.p36.reb)} boards per ${pm}${x.p36.orb >= 3 ? `, including ${f1(x.p36.orb)} offensive. Crashes the glass` : ''}.`);
    if (x.p36.blk >= 2) notes.push(`Rim protector: ${f1(x.p36.blk)} blocks per ${pm}. Changes shots at the basket.`);
    if (x.p36.stl >= 1.7) notes.push(`Active hands: ${f1(x.p36.stl)} steals per ${pm}. Jumps passing lanes.`);
  }
  if (a.avgFouls >= 3.5 && a.avgMinutes < 30) notes.push(`Foul-prone (${f1(a.avgFouls)} PF in ${f1(a.avgMinutes)} min). Watch for early foul trouble.`);
  return notes.map(x => gender(lg, x));
}
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------- role on team
export function roleNotes(p, roster, lg) {
  const a = p.cur?.a;
  const out = [];
  if (!a || !a.gamesPlayed) {
    out.push(p.injury ? `Not yet playing this season (${p.injury}).` : 'Has not logged a game this season.');
    return out.map(x => gender(lg, x));
  }
  const gs = a.gamesStarted || 0, gp = a.gamesPlayed;
  const starter = gs / gp >= 0.5;
  const withStats = roster.filter(r => r.cur?.a?.gamesPlayed);
  const rank = (key, get) => 1 + withStats.filter(r => (get(r) ?? -1) > (get(p) ?? -1)).length;
  const mr = rank('min', r => r.cur?.a?.avgMinutes);
  const pr = rank('pts', r => r.cur?.a?.avgPoints);
  const ur = rank('usg', r => r.adv?.usg);
  out.push(`${starter ? `Starter (${gs} of ${gp} games)` : gs ? `Mostly off the bench (${gs} starts in ${gp} games)` : `Bench piece (${gp} games, no starts)`}. ${ordinal(mr)} on the team in minutes (${f1(a.avgMinutes)} per game).`);
  if (pr <= 3) out.push(`${pr === 1 ? 'Leading scorer' : ordinal(pr) + '-leading scorer'} on the roster at ${f1(a.avgPoints)} PPG${p.adv?.usg != null && ur <= 3 ? `, and ${ordinal(ur)} in usage` : ''}.`);
  const leads = [];
  const lead = (label, get) => { if (rank(label, get) === 1 && (get(p) || 0) > 0) leads.push(label); };
  lead('rebounds', r => r.cur?.a?.avgRebounds);
  lead('assists', r => r.cur?.a?.avgAssists);
  lead('steals', r => r.cur?.a?.avgSteals);
  lead('blocks', r => r.cur?.a?.avgBlocks);
  lead('made threes', r => r.cur?.a?.avgThreePointFieldGoalsMade);
  if (leads.length) out.push(`Leads the team in ${leads.join(', ')}.`);
  return out.map(x => gender(lg, x));
}

// ---------------------------------------------------------------- talking points
export function factNotes(p, roster, lg, extra = {}) {
  const facts = [];
  const a = p.cur?.a;
  // national / league ranks from ESPN statsSummary
  for (const s of p.ranks || []) {
    const lim = isPro(lg) ? 25 : 100;
    if (s.rank && s.rank <= lim) facts.push(`Ranks ${s.rankDisplayValue || ordinal(s.rank)} in ${scope(lg)} in ${s.displayName.toLowerCase()} (${s.displayValue}).`);
  }
  // game log: highs and streaks
  const gl = p.gamelog || [];
  if (gl.length) {
    const best = (k) => gl.reduce((m, g) => (g[k] ?? -1) > (m?.[k] ?? -1) ? g : m, null);
    const bp = best('pts'), br = best('reb'), ba = best('ast');
    if (bp?.pts) facts.push(`Season high ${bp.pts} points ${bp.atVs || 'vs'} ${bp.opp} (${bp.date}).`);
    if (br?.reb >= 8) facts.push(`Season high ${br.reb} rebounds ${br.atVs || 'vs'} ${br.opp} (${br.date}).`);
    if (ba?.ast >= 6) facts.push(`Season high ${ba.ast} assists ${ba.atVs || 'vs'} ${ba.opp} (${ba.date}).`);
    const streak = (test) => { let n = 0; for (const g of gl) { if (test(g)) n++; else break; } return n; };
    const s20 = streak(g => g.pts >= 20), s10 = streak(g => g.pts >= 10), sdd = streak(g => [g.pts, g.reb, g.ast].filter(v => v >= 10).length >= 2);
    if (s20 >= 3) facts.push(`Has scored 20+ in ${s20} straight games.`);
    else if (s10 >= 5 && (a?.avgPoints || 0) < 15) facts.push(`Double-figure scoring in ${s10} straight games.`);
    if (sdd >= 2) facts.push(`Double-doubles in ${sdd} straight games.`);
    const last5 = gl.slice(0, 5);
    if (last5.length >= 3 && a?.avgPoints) {
      const l5 = last5.reduce((s, g) => s + (g.pts || 0), 0) / last5.length;
      if (l5 - a.avgPoints >= 4) facts.push(`Heating up: ${f1(l5)} PPG over his last ${last5.length}, up from ${f1(a.avgPoints)} on the season.`);
      if (a.avgPoints - l5 >= 4) facts.push(`Cooling off: ${f1(l5)} PPG over his last ${last5.length}, below his ${f1(a.avgPoints)} average.`);
      const tp = last5.reduce((s, g) => s + (g.tpm || 0), 0), ta = last5.reduce((s, g) => s + (g.tpa || 0), 0);
      if (ta >= 12 && tp / ta >= 0.45) facts.push(`Hot from deep: ${tp}-of-${ta} (${Math.round(100 * tp / ta)}%) on threes over the last ${last5.length}.`);
    }
  }
  // career milestones (NBA)
  if (isPro(lg) && p.careerTot) {
    const ms = [['points', 1000, 'points'], ['totalRebounds', 1000, 'rebounds'], ['assists', 1000, 'assists'], ['threePointFieldGoalsMade', 250, 'made threes']];
    for (const [k, step, label] of ms) {
      const v = p.careerTot[k];
      if (!v || v < step) continue;
      const next = Math.ceil((v + 1) / step) * step;
      const need = next - v;
      const perGame = isPro(lg) ? { points: a?.avgPoints, totalRebounds: a?.avgRebounds, assists: a?.avgAssists, threePointFieldGoalsMade: a?.avgThreePointFieldGoalsMade }[k] : null;
      if (perGame && need <= perGame * 6) facts.push(`Milestone watch: ${need.toLocaleString()} ${label} away from ${next.toLocaleString()} for his career (has ${v.toLocaleString()}).`);
    }
  }
  if (p.careerTot?.points >= 10000 && isPro(lg)) facts.push(`${p.careerTot.points.toLocaleString()} career points.`);
  // awards (ESPN)
  for (const aw of (p.awards || []).slice(0, 8)) facts.push(`${aw.displayCount ? aw.displayCount + ' ' : ''}${aw.name}${aw.seasons?.length ? ` (${aw.seasons.slice(0, 6).join(', ')}${aw.seasons.length > 6 ? '…' : ''})` : ''}.`);
  // roster context
  const ages = roster.filter(r => r.age).map(r => r.age);
  if (p.age && ages.length > 5) {
    if (p.age === Math.max(...ages)) facts.push(`Oldest player on the roster (${p.age}).`);
    if (p.age === Math.min(...ages)) facts.push(`Youngest player on the roster (${p.age}).`);
  }
  if (p.htIn) {
    const hs = roster.filter(r => r.htIn).map(r => r.htIn);
    if (hs.length > 5 && p.htIn === Math.max(...hs)) facts.push(`Tallest player on the roster (${p.ht}).`);
  }
  if (p.birthCountry && p.birthCountry !== 'USA') facts.push(`International player, born in ${p.birthPlace || p.birthCountry}.`);
  if (extra.wiki?.highlights?.length) facts.push(...extra.wiki.highlights.slice(0, 6).map(h => h.endsWith('.') ? h : h + '.'));
  return [...new Set(facts)].map(x => gender(lg, x));
}

// ---------------------------------------------------------------- game log parsing (ESPN /gamelog)
export function parseGamelog(js) {
  if (!js?.seasonTypes) return [];
  const names = js.names || [];
  const idx = n => names.indexOf(n);
  const ev = js.events || {};
  const out = [];
  const st = js.seasonTypes.find(s => /Regular|Postseason/i.test(s.displayName)) || js.seasonTypes[0];
  for (const st2 of js.seasonTypes) {
    if (/Preseason/i.test(st2.displayName || '')) continue;
    for (const c of st2.categories || []) {
      if (c.type !== 'event') continue;
      for (const e of c.events || []) {
        const meta = ev[e.eventId] || {};
        const g = (n) => e.stats[idx(n)];
        const split = (n) => (g(n) || '').split('-').map(Number);
        const [fgm, fga] = split('fieldGoalsMade-fieldGoalsAttempted');
        const [tpm, tpa] = split('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
        out.push({
          id: e.eventId, dateIso: meta.gameDate, date: meta.gameDate ? new Date(meta.gameDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
          opp: meta.opponent?.abbreviation || meta.opponent?.displayName || '', oppLogo: meta.opponent?.logo, atVs: meta.atVs, result: meta.gameResult, score: meta.score,
          min: num(g('minutes')), pts: num(g('points')), reb: num(g('totalRebounds')), ast: num(g('assists')), stl: num(g('steals')), blk: num(g('blocks')), tov: num(g('turnovers')),
          fgm, fga, tpm, tpa, post: /Post/i.test(st2.displayName || ''),
        });
      }
    }
  }
  void st;
  out.sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso));
  return out;
}

// ---------------------------------------------------------------- Wikipedia
export function cleanWiki(s) {
  if (!s) return '';
  let t = s;
  t = t.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  t = t.replace(/\{\{\s*(?:nbay|nba year|nbayear)\s*\|\s*(\d{4})[^}]*\}\}/gi, (m, y) => `${+y - 1}–${String(y).slice(2)}`);
  t = t.replace(/\{\{\s*(?:cbb ?link|cbbteam|cbb link)[^|]*\|([^|}]+)[^}]*\}\}/gi, '$1');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{\s*(?:small|nowrap|nobr|lang\|[a-z]+|abbr|sortname|flagicon[^|]*)\s*\|([^{}|]*)(?:\|[^{}]*)?\}\}/gi, '$1');
  t = t.replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<br\s*\/?>/gi, '; ').replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/[{}]+/g, '').replace(/\s+/g, ' ').replace(/(\d)([A-Z][A-Za-z]+:)/g, '$1; $2').replace(/;\s*\(/g, ' (').trim();
  return t;
}
export function infobox(text) {
  const out = {};
  if (!text) return out;
  const start = text.search(/\{\{\s*Infobox/i);
  if (start < 0) return out;
  let depth = 0, i = start, end = text.length;
  for (; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; } else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (!depth) { end = i; break; } }
  }
  const body = text.slice(start, end);
  // split on top-level pipes at line starts
  const re = /\n\s*\|\s*([a-z_0-9 ]+?)\s*=\s*([\s\S]*?)(?=\n\s*\|\s*[a-z_0-9 ]+?\s*=|\n?\}\}$|$)/gi;
  let m;
  while ((m = re.exec(body + '\n}}'))) out[m[1].trim().toLowerCase()] = m[2].trim();
  return out;
}
export function listItems(raw) {
  if (!raw) return [];
  let lines = raw.split(/\n/).map(l => l.trim()).filter(l => /^\*/.test(l)).map(l => cleanWiki(l.replace(/^\*+\s*/, '')));
  if (!lines.length) lines = raw.split(/<br\s*\/?>/i).map(cleanWiki);
  return lines.map(x => x.replace(/[}{]+/g, '').replace(/^\W+/, '').trim()).filter(x => x.length > 2 && x.length < 160 && !/=|^medal/i.test(x));
}

/** Find the player's Wikipedia article (only when it clearly matches) and pull background facts. */
export async function wikiPlayer(name, lg, team) {
  const q = `${name} basketball`;
  const res = await safe(wiki.search(q, 6));
  const hits = res?.query?.search || [];
  const key = normName(name);
  const cand = hits.find(h => normName(h.title.replace(/\s*\(.*\)$/, '')) === key && /basketball/i.test(h.snippet));
  if (!cand) return null;
  const [intro, lead] = await Promise.all([safe(wiki.intro(cand.title)), safe(wiki.lead(cand.title))]);
  const page = Object.values(intro?.query?.pages || {})[0];
  const extract = page?.extract || '';
  // sanity checks to avoid a namesake
  if (isPro(lg) && !(lg === 'wnba' ? /WNBA|Women's National Basketball Association/ : /NBA|National Basketball Association/).test(extract)) return null;
  if (isCollege(lg)) {
    const school = [team?.location, team?.short, team?.nick].filter(Boolean);
    if (!school.some(s => extract.includes(s))) return null;
  }
  const wt = lead?.parse?.wikitext?.['*'] || '';
  const ib = infobox(wt);
  const pron = pronunciation(wt, extract);
  const sentences = extract.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 4).join(' ');
  const draft = ib.draft_year ? `${cleanWiki(ib.draft_year)}${ib.draft_round ? ', round ' + cleanWiki(ib.draft_round) : ''}${ib.draft_pick ? ', pick ' + cleanWiki(ib.draft_pick) : ''}${ib.draft_team ? ' by the ' + cleanWiki(ib.draft_team) : ''}` : '';
  return {
    title: cand.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(cand.title.replace(/ /g, '_'))}`,
    extract: sentences, hs: cleanWiki(ib.high_school), college: cleanWiki(ib.college), draft, nickname: cleanWiki(ib.nickname),
    nationality: cleanWiki(ib.nationality), highlights: listItems(ib.highlights || ib.career_highlights || ib.awards).slice(0, 12),
    born: cleanWiki(ib.birth_place), pron,
  };
}

/** Respelled pronunciation from Wikipedia ({{respell|...}} or a "/ dah-m-ay s-ar" style respelling in the lead). */
export function pronunciation(wt, extract) {
  const m = /\{\{\s*respell\s*\|([^}]+)\}\}/i.exec(wt || '');
  if (m) {
    const parts = m[1].split('|').map(x => x.trim()).filter(x => x && !x.includes('='));
    let out = '';
    parts.forEach((x, i) => { if (x === '_') out += ' '; else out += (i && !out.endsWith(' ') ? '-' : '') + x; });
    if (out.trim()) return out.trim();
  }
  const m2 = /\/\s*([A-Za-z][A-Za-z\-' ]{2,40}?)\s*[,;)]/.exec((extract || '').slice(0, 320));
  if (m2 && m2[1].includes('-')) return m2[1].trim();
  return '';
}

/** Head coach background from Wikipedia (only when the article clearly matches). */
export async function wikiCoach(name, lg, team) {
  const res = await safe(wiki.search(`${name} basketball coach`, 6));
  const key = normName(name);
  const cand = (res?.query?.search || []).find(h => normName(h.title.replace(/\s*\(.*\)$/, '')) === key && /coach/i.test(h.snippet));
  if (!cand) return null;
  const [intro, lead] = await Promise.all([safe(wiki.intro(cand.title)), safe(wiki.lead(cand.title))]);
  const extract = Object.values(intro?.query?.pages || {})[0]?.extract || '';
  if (!/coach/i.test(extract)) return null;
  if (team && ![team.location, team.short, team.nick, team.name].filter(Boolean).some(x => extract.includes(x))) return null;
  const wt = lead?.parse?.wikitext?.['*'] || '';
  const ib = infobox(wt);
  const pick = keys => { for (const k of keys) if (ib[k]) return cleanWiki(ib[k]); return ''; };
  return {
    title: cand.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(cand.title.replace(/ /g, '_'))}`,
    extract: extract.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 3).join(' '),
    overall: pick(['overall', 'overall_record', 'coach_record', 'career_record']),
    highlights: listItems(ib.accomplishments || ib.championships || ib.highlights || ib.awards).slice(0, 8),
    pron: pronunciation(wt, extract),
  };
}

/** Team article on Wikipedia: summary + infobox facts (titles, arena, coach, history). */
export async function wikiTeam(team, lg) {
  const title = isPro(lg) ? team.name : `${team.location} ${team.nick} ${L(lg).women ? "women's" : "men's"} basketball`;
  let lead = await safe(wiki.lead(title));
  let used = title;
  if (!lead?.parse) {
    const res = await safe(wiki.search(isPro(lg) ? `${team.name} ${L(lg).name} team` : `${team.location} ${team.nick} ${L(lg).women ? "women's" : "men's"} basketball`, 3));
    const t = res?.query?.search?.[0]?.title;
    if (t) { used = t; lead = await safe(wiki.lead(t)); }
  }
  if (!lead?.parse) return null;
  used = lead.parse.title || used;
  const intro = await safe(wiki.intro(used));
  const page = Object.values(intro?.query?.pages || {})[0];
  const ib = infobox(lead.parse.wikitext['*']);
  const pick = keys => { for (const k of keys) if (ib[k]) return cleanWiki(ib[k]); return ''; };
  const facts = [];
  const add = (label, keys) => { const v = pick(keys); if (v && v.length < 400) facts.push([label, v]); };
  if (isPro(lg)) {
    add('Founded', ['founded']); add('History', ['history']); add('Arena', ['arena']); add('Championships', ['championships']);
    add('Conference titles', ['conf_titles']); add('Division titles', ['div_titles']); add('Retired numbers', ['retired_numbers']);
    add('Owner', ['owner', 'owners']); add('President', ['president']); add('General manager', ['general_manager', 'gm']); add('Head coach', ['coach', 'head_coach']);
  } else {
    add('Head coach', ['coach', 'head_coach', 'coach_name']); add('Arena', ['arena', 'arenaname']); add('Conference', ['conference']);
    add('NCAA championships', ['ncaachampion', 'ncaa_champion', 'ncaa_championships']); add('Final Fours', ['ncaafinalfour', 'final_fours', 'ncaa_final_four']);
    add('Elite Eights', ['ncaaeliteeight', 'ncaa_elite_eight']); add('Sweet Sixteens', ['ncaasweetsixteen', 'ncaa_sweet_sixteen']);
    add('NCAA Tournament appearances', ['ncaatourneys', 'ncaa_tourneys', 'ncaa_tournament_appearances']);
    add('Conference tournament titles', ['conference_tournament', 'conftourneychamp', 'conference_tournament_champions']);
    add('Conference regular-season titles', ['conference_season', 'confseasonchamp', 'conference_season_champions']);
  }
  const extract = (page?.extract || '').split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 5).join(' ');
  return { title: used, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(used.replace(/ /g, '_'))}`, extract, facts };
}

// ---------------------------------------------------------------- team style + storylines
export function teamStyle(ts, lg, n) {
  if (!ts) return [];
  const out = [], rk = ts.rk || {};
  const top = (k, frac = 0.2) => rk[k] && rk[k] <= Math.ceil(n * frac);
  const bot = (k, frac = 0.2) => rk[k] && rk[k] > n - Math.ceil(n * frac);
  if (top('pace')) out.push(`Plays fast: ${f1(ts.pace)} possessions per game (${ordinal(rk.pace)} of ${n}).`);
  else if (bot('pace')) out.push(`Slows the game down: ${f1(ts.pace)} possessions per game (${ordinal(rk.pace)} of ${n}).`);
  if (top('tpaRate')) out.push(`Three-point heavy: ${pct(ts.tpaRate, 0)} of shots are threes (${ordinal(rk.tpaRate)}).`);
  else if (bot('tpaRate')) out.push(`Attacks inside: only ${pct(ts.tpaRate, 0)} of shots are threes (${ordinal(rk.tpaRate)}).`);
  if (top('ortg')) out.push(`Elite offense: ${f1(ts.ortg)} points per 100 possessions (${ordinal(rk.ortg)}).`);
  if (bot('ortg')) out.push(`Offense struggles: ${f1(ts.ortg)} points per 100 (${ordinal(rk.ortg)}).`);
  if (top('drtg')) out.push(`Elite defense: allows ${f1(ts.drtg)} per 100 possessions (${ordinal(rk.drtg)}).`);
  if (bot('drtg')) out.push(`Leaky defense: allows ${f1(ts.drtg)} per 100 (${ordinal(rk.drtg)}).`);
  if (top('astRatio')) out.push(`Ball movement: assists on ${pct(ts.astRatio, 0)} of made baskets (${ordinal(rk.astRatio)}).`);
  if (top('orpg')) out.push(`Crashes the offensive glass: ${f1(ts.orpg)} OREB per game (${ordinal(rk.orpg)}).`);
  if (top('tovPct') ) out.push(`Protects the ball: ${f1(ts.tovPct)} turnovers per 100 possessions (${ordinal(rk.tovPct)}).`);
  if (bot('tovPct')) out.push(`Turnover issues: ${f1(ts.tovPct)} per 100 possessions (${ordinal(rk.tovPct)}).`);
  if (top('ftRate')) out.push(`Lives at the line: ${f1(ts.fta)} FTA per game (${ordinal(rk.ftRate)} in FT rate).`);
  if (top('bpg')) out.push(`Shot-blocking team: ${f1(ts.bpg)} blocks per game (${ordinal(rk.bpg)}).`);
  if (top('spg')) out.push(`Disruptive: ${f1(ts.spg)} steals per game (${ordinal(rk.spg)}).`);
  if (top('tpp')) out.push(`Shoots it well from deep: ${pct(ts.tpp)} from three (${ordinal(rk.tpp)}).`);
  if (bot('tpp')) out.push(`Cold from three: ${pct(ts.tpp)} (${ordinal(rk.tpp)}).`);
  return out;
}
