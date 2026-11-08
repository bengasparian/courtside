// Matchup prep (two teams) and single-team pages.
import { esc, f1, pct, ordinal, signed, logoFor, fmtDate, fmtTime, num, stars } from '../util.js';
import { espn, safe } from '../api.js';
import { state, teams, paint, myNotes, seasonYear } from '../ctx.js';
import { teamData, roster, history, teamWiki, scheduleFacts } from '../teamdata.js';
import { teamStyle, playStyle, roleNotes, factNotes, GLOSSARY } from '../notes.js';
import { kpi, q, newsList, rankCls } from './common.js';
import { cardHTML, bodyHTML, headerLine, wireCards } from './players.js';
import { onLeave } from '../app.js';

// ------------------------------------------------------------------------------------------------ single team page
export async function renderTeam(app, lg, id, params) {
  const T = await teams(lg);
  state._teamsById = state._teamsById || {}; state._teamsById[lg] = T.byId;
  const team = T.byId[id];
  if (!team) { app.innerHTML = '<div class="err">Team not found.</div>'; return; }
  paint(document.documentElement, team);
  const tab = params.get('tab') || 'team';
  app.innerHTML = `${teamHeader(team, lg)}
    <div class="tabs noprint">
      <a href="#/${lg}/team/${id}" class="${tab === 'team' ? 'on' : ''}">Team breakdown</a>
      <a href="#/${lg}/team/${id}?tab=players" class="${tab === 'players' ? 'on' : ''}">Player notes</a>
      <span class="sp"></span><a href="#/${lg}" class="mut">Compare with another team →</a>
    </div><div id="body"></div>`;
  const body = app.querySelector('#body');
  fillHeader(app, team, lg);
  if (tab === 'players') playersTab(body, team, lg);
  else teamTab(body, team, lg);
  roster(lg, team); // start loading players in the background
}

// ------------------------------------------------------------------------------------------------ matchup page
export async function render(app, lg, aId, bId, tab) {
  const T = await teams(lg);
  state._teamsById = state._teamsById || {}; state._teamsById[lg] = T.byId;
  const A = T.byId[aId], B = T.byId[bId];
  if (!A || !B) { app.innerHTML = '<div class="err">One of these teams could not be found.</div>'; return; }
  const root = document.documentElement;
  paint(root, A, 'a'); paint(root, B, 'b');
  paint(root, tab.startsWith('b') ? B : A, 'acc');
  const base = `#/${lg}/matchup/${aId}/${bId}`;
  const tabs = [['overview', 'Matchup'], ['a', `<img src="${esc(logoFor(A, state.theme))}" alt="">${esc(A.abbr)} team`], ['a-players', `${esc(A.abbr)} players`],
    ['b', `<img src="${esc(logoFor(B, state.theme))}" alt="">${esc(B.abbr)} team`], ['b-players', `${esc(B.abbr)} players`], ['board', 'Spotting board']];
  app.innerHTML = `
    <div class="mh">
      <a class="side a" href="#/${lg}/team/${A.id}"><img class="logo" src="${esc(A.logo)}" alt=""><div><div class="nm">${esc(A.name)}</div><div class="sub" id="subA">&nbsp;</div></div></a>
      <div class="mid" id="mid"><div class="tiny" style="opacity:.7">MATCHUP</div><div class="big">${esc(A.abbr)} @ ${esc(B.abbr)}</div><div class="tiny" id="midInfo" style="opacity:.8"></div></div>
      <a class="side b" href="#/${lg}/team/${B.id}"><div><div class="nm">${esc(B.name)}</div><div class="sub" id="subB">&nbsp;</div></div><img class="logo" src="${esc(B.logo)}" alt=""></a>
    </div>
    <div class="tabs noprint">${tabs.map(([k, l]) => `<a href="${base}/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}<span class="sp"></span><a class="mut" href="${`#/${lg}/matchup/${bId}/${aId}/${tab.replace(/^a/, 'x').replace(/^b/, 'a').replace(/^x/, 'b')}`}" title="Swap home/away">⇄</a></div>
    <div id="body"></div>`;
  const body = app.querySelector('#body');
  // header subtitles
  Promise.all([teamData(lg, A), teamData(lg, B)]).then(([da, db]) => {
    app.querySelector('#subA').innerHTML = subLine(da, lg);
    app.querySelector('#subB').innerHTML = subLine(db, lg);
    const next = da.events.find(e => e.oppId === B.id && e.state !== 'post');
    if (next) app.querySelector('#midInfo').innerHTML = `${next.state === 'in' ? '<span class="livedot"></span>LIVE · ' : ''}${esc(fmtDate(next.date))} · ${esc(fmtTime(next.date))}${next.tv ? ' · ' + esc(next.tv) : ''}`;
  });
  // kick off both rosters so every tab is instant
  roster(lg, A); roster(lg, B);
  if (tab === 'overview') overviewTab(body, A, B, lg);
  else if (tab === 'a') teamTab(body, A, lg);
  else if (tab === 'b') teamTab(body, B, lg);
  else if (tab === 'a-players') playersTab(body, A, lg);
  else if (tab === 'b-players') playersTab(body, B, lg);
  else if (tab === 'board') boardTab(body, A, B, lg);
}

function subLine(d, lg) {
  const s = d.std;
  const parts = [];
  if (lg === 'nba') {
    if (s) parts.push(`${s.overall || `${s.w}-${s.l}`}`, s.seed ? `${ordinal(s.seed)} in ${s.confAbbr || s.conf}` : '');
    if (d.power) parts.push(`Power #${d.power.rank}`);
  } else {
    const ap = d.polls?.find(p => /AP/.test(p.name));
    if (ap?.rank) parts.push(`AP #${ap.rank.current}`);
    if (s) parts.push(s.overall, s.conf ? `${s.conf} ${esc(shortConf(s.confName))}` : '');
    if (d.bpi?.bpirank) parts.push(`BPI #${d.bpi.bpirank}`);
  }
  return parts.filter(Boolean).map(esc).join(' · ');
}
const shortConf = c => (c || '').replace(/ Conference$/, '').replace(/Atlantic Coast/, 'ACC').replace(/Southeastern/, 'SEC');

