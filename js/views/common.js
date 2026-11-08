// Shared building blocks for views.
import { esc, ordinal, logoFor, fmtTime, fmtDate, ago } from '../util.js';
import { GLOSSARY } from '../notes.js';
import { state } from '../ctx.js';

export function gameStatus(e) {
  const t = e?.status?.type || e?.competitions?.[0]?.status?.type || {};
  const state = t.state;
  let short = t.shortDetail || t.detail || '';
  if (state === 'pre') short = `${fmtDate(e.date, { month: 'short', day: 'numeric' })} · ${fmtTime(e.date)}`;
  return { state, short, completed: t.completed };
}

export function awayHome(comp) {
  const c = comp.competitors || [];
  return [c.find(x => x.homeAway === 'away') || c[0], c.find(x => x.homeAway === 'home') || c[1]];
}

/** Tooltip "?" with what a stat means. */
export function q(key, lg = state.lg) {
  const g = GLOSSARY[key];
  if (!g) return '';
  const ctx = g[lg] || '';
  return `<span class="q" tabindex="0">?<span class="tip"><b>${esc(g.name)}</b>${esc(g.what)}${ctx ? '<br><br>' + esc(ctx) : ''}</span></span>`;
}

export function rankCls(r, n) {
  if (!r || !n) return '';
  if (r <= Math.ceil(n * 0.2)) return 'top';
  if (r > n - Math.ceil(n * 0.2)) return 'bot';
  return '';
}

export function kpi(label, value, { rank, n, gloss, sub } = {}) {
  return `<div class="kpi"><div class="k">${esc(label)}${gloss ? q(gloss) : ''}</div><div class="v">${value}</div>${rank ? `<div class="r ${rankCls(rank, n)}">${ordinal(rank)} of ${n}</div>` : sub ? `<div class="r">${sub}</div>` : ''}</div>`;
}

export function gameCard(e, lg, T, { prep = true } = {}) {
  const c = e.competitions[0];
  const st = gameStatus(e);
  const [aw, hm] = awayHome(c);
  const row = (x) => {
    const t = T.byId[x.team.id] || {};
    const rk = x.curatedRank?.current && x.curatedRank.current <= 25 ? `<span class="mut2 small">${x.curatedRank.current}</span> ` : '';
    const rec = x.records?.[0]?.summary || '';
    const lose = st.state === 'post' && !x.winner;
    return `<div class="tr ${lose ? 'lose' : ''}"><img src="${esc(logoFor(t, state.theme) || x.team.logo)}" alt="" loading="lazy"><span class="nm">${rk}${esc(x.team.shortDisplayName || x.team.displayName)}</span><span class="rec">${esc(rec)}</span><span class="sc">${st.state === 'pre' ? '' : esc(x.score ?? '')}</span></div>`;
  };
  const tv = (c.broadcasts || []).flatMap(b => b.names || []).slice(0, 2).join(', ');
  const note = (c.notes || []).map(n => n.headline).filter(Boolean).join(' · ');
  return `<div class="gc ${st.state === 'in' ? 'live' : ''}">
    ${note ? `<div class="tiny mut">${esc(note)}</div>` : ''}
    ${row(aw)}${row(hm)}
    <div class="ft"><span class="stt">${st.state === 'in' ? '<span class="livedot"></span>' : ''}${esc(st.short)}${tv ? ' · ' + esc(tv) : ''}</span>
    <span class="acts"><a class="btn sm" href="#/${lg}/game/${e.id}">${st.state === 'pre' ? 'Preview' : 'Box score'}</a>${prep ? `<a class="btn sm pri" href="#/${lg}/matchup/${aw.team.id}/${hm.team.id}">Prep</a>` : ''}</span></div>
  </div>`;
}

export function newsList(articles, { limit = 8, img = true } = {}) {
  const arts = (articles || []).filter(a => a && (a.headline || a.h)).slice(0, limit);
  if (!arts.length) return '<div class="empty small">No recent news.</div>';
  return arts.map(a => {
    const h = a.headline || a.h, d = a.description || a.d, u = a.links?.web?.href || a.u, t = a.published || a.lastModified || a.t;
    const im = a.images?.[0]?.url || a.img;
    return `<a class="newsi" href="${esc(u || '#')}" target="_blank" rel="noopener">${img && im ? `<img src="${esc(im)}" alt="" loading="lazy">` : ''}<div><div class="hd">${esc(h)}</div>${d ? `<div class="ds">${esc(d)}</div>` : ''}<div class="tiny mut2">${esc(ago(t))}</div></div></a>`;
  }).join('');
}

export function teamCell(t, lg, { link = true } = {}) {
  if (!t) return '';
  const inner = `<img src="${esc(logoFor(t, state.theme))}" alt="" loading="lazy"><span>${esc(t.short || t.name)}</span>`;
  return link ? `<a class="tm" href="#/${lg}/team/${t.id}">${inner}</a>` : `<span class="tm">${inner}</span>`;
}

export function sortable(table) {
  table.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k, asc = th.dataset.dir !== 'asc';
    th.dataset.dir = asc ? 'asc' : 'desc';
    const rows = [...table.tBodies[0].rows];
    rows.sort((a, b) => {
      const x = a.dataset[k], y = b.dataset[k];
      const nx = parseFloat(x), ny = parseFloat(y);
      const cmp = (!isNaN(nx) && !isNaN(ny)) ? nx - ny : String(x).localeCompare(String(y));
      return asc ? cmp : -cmp;
    });
    rows.forEach(r => table.tBodies[0].appendChild(r));
  }));
}
