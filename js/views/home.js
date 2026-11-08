import { L, isPro, isCollege } from '../league.js?v=65d43e4ab4';
import { esc, logoFor, ymd } from '../util.js?v=65d43e4ab4';
import { espn, repo, safe } from '../api.js?v=65d43e4ab4';
import { state, teams, favs, recents } from '../ctx.js?v=65d43e4ab4';
import { gameCard, newsList, gameStatus } from './common.js?v=65d43e4ab4';

export async function render(app, lg) {
  const T = await teams(lg);
  const saved = (() => { try { return JSON.parse(localStorage.getItem('cs-pick-' + lg) || '[]'); } catch { return []; } })();
  let pickA = T.byId[saved[0]] || null, pickB = T.byId[saved[1]] || null;
  app.innerHTML = `
    <div class="row wrap" style="margin-bottom:12px"><h1 class="h1">${L(lg).name} matchup prep</h1><span class="sp"></span><span class="mut small">Pick any two teams for full notes on both rosters</span></div>
    <div class="hero">
      <div class="pick" id="pA"></div>
      <div class="vs">VS</div>
      <div class="pick" id="pB"></div>
    </div>
    <div class="row" style="justify-content:center;margin:14px 0 4px;gap:10px">
      <button class="btn pri" id="go" style="padding:11px 26px;font-size:15px">Build full notes →</button>
      <button class="btn" id="swap" title="Swap teams">⇄ Swap</button>
    </div>
    <div id="quick" style="margin-top:18px"></div>
    <div class="grid g-side" style="margin-top:22px">
      <div>
        <div class="row" style="margin-bottom:10px"><h2 class="h2" style="margin:0">Today's games</h2><span class="sp"></span><a class="link small" href="#/${lg}/scores">All scores &amp; dates →</a></div>
        <div id="today" class="games"><div class="loading">Loading games…</div></div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="card" id="snap"><div class="loading"></div></div>
        <div class="card"><h3 class="h3">Latest ${isPro(lg) ? L(lg).name : L(lg).full} news</h3><div id="news"><div class="loading"></div></div></div>
      </div>
    </div>`;

  const combo = (el, label, getSel, setSel) => {
    const draw = () => {
      const t = getSel();
      el.innerHTML = `<div class="pick-lbl">${label}</div>
        <div class="combo"><input placeholder="Type a team name…" value="" aria-label="${label}"><div class="opts hidden"></div></div>
        <div class="sel">${t ? `<img src="${esc(logoFor(t, state.theme))}" alt=""><div>${esc(t.name)}<div class="small mut" style="font-family:var(--font);text-transform:none;font-weight:500">${esc(t.conf || '')}${t.division ? ' · ' + esc(t.division) : ''}</div></div>` : '<span class="mut" style="font-size:16px">No team selected</span>'}</div>`;
      const inp = el.querySelector('input'), opts = el.querySelector('.opts');
      const show = () => {
        const qv = inp.value.trim().toLowerCase();
        const hits = T.list.filter(x => !qv || [x.name, x.abbr, x.location, x.nick, x.conf].some(s => (s || '').toLowerCase().includes(qv))).slice(0, isPro(lg) ? 30 : 60);
        opts.innerHTML = hits.map(x => `<div class="opt" data-id="${x.id}"><img src="${esc(logoFor(x, state.theme))}" alt="" loading="lazy"><span>${esc(x.name)}</span><span class="mut">${esc(x.confAbbr || x.conf || '')}</span></div>`).join('') || '<div class="empty small">No team found</div>';
        opts.classList.remove('hidden');
      };
      inp.addEventListener('focus', show);
      inp.addEventListener('input', show);
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { const f = opts.querySelector('.opt'); if (f) f.click(); }
        if (ev.key === 'Escape') opts.classList.add('hidden');
      });
      opts.addEventListener('mousedown', ev => {
        const o = ev.target.closest('.opt');
        if (!o) return;
        setSel(T.byId[o.dataset.id]);
        draw();
      });
      inp.addEventListener('blur', () => setTimeout(() => opts.classList.add('hidden'), 150));
    };
    draw();
    return draw;
  };
  const save = () => { try { localStorage.setItem('cs-pick-' + lg, JSON.stringify([pickA?.id, pickB?.id])); } catch { /* ignore */ } };
  const drawA = combo(app.querySelector('#pA'), 'Team 1 (away)', () => pickA, t => { pickA = t; save(); });
  const drawB = combo(app.querySelector('#pB'), 'Team 2 (home)', () => pickB, t => { pickB = t; save(); });
  app.querySelector('#swap').onclick = () => { [pickA, pickB] = [pickB, pickA]; save(); drawA(); drawB(); };
  app.querySelector('#go').onclick = () => {
    if (pickA && pickB && pickA.id !== pickB.id) location.hash = `#/${lg}/matchup/${pickA.id}/${pickB.id}`;
    else if (pickA || pickB) location.hash = `#/${lg}/team/${(pickA || pickB).id}`;
    else alert('Pick at least one team.');
  };

  // favorites + recent matchups
  const drawQuick = () => {
    const f = favs.list(lg).map(id => T.byId[id]).filter(Boolean);
    const r = recents.list(lg).filter(x => T.byId[x.a] && T.byId[x.b]);
    const chip = t => `<img src="${esc(logoFor(t, state.theme))}" alt="">`;
    app.querySelector('#quick').innerHTML = (f.length || r.length) ? `<div class="grid g2">
      <div class="card"><div class="row"><h3 class="h3" style="margin:0">★ Favorites</h3><span class="sp"></span><span class="small mut">Click a team to pick it, or open its page</span></div>
        <div class="qk">${f.map(t => `<span class="qkt"><button data-pick="${t.id}" title="Use as a pick">${chip(t)}${esc(t.short || t.name)}</button><a href="#/${lg}/team/${t.id}" title="Team page">↗</a></span>`).join('') || '<span class="small mut">Star a team on its page to pin it here.</span>'}</div></div>
      <div class="card"><div class="row"><h3 class="h3" style="margin:0">Recent matchups</h3><span class="sp"></span>${r.length ? '<button class="btn sm" id="clrRec">Clear</button>' : ''}</div>
        <div class="qk">${r.map(x => `<a class="qkm" href="#/${lg}/matchup/${x.a}/${x.b}">${chip(T.byId[x.a])}${esc(T.byId[x.a].abbr)} <span class="mut2">@</span> ${chip(T.byId[x.b])}${esc(T.byId[x.b].abbr)}</a>`).join('') || '<span class="small mut">Matchups you open show up here.</span>'}</div></div></div>` : '';
    app.querySelector('#clrRec')?.addEventListener('click', () => { recents.clear(lg); drawQuick(); });
    app.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const t = T.byId[b.dataset.pick];
      if (!pickA || (pickA && pickB)) { pickA = t; if (pickB?.id === t.id) pickB = null; } else if (t.id !== pickA.id) pickB = t;
      save(); drawA(); drawB();
    }));
  };
  drawQuick();

  // today's games
  (async () => {
    const sb = await safe(espn.scoreboard(lg, ymd(new Date())), null);
    let evs = sb?.events || [];
    const el = app.querySelector('#today');
    if (!evs.length) {
      // next day with games
      const d = new Date(); d.setDate(d.getDate() + 1);
      const nx = await safe(espn.scoreboard(lg, ymd(d)), null);
      evs = nx?.events || [];
      if (evs.length) el.insertAdjacentHTML('beforebegin', '<div class="small mut" style="margin-bottom:6px">No games today. Tomorrow\'s slate:</div>');
    }
    if (isCollege(lg)) evs.sort((a, b) => rankScore(b) - rankScore(a));
    el.innerHTML = evs.length ? evs.slice(0, isCollege(lg) ? 60 : 30).map(e => gameCard(e, lg, T)).join('') : '<div class="empty">No games scheduled.</div>';
  })();

  // snapshot
  (async () => {
    const el = app.querySelector('#snap');
    if (isPro(lg)) {
      const pw = await safe(repo(`${lg}/power.json`), null);
      const rows = (pw?.rows || []).slice(0, 10);
      el.innerHTML = `<div class="row"><h3 class="h3" style="margin:0">Power rankings</h3><span class="sp"></span><a class="link small" href="#/${lg}/league?tab=power">Full list →</a></div>
        <table class="t" style="margin-top:6px"><tbody>${rows.map(r => {
          const t = T.byId[r.id] || {}; const mv = r.prev ? r.prev - r.rank : 0;
          return `<tr><td class="l" style="width:24px"><b>${r.rank}</b></td><td class="l"><a class="tm" href="#/${lg}/team/${t.id}"><img src="${esc(logoFor(t, state.theme))}" alt="">${esc(t.short || t.name)}</a></td><td>${r.w}-${r.l}</td><td class="pr-move ${mv > 0 ? 'good' : mv < 0 ? 'bad' : 'mut2'}">${mv > 0 ? '▲' + mv : mv < 0 ? '▼' + -mv : '–'}</td></tr>`;
        }).join('')}</tbody></table>`;
    } else {
      const rk = await safe(espn.rankings(lg), null);
      const ap = rk?.rankings?.find(r => /AP/.test(r.name)) || rk?.rankings?.[0];
      el.innerHTML = `<div class="row"><h3 class="h3" style="margin:0">${esc(ap?.name || 'AP Top 25')}</h3><span class="sp"></span><a class="link small" href="#/${lg}/league">Full poll →</a></div>
        <table class="t" style="margin-top:6px"><tbody>${(ap?.ranks || []).slice(0, 12).map(r => {
          const t = T.byId[r.team.id] || { id: r.team.id, name: r.team.location, logo: r.team.logos?.[0]?.href };
          const mv = r.previous ? r.previous - r.current : 0;
          return `<tr><td class="l" style="width:24px"><b>${r.current}</b></td><td class="l"><a class="tm" href="#/${lg}/team/${t.id}"><img src="${esc(logoFor(t, state.theme))}" alt="">${esc(t.short || t.name)}</a></td><td>${esc(r.recordSummary || '')}</td><td class="pr-move ${mv > 0 ? 'good' : mv < 0 ? 'bad' : 'mut2'}">${!r.previous ? 'NR' : mv > 0 ? '▲' + mv : mv < 0 ? '▼' + -mv : '–'}</td></tr>`;
        }).join('')}</tbody></table>`;
    }
  })();
  (async () => {
    const n = await safe(espn.news(lg, null, 10), null);
    app.querySelector('#news').innerHTML = newsList(n?.articles, { limit: 7 });
  })();
  void gameStatus;
}

function rankScore(e) {
  const c = e.competitions[0];
  const best = Math.min(...c.competitors.map(x => x.curatedRank?.current || 99));
  return (e.status?.type?.state === 'in' ? 100 : 0) + (99 - best);
}