// ------------------------------------------------------------------------------------------------ team header
function teamHeader(team, lg) {
  return `<div class="th"><img class="logo" src="${esc(team.logo)}" alt=""><div style="flex:1;min-width:240px"><div class="nm">${esc(team.name)}</div>
    <div class="small" style="opacity:.9;margin-top:4px">${esc([team.conf, team.division].filter(Boolean).join(' · '))}</div><div class="meta" id="thMeta"></div></div></div>`;
}
async function fillHeader(app, team, lg) {
  const d = await teamData(lg, team);
  const chips = [];
  const s = d.std;
  if (lg === 'nba' && s) {
    chips.push(`${s.overall || s.w + '-' + s.l}`, s.seed ? `${ordinal(s.seed)} in ${s.conf}` : '', s.gb && s.gb !== '-' ? `${s.gb} GB` : '', s.streak ? `Streak ${s.streak}` : '', s.last10 ? `L10 ${s.last10}` : '', s.home ? `Home ${s.home}` : '', s.road ? `Road ${s.road}` : '');
    if (d.power) chips.push(`Power rank #${d.power.rank}`);
  }
  if (lg === 'cbb') {
    for (const p of d.polls || []) chips.push(`${/AP/.test(p.name) ? 'AP' : 'Coaches'} #${p.rank.current}`);
    if (s) chips.push(s.overall, `${s.conf || '0-0'} conf (${ordinal(s.confRank)} of ${s.confSize})`, s.streak ? `Streak ${s.streak}` : '');
    if (d.net && d.netCurrent) chips.push(`NET #${d.net.Rank}`);
  }
  if (d.bpi?.bpirank) chips.push(`BPI #${d.bpi.bpirank}`);
  const ros = roster(lg, team);
  const draw = () => {
    const coach = ros.coach ? `Coach ${ros.coach.firstName} ${ros.coach.lastName}` : '';
    const el = app.querySelector('#thMeta');
    if (el) el.innerHTML = [...chips, coach].filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join('');
  };
  draw();
  if (!ros.ready) { const un = ros.subscribe(() => { if (ros.ready) { draw(); un(); } }); onLeave(un); }
}

