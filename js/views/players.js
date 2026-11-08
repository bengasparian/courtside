// Player notes: load every player on a roster (progressively) and render full commentator cards.
import { L, isPro, isCollege, draftLeague } from '../league.js?v=fb64bb9f50';
import { esc, f1, pct, ordinal, num, stars, normName, logoFor } from '../util.js?v=fb64bb9f50';
import { espn, repo, safe } from '../api.js?v=fb64bb9f50';
import { state, myNotes, teams, seasonYear, paint, sayName } from '../ctx.js?v=fb64bb9f50';
import { parseAthleteStats, currentSeason, advanced, playStyle, roleNotes, factNotes, parseGamelog, wikiPlayer, teamTotals, tsTier, usgTier, GLOSSARY } from '../notes.js?v=fb64bb9f50';
import { q } from './common.js?v=fb64bb9f50';

window.__csPlayers = window.__csPlayers || [];

let extrasCache = {};
async function extras(lg) {
  if (extrasCache[lg]) return extrasCache[lg];
  const [draft, recruits, portal, leaders] = await Promise.all([
    safe(repo(draftLeague(lg) === 'nba' ? 'draft.json' : 'wnba/draft.json', 3600), null),
    isCollege(lg) ? safe(repo(`${lg}/recruits.json`, 3600), null) : null,
    isCollege(lg) ? safe(repo(`${lg}/portal.json`, 3600), null) : null,
    isPro(lg) ? safe(repo(`${lg}/leaders.json`, 1800), null) : null,
  ]);
  const mock = {}, board = {};
  for (const r of draft?.mock || []) mock[normName(r.name)] = r;
  for (const r of draft?.board || []) board[normName(r.name)] = r;
  extrasCache[lg] = { mock, board, recruits: recruits?.players || {}, portal: portal?.players || {}, per: leaders?.per || {}, draftSrc: draft?.source };
  return extrasCache[lg];
}

