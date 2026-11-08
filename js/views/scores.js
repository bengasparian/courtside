import { isPro, isCollege } from '../league.js?v=fb64bb9f50';
import { esc, ymd } from '../util.js?v=fb64bb9f50';
import { espn, safe } from '../api.js?v=fb64bb9f50';
import { teams } from '../ctx.js?v=fb64bb9f50';
import { gameCard } from './common.js?v=fb64bb9f50';
import { onLeave } from '../app.js?v=fb64bb9f50';

export async function render(app, lg, params) {
  const T = await teams(lg);
  const ds = params.get('d');
  const date = ds ? new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)) : new Date();
  const filter = params.get('f') || (isCollege(lg) ? 'top25' : 'all');
  const conf = params.get('c') || '';
  const shift = n => { const d = new Date(date); d.setDate(d.getDate() + n); return ymd(d); };
  const link = (d, f = filter, c = conf) => `#/${lg}/scores?d=${d}${isCollege(lg) ? `&f=${f}${c ? '&c=' + encodeURIComponent(c) : ''}` : ''}`;
  const confs = [...new Set(T.list.map(t => t.conf).filter(Boolean))].sort();
  app.innerHTML = `<div class="row wrap" style="margin-bottom:12px;gap:8px">
      <h1 class="h1">Scores</h1><span class="sp"></span>
      <a class="btn sm" href="${link(shift(-1))}">◀</a>
      <input type="date" id="dp" value="${date.toISOString().slice(0, 10)}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--txt)">
      <a class="btn sm" href="${link(shift(1))}">▶</a>
      <a class="btn sm" href="${link(ymd(new Date()))}">Today</a>
    </div>
    ${isCollege(lg) ? `<div class="subtabs"><button data-f="top25" class="${filter === 'top25' ? 'on' : ''}">Top 25</button><button data-f="all" class="${filter === 'all' && !conf ? 'on' : ''}">All D-I</button>
      <select id="cf" style="padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--txt)"><option value="">Conference…</option>${confs.map(c => `<option ${c === conf ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>` : ''}
    <div class="small mut" id="cnt"></div>
    <div class="games" id="g"><div class="loading">Loading…</div></div>`;
  app.querySelector('#dp').addEventListener('change', e => { location.hash = link(e.target.value.replace(/-/g, '')); });
  app.querySelectorAll('.subtabs button').forEach(b => b.addEventListener('click', () => { location.hash = link(ymd(date), b.dataset.f, ''); }));
  app.querySelector('#cf')?.addEventListener('change', e => { location.hash = link(ymd(date), 'all', e.target.value); });
  let timer;
  onLeave(() => clearTimeout(timer));
  const load = async () => {
    const sb = await safe(espn.scoreboard(lg, ymd(date)), null);
    let evs = sb?.events || [];
    if (isCollege(lg)) {
      if (conf) evs = evs.filter(e => e.competitions[0].competitors.some(c => T.byId[c.team.id]?.conf === conf));
      else if (filter === 'top25') evs = evs.filter(e => e.competitions[0].competitors.some(c => c.curatedRank?.current <= 25));
      evs.sort((a, b) => best(a) - best(b));
    }
    const live = evs.filter(e => e.status?.type?.state === 'in');
    const ord = [...live, ...evs.filter(e => e.status?.type?.state === 'pre'), ...evs.filter(e => e.status?.type?.state === 'post')];
    const el = app.querySelector('#g');
    if (!el) return;
    app.querySelector('#cnt').textContent = `${ord.length} game${ord.length === 1 ? '' : 's'}${live.length ? ` · ${live.length} live (auto-refreshing)` : ''}`;
    el.innerHTML = ord.map(e => gameCard(e, lg, T)).join('') || '<div class="empty">No games on this date.</div>';
    if (live.length) timer = setTimeout(load, 25000);
  };
  load();
}
function best(e) { return Math.min(...e.competitions[0].competitors.map(c => c.curatedRank?.current || 99)); }
