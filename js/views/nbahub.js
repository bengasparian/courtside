// NBA league hub: season phase (Cup → All-Star → playoff race → playoffs), power rankings, standings, leaders, draft.
import { esc, f1, pct, ordinal, signed, logoFor, fmtDate, fmtTime, ymd } from '../util.js';
import { espn, repo, wiki, safe } from '../api.js';
import { state, teams, meta, seasonYear } from '../ctx.js';
import { gameCard, newsList, teamCell, q } from './common.js';

let T;
export async function render(app, view, params) {
  T = await teams('nba');
  if (view === 'standings') return standings(app, params);
  if (view === 'draft') return draft(app, params);
  const info = await phaseInfo();
  const tab = params.get('tab') || 'phase';
  const tabs = [['phase', info.label], ['power', 'Power rankings'], ['news', 'Around the league'], ['leaders', 'Stat leaders']];
  app.innerHTML = `<div class="row wrap"><h1 class="h1">Around the NBA</h1><span class="sp"></span><span class="chip acc">${esc(info.label)}</span></div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/nba/league?tab=${k}" class="${tab === k ? 'on' : ''}">${esc(l)}</a>`).join('')}</div><div id="hb"><div class="loading"></div></div>`;
  const el = app.querySelector('#hb');
  if (tab === 'phase') return phase(el, info, params.get('p') || info.phase);
  if (tab === 'power') return power(el);
  if (tab === 'news') return around(el);
  if (tab === 'leaders') return leaders(el);
}

// ------------------------------------------------------------------ season phase
async function phaseInfo() {
  const [m, cup, year] = await Promise.all([meta(), safe(repo('nba/cup.json'), null), seasonYear('nba')]);
  const types = m?.seasons?.nba?.types || [];
  const reg = types.find(t => t.id === '2'), post = types.find(t => t.id === '3');
  const regStart = reg?.start ? new Date(reg.start) : new Date(`${year - 1}-10-20`);
  const regEnd = reg?.end ? new Date(reg.end) : new Date(`${year}-04-13`);
  const postStart = post?.start ? new Date(post.start) : new Date(`${year}-04-18`);
  const seasonEnd = post?.end ? new Date(post.end) : new Date(`${year}-06-25`);
  const finalGame = (cup?.knockout || []).filter(g => /Champ|Final/i.test(g.note) && !/Semi|Quarter/i.test(g.note)).pop();
  const cupEnd = finalGame ? new Date(new Date(finalGame.date).getTime() + (finalGame.state === 'post' ? 2 : 3) * 864e5) : new Date(`${year - 1}-12-20`);
  const asg = await allStarDate(year);
  const now = new Date();
  let phase = 'offseason';
  if (now < regStart) phase = 'preseason';
  else if (now <= cupEnd) phase = 'cup';
  else if (now <= new Date(asg.getTime() + 864e5)) phase = 'allstar';
  else if (now <= regEnd) phase = 'race';
  else if (now <= seasonEnd) phase = 'playoffs';
  const labels = { preseason: 'Preseason', cup: 'NBA Cup', allstar: 'Road to the All-Star Game', race: 'Playoff race', playoffs: 'NBA Playoffs', offseason: 'Offseason' };
  return { phase, label: labels[phase], labels, year, regStart, regEnd, postStart, seasonEnd, cupEnd, asg, cup };
}

async function allStarDate(year) {
  const s = await safe(wiki.intro(`${year} NBA All-Star Game`), null);
  const ex = Object.values(s?.query?.pages || {})[0]?.extract || '';
  const m = /(February|March)\s+(\d{1,2}),\s+(\d{4})/.exec(ex);
  if (m) return new Date(`${m[1]} ${m[2]}, ${m[3]}`);
  // fallback: third Sunday of February
  const d = new Date(year, 1, 1); let sundays = 0;
  while (sundays < 3) { if (d.getDay() === 0) sundays++; if (sundays < 3) d.setDate(d.getDate() + 1); }
  return d;
}

async function phase(el, info, which) {
  const subs = [['cup', 'NBA Cup'], ['allstar', 'All-Star race'], ['race', 'Playoff race'], ['playoffs', 'Playoffs']];
  el.innerHTML = `<div class="subtabs">${subs.map(([k, l]) => `<button data-p="${k}" class="${k === which ? 'on' : ''}">${l}${k === info.phase ? ' • now' : ''}</button>`).join('')}</div><div id="ph"><div class="loading"></div></div>`;
  el.querySelectorAll('.subtabs button').forEach(b => b.addEventListener('click', () => { location.hash = `#/nba/league?tab=phase&p=${b.dataset.p}`; }));
  const ph = el.querySelector('#ph');
  if (which === 'cup' || which === 'preseason') return cupPanel(ph, info);
  if (which === 'allstar') return allStarPanel(ph, info);
  if (which === 'race' || which === 'offseason') return racePanel(ph, info);
  if (which === 'playoffs') return playoffPanel(ph, info);
}

