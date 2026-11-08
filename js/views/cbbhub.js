// College hub: polls & rankings, conferences, March Madness projections, transfer portal, draft prospects.
import { esc, f1, pct, ordinal, signed, logoFor, stars, ymd, fmtDate } from '../util.js?v=f76d549b88';
import { espn, repo, safe } from '../api.js?v=f76d549b88';
import { state, teams, seasonYear } from '../ctx.js?v=f76d549b88';
import { newsList, teamCell, q, sortable } from './common.js?v=f76d549b88';
import { draftView } from './nbahub.js?v=f76d549b88';
import { netFor, netIsCurrent } from '../teamdata.js?v=f76d549b88';
import { L, draftLeague } from '../league.js?v=f76d549b88';

let T, CL = 'cbb';
export async function render(app, view, params, lg = 'cbb') {
  CL = lg;
  T = await teams(CL);
  if (view === 'conferences') return conferences(app, params);
  if (view === 'madness') return madness(app, params);
  if (view === 'portal') return portal(app, params);
  if (view === 'draft') return draftView(app, CL, params);
  return league(app, params);
}

async function league(app, params) {
  const tab = params.get('tab') || 'polls';
  const tabs = [['polls', 'AP & Coaches polls'], ['bpi', 'ESPN BPI'], ['net', 'NET rankings'], ['leaders', 'National leaders'], ['news', 'News']];
  app.innerHTML = `<h1 class="h1">${L(CL).name} rankings &amp; news</h1><div class="tabs">${tabs.map(([k, l]) => `<a href="#/${CL}/league?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="lb"><div class="loading"></div></div>`;
  const el = app.querySelector('#lb');
  if (tab === 'polls') {
    const rk = await safe(espn.rankings(CL), null);
    el.innerHTML = `<div class="grid g2">${(rk?.rankings || []).slice(0, 2).map(p => `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(p.name)}</h3><span class="small mut">${esc(p.headline || p.shortHeadline || '')}</span></div><table class="t"><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Pts</th><th>Prev</th></tr></thead><tbody>
      ${(p.ranks || []).map(r => { const t = T.byId[r.team.id] || { id: r.team.id, name: r.team.location, short: r.team.location, logo: r.team.logos?.[0]?.href }; const mv = r.previous ? r.previous - r.current : null; return `<tr><td class="l b">${r.current}</td><td class="l">${teamCell(t, CL)}${r.firstPlaceVotes ? ` <span class="tiny mut">(${r.firstPlaceVotes})</span>` : ''}</td><td>${esc(r.recordSummary || '')}</td><td>${r.points ?? ''}</td><td class="${mv > 0 ? 'good' : mv < 0 ? 'bad' : 'mut2'}">${r.previous ? r.previous : 'NR'}</td></tr>`; }).join('')}
      </tbody></table>${(p.others || []).length ? `<div class="small mut" style="padding:8px 12px">Others receiving votes: ${(p.others || []).map(o => `${esc(o.team.location)} ${o.points}`).join(', ')}</div>` : ''}</div>`).join('')}</div>`;
  } else if (tab === 'bpi') {
    const b = await safe(repo(`${CL}/bpi.json`), null);
    const rows = Object.entries(b?.teams || {}).sort((x, y) => (x[1].bpirank || 999) - (y[1].bpirank || 999)).slice(0, 100);
    el.innerHTML = `<div class="card flush"><div class="tscroll"><table class="t" id="bt"><thead><tr><th data-k="r">BPI rk</th><th>Team</th><th>Conf</th><th data-k="w">W-L</th><th data-k="b">BPI${q('bpi', CL)}</th><th>Off</th><th>Def</th><th data-k="sor">SOR${q('sor', CL)}</th><th>Proj seed</th><th>Sweet 16</th><th>Final Four</th><th>Title</th></tr></thead><tbody>
      ${rows.map(([id, s]) => `<tr data-r="${s.bpirank}" data-b="${s.bpi}" data-sor="${s.sorrank || 999}" data-w="${s.wins}"><td class="l b">${s.bpirank}</td><td class="l">${teamCell(T.byId[id], CL)}</td><td class="small mut">${esc(T.byId[id]?.confAbbr || '')}</td><td>${s.wins}-${s.losses}</td><td class="b">${signed(s.bpi)}</td><td>${signed(s.bpioffense)}</td><td>${signed(s.bpidefense)}</td><td>${s.sorrank || '–'}</td><td>${s.projectedtournamentseed ? Math.round(s.projectedtournamentseed) : '–'}</td><td>${pct(s.chancesweet16, 0)}</td><td>${pct(s.chancefinal4, 1)}</td><td>${pct(s.chancencaachampion, 1)}</td></tr>`).join('')}</tbody></table></div></div><div class="src">ESPN Basketball Power Index${rows.length < 50 ? ` (ESPN publishes only its top ${rows.length} for ${esc(L(CL).full)})` : ', top 100'}. Click a column header to sort.</div>`;
    sortable(el.querySelector('#bt'));
  } else if (tab === 'net') {
    const [n, year] = await Promise.all([safe(repo(`${CL}/net.json`), null), seasonYear(CL)]);
    const cur = netIsCurrent(n, year);
    const byNet = {};
    for (const t of T.list) { const r = netFor(t, n); if (r) byNet[r.Rank] = t; }
    el.innerHTML = `${cur ? '' : `<div class="card" style="margin-bottom:12px"><div class="small"><b>Showing last season's final NET (${esc(n?.updated || '')}).</b> The NCAA usually releases the first NET of a new season in early December. This page switches over on its own when it does.</div></div>`}
      <div class="card flush"><div class="tscroll"><table class="t"><thead><tr><th>NET</th><th>Team</th><th>Record</th><th>Conf</th><th>Road</th><th>Neutral</th><th>Home</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Prev</th></tr></thead><tbody>
      ${(n?.rows || []).slice(0, 150).map(r => `<tr><td class="l b">${esc(r.Rank)}</td><td class="l">${byNet[r.Rank] ? teamCell(byNet[r.Rank], CL) : esc(r.School)}</td><td>${esc(r.Record)}</td><td class="small mut">${esc(r.Conf)}</td><td>${esc(r.Road)}</td><td>${esc(r.Neutral)}</td><td>${esc(r.Home)}</td><td class="b">${esc(r['Quad 1'])}</td><td>${esc(r['Quad 2'])}</td><td>${esc(r['Quad 3'])}</td><td>${esc(r['Quad 4'])}</td><td>${esc(r.Prev)}</td></tr>`).join('')}</tbody></table></div></div><div class="src">NCAA Evaluation Tool via ncaa.com. ${q('net_rank', CL)}</div>`;
  } else if (tab === 'leaders') {
    const year = await seasonYear(CL);
    const L = await safe(espn.leaders(CL, year), null);
    const cats = L?.leaders?.categories || [];
    el.innerHTML = cats.length ? `<div class="grid g3">${cats.slice(0, 12).map(c => `<div class="card flush"><div class="card-h"><h3 class="h3">${esc(c.displayName || c.name)}</h3></div><table class="t"><tbody>${(c.leaders || []).slice(0, 10).map((l, i) => { const tm = l.team || l.athlete?.team || {}; const t = T.byId[tm.id]; return `<tr><td class="l" style="width:20px">${i + 1}</td><td class="l"><span class="tm">${t ? `<img src="${esc(logoFor(t, state.theme))}" alt="">` : ''}${esc(l.athlete?.displayName || '')}</span></td><td class="b">${esc(l.displayValue)}</td></tr>`; }).join('')}</tbody></table></div>`).join('')}</div><div class="src">ESPN national statistical leaders. Every player's national rank is also on his card in the matchup view.</div>` : '<div class="empty">National leaders are not available right now. Each player\'s national ranks are on his player card.</div>';
  } else {
    const n = await safe(espn.news(CL, null, 30), null);
    el.innerHTML = `<div class="card">${newsList(n?.articles, { limit: 25 })}</div>`;
  }
}

