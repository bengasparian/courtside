// Live box score / game preview.
import { L } from '../league.js';
import { esc, logoFor, fmtDate, fmtTime, sparkline, num } from '../util.js';
import { espn, safe } from '../api.js';
import { state, teams, paint } from '../ctx.js';
import { onLeave } from '../app.js';
import { newsList } from './common.js';

export async function render(app, lg, id) {
  const T = await teams(lg);
  let timer;
  onLeave(() => clearTimeout(timer));
  const load = async (first) => {
    const s = await safe(espn.summary(lg, id, first ? 10 : 0), null);
    if (!s?.header) { if (first) app.innerHTML = '<div class="err">Game not found.</div>'; return; }
    if (!document.body.contains(app) || !location.hash.includes(`/game/${id}`)) return;
    const y = window.scrollY;
    draw(app, lg, s, T);
    window.scrollTo(0, y);
    const st = s.header.competitions[0].status.type.state;
    if (st === 'in') timer = setTimeout(() => load(false), 15000);
    else if (st === 'pre') timer = setTimeout(() => load(false), 120000);
  };
  await load(true);
}

function draw(app, lg, s, T) {
  const comp = s.header.competitions[0];
  const st = comp.status.type;
  const away = comp.competitors.find(c => c.homeAway === 'away'), home = comp.competitors.find(c => c.homeAway === 'home');
  const tA = T.byId[away.team.id] || { ...away.team, logo: away.team.logos?.[0]?.href }, tH = T.byId[home.team.id] || { ...home.team, logo: home.team.logos?.[0]?.href };
  const root = document.documentElement;
  paint(root, tA, 'a'); paint(root, tH, 'b'); paint(root, tH, 'acc');
  const live = st.state === 'in';
  const rank = c => (c.rank && c.rank <= 25 ? `<span class="mut2 small">${c.rank}</span> ` : '');
  const rec = c => (c.record || []).map(r => r.summary || r.displayValue).filter(Boolean)[0] || '';
  const periods = Math.max(away.linescores?.length || 0, home.linescores?.length || 0, L(lg).quarters ? 4 : 2);
  const pLabel = i => (L(lg).quarters ? (i < 4 ? `Q${i + 1}` : `OT${i - 3 > 1 ? i - 3 : ''}`) : (i < 2 ? `H${i + 1}` : `OT${i - 1 > 1 ? i - 1 : ''}`));
  const ls = c => Array.from({ length: periods }, (_, i) => `<td>${esc(c.linescores?.[i]?.displayValue ?? c.linescores?.[i]?.value ?? '')}</td>`).join('');
  const gi = s.gameInfo || {};
  const odds = (s.pickcenter || [])[0];
  const notes = (comp.notes || s.header.gameNote ? [s.header.gameNote, ...(comp.notes || []).map(n => n.headline)] : []).filter(Boolean);
  const tv = (comp.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(', ');

  const wp = (s.winprobability || []).map(x => x.homeWinPercentage * 100);
  const lastWp = wp.length ? wp[wp.length - 1] : null;

  app.innerHTML = `
  <div class="row noprint" style="margin-bottom:10px"><a class="link small" href="#/${lg}/scores">← Scores</a><span class="sp"></span><a class="btn sm pri" href="#/${lg}/matchup/${tA.id}/${tH.id}">Full matchup prep →</a></div>
  <div class="card">
    ${notes.length ? `<div class="small mut" style="text-align:center;margin-bottom:6px">${esc(notes.join(' · '))}</div>` : ''}
    <div class="box-h">
      <a class="t" href="#/${lg}/team/${tA.id}"><img src="${esc(logoFor(tA, state.theme))}" alt=""><div><div class="h2" style="margin:0">${rank(away)}${esc(tA.name || away.team.displayName)}</div><div class="small mut">${esc(rec(away))}</div></div></a>
      <div class="mid"><div class="sc">${st.state === 'pre' ? '–' : `${esc(away.score ?? '')} <span class="mut2">-</span> ${esc(home.score ?? '')}`}</div>
        <div class="${live ? 'bad b' : 'mut'}">${live ? '<span class="livedot"></span>' : ''}${esc(st.state === 'pre' ? `${fmtDate(comp.date)} · ${fmtTime(comp.date)}` : st.detail)}</div>
        ${tv ? `<div class="small mut">${esc(tv)}</div>` : ''}</div>
      <a class="t r" href="#/${lg}/team/${tH.id}"><div><div class="h2" style="margin:0">${rank(home)}${esc(tH.name || home.team.displayName)}</div><div class="small mut">${esc(rec(home))}</div></div><img src="${esc(logoFor(tH, state.theme))}" alt=""></a>
    </div>
    ${st.state !== 'pre' ? `<div class="tscroll" style="margin-top:12px;display:flex;justify-content:center"><table class="t lines" style="width:auto;min-width:340px"><thead><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${pLabel(i)}</th>`).join('')}<th>T</th></tr></thead><tbody>
      <tr><td class="l b">${esc(away.team.abbreviation)}</td>${ls(away)}<td class="b">${esc(away.score ?? '')}</td></tr>
      <tr><td class="l b">${esc(home.team.abbreviation)}</td>${ls(home)}<td class="b">${esc(home.score ?? '')}</td></tr></tbody></table></div>` : ''}
  </div>
  <div class="grid g-side" style="margin-top:16px">
    <div class="grid" style="align-content:start">
      ${(s.boxscore?.players || []).map(tp => playerBox(tp, lg)).join('') || pregame(s, lg, tA, tH)}
    </div>
    <div class="grid" style="align-content:start">
      ${wp.length > 2 ? `<div class="card"><h3 class="h3">Win probability</h3><div class="row"><b style="color:var(--b-txt)">${esc(home.team.abbreviation)} ${lastWp != null ? Math.round(lastWp) : ''}%</b><span class="sp"></span><span class="mut small">${esc(away.team.abbreviation)} ${lastWp != null ? Math.round(100 - lastWp) : ''}%</span></div>${sparkline(wp, { w: 360, h: 80, color: 'var(--b-txt)', mid: 50, fill: true })}<div class="src">ESPN win probability (home team), whole game.</div></div>` : ''}
      ${teamCompare(s, away, home)}
      ${leaders(s)}
      ${(s.plays || []).length ? `<div class="card"><h3 class="h3">Play-by-play (latest first)</h3><div class="plays">${(s.plays || []).slice(-40).reverse().map(p => `<div class="play ${p.scoringPlay ? 'sc' : ''}"><span class="mut small">${esc(p.period?.displayValue?.replace(' Quarter', 'Q').replace(' Half', 'H') || '')} ${esc(p.clock?.displayValue || '')}</span><span>${esc(p.text || '')}</span><span style="text-align:right">${p.awayScore}-${p.homeScore}</span></div>`).join('')}</div></div>` : ''}
      <div class="card"><h3 class="h3">Game info</h3><table class="minitable"><tbody>
        ${gi.venue ? `<tr><td class="mut">Venue</td><td style="white-space:normal;text-align:left">${esc(gi.venue.fullName)}${gi.venue.address ? `, ${esc([gi.venue.address.city, gi.venue.address.state].filter(Boolean).join(', '))}` : ''}</td></tr>` : ''}
        ${gi.attendance ? `<tr><td class="mut">Attendance</td><td style="text-align:left">${Number(gi.attendance).toLocaleString()}</td></tr>` : ''}
        ${gi.officials?.length ? `<tr><td class="mut">Officials</td><td style="white-space:normal;text-align:left">${gi.officials.map(o => esc(o.displayName || o.fullName)).join(', ')}</td></tr>` : ''}
        ${odds ? `<tr><td class="mut">Line</td><td style="white-space:normal;text-align:left">${esc(odds.details || '')}${odds.overUnder ? ` · O/U ${esc(odds.overUnder)}` : ''} <span class="mut2">(${esc(odds.provider?.name || '')})</span></td></tr>` : ''}
        ${(s.seasonseries || [])[0] ? `<tr><td class="mut">Season series</td><td style="white-space:normal;text-align:left">${esc(s.seasonseries[0].summary || '')}</td></tr>` : ''}
      </tbody></table></div>
      ${injuries(s)}
      ${(s.news?.articles || []).length ? `<div class="card"><h3 class="h3">Related news</h3>${newsList(s.news.articles, { limit: 4 })}</div>` : ''}
    </div>
  </div>`;
}

function playerBox(tp, lg) {
  const stt = tp.statistics?.[0];
  if (!stt) return '';
  const labels = stt.labels || [];
  const rows = (stt.athletes || []);
  const starters = rows.filter(r => r.starter), bench = rows.filter(r => !r.starter);
  const row = r => {
    if (r.didNotPlay || !r.stats?.length) return `<tr><td class="l">${esc(r.athlete.shortName || r.athlete.displayName)} <span class="mut2 small">${esc(r.athlete.position?.abbreviation || '')}</span></td><td colspan="${labels.length}" class="l mut small">${esc(r.reason || 'DNP')}</td></tr>`;
    return `<tr><td class="l"><span class="mut2 small">${esc(r.athlete.jersey || '')}</span> ${esc(r.athlete.shortName || r.athlete.displayName)} <span class="mut2 small">${esc(r.athlete.position?.abbreviation || '')}</span></td>${r.stats.map((v, i) => `<td class="${labels[i] === 'PTS' ? 'b' : ''}">${esc(v)}</td>`).join('')}</tr>`;
  };
  const tot = stt.totals || [];
  return `<div class="card flush"><div class="card-h"><div class="row"><img src="${esc(tp.team.logo)}" alt="" style="width:26px;height:26px;object-fit:contain"><h3 class="h3" style="margin:0">${esc(tp.team.displayName)}</h3></div></div>
    <div class="tscroll"><table class="t"><thead><tr><th>Starters</th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${starters.map(row).join('')}
    <tr><th class="l" style="position:static">Bench</th>${labels.map(() => '<th style="position:static"></th>').join('')}</tr>${bench.map(row).join('')}
    ${tot.length ? `<tr class="b"><td class="l">Team</td>${tot.map(v => `<td>${esc(v)}</td>`).join('')}</tr>` : ''}</tbody></table></div></div>`;
}

function teamCompare(s, away, home) {
  const ts = s.boxscore?.teams || [];
  if (ts.length < 2 || !ts[0].statistics?.length) return '';
  const a = ts.find(t => t.team.id === away.team.id) || ts[0], h = ts.find(t => t.team.id === home.team.id) || ts[1];
  const want = ['fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'threePointFieldGoalPct', 'freeThrowsMade-freeThrowsAttempted', 'totalRebounds', 'offensiveRebounds', 'assists', 'steals', 'blocks', 'totalTurnovers', 'turnoverPoints', 'fastBreakPoints', 'pointsInPaint', 'fouls', 'largestLead', 'leadChanges'];
  const m = t => Object.fromEntries((t.statistics || []).map(x => [x.name, x]));
  const ma = m(a), mh = m(h);
  return `<div class="card"><h3 class="h3">Team stats</h3><table class="minitable"><thead><tr><th>${esc(away.team.abbreviation)}</th><th style="text-align:center"></th><th>${esc(home.team.abbreviation)}</th></tr></thead><tbody>
    ${want.filter(k => ma[k] || mh[k]).map(k => `<tr><td style="text-align:left">${esc(ma[k]?.displayValue ?? '')}</td><td style="text-align:center" class="mut">${esc(ma[k]?.label || mh[k]?.label || k)}</td><td>${esc(mh[k]?.displayValue ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
}

function leaders(s) {
  const L = s.leaders || [];
  if (!L.length) return '';
  return `<div class="card"><h3 class="h3">Leaders</h3>${L.map(t => `<div style="margin-bottom:8px"><div class="small b">${esc(t.team?.displayName || '')}</div>${(t.leaders || []).map(c => { const l = c.leaders?.[0]; return l ? `<div class="row small" style="padding:3px 0"><span class="mut" style="width:90px">${esc(c.displayName)}</span><img src="${esc(l.athlete?.headshot?.href || '')}" alt="" style="width:26px;height:20px;object-fit:cover;border-radius:4px" onerror="this.style.visibility='hidden'"><b>${esc(l.athlete?.displayName || '')}</b><span class="sp"></span><span>${esc(l.displayValue)}</span></div>` : ''; }).join('')}</div>`).join('')}</div>`;
}

function injuries(s) {
  const inj = (s.injuries || []).flatMap(t => (t.injuries || []).map(i => ({ t: t.team?.abbreviation, n: i.athlete?.displayName, st: i.status, d: i.details?.type || i.type?.description })));
  if (!inj.length) return '';
  return `<div class="card"><h3 class="h3">Injuries</h3><table class="minitable"><tbody>${inj.map(i => `<tr><td>${esc(i.t)}</td><td class="l">${esc(i.n)}</td><td class="inj" style="text-align:left;white-space:normal">${esc(i.st || '')}${i.d ? ' · ' + esc(i.d) : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function pregame(s, lg, tA, tH) {
  return `<div class="card"><h3 class="h3">Pregame</h3><p>The box score fills in at tip-off and this page refreshes on its own every 15 seconds while the game is live.</p>
    <a class="btn pri" href="#/${lg}/matchup/${tA.id}/${tH.id}">Open full matchup prep (players, stats, storylines) →</a></div>`;
}
void num;