async function cupPanel(el, info) {
  const cup = info.cup;
  if (!cup?.groups || !Object.keys(cup.groups).length) { el.innerHTML = '<div class="empty">NBA Cup data is not available yet.</div>'; return; }
  const news = await safe(espn.news('nba', null, 50), null);
  const cupNews = (news?.articles || []).filter(a => /Cup|Vegas|knockout|group play/i.test(`${a.headline} ${a.description}`));
  // wild card: best second-place team per conference
  const wc = {};
  for (const conf of ['East', 'West']) {
    const seconds = Object.entries(cup.groups).filter(([g]) => g.startsWith(conf)).map(([, rows]) => rows[1]).filter(Boolean);
    seconds.sort((a, b) => (b.w - a.w) || (b.diff - a.diff) || (b.pf - a.pf));
    if (seconds[0]) wc[conf] = seconds[0].id;
  }
  const groupTable = (g, rows) => `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(g)}</h3></div><table class="t"><thead><tr><th>Team</th><th>W-L</th><th>PF</th><th>PA</th><th>Diff</th><th>Left</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i === 0 ? 'hl' : ''}"><td class="l">${teamCell(T.byId[r.id], 'nba')}${i === 0 ? ' <span class="chip green">1st</span>' : wc[g.split(' ')[0]] === r.id ? ' <span class="chip amber">WC</span>' : ''}</td><td class="b">${r.w}-${r.l}</td><td>${r.pf}</td><td>${r.pa}</td><td class="${r.diff > 0 ? 'good' : r.diff < 0 ? 'bad' : ''}">${signed(r.diff, 0)}</td><td>${r.left}</td></tr>`).join('')}</tbody></table></div>`;
  const upcoming = (cup.games || []).filter(g => g.state !== 'post').slice(0, 12);
  const ko = cup.knockout || [];
  el.innerHTML = `
    <div class="card" style="margin-bottom:14px"><h3 class="h3">How the Cup works</h3><div class="small">30 teams in six groups of five (three per conference). Each team plays four group games, which also count in the regular-season standings. The six group winners plus one wild card per conference (best second-place record) reach the eight-team knockout round. Quarterfinals are at home sites; the semifinals and championship are in Las Vegas. The championship game does not count in the standings. Group tiebreakers: head-to-head, then point differential in group games, then total points scored. <span class="chip green">1st</span> = currently leads group · <span class="chip amber">WC</span> = current wild-card leader.</div></div>
    <div class="grid g3">${Object.entries(cup.groups).sort(([a], [b]) => a.localeCompare(b)).map(([g, rows]) => groupTable(g, rows)).join('')}</div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card flush"><div class="card-h"><h3 class="h3">${ko.length ? 'Knockout round' : 'Upcoming Cup games'}</h3></div>
        <table class="t"><tbody>${(ko.length ? ko : upcoming).map(g => { const a = T.byId[g.away], h = T.byId[g.home]; return `<tr><td class="l small">${esc(fmtDate(g.date, { month: 'short', day: 'numeric' }))}</td><td class="l">${teamCell(a, 'nba')}</td><td>${g.state === 'post' ? `<a class="b" href="#/nba/game/${g.id}">${g.as}-${g.hs}</a>` : `<a href="#/nba/game/${g.id}">${esc(fmtTime(g.date))}</a>`}</td><td class="l">${teamCell(h, 'nba')}</td><td class="small mut">${esc(g.note.replace('NBA Cup - ', ''))}</td></tr>`; }).join('') || '<tr><td class="empty">Group play is complete.</td></tr>'}</tbody></table></div>
      <div class="card"><h3 class="h3">Cup news &amp; implications</h3>${newsList(cupNews.length ? cupNews : news?.articles, { limit: 6 })}</div>
    </div>
    <div class="src">Groups: Wikipedia (${esc(String(info.year - 1))} NBA Cup) · Results: ESPN, recomputed every 2 hours.</div>`;
}

async function allStarPanel(el, info) {
  const [L, sum, news] = await Promise.all([safe(repo('nba/leaders.json'), null), safe(wiki.summary(`${info.year} NBA All-Star Game`), null), safe(espn.news('nba', null, 50), null)]);
  const cats = L?.categories || {};
  // candidate pool: everyone in the top 15 of rating, PER, points, rebounds, assists
  const score = {};
  for (const [k, w] of [['NBARating', 3], ['PER', 2], ['pointsPerGame', 2], ['reboundsPerGame', 1], ['assistsPerGame', 1]]) {
    for (const p of cats[k]?.leaders || []) {
      const s = score[p.id] || (score[p.id] = { ...p, pts: 0, why: [] });
      s.pts += w * (16 - p.rank);
      s.why.push(`${cats[k].label} ${ordinal(p.rank)}`);
    }
  }
  const pool = Object.values(score).sort((a, b) => b.pts - a.pts);
  const conf = id => T.byId[id]?.conf;
  const col = c => pool.filter(p => conf(p.teamId) === c).slice(0, 12);
  const asNews = (news?.articles || []).filter(a => /All-Star|MVP|award/i.test(`${a.headline} ${a.description}`));
  el.innerHTML = `<div class="grid g-side">
    <div class="grid" style="align-content:start">
      <div class="card"><h3 class="h3">${esc(sum?.title || `${info.year} NBA All-Star Game`)}</h3><div class="small">${esc(sum?.extract || 'Details will appear once announced.')}</div><div class="small mut" style="margin-top:6px">Game date: <b>${esc(fmtDate(info.asg.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</b>${sum?.content_urls?.desktop?.page ? ` · <a class="link" href="${esc(sum.content_urls.desktop.page)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div></div>
      <div class="grid g2">${['East', 'West'].map(c => `<div class="card flush"><div class="card-h"><h3 class="h3">${c} All-Star candidates</h3></div><table class="t"><tbody>${col(c).map((p, i) => `<tr><td class="l" style="width:22px">${i + 1}</td><td class="l"><b>${esc(p.name)}</b> <span class="mut small">${esc(p.team || '')}</span><div class="tiny mut">${esc(p.why.slice(0, 3).join(' · '))}</div></td></tr>`).join('') || '<tr><td class="empty">Not enough games yet.</td></tr>'}</tbody></table></div>`).join('')}</div>
      <div class="src">Candidate list is a Courtside composite of the ESPN leaderboards (player rating, PER, scoring, rebounding, assists). It isn't an official vote. Fan, player and media voting decides starters; coaches pick reserves.</div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3 class="h3">MVP-style rating leaders</h3><table class="t"><tbody>${(cats.NBARating?.leaders || []).slice(0, 10).map(p => `<tr><td class="l">${p.rank}</td><td class="l">${esc(p.name)} <span class="mut small">${esc(p.team || '')}</span></td><td class="b">${esc(p.v)}</td></tr>`).join('')}</tbody></table><div class="src">ESPN NBA player rating.</div></div>
      <div class="card"><h3 class="h3">All-Star &amp; awards news</h3>${newsList(asNews.length ? asNews : news?.articles, { limit: 6 })}</div>
    </div></div>`;
}

async function racePanel(el, info) {
  const [st, bpi] = await Promise.all([safe(espn.standings('nba'), null), safe(repo('nba/bpi.json'), null)]);
  const B = bpi?.teams || {};
  el.innerHTML = `<div class="card" style="margin-bottom:14px"><div class="small">Seeds 1–6 in each conference make the playoffs outright. Seeds 7–10 go to the Play-In Tournament: 7 hosts 8 (the winner is the 7 seed), 9 hosts 10 (the loser is out), then the 7/8 loser hosts the 9/10 winner for the 8 seed. Odds are ESPN BPI season simulations. Regular season ends ${esc(fmtDate(info.regEnd.toISOString(), { month: 'long', day: 'numeric' }))}.</div></div>
    <div class="grid g2">${(st?.children || []).map(c => confTable(c, B)).join('')}</div>`;
}

function confTable(c, B) {
  const rows = (c.standings?.entries || []).map(e => { const v = {}, d = {}; for (const s of e.stats) { v[s.name || s.type] = s.value; d[s.name || s.type] = s.displayValue ?? s.summary; } return { id: e.team.id, v, d }; }).sort((a, b) => (a.v.playoffSeed || 99) - (b.v.playoffSeed || 99));
  return `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(c.name)}</h3></div><div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Team</th><th>W-L</th><th>GB</th><th>L10</th><th>Strk</th><th>Playoff%</th><th>Play-in%</th><th>Proj W</th><th>SOS left</th></tr></thead><tbody>
    ${rows.map(r => { const b = B[r.id] || {}; const s = r.v.playoffSeed; return `<tr class="${s === 6 || s === 10 ? 'cut' : ''}"><td class="l">${s ?? ''}</td><td class="l">${teamCell(T.byId[r.id], 'nba')}</td><td class="b">${esc(r.d.overall || `${r.v.wins}-${r.v.losses}`)}</td><td>${esc(r.d.gamesBehind ?? '')}</td><td>${esc(r.d['Last Ten Games'] || r.d.lasttengames || '')}</td><td>${esc(r.d.streak || '')}</td><td>${b.probmakeplayoffs != null ? pct(b.probmakeplayoffs, 0) : '–'}</td><td>${b.playinchance != null ? pct(b.playinchance, 0) : '–'}</td><td>${b.projectedw != null ? Math.round(b.projectedw) : '–'}</td><td>${b.sosremainingrank ? ordinal(b.sosremainingrank) : '–'}</td></tr>`; }).join('')}
  </tbody></table></div></div>`;
}

async function playoffPanel(el, info) {
  const range = `${ymd(info.postStart)}-${ymd(info.seasonEnd)}`;
  const [sb, bpi] = await Promise.all([safe(espn.scoreboardRange('nba', range, '&seasontype=3'), null), safe(repo('nba/bpi.json'), null)]);
  const evs = sb?.events || [];
  const series = {};
  for (const e of evs) {
    const c = e.competitions[0];
    const ids = c.competitors.map(x => x.team.id).sort();
    const k = ids.join('-');
    const s = series[k] || (series[k] = { ids, games: [], round: '', summary: '' });
    s.games.push(e);
    const note = (c.notes || []).map(n => n.headline).join(' ');
    if (note) s.round = note.replace(/\s*-\s*Game \d+.*$/, '');
    if (c.series?.summary) s.summary = c.series.summary;
  }
  const rounds = {};
  for (const s of Object.values(series)) (rounds[s.round || 'Playoffs'] = rounds[s.round || 'Playoffs'] || []).push(s);
  const order = r => (/Play-In/i.test(r) ? 0 : /1st|First/i.test(r) ? 1 : /Semi/i.test(r) ? 2 : /Conf.*Final|Conference Finals/i.test(r) ? 3 : /NBA Finals|^Finals/i.test(r) ? 4 : 5);
  const B = bpi?.teams || {};
  const odds = Object.entries(B).filter(([, b]) => b.probwintitle > 0).sort((a, b) => b[1].probwintitle - a[1].probwintitle).slice(0, 16);
  el.innerHTML = `${evs.length ? `<div class="bracket">${Object.keys(rounds).sort((a, b) => order(a) - order(b)).map(r => `<div class="col"><div class="h3">${esc(r)}</div>${rounds[r].map(s => `<div class="series">${s.ids.map(id => `<div class="r"><img src="${esc(logoFor(T.byId[id], state.theme))}" alt="">${esc(T.byId[id]?.short || id)}</div>`).join('')}<div class="small mut" style="margin-top:4px">${esc(s.summary || `${s.games.length} game${s.games.length > 1 ? 's' : ''}`)}</div></div>`).join('')}</div>`).join('')}</div>`
    : `<div class="card"><div class="small">The playoffs begin ${esc(fmtDate(info.postStart.toISOString(), { month: 'long', day: 'numeric', year: 'numeric' }))}. The bracket fills in automatically as series are set. Title odds below are current ESPN BPI projections.</div></div>`}
    <div class="card flush" style="margin-top:14px"><div class="card-h"><h3 class="h3">Championship odds (ESPN BPI)</h3></div><table class="t"><thead><tr><th>Team</th><th>Title</th><th>Finals</th><th>Conf. finals</th><th>2nd round</th><th>Playoffs</th></tr></thead><tbody>
    ${odds.map(([id, b]) => `<tr><td class="l">${teamCell(T.byId[id], 'nba')}</td><td class="b">${pct(b.probwintitle, 1)}</td><td>${pct(b.probmaketitlegame, 1)}</td><td>${pct(b.probmakeconfchamp, 1)}</td><td>${pct(b.probmakeconfsemi, 1)}</td><td>${pct(b.probmakeplayoffs, 0)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------------ power rankings
async function power(el) {
  const p = await safe(repo('nba/power.json'), null);
  if (!p?.rows) { el.innerHTML = '<div class="empty">Power rankings are not available yet.</div>'; return; }
  el.innerHTML = `<div class="card flush"><div class="card-h"><h3 class="h3">Courtside power rankings · ${esc(p.date)}</h3><span class="small mut">movement vs ${esc(p.baseDate)}</span></div><div class="tscroll"><table class="t"><thead><tr><th>#</th><th></th><th>Team</th><th>Record</th><th>L10</th><th>Streak</th><th>Net Rtg${q('net', 'nba')}</th><th>BPI${q('bpi', 'nba')}</th><th>Score</th></tr></thead><tbody>
    ${p.rows.map(r => { const mv = r.prev ? r.prev - r.rank : 0; return `<tr><td class="l b">${r.rank}</td><td class="pr-move ${mv > 0 ? 'good' : mv < 0 ? 'bad' : 'mut2'}">${mv > 0 ? '▲' + mv : mv < 0 ? '▼' + -mv : '–'}</td><td class="l">${teamCell(T.byId[r.id], 'nba')}</td><td>${r.w}-${r.l}</td><td>${esc(r.last10 || '')}</td><td>${esc(r.streak || '')}</td><td>${signed(r.net)}</td><td>${signed(r.bpi)}</td><td>${signed(r.score, 2)}</td></tr>`; }).join('')}
  </tbody></table></div></div><div class="src">Method: 40% ESPN BPI, 25% net rating, 20% win %, 15% last-10 form (each as a z-score). Refreshed every 2 hours; movement compares with about a week ago.</div>`;
}

async function around(el) {
  const [news, sb] = await Promise.all([safe(espn.news('nba', null, 30), null), safe(espn.scoreboard('nba', ymd(new Date())), null)]);
  el.innerHTML = `<div class="grid g-side"><div class="card"><h3 class="h3">Top stories</h3>${newsList(news?.articles, { limit: 20 })}</div><div><h3 class="h3">Tonight</h3><div class="games" style="grid-template-columns:1fr">${(sb?.events || []).map(e => gameCard(e, 'nba', T)).join('') || '<div class="empty">No games today.</div>'}</div></div></div>`;
}

async function leaders(el) {
  const L = await safe(repo('nba/leaders.json'), null);
  const want = ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', 'stealsPerGame', 'blocksPerGame', '3PointsMadePerGame', 'fieldGoalPercentage', '3PointPct', 'FreeThrowPct', 'PER', 'doubleDouble', 'minutesPerGame'];
  el.innerHTML = `<div class="grid g3">${want.filter(k => L?.categories?.[k]).map(k => { const c = L.categories[k]; return `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(c.label)}</h3></div><table class="t"><tbody>${c.leaders.slice(0, 10).map(p => `<tr><td class="l" style="width:20px">${p.rank}</td><td class="l"><span class="tm">${T.byId[p.teamId] ? `<img src="${esc(logoFor(T.byId[p.teamId], state.theme))}" alt="">` : ''}${esc(p.name)}</span></td><td class="b">${esc(p.v)}</td></tr>`).join('')}</tbody></table></div>`; }).join('') || '<div class="empty">Leaders not available yet.</div>'}</div><div class="src">ESPN statistical leaders (qualified players).</div>`;
}

// ------------------------------------------------------------------ standings + draft
async function standings(app, params) {
  const view = params.get('v') || 'conf';
  app.innerHTML = `<div class="row"><h1 class="h1">NBA standings</h1><span class="sp"></span><div class="subtabs" style="margin:0"><button data-v="conf" class="${view === 'conf' ? 'on' : ''}">Conference</button><button data-v="div" class="${view === 'div' ? 'on' : ''}">Division</button></div></div><div id="sb" style="margin-top:12px"><div class="loading"></div></div>`;
  app.querySelectorAll('.subtabs button').forEach(b => b.addEventListener('click', () => { location.hash = `#/nba/standings?v=${b.dataset.v}`; }));
  const [st, bpi] = await Promise.all([safe(espn.standings('nba', view === 'div' ? '?level=3' : ''), null), safe(repo('nba/bpi.json'), null)]);
  const el = app.querySelector('#sb');
  const tables = [];
  const walk = n => { if (n.standings?.entries?.length) tables.push(n); for (const c of n.children || []) walk(c); };
  walk(st || {});
  el.innerHTML = `<div class="grid g2">${tables.map(c => full(c, bpi?.teams || {}, view === 'conf')).join('')}</div><div class="src">Dashed lines: playoff (top 6) and play-in (7–10) cutoffs. Source: ESPN.</div>`;
}
function full(c, B, cuts) {
  const rows = (c.standings.entries || []).map(e => { const v = {}, d = {}; for (const s of e.stats) { v[s.name || s.type] = s.value; d[s.name || s.type] = s.displayValue ?? s.summary; } return { id: e.team.id, v, d }; });
  rows.sort((a, b) => cuts ? (a.v.playoffSeed || 99) - (b.v.playoffSeed || 99) : (b.v.winPercent || 0) - (a.v.winPercent || 0));
  return `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(c.name)}</h3></div><div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>Home</th><th>Road</th><th>Conf</th><th>L10</th><th>Strk</th><th>Diff</th><th>BPI</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr class="${cuts && (r.v.playoffSeed === 6 || r.v.playoffSeed === 10) ? 'cut' : ''}"><td class="l">${cuts ? r.v.playoffSeed ?? '' : i + 1}</td><td class="l">${teamCell(T.byId[r.id], 'nba')}</td><td>${r.v.wins ?? ''}</td><td>${r.v.losses ?? ''}</td><td>${esc(r.d.winPercent ?? '')}</td><td>${esc(r.d.gamesBehind ?? '')}</td><td>${esc(r.d.Home ?? r.d.home ?? '')}</td><td>${esc(r.d.Road ?? r.d.road ?? '')}</td><td>${esc(r.d['vs. Conf.'] ?? '')}</td><td>${esc(r.d['Last Ten Games'] ?? '')}</td><td>${esc(r.d.streak ?? '')}</td><td class="${(r.v.differential || 0) > 0 ? 'good' : (r.v.differential || 0) < 0 ? 'bad' : ''}">${esc(r.d.differential ?? '')}</td><td>${B[r.id]?.bpi != null ? signed(B[r.id].bpi) : '–'}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

export async function draftView(app, lg, params) { return draft(app, params, lg); }
async function draft(app, params, lg = 'nba') {
  T = await teams(lg);
  const tab = params.get('t') || 'mock';
  const [d, bpi, nbaT] = await Promise.all([safe(repo('draft.json'), null), lg === 'nba' ? safe(repo('nba/bpi.json'), null) : null, teams('nba')]);
  const base = `#/${lg}/draft`;
  app.innerHTML = `<div class="row wrap"><h1 class="h1">${lg === 'nba' ? 'NBA draft' : 'NBA draft prospects'}</h1><span class="sp"></span><span class="small mut">Mock draft &amp; big board: ${esc(d?.source || 'Tankathon')}</span></div>
    <div class="tabs"><a href="${base}?t=mock" class="${tab === 'mock' ? 'on' : ''}">Mock draft</a><a href="${base}?t=board" class="${tab === 'board' ? 'on' : ''}">Big board</a>${lg === 'nba' ? `<a href="${base}?t=lottery" class="${tab === 'lottery' ? 'on' : ''}">Lottery race</a>` : ''}</div><div id="dv"></div>`;
  const el = app.querySelector('#dv');
  const byName = {};
  for (const t of nbaT.list) { byName[t.location] = t; byName[t.short] = t; byName[t.name] = t; }
  byName['LA Clippers'] = byName['LA'] = nbaT.list.find(t => t.abbr === 'LAC'); byName['L.A. Lakers'] = nbaT.list.find(t => t.abbr === 'LAL');
  if (tab === 'lottery' && lg === 'nba') {
    const B = bpi?.teams || {};
    const rows = Object.entries(B).filter(([, b]) => b.projdraftslot).sort((a, b) => a[1].projdraftslot - b[1].projdraftslot).slice(0, 14);
    el.innerHTML = `<div class="card flush"><div class="card-h"><h3 class="h3">Projected lottery (ESPN BPI)</h3></div><table class="t"><thead><tr><th>Proj. slot</th><th>Team</th><th>Record</th><th>Proj. W-L</th><th>#1 pick</th><th>Top 5</th><th>Top 10</th></tr></thead><tbody>
      ${rows.map(([id, b]) => `<tr><td class="l b">${Math.round(b.projdraftslot)}</td><td class="l">${teamCell(nbaT.byId[id], 'nba')}</td><td>${b.numwins}-${b.numlosses}</td><td>${Math.round(b.projectedw)}-${Math.round(b.projectedl)}</td><td>${pct(b.probno1draftpick, 1)}</td><td>${pct(b.probtop5draftpick, 0)}</td><td>${pct(b.probtop10draftpick, 0)}</td></tr>`).join('')}</tbody></table></div>
      <div class="src">The three worst records each have a 14% chance at the No. 1 pick in the lottery. Projections: ESPN BPI.</div>`;
    return;
  }
  const list = tab === 'board' ? d?.board : d?.mock;
  if (!list?.length) { el.innerHTML = '<div class="empty">Draft data unavailable right now.</div>'; return; }
  el.innerHTML = `<div class="card flush"><div class="tscroll"><table class="t"><thead><tr><th>${tab === 'board' ? 'Rank' : 'Pick'}</th>${tab === 'mock' ? '<th>Team</th>' : ''}<th>Player</th><th>Pos</th><th>School / Team</th><th>Ht</th><th>Wt</th><th>Year</th><th>Age</th><th>PTS</th><th>REB</th><th>AST</th><th>TS%</th><th>USG</th><th>BPM</th></tr></thead><tbody>
    ${list.map(r => { const pg = r.stats?.['per-game'] || {}, ad = r.stats?.advanced || {}; const t = byName[r.team]; const cbbT = T.list.find(x => x.location === r.school || x.short === r.school);
      return `<tr><td class="l b">${r.pick}</td>${tab === 'mock' ? `<td class="l">${t ? teamCell(t, 'nba') : esc(r.team || '')}${r.via ? ` <span class="tiny mut">via ${esc(r.via)}</span>` : ''}</td>` : ''}<td class="l b">${esc(r.name)}</td><td>${esc(r.pos)}</td><td class="l">${lg === 'cbb' && cbbT ? `<a class="link" href="#/cbb/team/${cbbT.id}">${esc(r.school)}</a>` : esc(r.school)}</td><td>${esc(r.ht || '')}</td><td>${esc(r.wt || '')}</td><td>${esc(r.year || '')}</td><td>${esc((r.age || '').replace(' yrs', ''))}</td><td>${esc(pg.pts || '')}</td><td>${esc(pg.reb || '')}</td><td>${esc(pg.ast || '')}</td><td>${esc(ad['ts%'] || '')}</td><td>${esc(ad.usg || '')}</td><td>${esc(ad.bpm || '')}</td></tr>`; }).join('')}
  </tbody></table></div></div><div class="src">Updated twice daily from Tankathon. Stats are current-season per game (college or international).</div>`;
  void f1;
}