// ------------------------------------------------------------------------------------------------ team tab
async function teamTab(body, team, lg) {
  paint(document.documentElement, team, 'acc');
  body.innerHTML = '<div class="loading">Loading team breakdown…</div>';
  const d = await teamData(lg, team);
  const r = d.ranks || {}, rk = r.rk || {}, n = d.n;
  const K = (label, v, key, gloss, fmt = f1) => kpi(label, v == null ? '–' : fmt(v), { rank: rk[key], n, gloss });
  const style = teamStyle(r, lg, n);
  if (d.bpi) {
    if (d.bpi.bpirank <= Math.ceil((lg === 'nba' ? 30 : 362) * 0.15)) style.push(`ESPN BPI rates them ${ordinal(d.bpi.bpirank)} overall (${signed(d.bpi.bpi)} points better than an average team on a neutral floor).`);
  }
  const done = d.events.filter(e => e.state === 'post');
  const upcoming = d.events.filter(e => e.state !== 'post');
  const facts = scheduleFacts(d.events, team, lg);

  body.innerHTML = `
  <div class="grid g-side">
    <div class="grid" style="align-content:start">
      <div class="card"><div class="row"><h3 class="h3" style="margin:0">Team stats</h3><span class="sp"></span><span class="small mut">${n ? `ranks among ${n} ${lg === 'nba' ? 'NBA' : 'D-I'} teams` : ''}</span></div>
        <div class="kpis" style="margin-top:8px">
          ${K('PPG', r.ppg, 'ppg')}${K('Opp PPG', r.oppg, 'oppg')}${K('RPG', r.rpg, 'rpg')}${K('APG', r.apg, 'apg')}${K('SPG', r.spg, 'spg')}${K('BPG', r.bpg, 'bpg')}
          ${K('TOV', r.tpg, 'tpg')}${K('FG%', r.fgp, 'fgp', null, pct)}${K('3P%', r.tpp, 'tpp', null, pct)}${K('FT%', r.ftp, 'ftp', null, pct)}${K('3PM', r.tpm, 'tpm')}${K('OREB', r.orpg, 'orpg')}
        </div></div>
      <div class="card"><h3 class="h3">Advanced stats</h3>
        <div class="kpis">
          ${K('ORtg', r.ortg, 'ortg', 'ortg')}${K('DRtg', r.drtg, 'drtg', 'drtg')}${K('Net Rtg', r.net, 'net', 'net', signed)}${K('Pace', r.pace, 'pace', 'pace')}
          ${K('eFG%', r.efg, 'efg', 'efg', pct)}${K('TS%', r.ts, 'ts', 'ts', pct)}${K('TOV%', r.tovPct, 'tovPct', 'tovPct')}${K('3PA rate', r.tpaRate, 'tpaRate', 'tpar', v => pct(v, 0))}
          ${K('FT rate', r.ftRate, 'ftRate', 'ftr', v => (v / 100).toFixed(2))}${K('AST ratio', r.astRatio, 'astRatio', null, v => pct(v, 0))}
          ${d.bpi ? kpi('BPI', signed(d.bpi.bpi), { rank: d.bpi.bpirank, n: Object.keys(d.bpiAll).length, gloss: 'bpi' }) + kpi('BPI Off', signed(d.bpi.bpioffense), { rank: d.bpi.bpioffenserank, n: Object.keys(d.bpiAll).length }) + kpi('BPI Def', signed(d.bpi.bpidefense), { rank: d.bpi.bpidefenserank, n: Object.keys(d.bpiAll).length }) : ''}
        </div>
        <div class="src">Ratings use the standard box-score possession estimate (FGA − OREB + TOV + 0.44×FTA). League ranks refresh every few hours; BPI is ESPN's.</div></div>
      <div class="card"><h3 class="h3">Play style</h3>${style.length ? `<ul class="notes">${style.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<div class="small mut">Not enough games yet for a style profile.</div>'}</div>
      <div class="card"><h3 class="h3">Outlook &amp; implications</h3><div id="outlook">${outlookHTML(d, lg, team)}</div></div>
      <div class="grid g2">
        <div class="card flush"><div class="card-h"><h3 class="h3">Recent games</h3><span class="small mut">${done.length ? `${done.filter(e => e.win).length}-${done.filter(e => !e.win).length}` : ''}</span></div>${gamesTable(done.slice(-10).reverse(), lg, true)}</div>
        <div class="card flush"><div class="card-h"><h3 class="h3">Upcoming schedule</h3></div>${gamesTable(upcoming.slice(0, 10), lg, false)}</div>
      </div>
      <div class="card" id="hist"><h3 class="h3">History &amp; recent success</h3><div class="loading"></div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3 class="h3">Interesting facts</h3>${facts.length ? `<ul class="notes">${facts.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<div class="small mut">Facts appear once games are played.</div>'}<div id="wikiFacts"></div></div>
      <div class="card" id="inj"><h3 class="h3">Injury report</h3><div class="loading"></div></div>
      <div class="card" id="rosterMini"><h3 class="h3">Roster</h3><div class="loading"></div></div>
      <div class="card"><h3 class="h3">Team news</h3>${newsList(d.news, { limit: 6 })}</div>
      <div class="card"><h3 class="h3">My team notes</h3><textarea class="mynotes" data-key="${lg}:team:${team.id}" placeholder="Storylines, pronunciations, stats to mention…">${esc(myNotes.get(`${lg}:team:${team.id}`))}</textarea></div>
    </div>
  </div>`;
  body.querySelector('textarea.mynotes').addEventListener('input', e => myNotes.set(e.target.dataset.key, e.target.value));
  // history + wiki
  (async () => {
    const [h, w] = await Promise.all([history(lg, team.id, d.year, 5), teamWiki(team, lg)]);
    const el = body.querySelector('#hist');
    if (!el) return;
    const cur = done.length ? `${done.filter(e => e.win).length}-${done.filter(e => !e.win).length}` : null;
    el.innerHTML = `<h3 class="h3">History &amp; recent success</h3>
      <div class="grid g2"><div><table class="minitable"><thead><tr><th>Season</th><th>Record</th>${h.some(x => x.conf) ? '<th>Conf</th>' : ''}</tr></thead><tbody>
      ${cur ? `<tr class="b"><td>${d.year - 1}-${String(d.year).slice(2)} (now)</td><td>${cur}</td>${h.some(x => x.conf) ? `<td>${esc(d.std?.conf || '')}</td>` : ''}</tr>` : ''}
      ${h.map(x => `<tr><td>${x.label}</td><td>${esc(x.rec)}</td>${h.some(y => y.conf) ? `<td>${esc(x.conf || '')}</td>` : ''}</tr>`).join('')}</tbody></table>
      ${trendNote(h, cur)}</div>
      <div>${w ? `<table class="minitable"><tbody>${w.facts.map(([k, v]) => `<tr><td class="mut">${esc(k)}</td><td style="white-space:normal;text-align:left">${esc(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="small mut">No Wikipedia article found.</div>'}</div></div>
      ${w?.extract ? `<p class="small" style="margin:10px 0 0">${esc(w.extract)} <a class="link" href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a></p>` : ''}`;
  })();
  // roster-driven cards
  const ros = roster(lg, team);
  const drawRoster = () => {
    const inj = body.querySelector('#inj'), mini = body.querySelector('#rosterMini');
    if (!inj || !ros.ready) return;
    const hurt = ros.players.filter(p => p.injury);
    inj.innerHTML = `<h3 class="h3">Injury report</h3>${hurt.length ? `<table class="minitable"><tbody>${hurt.map(p => `<tr><td>${esc(p.name)}</td><td class="inj" style="white-space:normal">${esc(p.injury)}</td></tr>`).join('')}</tbody></table>` : '<div class="small mut">No injuries listed.</div>'}<div class="src">Source: ESPN roster injury designations.</div>`;
    const list = ros.players.slice().sort((a, b) => (b.cur?.a?.avgMinutes || 0) - (a.cur?.a?.avgMinutes || 0));
    mini.innerHTML = `<div class="row"><h3 class="h3" style="margin:0">Roster</h3><span class="sp"></span><a class="link small" href="${location.hash.includes('/matchup/') ? location.hash.replace(/\/(a|b)$/, '/$1-players') : `#/${lg}/team/${team.id}?tab=players`}">Full player notes →</a></div>
      <div class="tscroll"><table class="minitable" style="margin-top:6px"><thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Ht</th><th>PTS</th><th>REB</th><th>AST</th><th>MIN</th></tr></thead><tbody>
      ${list.map(p => `<tr><td>${esc(p.jersey ?? '')}</td><td class="l"><a href="#/${lg}/player/${p.id}/${team.id}">${esc(p.name)}</a>${p.injShort ? ` <span class="inj tiny">${esc(p.injShort)}</span>` : ''}</td><td>${esc(p.pos || '')}</td><td>${esc(p.ht || '')}</td><td>${f1(p.cur?.a?.avgPoints)}</td><td>${f1(p.cur?.a?.avgRebounds)}</td><td>${f1(p.cur?.a?.avgAssists)}</td><td>${f1(p.cur?.a?.avgMinutes)}</td></tr>`).join('')}
      </tbody></table></div>${ros.coach ? `<div class="small mut" style="margin-top:6px">Head coach: <b>${esc(ros.coach.firstName)} ${esc(ros.coach.lastName)}</b>${ros.coach.experience ? ` (${ros.coach.experience} yrs)` : ''}</div>` : ''}`;
  };
  drawRoster();
  let tmr; const un = ros.subscribe(() => { clearTimeout(tmr); tmr = setTimeout(drawRoster, 400); });
  onLeave(un);
}

function trendNote(h, cur) {
  const recs = h.map(x => { const m = /(\d+)-(\d+)/.exec(x.rec || ''); return m ? +m[1] / (+m[1] + +m[2]) : null; }).filter(v => v != null);
  if (recs.length < 3) return '';
  const avg = recs.reduce((a, b) => a + b, 0) / recs.length;
  const last = recs[0];
  let t = `Averaged a ${(avg * 100).toFixed(0)}% win rate over the last ${recs.length} seasons.`;
  if (last - avg > 0.1) t += ' Last season was a step up.';
  if (avg - last > 0.1) t += ' Last season was a step back.';
  if (cur) { const m = /(\d+)-(\d+)/.exec(cur); if (m && +m[1] + +m[2] >= 5) { const c = +m[1] / (+m[1] + +m[2]); if (c - last > 0.12) t += ' This season is running well ahead of last year’s pace.'; if (last - c > 0.12) t += ' This season is behind last year’s pace.'; } }
  return `<div class="small mut" style="margin-top:6px">${t}</div>`;
}

function gamesTable(evs, lg, done) {
  if (!evs.length) return `<div class="empty small">${done ? 'No games played yet.' : 'No upcoming games on the schedule.'}</div>`;
  return `<div class="tscroll"><table class="t"><tbody>${evs.map(e => `<tr>
    <td class="l small">${esc(fmtDate(e.date, { month: 'short', day: 'numeric' }))}</td>
    <td class="l"><span class="tm"><span class="mut2 small" style="width:16px">${e.neutral ? 'N' : e.home ? 'vs' : '@'}</span><img src="${esc(e.oppLogo || '')}" alt="" loading="lazy">${e.oppRank ? `<span class="mut2 tiny">${e.oppRank}</span>` : ''}<a href="#/${lg}/team/${e.oppId}">${esc(e.opp || e.oppName)}</a></span></td>
    <td>${done ? `<a href="#/${lg}/game/${e.id}" class="${e.win ? 'good' : 'bad'} b">${e.win ? 'W' : 'L'} ${e.us}-${e.them}${e.ot ? ' OT' : ''}</a>` : e.state === 'in' ? `<a class="bad b" href="#/${lg}/game/${e.id}">LIVE</a>` : `<span class="small">${esc(fmtTime(e.date))}</span>`}</td>
    <td class="small mut" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(done ? (e.note || '') : [e.tv, e.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>`;
}

function outlookHTML(d, lg, team) {
  const b = d.bpi;
  const out = [];
  if (lg === 'nba') {
    if (b) {
      out.push(`<div class="kpis">${kpi('Proj. record', `${Math.round(b.projectedw)}-${Math.round(b.projectedl)}`)}${kpi('Playoffs', pct(b.probmakeplayoffs, 0))}${kpi('Play-in chance', pct(b.playinchance, 0))}${kpi('Win division', pct(b.probwindiv, 0))}${kpi('Reach conf. finals', pct(b.probmakeconfchamp, 0))}${kpi('Win title', pct(b.probwintitle, 1))}${b.projdraftslot ? kpi('Proj. draft slot', '#' + Math.round(b.projdraftslot)) : ''}${kpi('Remaining SOS', `${ordinal(b.sosremainingrank)}`, { sub: 'hardest = 1st' })}</div>`);
      out.push('<div class="src">Projections: ESPN BPI season simulations.</div>');
    }
    const cup = d.cup;
    if (cup?.groups) {
      for (const [g, rows] of Object.entries(cup.groups)) {
        const i = rows.findIndex(r => r.id === team.id);
        if (i < 0) continue;
        const r = rows[i];
        const done = rows.every(x => x.left === 0);
        out.push(`<div style="margin-top:10px"><b>NBA Cup, ${esc(g)}:</b> ${r.w}-${r.l} (${signed(r.diff, 0)} point diff), ${ordinal(i + 1)} in the group${r.left ? `, ${r.left} group game${r.left > 1 ? 's' : ''} left` : ''}. ${i === 0 && done ? 'Won the group and advanced to the knockout round.' : i === 0 ? 'Currently leads the group: the winner advances to the quarterfinals.' : 'Only the group winner and one wild card per conference advance; point differential is a tiebreaker.'} <a class="link" href="#/nba/league?tab=phase">Cup standings →</a></div>`);
      }
    }
  } else {
    const ap = d.polls?.find(p => /AP/.test(p.name));
    if (b) {
      out.push(`<div class="kpis">${b.projectedtournamentseed ? kpi('Proj. NCAA seed', b.projectedtournamentseed ? '#' + Math.round(b.projectedtournamentseed) : '–', { sub: b.tournamentregion ? 'ESPN BPI' : '' }) : kpi('Proj. NCAA seed', 'Out')}${kpi('Proj. record', `${Math.round(b.projtotalwins)}-${Math.round(b.projtotallosses)}`)}${kpi('Proj. conf', `${Math.round(b.projconfwins)}-${Math.round(b.projconflosses)}`)}${kpi('Win conf.', pct(b.chancewinconfortie, 0))}${kpi('Sweet 16', pct(b.chancesweet16, 0))}${kpi('Final Four', pct(b.chancefinal4, 1))}${kpi('Title', pct(b.chancencaachampion, 1))}${kpi('SOR', b.sorrank ? '#' + b.sorrank : '–', { gloss: 'sor' })}</div>`);
      if (b.top50bpiwins != null) out.push(`<div class="small" style="margin-top:6px">Wins vs BPI top 50: <b>${b.top50bpiwins}-${b.top50bpilosses}</b> · Strength of schedule so far: ${b.sospastrank ? ordinal(b.sospastrank) : '–'}</div>`);
    }
    if (d.net) out.push(`<div class="small" style="margin-top:8px"><b>NET${d.netCurrent ? '' : ' (last season final)'}: #${esc(d.net.Rank)}</b>${q('net_rank', 'cbb')} · Quad 1: ${esc(d.net['Quad 1'])} · Q2: ${esc(d.net['Quad 2'])} · Q3: ${esc(d.net['Quad 3'])} · Q4: ${esc(d.net['Quad 4'])}${d.netCurrent ? '' : ' <span class="mut">(the NCAA publishes this season\'s NET starting in early December)</span>'}</div>`);
    if (ap) out.push(`<div class="small" style="margin-top:6px">AP Poll: <b>#${ap.rank.current}</b>${ap.rank.previous ? ` (last week #${ap.rank.previous})` : ' (new this week)'}${ap.rank.points ? ` · ${ap.rank.points} pts` : ''}${ap.rank.firstPlaceVotes ? ` · ${ap.rank.firstPlaceVotes} first-place votes` : ''}</div>`);
    if (d.std) out.push(`<div class="small" style="margin-top:6px">${esc(d.std.confName)}: ${ordinal(d.std.confRank)} of ${d.std.confSize} (${esc(d.std.conf || '0-0')} in conference play)</div>`);
    out.push('<div class="src">Projections and tournament odds: ESPN BPI. NET: NCAA. Seeds are projections, not bracketology picks.</div>');
  }
  return out.join('') || '<div class="small mut">No projections available yet.</div>';
}

// ------------------------------------------------------------------------------------------------ players tab
function playersTab(body, team, lg) {
  paint(document.documentElement, team, 'acc');
  const ros = roster(lg, team);
  const sortKey = { v: 'min' };
  let collapsedAll = false;
  body.innerHTML = `<div class="roster-tools noprint"><div class="subtabs" id="sorts" style="margin:0">
      <button data-k="min" class="on">By minutes</button><button data-k="pts">By points</button><button data-k="num">By number</button><button data-k="name">By name</button></div>
      <span class="sp"></span><input id="pf" placeholder="Filter players" style="padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--txt)">
      <button class="btn sm" id="tog">Collapse all</button><span class="small mut" id="prog"></span></div>
    <div class="pcards" id="cards"><div class="loading">Loading roster…</div></div>`;
  const cards = body.querySelector('#cards');
  wireCards(cards);
  const order = () => {
    const ps = ros.players.slice();
    const k = sortKey.v;
    if (k === 'min') ps.sort((a, b) => (b.cur?.a?.avgMinutes || 0) - (a.cur?.a?.avgMinutes || 0));
    if (k === 'pts') ps.sort((a, b) => (b.cur?.a?.avgPoints || 0) - (a.cur?.a?.avgPoints || 0));
    if (k === 'num') ps.sort((a, b) => (+a.jersey || 0) - (+b.jersey || 0));
    if (k === 'name') ps.sort((a, b) => (a.last || a.name).localeCompare(b.last || b.name));
    return ps;
  };
  const full = () => {
    if (!ros.ready) return;
    const f = (body.querySelector('#pf').value || '').toLowerCase();
    cards.innerHTML = order().filter(p => !f || p.name.toLowerCase().includes(f)).map(p => cardHTML(p, lg, ros.players, { collapsed: collapsedAll })).join('') || '<div class="empty">No players.</div>';
    prog();
  };
  const prog = () => {
    const done = ros.players.filter(p => p.loaded.wiki).length;
    body.querySelector('#prog').textContent = ros.done ? `${ros.players.length} players` : `Loading details ${done}/${ros.players.length}…`;
  };
  const one = (p) => {
    const el = cards.querySelector(`.pc[data-pid="${p.id}"]`);
    if (!el) return;
    const ta = el.querySelector('textarea.mynotes');
    if (ta && document.activeElement === ta) return; // don't clobber typing
    const h = el.querySelector('.pc-h');
    h.querySelector('.line')?.remove();
    h.insertAdjacentHTML('beforeend', headerLine(p));
    const tagsEl = el.querySelector('.tags');
    const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(p, lg, ros.players);
    tagsEl.innerHTML = tmp.querySelector('.tags').innerHTML;
    el.querySelector('.bio').innerHTML = tmp.querySelector('.bio').innerHTML;
    if (!el.classList.contains('collapsed')) el.querySelector('.pc-b').innerHTML = bodyHTML(p, lg, ros.players);
    prog();
  };
  cards.addEventListener('expand', e => {
    const el = e.target.closest('.pc'); const p = ros.players.find(x => x.id === el.dataset.pid);
    if (p) el.querySelector('.pc-b').innerHTML = bodyHTML(p, lg, ros.players);
  });
  body.querySelector('#sorts').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sortKey.v = b.dataset.k; body.querySelectorAll('#sorts button').forEach(x => x.classList.toggle('on', x === b)); full();
  });
  body.querySelector('#pf').addEventListener('input', full);
  body.querySelector('#tog').addEventListener('click', e => {
    collapsedAll = !collapsedAll; e.target.textContent = collapsedAll ? 'Expand all' : 'Collapse all'; full();
  });
  let statsSeen = 0;
  const un = ros.subscribe((p) => {
    if (!p) { full(); return; }
    // re-sort once when all season stats are in
    const s = ros.players.filter(x => x.loaded.stats).length;
    if (s === ros.players.length && statsSeen < ros.players.length) { statsSeen = s; full(); return; }
    statsSeen = s;
    one(p);
  });
  onLeave(un);
  if (ros.ready) full();
}

// ------------------------------------------------------------------------------------------------ overview tab
async function overviewTab(body, A, B, lg) {
  body.innerHTML = '<div class="loading">Building matchup…</div>';
  const [da, db] = await Promise.all([teamData(lg, A), teamData(lg, B)]);
  const ra = da.ranks || {}, rb = db.ranks || {};
  const n = da.n || db.n;
  const rows = [
    ['Points per game', 'ppg', true, f1], ['Opp. points per game', 'oppg', false, f1], ['Offensive rating', 'ortg', true, f1, 'ortg'], ['Defensive rating', 'drtg', false, f1, 'drtg'],
    ['Net rating', 'net', true, signed, 'net'], ['Pace', 'pace', null, f1, 'pace'], ['eFG%', 'efg', true, pct, 'efg'], ['3P%', 'tpp', true, pct], ['3PA rate', 'tpaRate', null, v => pct(v, 0), 'tpar'],
    ['Rebounds', 'rpg', true, f1], ['Off. rebounds', 'orpg', true, f1], ['Assists', 'apg', true, f1], ['Turnover %', 'tovPct', false, f1, 'tovPct'], ['Steals', 'spg', true, f1], ['Blocks', 'bpg', true, f1], ['FT rate', 'ftRate', true, v => (v / 100).toFixed(2), 'ftr'],
  ];
  const cmp = rows.map(([label, k, hi, fmt, gl]) => {
    const va = ra[k], vb = rb[k];
    if (va == null && vb == null) return '';
    const max = Math.max(Math.abs(va || 0), Math.abs(vb || 0)) || 1;
    const wa = Math.abs(va || 0) / max * 100, wb = Math.abs(vb || 0) / max * 100;
    const ea = hi === null || va == null || vb == null ? false : hi ? va > vb : va < vb;
    const eb = hi === null || va == null || vb == null ? false : hi ? vb > va : vb < va;
    const rka = ra.rk?.[k], rkb = rb.rk?.[k];
    return `<div class="va"><span class="rk ${rankCls(rka, n)}">${rka ? ordinal(rka) : ''}</span><div class="bar"><span style="width:${wa}%"></span></div><span class="x ${ea ? 'edge' : ''}">${va == null ? '–' : fmt(va)}</span></div>
      <div class="lab">${esc(label)}${gl ? q(gl, lg) : ''}</div>
      <div class="vb"><span class="x ${eb ? 'edge' : ''}">${vb == null ? '–' : fmt(vb)}</span><div class="bar"><span style="width:${wb}%"></span></div><span class="rk ${rankCls(rkb, n)}">${rkb ? ordinal(rkb) : ''}</span></div>`;
  }).join('');

  // prediction from BPI (B is home unless the scheduled meeting is neutral)
  const next = da.events.find(e => e.oppId === B.id && e.state !== 'post');
  const neutral = next?.neutral;
  const hca = neutral ? 0 : (lg === 'nba' ? 2.2 : 3.2);
  let pred = '';
  if (da.bpi?.bpi != null && db.bpi?.bpi != null) {
    const margin = (db.bpi.bpi - da.bpi.bpi) + hca; // + favors B
    const sd = lg === 'nba' ? 12.5 : 10.5;
    const pB = 1 / (1 + Math.exp(-1.7 * margin / sd));
    const fav = margin >= 0 ? B : A;
    pred = `<div class="card"><h3 class="h3">Projection${q('bpi', lg)}</h3>
      <div class="row wrap" style="gap:18px"><div class="kpi" style="flex:1"><div class="k">Favorite</div><div class="v">${esc(fav.abbr)} by ${Math.abs(margin).toFixed(1)}</div><div class="r">${neutral ? 'neutral site' : `incl. ~${hca} pts home court for ${esc(B.abbr)}`}</div></div>
      <div class="kpi" style="flex:1"><div class="k">Win probability</div><div class="v">${esc(A.abbr)} ${Math.round((1 - pB) * 100)}% · ${esc(B.abbr)} ${Math.round(pB * 100)}%</div><div class="r">estimate from ESPN BPI ratings</div></div></div>
      <div class="src">Courtside estimate: BPI difference plus home-court edge, converted with a normal-ish curve. Not a betting line.</div></div>`;
  }
  // season series
  const meetings = da.events.filter(e => e.oppId === B.id);
  const series = meetings.length ? `<table class="t"><tbody>${meetings.map(e => `<tr><td class="l">${esc(fmtDate(e.date))}</td><td class="l">${e.home ? 'vs' : '@'} ${esc(B.abbr)}${e.note ? ` <span class="mut small">${esc(e.note)}</span>` : ''}</td><td>${e.state === 'post' ? `<a class="b ${e.win ? 'good' : 'bad'}" href="#/${lg}/game/${e.id}">${esc(A.abbr)} ${e.win ? 'W' : 'L'} ${e.us}-${e.them}</a>` : e.state === 'in' ? `<a class="bad b" href="#/${lg}/game/${e.id}">LIVE</a>` : `<a class="link" href="#/${lg}/game/${e.id}">${esc(fmtTime(e.date))}${e.tv ? ' · ' + esc(e.tv) : ''}</a>`}</td></tr>`).join('')}</tbody></table>` : '<div class="small mut">These teams do not meet this season (so far on the schedule).</div>';

  body.innerHTML = `
    <div class="grid g-side">
      <div class="grid" style="align-content:start">
        <div class="card"><div class="row" style="margin-bottom:10px"><h3 class="h3" style="margin:0">Head to head: season stats</h3><span class="sp"></span><span class="small mut">bold = edge · small = league rank${n ? ' of ' + n : ''}</span></div>
          <div class="cmp"><div class="va" style="justify-content:flex-end"><b>${esc(A.abbr)}</b></div><div></div><div class="vb"><b>${esc(B.abbr)}</b></div>${cmp}</div></div>
        <div class="card" id="keyp"><h3 class="h3">Players to watch</h3><div class="loading"></div></div>
        <div class="card" id="story"><h3 class="h3">Storylines</h3><div class="loading"></div></div>
      </div>
      <div class="grid" style="align-content:start">
        ${pred}
        <div class="card"><h3 class="h3">Season series</h3>${series}</div>
        <div class="card" id="injboth"><h3 class="h3">Injury report</h3><div class="loading"></div></div>
        <div class="card"><h3 class="h3">Style contrast</h3><div class="grid g2" style="gap:10px"><div><b>${esc(A.abbr)}</b><ul class="notes small">${teamStyle(ra, lg, n).slice(0, 4).map(s => `<li>${esc(s)}</li>`).join('') || '<li class="mut">No clear tendencies yet.</li>'}</ul></div><div><b>${esc(B.abbr)}</b><ul class="notes small">${teamStyle(rb, lg, n).slice(0, 4).map(s => `<li>${esc(s)}</li>`).join('') || '<li class="mut">No clear tendencies yet.</li>'}</ul></div></div></div>
      </div>
    </div>`;

  const rA = roster(lg, A), rB = roster(lg, B);
  const draw = () => {
    const keyp = body.querySelector('#keyp'), inj = body.querySelector('#injboth'), story = body.querySelector('#story');
    if (!keyp) return;
    const top = (ros) => ros.players.filter(p => p.cur?.a?.gamesPlayed).sort((x, y) => (y.cur.a.avgPoints + y.cur.a.avgRebounds * .5 + y.cur.a.avgAssists * .7) - (x.cur.a.avgPoints + x.cur.a.avgRebounds * .5 + x.cur.a.avgAssists * .7)).slice(0, 3);
    const pl = (p, team, side) => `<a class="row" href="${location.hash.replace(/\/[^/]+$/, '/' + side + '-players')}" style="padding:6px 0;border-bottom:1px solid var(--line2)"><img src="${esc(p.headshot || '')}" alt="" style="width:52px;height:38px;object-fit:cover;object-position:top;border-radius:6px;background:var(--chip)" onerror="this.style.visibility='hidden'"><div style="min-width:0"><div class="b">${esc(p.name)} <span class="mut small">#${esc(p.jersey ?? '')} ${esc(p.pos || '')}</span></div><div class="small mut">${f1(p.cur.a.avgPoints)} pts · ${f1(p.cur.a.avgRebounds)} reb · ${f1(p.cur.a.avgAssists)} ast${p.adv?.ts ? ` · ${f1(p.adv.ts)} TS%` : ''}</div><div class="small">${esc(playStyle(p, lg)[0] || '')}</div></div></a>`;
    keyp.innerHTML = `<h3 class="h3">Players to watch</h3><div class="grid g2" style="gap:12px"><div><div class="small b" style="color:var(--a-txt)">${esc(A.name)}</div>${rA.ready ? top(rA).map(p => pl(p, A, 'a')).join('') || '<div class="small mut">No stats yet.</div>' : '<div class="loading"></div>'}</div><div><div class="small b" style="color:var(--b-txt)">${esc(B.name)}</div>${rB.ready ? top(rB).map(p => pl(p, B, 'b')).join('') || '<div class="small mut">No stats yet.</div>' : '<div class="loading"></div>'}</div></div>`;
    const hurt = (ros, t) => ros.ready ? (ros.players.filter(p => p.injury).map(p => `<tr><td>${esc(t.abbr)}</td><td class="l">${esc(p.name)}</td><td class="inj" style="white-space:normal;text-align:left">${esc(p.injury)}</td></tr>`).join('')) : '';
    const rowsInj = hurt(rA, A) + hurt(rB, B);
    inj.innerHTML = `<h3 class="h3">Injury report</h3>${rowsInj ? `<table class="minitable"><tbody>${rowsInj}</tbody></table>` : (rA.ready && rB.ready ? '<div class="small mut">No injuries listed for either team.</div>' : '<div class="loading"></div>')}`;
    story.innerHTML = `<h3 class="h3">Storylines</h3><ul class="notes">${storylines(A, B, da, db, lg, rA, rB).map(s => `<li>${s}</li>`).join('')}</ul>`;
  };
  draw();
  let t; const u1 = rA.subscribe(() => { clearTimeout(t); t = setTimeout(draw, 500); }), u2 = rB.subscribe(() => { clearTimeout(t); t = setTimeout(draw, 500); });
  onLeave(u1); onLeave(u2);
}

function storylines(A, B, da, db, lg, rA, rB) {
  const s = [];
  const streak = (d, t) => { const st = d.std?.streak; if (st && /([WL])(\d+)/.test(st)) { const [, k, n] = /([WL])(\d+)/.exec(st); if (+n >= 3) s.push(`<b>${esc(t.short || t.name)}</b> ${k === 'W' ? 'have won' : 'have lost'} ${n} straight.`); } };
  streak(da, A); streak(db, B);
  if (lg === 'nba') {
    if (da.std && db.std) {
      s.push(`${esc(A.short)}: ${esc(da.std.overall || '')}, ${da.std.seed ? ordinal(da.std.seed) + ' in the ' + esc(da.std.conf) : ''}. ${esc(B.short)}: ${esc(db.std.overall || '')}, ${db.std.seed ? ordinal(db.std.seed) + ' in the ' + esc(db.std.conf) : ''}.`);
      if (da.std.conf === db.std.conf && da.std.seed && db.std.seed && Math.abs(da.std.seed - db.std.seed) <= 3) s.push('Direct conference standings implications: they are within three seeds of each other.');
    }
    if (da.power && db.power) s.push(`Courtside power rankings: ${esc(A.abbr)} #${da.power.rank}, ${esc(B.abbr)} #${db.power.rank}.`);
    const cup = da.cup;
    if (cup?.groups) for (const [g, rows] of Object.entries(cup.groups)) if (rows.some(r => r.id === A.id) && rows.some(r => r.id === B.id)) s.push(`NBA Cup: both teams are in <b>${esc(g)}</b>. A Cup group game here directly affects who advances to the knockout rounds (point differential matters).`);
  } else {
    const ap = d => d.polls?.find(p => /AP/.test(p.name))?.rank?.current;
    if (ap(da) || ap(db)) s.push(`${ap(da) ? `No. ${ap(da)} ` : 'Unranked '}${esc(A.short || A.name)} vs ${ap(db) ? `No. ${ap(db)} ` : 'unranked '}${esc(B.short || B.name)}.`);
    if (da.std && db.std && da.std.confName === db.std.confName) s.push(`Conference game in the ${esc(da.std.confName)}: ${esc(A.short)} is ${ordinal(da.std.confRank)} (${esc(da.std.conf || '0-0')}), ${esc(B.short)} is ${ordinal(db.std.confRank)} (${esc(db.std.conf || '0-0')}).`);
    const seed = d => d.bpi?.projectedtournamentseed;
    if (seed(da) || seed(db)) s.push(`March Madness: ESPN BPI projects ${esc(A.short)} ${seed(da) ? 'as a ' + Math.round(seed(da)) + ' seed' : 'outside the field'} and ${esc(B.short)} ${seed(db) ? 'as a ' + Math.round(seed(db)) + ' seed' : 'outside the field'}.`);
    const pros = [...(rA.players || []), ...(rB.players || [])].filter(p => p.mock || (p.board && p.board.pick <= 40));
    if (pros.length) s.push(`NBA scouts in the building: ${pros.map(p => `${esc(p.name)} (${p.mock ? 'mock #' + p.mock.pick : 'big board #' + p.board.pick})`).join(', ')}.`);
    const tr = [...(rA.players || []), ...(rB.players || [])].filter(p => (p.portal?.[0]?.from || p.transferFrom) && p.cur?.a?.gamesPlayed);
    if (tr.length) s.push(`Transfers to note: ${tr.slice(0, 8).map(p => `${esc(p.name)} (from ${esc(p.portal?.[0]?.from || p.transferFrom)})`).join(', ')}.`);
    const rec5 = [...(rA.players || []), ...(rB.players || [])].filter(p => p.recruit?.stars >= 5);
    if (rec5.length) s.push(`Former five-star recruits: ${rec5.map(p => `${esc(p.name)} (#${p.recruit.rank} in ${p.recruit.cls})`).join(', ')}.`);
  }
  const ra = da.ranks, rb = db.ranks;
  if (ra?.pace && rb?.pace && Math.abs(ra.rk.pace - rb.rk.pace) > (da.n * 0.5)) s.push(`Tempo clash: ${esc(ra.pace > rb.pace ? A.abbr : B.abbr)} wants to run (${f1(Math.max(ra.pace, rb.pace))} poss.), ${esc(ra.pace > rb.pace ? B.abbr : A.abbr)} plays slower (${f1(Math.min(ra.pace, rb.pace))}).`);
  if (ra?.ortg && rb?.drtg && ra.rk.ortg <= 5 && rb.rk.drtg <= 5) s.push(`Strength on strength: ${esc(A.abbr)}'s top-5 offense against ${esc(B.abbr)}'s top-5 defense.`);
  if (rb?.ortg && ra?.drtg && rb.rk.ortg <= 5 && ra.rk.drtg <= 5) s.push(`Strength on strength: ${esc(B.abbr)}'s top-5 offense against ${esc(A.abbr)}'s top-5 defense.`);
  const hot = [...(rA.players || []), ...(rB.players || [])].map(p => ({ p, f: factNotes(p, [], lg).find(x => /Heating up|20\+ in|Double-doubles in|Hot from deep/.test(x)) })).filter(x => x.f);
  for (const h of hot.slice(0, 4)) s.push(`${esc(h.p.name)}: ${esc(h.f)}`);
  const ms = [...(rA.players || []), ...(rB.players || [])].map(p => ({ p, f: factNotes(p, [], lg).find(x => /Milestone/.test(x)) })).filter(x => x.f);
  for (const h of ms.slice(0, 3)) s.push(`${esc(h.p.name)}: ${esc(h.f)}`);
  return s.length ? s : ['Storylines appear as team and player data loads.'];
}

// ------------------------------------------------------------------------------------------------ spotting board
function boardTab(body, A, B, lg) {
  const rA = roster(lg, A), rB = roster(lg, B);
  body.innerHTML = `<div class="row noprint" style="margin-bottom:10px"><span class="small mut">One-page spotting board for the booth. Prints in landscape. Your own notes are included.</span><span class="sp"></span><button class="btn pri" onclick="window.print()">🖨 Print</button></div><div class="board" id="board"><div class="loading"></div></div>`;
  const draw = async () => {
    const [da, db] = await Promise.all([teamData(lg, A), teamData(lg, B)]);
    const side = (t, d, ros, cls) => {
      const players = ros.players.slice().sort((x, y) => (+x.jersey || 0) - (+y.jersey || 0));
      const std = d.std;
      const head = lg === 'nba' ? [std?.overall, std?.seed ? ordinal(std.seed) + ' ' + std.confAbbr : '', std?.streak, d.power ? 'PR #' + d.power.rank : ''] : [std?.overall, std ? `${std.conf} ${shortConf(std.confName)}` : '', d.polls?.find(p => /AP/.test(p.name)) ? 'AP #' + d.polls.find(p => /AP/.test(p.name)).rank.current : '', d.bpi?.bpirank ? 'BPI #' + d.bpi.bpirank : ''];
      const r = d.ranks;
      return `<div class="bt ${cls}"><div class="bh"><img src="${esc(t.logo)}" alt="">${esc(t.name)}<span class="sp"></span><span style="font-size:14px">${esc(head.filter(Boolean).join(' · '))}</span></div>
        <div class="tn">${ros.coach ? `<b>Coach:</b> ${esc(ros.coach.firstName)} ${esc(ros.coach.lastName)} · ` : ''}${r ? `${f1(r.ppg)} PPG (${ordinal(r.rk.ppg)}) · ${f1(r.oppg)} allowed (${ordinal(r.rk.oppg)}) · ORtg ${f1(r.ortg)} · DRtg ${f1(r.drtg)} · Pace ${f1(r.pace)}` : ''}<br>${esc(teamStyle(r, lg, d.n).slice(0, 2).join(' '))}${myNotes.get(`${lg}:team:${t.id}`) ? `<br><b>My notes:</b> ${esc(myNotes.get(`${lg}:team:${t.id}`))}` : ''}</div>
        ${players.map(p => {
          const a = p.cur?.a;
          const line = a ? `${f1(a.avgPoints)}p ${f1(a.avgRebounds)}r ${f1(a.avgAssists)}a · ${f1(a.fieldGoalPct)} FG · ${f1(a.threePointFieldGoalPct ?? a.threePointPct)} 3P · ${f1(a.avgMinutes)} min` : 'No stats this season';
          const bits = [p.posName || p.pos, p.ht, lg === 'cbb' ? p.exp : (p.expStr || p.exp), p.recruit?.hs || p.wiki?.hs || '', lg === 'nba' ? (p.college || '') : (p.birthPlace || '')].filter(Boolean);
          const note = [roleNotes(p, ros.players, lg)[0], playStyle(p, lg)[1] || playStyle(p, lg)[0], factNotes(p, ros.players, lg, { wiki: p.wiki })[0]].filter(Boolean).slice(0, 2).join(' ');
          const extra = [p.injury ? `⚕ ${p.injury}` : '', p.recruit?.stars ? `${stars(p.recruit.stars)} #${p.recruit.rank || '–'} (${p.recruit.cls})` : '', (p.portal?.[0]?.from || p.transferFrom) ? `Transfer: ${p.portal?.[0]?.from || p.transferFrom}` : '', p.mock ? `Mock #${p.mock.pick}` : ''].filter(Boolean).join(' · ');
          const my = myNotes.get(`${lg}:${p.id}`);
          return `<div class="pl"><div class="n">${esc(p.jersey ?? '')}</div><div><div class="nm">${esc(p.name)} <span class="mut" style="font-weight:500">${esc(bits.join(' · '))}</span></div><div class="ln">${esc(line)}${extra ? ' · ' + esc(extra) : ''}</div></div><div class="nt">${esc(note)}${my ? ` <b>✎ ${esc(my)}</b>` : ''}</div></div>`;
        }).join('')}</div>`;
    };
    const el = body.querySelector('#board');
    if (!el) return;
    el.innerHTML = side(A, da, rA, 'a') + side(B, db, rB, 'b');
    if (!(rA.done && rB.done)) el.insertAdjacentHTML('beforebegin', '');
  };
  draw();
  let t; const re = () => { clearTimeout(t); t = setTimeout(draw, 800); };
  const u1 = rA.subscribe(re), u2 = rB.subscribe(re); onLeave(u1); onLeave(u2);
  void GLOSSARY; void num; void espn; void safe; void seasonYear;
}