function fromRoster(a, team, lg) {
  const inj = (a.injuries || [])[0];
  return {
    id: a.id, lg, teamId: team.id, team: team.abbr, name: a.displayName || a.fullName, first: a.firstName, last: a.lastName,
    jersey: a.jersey, pos: a.position?.abbreviation, posName: a.position?.displayName, ht: a.displayHeight, htIn: num(a.height),
    wt: a.displayWeight, age: a.age, dob: a.dateOfBirth, birthPlace: a.birthPlace ? [a.birthPlace.city, a.birthPlace.state, a.birthPlace.country !== 'USA' ? a.birthPlace.country : ''].filter(Boolean).join(', ') : '',
    birthCountry: a.birthCountry?.abbreviation || a.birthPlace?.country, exp: a.experience?.displayValue || (a.experience?.years != null ? (a.experience.years === 0 ? 'Rookie' : `${a.experience.years} yrs`) : ''),
    expYears: a.experience?.years, college: a.college?.name || a.college?.shortName, headshot: a.headshot?.href,
    injury: inj ? `${inj.status || ''}${inj.details?.type ? ': ' + inj.details.type : ''}${inj.details?.returnDate ? ` (est. return ${new Date(inj.details.returnDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : ''}`.trim() : '',
    injShort: inj?.status || '', status: a.status?.name,
    contract: (a.contracts || []).sort((x, y) => (y.season?.year || 0) - (x.season?.year || 0))[0] || null,
    contracts: a.contracts || [],
    loaded: { stats: false, ov: false, ath: false, gl: false, wiki: false },
  };
}

/** Load roster + all per-player details. onUpdate(player) fires as each piece arrives. */
export async function loadRoster(lg, team, { onUpdate, onRoster } = {}) {
  const [ros, tsJs, year, X] = await Promise.all([espn.roster(lg, team.id), safe(espn.teamStats(lg, team.id), null), seasonYear(lg), extras(lg)]);
  const tm = teamTotals(tsJs, L(lg).mins);
  const players = (ros.athletes || []).flatMap(g => (g.items ? g.items : [g])).map(a => fromRoster(a, team, lg));
  const coach = (ros.coach || [])[0];
  players.forEach(p => {
    window.__csPlayers = window.__csPlayers.filter(x => x.id !== p.id);
    window.__csPlayers.push({ id: p.id, name: p.name, team: team.abbr, teamId: team.id, lg, headshot: p.headshot });
  });
  onRoster?.(players, coach, tm);
  const ctx = { lg, team, year, tm, X, players };
  const tasks = players.map(p => enrich(p, ctx, onUpdate));
  await Promise.all(tasks);
  return { players, coach, tm, year };
}

async function enrich(p, ctx, onUpdate) {
  const { lg, team, year, tm, X } = ctx;
  // 1) season + career stats
  const st = await safe(espn.athleteStats(lg, p.id), null);
  p.parsed = parseAthleteStats(st);
  p.cur = currentSeason(p.parsed, year, team.id);
  p.career = p.parsed?.career;
  p.careerTot = p.parsed?.careerTot;
  p.careerMisc = p.parsed?.careerMisc;
  p.adv = advanced(p.cur?.a, tm, lg);
  // previous season (for small early-season samples) and school path / transfers from ESPN season rows
  const prevRows = (p.parsed?.seasons || []).filter(s => s.year < year && s.a?.gamesPlayed);
  p.prev = prevRows.sort((a, b) => b.year - a.year || (b.a.gamesPlayed - a.a.gamesPlayed))[0] || null;
  const TB = state._teamsById?.[lg] || {};
  if (p.prev && p.prev.teamId !== team.id) p.prevSchool = TB[p.prev.teamId]?.short || TB[p.prev.teamId]?.name || '';
  if (isCollege(lg)) {
    const path = [];
    for (const s of (p.parsed?.seasons || []).slice().sort((a, b) => a.year - b.year)) {
      const nm = TB[s.teamId]?.short || TB[s.teamId]?.name || (s.teamSlug || '').replace(/-/g, ' ');
      if (nm && (!path.length || path[path.length - 1].nm !== nm)) path.push({ nm, from: s.year, to: s.year, id: s.teamId }); else if (path.length) path[path.length - 1].to = s.year;
    }
    p.schoolPath = path;
    p.transferFrom = path.length > 1 ? path[path.length - 2].nm : null;
  }
  if (p.adv && isPro(lg) && X.per[p.id]) { p.adv.per = X.per[p.id].per; p.adv.perRank = X.per[p.id].rank; }
  p.loaded.stats = true;
  // college extras (no requests)
  if (isCollege(lg)) {
    const k = normName(p.name);
    p.recruit = X.recruits[k] || null;
    const pt = X.portal[k];
    p.portal = pt ? pt.filter(e => !e.to || sameSchool(e.to, team)).sort((a, b) => b.year - a.year) : null;
    if (p.portal && !p.portal.length) p.portal = pt; // keep history even if destination name differs
    p.mock = X.mock[k] || null; p.board = X.board[k] || null;
  } else {
    const k = normName(p.name);
    p.mock = null; p.board = X.board[k] || null;
  }
  onUpdate?.(p);
  // 2) overview (news, RotoWire note, awards) + bio (ranks, draft) + game log in parallel
  const [ov, ath, gl] = await Promise.all([safe(espn.athleteOverview(lg, p.id), null), safe(espn.athlete(lg, p.id), null), safe(espn.gamelog(lg, p.id), null)]);
  if (ov) {
    p.news = (ov.news || []).filter(n => n.type !== 'Media' && !/Highlights|^Watch/i.test(n.headline || ''));
    p.rotowire = ov.rotowire || null;
    p.outlook = ov.fantasy?.projection || null;
    p.awards = ov.awards || [];
    p.nextGame = ov.nextGame?.league?.events?.[0] || null;
  }
  p.loaded.ov = true;
  if (ath?.athlete) {
    const a = ath.athlete;
    p.ranks = (a.statsSummary?.statistics || []).filter(s => s.rank);
    p.draft = a.displayDraft || '';
    p.dobStr = p.dob ? new Date(p.dob).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : (a.displayDOB || '');
    p.debut = a.debutYear;
    p.expStr = a.displayExperience || p.exp;
    if (!p.birthPlace && a.displayBirthPlace) p.birthPlace = a.displayBirthPlace;
    if (a.college?.name) p.college = a.college.name;
  }
  p.loaded.ath = true;
  p.gamelog = parseGamelog(gl);
  p.loaded.gl = true;
  onUpdate?.(p);
  // 3) Wikipedia (background, high school, honors)
  p.wiki = await safe(wikiPlayer(p.name, lg, team), null);
  p.loaded.wiki = true;
  onUpdate?.(p);
}

function sameSchool(name, team) {
  const n = (name || '').toLowerCase();
  return [team.location, team.short, team.name, team.nick].some(s => s && n.includes(s.toLowerCase()));
}

// ---------------------------------------------------------------- rendering
const statCols = [['GP', a => a.gamesPlayed, 0], ['MIN', a => a.avgMinutes], ['PTS', a => a.avgPoints], ['REB', a => a.avgRebounds], ['AST', a => a.avgAssists], ['STL', a => a.avgSteals], ['BLK', a => a.avgBlocks], ['TO', a => a.avgTurnovers], ['FG%', a => a.fieldGoalPct], ['3P%', a => a.threePointFieldGoalPct ?? a.threePointPct], ['FT%', a => a.freeThrowPct]];

function statRow(label, a, cls = '') {
  if (!a) return '';
  return `<tr class="${cls}"><td>${label}</td>${statCols.map(([, g, d]) => `<td>${g(a) == null ? '–' : d === 0 ? g(a) : f1(g(a))}</td>`).join('')}</tr>`;
}

export function headerLine(p) {
  const a = p.cur?.a;
  const s = (v, l) => `<div class="s"><b>${v}</b><span>${l}</span></div>`;
  if (!p.loaded.stats) return `<div class="line mut small">loading stats…</div>`;
  if (!a) return `<div class="line mut small">No games this season</div>`;
  return `<div class="line">${s(f1(a.avgPoints), 'PTS')}${s(f1(a.avgRebounds), 'REB')}${s(f1(a.avgAssists), 'AST')}${s(f1(a.fieldGoalPct), 'FG%')}${s(f1(a.threePointFieldGoalPct ?? a.threePointPct), '3P%')}${s(f1(a.avgMinutes), 'MIN')}</div>`;
}

function tags(p, lg) {
  const t = [];
  if (p.injShort) t.push(`<span class="chip red" title="${esc(p.injury)}">⚕ ${esc(p.injShort)}</span>`);
  const a = p.cur?.a;
  if (a?.gamesPlayed) t.push(a.gamesStarted / a.gamesPlayed >= 0.5 ? '<span class="chip acc">Starter</span>' : '<span class="chip">Bench</span>');
  if (isCollege(lg)) {
    if (p.recruit?.stars) t.push(`<span class="chip amber" title="On3 Industry ranking">${stars(p.recruit.stars)} ${p.recruit.rank ? '#' + p.recruit.rank + ' in ' + p.recruit.cls : p.recruit.cls + ' class'}</span>`);
    const tr = p.portal?.[0];
    if (tr?.from) t.push(`<span class="chip">↪ Transfer from ${esc(tr.from)}</span>`);
    else if (p.transferFrom) t.push(`<span class="chip">↪ Transfer from ${esc(p.transferFrom)}</span>`);
    if (p.mock) t.push(`<span class="chip green">Mock draft: #${p.mock.pick}${p.mock.team ? ' (' + esc(p.mock.team) + ')' : ''}</span>`);
    else if (p.board) t.push(`<span class="chip green">Big board #${p.board.pick}</span>`);
  }
  if (isPro(lg)) {
    if (p.expYears === 0) t.push('<span class="chip amber">Rookie</span>');
    if (p.adv?.perRank && p.adv.perRank <= 25) t.push(`<span class="chip green">PER ${f1(p.adv.per)} (${ordinal(p.adv.perRank)} NBA)</span>`);
  }
  for (const r of (p.ranks || []).filter(r => r.rank <= (isPro(lg) ? 10 : 25)).slice(0, 2)) t.push(`<span class="chip green">${esc(r.rankDisplayValue)} ${esc(r.abbreviation || r.shortDisplayName)}</span>`);
  return t.join('');
}

function bioLine(p, lg) {
  return [p.posName || p.pos, p.ht, p.wt, p.age ? `Age ${p.age}` : '', isCollege(lg) ? p.exp : (p.expStr || p.exp), p.birthPlace ? `From ${p.birthPlace}` : ''].filter(Boolean).map(esc).join(' · ');
}

export function cardHTML(p, lg, roster, { collapsed = false } = {}) {
  return `<article class="pc ${collapsed ? 'collapsed' : ''}" data-pid="${p.id}">
    <div class="pc-h" title="Click to show / hide full notes">
      <div class="row" style="gap:10px"><div class="no">${esc(p.jersey ?? '')}</div><img class="hs" src="${esc(p.headshot || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></div>
      <div style="min-width:0"><div class="nm">${esc(p.name)}${sayName(p, lg) ? ` <span class="gd-say" style="font-family:var(--font);text-transform:none;letter-spacing:0">🔊 ${esc(sayName(p, lg))}</span>` : ''}</div><div class="bio">${bioLine(p, lg)}</div><div class="tags">${tags(p, lg)}</div></div>
      ${headerLine(p)}
    </div>
    <div class="pc-b">${collapsed ? '' : bodyHTML(p, lg, roster)}</div>
  </article>`;
}

function seasonsTable(p, lg) {
  const seasons = p.parsed?.seasons || [];
  if (!seasons.length) return '<div class="small mut">No stats on file.</div>';
  const T = (state._teamsById?.[lg]) || {};
  const rows = isCollege(lg) ? seasons.slice().reverse() : seasons.slice(-3).reverse();
  const teamAbbr = s => { const t = T[s.teamId]; return t ? t.abbr : (s.teamSlug || '').split('-').map(w => w[0]).join('').toUpperCase(); };
  return `<div class="tscroll"><table class="minitable"><thead><tr><th>Season</th>${statCols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(s => statRow(`${esc(s.label || s.year)} <span class="mut2">${esc(teamAbbr(s))}</span>`, s.a, s === p.cur ? 'b' : '')).join('')}
    ${p.career ? statRow('<b>Career</b>', p.career) : ''}
    </tbody></table></div>
    ${isPro(lg) && seasons.length > 3 ? `<details class="small" style="margin-top:6px"><summary class="link">All ${seasons.length} seasons</summary><div class="tscroll"><table class="minitable"><tbody>${seasons.slice().reverse().map(s => statRow(`${esc(s.label)} <span class="mut2">${esc(teamAbbr(s))}</span>`, s.a)).join('')}</tbody></table></div></details>` : ''}
    ${p.careerTot && isPro(lg) ? `<div class="small mut" style="margin-top:6px">Career totals: <b>${f0n(p.careerTot.points)}</b> pts · ${f0n(p.careerTot.totalRebounds)} reb · ${f0n(p.careerTot.assists)} ast · ${f0n(p.careerTot.threePointFieldGoalsMade)} 3PM${p.careerMisc?.doubleDouble ? ` · ${f0n(p.careerMisc.doubleDouble)} double-doubles` : ''}${p.careerMisc?.tripleDouble ? ` · ${f0n(p.careerMisc.tripleDouble)} triple-doubles` : ''}</div>` : ''}`;
}
const f0n = v => (v == null ? '–' : Math.round(v).toLocaleString());

function advHTML(p, lg) {
  const x = p.adv;
  if (!x) return '<div class="small mut">Needs at least one game this season.</div>';
  const k = (key, v, sub) => `<div class="kpi"><div class="k">${GLOSSARY[key].label}${q(key, lg)}</div><div class="v">${v}</div>${sub ? `<div class="r">${sub}</div>` : ''}</div>`;
  const pm = L(lg).per;
  const small = (p.cur?.a?.gamesPlayed || 0) < 5 ? `<div class="small warn" style="margin-bottom:6px">Small sample: ${p.cur?.a?.gamesPlayed} game${p.cur?.a?.gamesPlayed === 1 ? '' : 's'} this season.</div>` : '';
  return `${small}<div class="adv">
    ${k('ts', pct(x.ts), tsTier(x.ts, lg))}
    ${k('efg', pct(x.efg))}
    ${x.usg != null ? k('usg', pct(x.usg), usgTier(x.usg).split(' ')[0] === 'heliocentric' ? 'star load' : usgTier(x.usg).replace(' role player', '').replace(' role', '')) : ''}
    ${x.ast != null ? k('ast', pct(x.ast)) : ''}
    ${k('ato', x.ato == null ? '–' : x.ato.toFixed(2))}
    ${k('tpar', pct(x.tpar, 0))}
    ${k('ftr', x.ftr == null ? '–' : x.ftr.toFixed(2))}
    ${k('gmsc', f1(x.gmsc))}
    ${x.stocks != null ? `<div class="kpi"><div class="k">STK/${pm}${q('stocks', lg)}</div><div class="v">${f1(x.stocks)}</div></div>` : ''}
    ${x.per != null ? k('per', f1(x.per), x.perRank ? ordinal(x.perRank) + ' in NBA' : '') : ''}
  </div>
  ${x.p36 ? `<div class="small mut" style="margin-top:6px">Per ${pm} min: ${f1(x.p36.pts)} pts · ${f1(x.p36.reb)} reb · ${f1(x.p36.ast)} ast · ${f1(x.p36.stl)} stl · ${f1(x.p36.blk)} blk</div>` : ''}
  ${(p.ranks || []).length ? `<div class="small" style="margin-top:6px"><span class="mut">${isPro(lg) ? 'League' : 'National'} ranks:</span> ${(p.ranks).slice(0, 6).map(r => `${esc(r.abbreviation || r.shortDisplayName)} ${esc(r.rankDisplayValue)}`).join(' · ')}</div>` : ''}`;
}

function backgroundHTML(p, lg) {
  const rows = [];
  const add = (k, v) => { if (v) rows.push(`<tr><td class="mut">${k}</td><td style="white-space:normal;text-align:left">${v}</td></tr>`); };
  add('Born', esc([p.dobStr, p.birthPlace].filter(Boolean).join(' · ')));
  if (p.wiki?.nickname) add('Nickname', esc(p.wiki.nickname));
  const hs = p.recruit?.hs || p.portal?.[0]?.hs || p.wiki?.hs;
  add('High school', esc(hs ? hs + (p.recruit?.hometown ? ` (${p.recruit.hometown})` : '') : ''));
  if (isCollege(lg) && p.recruit) add('Recruiting', `${stars(p.recruit.stars)} ${p.recruit.rating ? '(' + f1(p.recruit.rating) + ') ' : ''}Class of ${p.recruit.cls}${p.recruit.rank ? ` · <b>#${p.recruit.rank}</b> nationally` : ''}${p.recruit.posRank ? ` · #${p.recruit.posRank} ${esc(p.recruit.pos || '')}` : ''}${p.recruit.stateRank ? ` · #${p.recruit.stateRank} in ${esc(p.recruit.state || 'state')}` : ''} <span class="mut2">(On3 Industry)</span>`);
  if (isCollege(lg) && p.schoolPath?.length > 1) add('College path', p.schoolPath.map(x => `${esc(x.nm)} (${x.from - 1}-${String(x.to).slice(2)})`).join(' → '));
  if (isCollege(lg) && p.portal?.length) {
    const hist = p.portal[0].history?.length ? p.portal[0].history.map(h => `${esc(h.team)} (${h.from}${h.to && h.to !== h.from ? '–' + String(h.to).slice(2) : ''})`).join(' → ') : '';
    add('Transfer', p.portal.map(e => `${e.year} portal: ${esc(e.from || '?')} → <b>${esc(e.to || 'uncommitted')}</b>${e.stars ? ` · ${stars(e.stars)} transfer${e.rank ? ' #' + e.rank : ''}` : ''}`).join('<br>') + (hist ? `<br><span class="mut">Path: ${hist}</span>` : ''));
  }
  if (isPro(lg)) {
    add(`College / pre-${L(lg).name}`, esc(p.college || p.wiki?.college || ''));
    add('Draft', esc(p.draft || p.wiki?.draft || ''));
    if (p.debut) add(`${L(lg).name} debut`, `${lg === 'wnba' ? p.debut : `${p.debut}-${String(p.debut + 1).slice(2)}`} season${p.expStr ? ' · ' + esc(p.expStr) : ''}`);
    if (p.contract?.salary) add('Salary', `$${(p.contract.salary / 1e6).toFixed(1)}M (${p.contract.season?.year - 1}-${String(p.contract.season?.year).slice(2)})${p.contracts.length > 1 ? ` · on ESPN file for ${p.contracts.length} seasons` : ''}`);
  }
  if (p.mock || p.board) {
    const d = p.mock || p.board;
    add(`${L(lg).women ? 'WNBA' : 'NBA'} draft outlook`, `${p.mock ? `Tankathon mock draft: <b>#${p.mock.pick}</b>${p.mock.team ? ' to ' + esc(p.mock.team) : ''}` : ''}${p.mock && p.board ? ' · ' : ''}${p.board ? `Big board <b>#${p.board.pick}</b>` : ''}${d.stats?.advanced ? ` · BPM ${esc(d.stats.advanced.bpm || '–')}, USG ${esc(d.stats.advanced.usg || '–')}` : ''}`);
  }
  if (p.injury) add('Injury', `<span class="inj">${esc(p.injury)}</span>`);
  const wikiTxt = p.wiki?.extract ? `<p class="small" style="margin:8px 0 0">${esc(p.wiki.extract)} <a class="link" href="${esc(p.wiki.url)}" target="_blank" rel="noopener">Wikipedia</a></p>` : (p.loaded.wiki ? '' : '<div class="small mut2">Looking up background…</div>');
  return `<table class="minitable"><tbody>${rows.join('')}</tbody></table>${wikiTxt}`;
}

function gamesHTML(p) {
  const g = (p.gamelog || []).slice(0, 6);
  if (!g.length) return `<div class="small mut">${p.loaded.gl ? 'No games logged yet.' : 'Loading…'}</div>`;
  return `<table class="minitable"><thead><tr><th>Date</th><th>Opp</th><th>Res</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th></tr></thead><tbody>
  ${g.map(x => `<tr><td>${esc(x.date)}</td><td class="l">${esc(x.atVs || '')} ${esc(x.opp)}</td><td class="${x.result === 'W' ? 'good' : x.result === 'L' ? 'bad' : ''}">${esc(x.result || '')} ${esc(x.score || '')}</td><td>${x.min ?? '–'}</td><td><b>${x.pts ?? '–'}</b></td><td>${x.reb ?? '–'}</td><td>${x.ast ?? '–'}</td><td>${x.fgm ?? 0}-${x.fga ?? 0}</td><td>${x.tpm ?? 0}-${x.tpa ?? 0}</td></tr>`).join('')}
  </tbody></table>`;
}

function newsHTML(p) {
  const out = [];
  if (p.rotowire?.headline) out.push(`<div class="newsi"><div><div class="hd">${esc(p.rotowire.headline)}</div>${p.rotowire.story ? `<div class="ds">${esc(p.rotowire.story)}</div>` : ''}<div class="tiny mut2">RotoWire${p.rotowire.published ? ' · ' + new Date(p.rotowire.published).toLocaleDateString() : ''}</div></div></div>`);
  for (const n of (p.news || []).slice(0, 3)) out.push(`<a class="newsi" href="${esc(n.links?.web?.href || '#')}" target="_blank" rel="noopener"><div><div class="hd">${esc(n.headline)}</div><div class="tiny mut2">${n.published || n.lastModified ? new Date(n.published || n.lastModified).toLocaleDateString() : ''}</div></div></a>`);
  return out.join('') || `<div class="small mut">${p.loaded.ov ? 'No recent news.' : 'Loading…'}</div>`;
}

export function bodyHTML(p, lg, roster) {
  const style = playStyle(p, lg);
  const role = roleNotes(p, roster, lg);
  const facts = factNotes(p, roster, lg, { wiki: p.wiki });
  const key = `${lg}:${p.id}`;
  return `
    <section><h4 class="h3">Season &amp; career averages</h4>${seasonsTable(p, lg)}</section>
    <section><h4 class="h3">Advanced stats (hover ? for meaning)</h4>${advHTML(p, lg)}</section>
    <section><h4 class="h3">Play style</h4>${style.length ? `<ul class="notes">${style.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<div class="small mut">Not enough minutes for a profile yet.</div>'}
      ${p.outlook ? `<div class="small" style="margin-top:8px"><span class="mut">Outlook (RotoWire):</span> ${esc(p.outlook)}</div>` : ''}</section>
    <section><h4 class="h3">Role on the team</h4><ul class="notes">${role.map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>
    <section><h4 class="h3">Background &amp; history</h4>${backgroundHTML(p, lg)}</section>
    <section><h4 class="h3">Talking points</h4>${facts.length ? `<ul class="notes">${facts.slice(0, 14).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : `<div class="small mut">${p.loaded.gl ? 'Nothing notable yet.' : 'Loading…'}</div>`}</section>
    <section><h4 class="h3">Recent games</h4>${gamesHTML(p)}</section>
    <section><h4 class="h3">Latest news</h4>${newsHTML(p)}</section>
    <section><h4 class="h3">My notes <span class="mut2" style="text-transform:none;letter-spacing:0;font-weight:500">(saved in this browser)</span></h4><textarea class="mynotes" data-key="${esc(key)}" placeholder="Pronunciation, storylines, stats to mention…">${esc(myNotes.get(key))}</textarea>
      <div class="small" style="margin-top:6px"><a class="link" href="https://www.espn.com/${L(lg).espn}/player/_/id/${p.id}" target="_blank" rel="noopener">ESPN profile</a> · <a class="link" href="#/${lg}/player/${p.id}/${p.teamId}">Open full page</a></div></section>`;
}

/** Wire up a container of cards: expand/collapse, notes autosave. */
export function wireCards(container) {
  container.addEventListener('click', e => {
    const h = e.target.closest('.pc-h');
    if (!h) return;
    const card = h.closest('.pc');
    card.classList.toggle('collapsed');
    if (!card.classList.contains('collapsed')) card.dispatchEvent(new CustomEvent('expand', { bubbles: true }));
  });
  container.addEventListener('input', e => {
    const t = e.target.closest('textarea.mynotes');
    if (t) myNotes.set(t.dataset.key, t.value);
  });
}

/** Standalone player page (#/lg/player/id/teamId) */
export async function renderPage(app, lg, pid, teamId) {
  const T = await teams(lg);
  state._teamsById = state._teamsById || {}; state._teamsById[lg] = T.byId;
  const team = T.byId[teamId];
  if (!team) { app.innerHTML = '<div class="err">Team not found for this player.</div>'; return; }
  paint(document.documentElement, team);
  app.innerHTML = `<div class="row" style="margin-bottom:12px"><a class="link small" href="#/${lg}/team/${team.id}">← ${esc(team.name)}</a></div><div id="pp"><div class="loading">Loading player…</div></div>`;
  const el = app.querySelector('#pp');
  let roster = [];
  const draw = () => {
    const p = roster.find(x => x.id === pid);
    if (!p) return;
    el.innerHTML = cardHTML(p, lg, roster);
  };
  wireCards(el);
  await loadRoster(lg, team, { onRoster: (ps) => { roster = ps; draw(); }, onUpdate: (p) => { if (p.id === pid) draw(); } });
  draw();
  if (!roster.find(x => x.id === pid)) el.innerHTML = '<div class="err">This player is not on the current roster.</div>';
  void logoFor;
}