async function conferences(app, params) {
  const [st, b, confs] = await Promise.all([safe(repo(`${CL}/standings.json`), null), safe(repo(`${CL}/bpi.json`), null), safe(repo(`${CL}/conferences.json`), null)]);
  const names = Object.keys(st || {}).sort();
  const sel = params.get('c') || names.find(n => /Big Ten/.test(n)) || names[0];
  const rows = (st?.[sel] || []);
  const B = b?.teams || {};
  // conference strength: average BPI
  const strength = names.map(n => { const v = (st[n] || []).map(r => B[r.id]?.bpi).filter(x => x != null); return { n, avg: v.length ? v.reduce((a, c) => a + c, 0) / v.length : -99 }; }).sort((a, c) => c.avg - a.avg);
  app.innerHTML = `<div class="row wrap"><h1 class="h1">Conferences</h1><span class="sp"></span><select id="cs" style="padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--txt)">${names.map(n => `<option ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="grid g-side" style="margin-top:14px">
      <div class="card flush"><div class="card-h"><h3 class="h3">${esc(sel)} standings</h3><span class="small mut">${ordinal(strength.findIndex(s => s.n === sel) + 1)} of ${names.length} conferences by average BPI</span></div><div class="tscroll"><table class="t"><thead><tr><th>#</th><th>Team</th><th>Conf</th><th>Overall</th><th>Home</th><th>Road</th><th>Strk</th><th>BPI rk</th><th>Win conf.</th><th>Proj seed</th></tr></thead><tbody>
        ${rows.map(r => { const s = B[r.id] || {}; return `<tr><td class="l">${r.confRank}</td><td class="l">${teamCell(T.byId[r.id], CL)}</td><td class="b">${esc(r.conf || '0-0')}</td><td>${esc(r.overall || '')}</td><td>${esc(r.home || '')}</td><td>${esc(r.road || '')}</td><td>${esc(r.streak || '')}</td><td>${s.bpirank || '–'}</td><td>${s.chancewinconfortie != null ? pct(s.chancewinconfortie, 0) : '–'}</td><td>${s.projectedtournamentseed ? Math.round(s.projectedtournamentseed) : '–'}</td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="card flush"><div class="card-h"><h3 class="h3">Conference power (avg BPI)</h3></div><table class="t"><tbody>${strength.slice(0, 32).map((s, i) => `<tr class="${s.n === sel ? 'hl' : ''}"><td class="l">${i + 1}</td><td class="l"><a href="#/${CL}/conferences?c=${encodeURIComponent(s.n)}">${esc(s.n.replace(/ Conference$/, ''))}</a></td><td>${s.avg > -99 ? signed(s.avg) : '–'}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  app.querySelector('#cs').addEventListener('change', e => { location.hash = `#/${CL}/conferences?c=${encodeURIComponent(e.target.value)}`; });
  void confs;
}

async function madness(app) {
  const [b, year, n, ts] = await Promise.all([safe(repo(`${CL}/bpi.json`), null), seasonYear(CL), safe(espn.news(CL, null, 50), null), safe(repo(`${CL}/teamstats.json`), null)]);
  let B = b?.teams || {};
  let basis = 'ESPN BPI';
  if (Object.keys(B).length < 100 && ts?.teams) {
    // ESPN doesn't publish a full index for this league: rank every team by net rating instead (keep BPI odds where they exist)
    basis = 'net rating';
    const rows = Object.entries(ts.teams).filter(([, t]) => t.net != null && t.gp >= 1).sort((x, y) => y[1].net - x[1].net);
    const nb = {};
    rows.forEach(([id, t], i) => { const st = B[id] || {}; nb[id] = { ...st, bpirank: i + 1, wins: st.wins ?? null, losses: st.losses ?? null, _net: t.net }; });
    B = nb;
  }
  let field = Object.entries(B).filter(([, s]) => s.projectedtournamentseed).sort((x, y) => (x[1].projectedtournamentorder || x[1].projectedtournamentseed * 4) - (y[1].projectedtournamentorder || y[1].projectedtournamentseed * 4));
  let own = false;
  if (field.length < 40) {
    // ESPN hasn't published seed projections yet: build a 68-team field from BPI (best BPI team in each conference = automatic bid)
    own = true;
    const ranked = Object.entries(B).filter(([, s]) => s.bpirank).sort((x, y) => x[1].bpirank - y[1].bpirank);
    const auto = new Map();
    for (const [id, s] of ranked) { const c = T.byId[id]?.conf; if (c && !auto.has(c)) auto.set(c, id); }
    const autoIds = new Set(auto.values());
    const atLarge = ranked.filter(([id]) => !autoIds.has(id)).slice(0, 68 - autoIds.size);
    const inField = new Set([...autoIds, ...atLarge.map(([id]) => id)]);
    const order = ranked.filter(([id]) => inField.has(id));
    // seed lines of 4, with the extra 4 teams as First Four on the 11 and 16 lines
    const counts = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 4, 4, 4, 4, 6];
    let i = 0;
    field = [];
    counts.forEach((n, k) => { for (let j = 0; j < n && i < order.length; j++, i++) field.push([order[i][0], { ...order[i][1], projectedtournamentseed: k + 1, auto: autoIds.has(order[i][0]) }]); });
  }
  const bySeed = {};
  for (const [id, s] of field) (bySeed[Math.round(s.projectedtournamentseed)] = bySeed[Math.round(s.projectedtournamentseed)] || []).push([id, s]);
  // bubble: last seeds in + best teams out
  const fieldIds = new Set(field.map(([id]) => id));
  const out = Object.entries(B).filter(([id]) => !fieldIds.has(id)).sort((x, y) => (x[1].bpirank || 999) - (y[1].bpirank || 999)).slice(0, 8);
  // live tournament bracket (mid-March to early April)
  const now = new Date();
  const tourney = now.getMonth() === 2 && now.getDate() >= 14 || (now.getMonth() === 3 && now.getDate() <= 8);
  let bracket = '';
  if (tourney) {
    const sb = await safe(espn.scoreboardRange(CL, `${year}0317-${year}0408`, '&groups=100'), null);
    const evs = sb?.events || [];
    if (evs.length) {
      const rounds = {};
      for (const e of evs) { const r = (e.competitions[0].notes || [])[0]?.headline?.replace(/^.*? - /, '') || 'Tournament'; (rounds[r] = rounds[r] || []).push(e); }
      bracket = `<div class="card" style="margin-bottom:14px"><h3 class="h3">NCAA Tournament: live results</h3>${Object.entries(rounds).map(([r, es]) => `<div style="margin-bottom:10px"><div class="small b">${esc(r)}</div><div class="games">${es.map(e => { const c = e.competitions[0]; return `<a class="gc" href="#/${CL}/game/${e.id}">${c.competitors.map(x => `<div class="tr ${e.status.type.completed && !x.winner ? 'lose' : ''}"><span class="mut2 small">${x.curatedRank?.current && x.curatedRank.current < 99 ? x.curatedRank.current : ''}</span><img src="${esc(x.team.logo)}" alt=""><span class="nm">${esc(x.team.shortDisplayName)}</span><span class="sc">${esc(x.score ?? '')}</span></div>`).join('')}<div class="ft">${esc(e.status.type.shortDetail)}</div></a>`; }).join('')}</div></div>`).join('')}</div>`;
    }
  }
  const madNews = (n?.articles || []).filter(a => /bracket|tournament|March Madness|seed|bubble|NCAA/i.test(`${a.headline} ${a.description}`));
  app.innerHTML = `<div class="row wrap"><h1 class="h1">March Madness ${year}</h1><span class="sp"></span><span class="small mut">Selection Sunday is mid-March; projections update every 2 hours</span></div>
    ${bracket}
    <div class="grid g-side" style="margin-top:12px">
      <div class="card flush"><div class="card-h"><h3 class="h3">Projected field by seed (${own ? `Courtside projection from ${basis}` : 'ESPN BPI'})</h3><span class="small mut">${field.length} teams</span></div><div class="tscroll"><table class="t"><thead><tr><th>Seed</th><th>Teams</th></tr></thead><tbody>
        ${Object.keys(bySeed).sort((a, c) => a - c).map(sd => `<tr><td class="l b" style="width:46px">${sd}</td><td class="l" style="white-space:normal"><div class="row wrap" style="gap:12px">${bySeed[sd].map(([id, s]) => `<span class="row" style="gap:6px">${teamCell(T.byId[id], CL)}<span class="tiny mut">${s.wins != null ? `${s.wins}-${s.losses}` : (s._net != null ? signed(s._net) + ' net' : '')}${s.auto ? ' · auto' : ''}</span></span>`).join('')}</div></td></tr>`).join('') || '<tr><td class="empty">Projections appear once ESPN starts publishing tournament odds.</td></tr>'}
      </tbody></table></div></div>
      <div class="grid" style="align-content:start">
        <div class="card flush"><div class="card-h"><h3 class="h3">Best teams projected out</h3></div><table class="t"><tbody>${out.map(([id, s]) => `<tr><td class="l">${teamCell(T.byId[id], CL)}</td><td>${s.wins != null ? `${s.wins}-${s.losses}` : ''}</td><td class="small mut">${basis === 'ESPN BPI' ? 'BPI' : 'Net rtg'} #${s.bpirank}</td></tr>`).join('')}</tbody></table></div>
        <div class="card flush"><div class="card-h"><h3 class="h3">Title favorites</h3></div><table class="t"><thead><tr><th>Team</th><th>F4</th><th>Title</th></tr></thead><tbody>${Object.entries(B).sort((x, y) => (y[1].chancencaachampion || 0) - (x[1].chancencaachampion || 0)).slice(0, 12).map(([id, s]) => `<tr><td class="l">${teamCell(T.byId[id], CL)}</td><td>${pct(s.chancefinal4, 1)}</td><td class="b">${pct(s.chancencaachampion, 1)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h3 class="h3">Bracket &amp; bubble news</h3>${newsList(madNews.length ? madNews : n?.articles, { limit: 6 })}</div>
      </div>
    </div>
    <div class="src">${own ? `ESPN has not published seed projections${basis === 'net rating' ? ` (and has no full power index for ${L(CL).full})` : ' yet this season'}, so this field is built from ${basis === 'net rating' ? 'each team\'s net rating (points per 100 possessions, not adjusted for schedule, so it\'s noisy early in the season)' : 'BPI rankings'}: the top-rated team in each conference takes the automatic bid ("auto"), the best remaining teams fill the 68 at-large spots, and seeds follow the S-curve. It switches to ESPN\'s own projections once they appear.` : 'Seeds and odds are ESPN BPI projections (automatic bids included), not the committee\'s bracket.'} The NCAA's NET ranking is the committee's main sorting tool: see Rankings → NET.</div>`;
  void ymd; void fmtDate; void f1;
}

async function portal(app, params) {
  const [p, n] = await Promise.all([safe(repo(`${CL}/portal.json`), null), safe(espn.news(CL, null, 50), null)]);
  if (!p?.players || !Object.keys(p.players).length) {
    app.innerHTML = `<h1 class="h1">Transfer portal</h1><div class="card" style="margin-top:12px"><div class="small">No free transfer-portal feed is available for ${esc(L(CL).full)} right now. Every player's school path and "Transfer from" tag are still on their cards (from ESPN season data), and portal news is below.</div></div><div class="card" style="margin-top:12px">${newsList(((n?.articles) || []).filter(a => /transfer|portal/i.test(`${a.headline} ${a.description}`)).concat(n?.articles || []), { limit: 12 })}</div>`;
    return;
  }
  const rows = Object.values(p?.players || {}).flat().sort((a, b) => (b.year - a.year) || ((a.rank || 9999) - (b.rank || 9999)));
  const years = [...new Set(rows.map(r => r.year))].sort((a, b) => b - a);
  const yr = +(params.get('y') || years[0] || 0);
  const pn = (n?.articles || []).filter(a => /transfer|portal/i.test(`${a.headline} ${a.description}`));
  app.innerHTML = `<div class="row wrap"><h1 class="h1">Transfer portal: top moves</h1><span class="sp"></span>${years.map(y => `<a class="chip ${y === yr ? 'acc' : ''}" href="#/${CL}/portal?y=${y}">${y}</a>`).join(' ')}</div>
    <div class="grid g-side" style="margin-top:12px">
      <div class="card flush"><div class="card-h"><input id="pf" placeholder="Filter by player or school" style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--txt)"><span class="small mut" id="pc"></span></div>
        <div class="tscroll" style="max-height:900px"><table class="t" id="pt"><thead><tr><th data-k="rank">Rank</th><th data-k="name">Player</th><th>Pos</th><th>From</th><th>To</th><th data-k="stars">★</th><th>Status</th><th>HS / hometown</th></tr></thead><tbody></tbody></table></div></div>
      <div class="card"><h3 class="h3">Portal news</h3>${newsList(pn.length ? pn : n?.articles, { limit: 10 })}</div>
    </div><div class="src">Source: On3 Transfer Portal's top-rated entries (about 50 per portal year), refreshed twice a day. For every D-I player, his full school path and "Transfer from" tag are on his card in the matchup view (from ESPN season data).</div>`;
  const tb = app.querySelector('#pt tbody');
  const draw = () => {
    const f = app.querySelector('#pf').value.toLowerCase();
    const list = rows.filter(r => r.year === yr && (!f || [r.name, r.from, r.to].some(s => (s || '').toLowerCase().includes(f))));
    app.querySelector('#pc').textContent = `${list.length} players`;
    tb.innerHTML = list.slice(0, 600).map(r => `<tr data-rank="${r.rank || 9999}" data-name="${esc(r.name)}" data-stars="${r.stars || 0}"><td class="l">${r.rank || '–'}</td><td class="l b">${esc(r.name)}</td><td>${esc(r.pos || '')}</td><td class="l">${esc(r.from || '')}</td><td class="l">${r.to ? `<b>${esc(r.to)}</b>` : '<span class="mut">—</span>'}</td><td class="warn">${stars(r.stars)}</td><td class="small">${esc(r.status || '')}</td><td class="l small mut">${esc([r.hs, r.hometown].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No portal entries.</td></tr>';
  };
  app.querySelector('#pf').addEventListener('input', draw);
  sortable(app.querySelector('#pt'));
  draw();
}
