// Router, header (league switch, nav, live ticker, search, theme).
import { L, isPro, isCollege, LEAGUES, LEAGUE_KEYS } from './league.js?v=5b6412a517';
import { $, esc, debounce, logoFor, ymd, normName } from './util.js?v=5b6412a517';
import { espn, safe, repo } from './api.js?v=5b6412a517';
import { state, teams, unpaint, meta } from './ctx.js?v=5b6412a517';
import { gameStatus, awayHome } from './views/common.js?v=5b6412a517';

const app = $('#app');
let cleanup = [];
export function onLeave(fn) { cleanup.push(fn); }

// ---------- keyboard shortcuts: global keys + keys a page registers with setKeys()
let pageKeys = [];
export function setKeys(list) { pageKeys = list; onLeave(() => { if (pageKeys === list) pageKeys = []; }); }
const GLOBAL_KEYS = [
  ['?', 'Show this list of shortcuts', () => help()],
  ['1 – 4', 'Switch league: 1 NBA · 2 WNBA · 3 NCAA men · 4 NCAA women', null],
  ['h', 'Home / matchup prep', () => { location.hash = `#/${state.lg}`; }],
  ['s', 'Scores', () => { location.hash = `#/${state.lg}/scores`; }],
  ['q', 'Search teams and players', () => { $('#q').focus(); }],
  ['t', 'Light / dark mode', () => $('#themeBtn').click()],
  ['[ ]', 'Previous / next tab', null],
  ['g', 'Game Day tab (on a matchup)', () => { const m = /#\/(\w+)\/matchup\/(\d+)\/(\d+)/.exec(location.hash); if (m) location.hash = `#/${m[1]}/matchup/${m[2]}/${m[3]}/gameday`; }],
  ['x', 'Swap home and away (on a matchup)', () => { const sw = document.querySelector('.tabs a[title="Swap home/away"]'); if (sw) sw.click(); }],
];
function help() {
  let ov = $('#helpOv');
  if (ov) { ov.remove(); return; }
  ov = document.createElement('div');
  ov.id = 'helpOv'; ov.className = 'drawer';
  const row = ([k, d]) => `<tr><td class="l"><kbd>${esc(k)}</kbd></td><td class="l" style="white-space:normal">${esc(d)}</td></tr>`;
  ov.innerHTML = `<div class="drawer-in" style="width:min(520px,96vw)"><div class="row drawer-h"><b>Keyboard shortcuts</b><span class="sp"></span><button class="btn sm" id="helpX">Close ✕</button></div><div style="padding:14px">
    ${pageKeys.length ? `<h3 class="h3">This page</h3><table class="minitable">${pageKeys.map(row).join('')}</table>` : ''}
    <h3 class="h3" style="margin-top:14px">Everywhere</h3><table class="minitable">${GLOBAL_KEYS.map(row).join('')}</table>
    <div class="small mut" style="margin-top:10px">Shortcuts are ignored while you're typing in a box. Press Esc to leave a box.</div></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.id === 'helpX') ov.remove(); });
}
window.__csHelp = help;
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (e.key === 'Escape' && $('#helpOv')) { $('#helpOv').remove(); return; }
  const pk = pageKeys.find(([k]) => k === e.key);
  if (pk && pk[2]) { e.preventDefault(); pk[2](); return; }
  if (/^[1-4]$/.test(e.key)) { setLeague(LEAGUE_KEYS[+e.key - 1]); return; }
  if (e.key === '[' || e.key === ']') {
    const tabs = [...document.querySelectorAll('.tabs a')].filter(a => !a.title);
    const i = tabs.findIndex(a => a.classList.contains('on'));
    const n = tabs[i + (e.key === ']' ? 1 : -1)];
    if (n) n.click();
    return;
  }
  const g = GLOBAL_KEYS.find(([k]) => k === e.key);
  if (g && g[2]) { e.preventDefault(); g[2](); }
});

const NAV = {
  nba: [['', 'Matchup prep'], ['scores', 'Scores'], ['league', 'Around the NBA'], ['standings', 'Standings'], ['draft', 'Draft']],
  wnba: [['', 'Matchup prep'], ['scores', 'Scores'], ['league', 'Around the WNBA'], ['standings', 'Standings'], ['draft', 'Draft']],
  cbb: [['', 'Matchup prep'], ['scores', 'Scores'], ['league', 'Rankings & news'], ['conferences', 'Conferences'], ['madness', 'March Madness'], ['portal', 'Transfer portal'], ['draft', 'NBA draft']],
  wcbb: [['', 'Matchup prep'], ['scores', 'Scores'], ['league', 'Rankings & news'], ['conferences', 'Conferences'], ['madness', 'March Madness'], ['portal', 'Transfer portal'], ['draft', 'WNBA draft']],
};

function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  return { parts, params };
}

async function route() {
  cleanup.forEach(f => { try { f(); } catch { /* ignore */ } });
  cleanup = [];
  unpaint(document.documentElement);
  let { parts, params } = parse();
  if (LEAGUE_KEYS.includes(parts[0])) {
    if (state.lg !== parts[0]) setLeague(parts[0], false);
  } else {
    location.replace(`#/${state.lg}`);
    return;
  }
  const lg = parts[0];
  const view = parts[1] || '';
  renderNav(view);
  app.innerHTML = '<div class="loading">Loading…</div>';
  window.scrollTo(0, 0);
  try {
    if (view === '') (await import('./views/home.js?v=5b6412a517')).render(app, lg);
    else if (view === 'matchup') (await import('./views/matchup.js?v=5b6412a517')).render(app, lg, parts[2], parts[3], parts[4] || 'gameday', params);
    else if (view === 'team') (await import('./views/matchup.js?v=5b6412a517')).renderTeam(app, lg, parts[2], params);
    else if (view === 'game') (await import('./views/game.js?v=5b6412a517')).render(app, lg, parts[2]);
    else if (view === 'scores') (await import('./views/scores.js?v=5b6412a517')).render(app, lg, params);
    else if (view === 'player') (await import('./views/players.js?v=5b6412a517')).renderPage(app, lg, parts[2], parts[3]);
    else if (isPro(lg)) (await import('./views/nbahub.js?v=5b6412a517')).render(app, view, params, lg);
    else (await import('./views/cbbhub.js?v=5b6412a517')).render(app, view, params, lg);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="err">Something went wrong loading this page: ${esc(e.message || e)}. Try refreshing; data sources occasionally hiccup.</div>`;
  }
}

function renderNav(view) {
  const lg = state.lg;
  $('#nav').innerHTML = NAV[lg].map(([v, label]) => `<a href="#/${lg}${v ? '/' + v : ''}" class="${v === view || (v === '' && ['matchup', 'team', 'player'].includes(view)) ? 'on' : ''}">${label}</a>`).join('');
  document.querySelectorAll('#leagueSeg button').forEach(b => b.classList.toggle('on', b.dataset.lg === lg));
}

function setLeague(lg, go = true) {
  state.lg = lg;
  try { localStorage.setItem('cs-lg', lg); } catch { /* ignore */ }
  document.querySelectorAll('#leagueSeg button').forEach(b => b.classList.toggle('on', b.dataset.lg === lg));
  ticker();
  if (go) location.hash = `#/${lg}`;
}

// ---------- live ticker (refreshes every 30s)
let tickTimer;
async function ticker() {
  clearTimeout(tickTimer);
  const lg = state.lg;
  const el = $('#ticker');
  const [sb, T] = await Promise.all([safe(espn.scoreboard(lg, null), null), teams(lg)]);
  if (lg !== state.lg) return;
  let evs = sb?.events || [];
  if (isCollege(lg)) {
    // college: show ranked teams / live games first, cap length
    evs = evs.slice().sort((a, b) => score(b) - score(a)).slice(0, 40);
  }
  if (!evs.length) {
    el.innerHTML = `<span class="tk"><span class="st">No ${isPro(lg) ? L(lg).name : 'D-I'} games today</span></span>`;
  } else {
    el.innerHTML = evs.map(e => {
      const c = e.competitions[0], st = gameStatus(e);
      const side = x => {
        const t = T.byId[x.team.id] || {};
        const rk = x.curatedRank?.current && x.curatedRank.current <= 25 ? `<span class="mut2 tiny">${x.curatedRank.current}</span> ` : '';
        return `<div class="r ${x.winner ? 'w' : ''}"><span>${rk}<img src="${esc(logoFor(t, state.theme) || x.team.logo)}" alt="" loading="lazy">${esc(x.team.abbreviation)}</span><span>${st.state === 'pre' ? '' : esc(x.score ?? '')}</span></div>`;
      };
      const comp = awayHome(c);
      return `<a class="tk ${st.state === 'in' ? 'live' : ''}" href="#/${lg}/game/${e.id}">${comp.map(side).join('')}<span class="st">${st.state === 'in' ? '● ' : ''}${esc(st.short)}</span></a>`;
    }).join('');
  }
  const live = evs.some(e => e.status?.type?.state === 'in');
  tickTimer = setTimeout(ticker, live ? 30000 : 120000);
  function score(e) {
    const c = e.competitions[0];
    const ranked = c.competitors.some(x => x.curatedRank?.current <= 25) ? 2 : 0;
    return (e.status?.type?.state === 'in' ? 3 : 0) + ranked;
  }
}

// ---------- search (teams in the active league + players you've loaded)
const qEl = $('#q'), qRes = $('#qres');
qEl.addEventListener('input', debounce(async () => {
  const q = qEl.value.trim().toLowerCase();
  if (q.length < 2) { qRes.classList.add('hidden'); return; }
  const lg = state.lg;
  const T = await teams(lg);
  const tHits = T.list.filter(t => [t.name, t.abbr, t.location, t.nick].some(s => (s || '').toLowerCase().includes(q))).slice(0, 8);
  const players = (window.__csPlayers || []).filter(p => p.lg === lg && normName(p.name).includes(normName(q))).slice(0, 8);
  qRes.innerHTML = (tHits.map(t => `<div class="opt" data-href="#/${lg}/team/${t.id}"><img src="${esc(logoFor(t, state.theme))}" alt=""><span>${esc(t.name)}</span><span class="mut">${esc(t.conf || '')}</span></div>`).join('')
    + players.map(p => `<div class="opt" data-href="#/${lg}/player/${p.id}/${p.teamId}"><img src="${esc(p.headshot || '')}" alt=""><span>${esc(p.name)}</span><span class="mut">${esc(p.team)}</span></div>`).join(''))
    || '<div class="empty small">No matches. Players appear here after you open their team.</div>';
  qRes.classList.remove('hidden');
}, 120));
qRes.addEventListener('click', e => {
  const o = e.target.closest('.opt');
  if (o) { location.hash = o.dataset.href; qRes.classList.add('hidden'); qEl.value = ''; }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) qRes.classList.add('hidden'); });

// ---------- theme
$('#themeBtn').addEventListener('click', () => {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cs-theme', next); } catch { /* ignore */ }
  route(); ticker();
});
document.querySelectorAll('#leagueSeg button').forEach(b => b.addEventListener('click', () => setLeague(b.dataset.lg)));

// ---------- footer: data freshness
(async () => {
  const m = await meta();
  const built = m?.built ? new Date(m.built).toLocaleString() : 'unknown';
  $('#foot').innerHTML = `Live data: ESPN (scores, rosters, stats, news) · League tables refreshed every 2 hours (last: ${built}) · Background: Wikipedia · Recruiting &amp; portal: On3 · Draft: Tankathon · NET: NCAA.<br>Notes you type are saved only in this browser. <a href="https://github.com/bengasparian/courtside">Source</a>`;
})();

const setTopH = () => document.documentElement.style.setProperty('--toph', ($('.top')?.offsetHeight || 98) + 'px');
try { new ResizeObserver(setTopH).observe($('.top')); } catch { window.addEventListener('resize', setTopH); }
setTopH();
window.addEventListener('hashchange', route);
void ymd; void repo;
route();
ticker();
