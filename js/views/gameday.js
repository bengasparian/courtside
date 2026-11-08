// Game Day: everything on one screen for a live broadcast.
// Both rosters side by side (big jersey numbers), the best note per player inline, tonight's live line on every row,
// click a row for quick notes in place, "Full card" slides out a drawer, and pregame notes collapse out of the way.
import { esc, f1, pct, ordinal, signed, stars, fmtTime, fmtDate } from '../util.js';
import { espn, safe } from '../api.js';
import { state, myNotes } from '../ctx.js';
import { teamData, roster } from '../teamdata.js';
import { playStyle, roleNotes, factNotes, teamStyle } from '../notes.js';
import { q } from './common.js';
import { bodyHTML } from './players.js';
import { storylines } from './matchup.js';
import { onLeave } from '../app.js';

const pref = {
  get(k, d) { try { return localStorage.getItem('cs-gd-' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cs-gd-' + k, v); } catch { /* ignore */ } },
};

export async function gamedayTab(body, A, B, lg) {
  const sort = { v: pref.get('sort', 'min') };
  const expanded = new Set();
  let live = null; // { state, detail, a, h, stats: {athleteId: {...}} }
  let showPre = pref.get('pre', '1') === '1';

  body.innerHTML = `
    <div class="gd-bar noprint">
      <div class="gd-live" id="gdLive"><span class="mut small">Looking for tonight's game…</span></div>
      <span class="sp"></span>
      <label class="gd-jump">Jump to #<input id="gdJump" inputmode="numeric" maxlength="3" placeholder="23" aria-label="Jump to jersey number"></label>
      <div class="subtabs" id="gdSort" style="margin:0"><button data-k="min">Rotation</button><button data-k="num">By number</button></div>
      <button class="btn sm" id="gdPre">${showPre ? 'Hide' : 'Show'} pregame notes</button>
    </div>
    <div id="gdPreWrap" class="${showPre ? '' : 'hidden'}"><div class="grid g3 gd-pre" id="gdPreGrid"><div class="loading"></div></div></div>
    <div class="gd-cols">
      <section class="gd-col" id="gdA"><div class="loading">Loading ${esc(A.name)}…</div></section>
      <section class="gd-col" id="gdB"><div class="loading">Loading ${esc(B.name)}…</div></section>
    </div>
    <div class="drawer hidden" id="drawer"><div class="drawer-in"><div class="row drawer-h"><b id="drawerT"></b><span class="sp"></span><button class="btn sm" id="drawerX">Close ✕</button></div><div id="drawerB" class="pc-b"></div></div></div>`;

  const [da, db] = await Promise.all([teamData(lg, A), teamData(lg, B)]);
  const rA = roster(lg, A), rB = roster(lg, B);
  const side = { a: { team: A, d: da, r: rA, el: body.querySelector('#gdA') }, b: { team: B, d: db, r: rB, el: body.querySelector('#gdB') } };

  // ---------- controls
  const sortBtns = body.querySelectorAll('#gdSort button');
  const markSort = () => sortBtns.forEach(b => b.classList.toggle('on', b.dataset.k === sort.v));
  markSort();
  body.querySelector('#gdSort').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sort.v = b.dataset.k; pref.set('sort', sort.v); markSort(); drawCols();
  });
  body.querySelector('#gdPre').addEventListener('click', e => {
    showPre = !showPre; pref.set('pre', showPre ? '1' : '0');
    body.querySelector('#gdPreWrap').classList.toggle('hidden', !showPre);
    e.target.textContent = `${showPre ? 'Hide' : 'Show'} pregame notes`;
  });
  const jump = body.querySelector('#gdJump');
  jump.addEventListener('input', () => {
    const n = jump.value.trim();
    body.querySelectorAll('.gd-row').forEach(r => r.classList.toggle('hit', !!n && r.dataset.no === n));
    const first = body.querySelector('.gd-row.hit');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  const key = e => {
    if (e.key === '/' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); jump.focus(); jump.select(); }
    if (e.key === 'Escape') closeDrawer();
  };
  document.addEventListener('keydown', key);
  onLeave(() => document.removeEventListener('keydown', key));

  // ---------- pregame strip: storylines, edges, projection + series
  const drawPre = () => {
    const grid = body.querySelector('#gdPreGrid');
    if (!grid) return;
    const ra = da.ranks || {}, rb = db.ranks || {}, n = da.n || db.n;
    const edgeRows = [['PPG', 'ppg', true, f1], ['Opp PPG', 'oppg', false, f1], ['ORtg', 'ortg', true, f1, 'ortg'], ['DRtg', 'drtg', false, f1, 'drtg'], ['Net', 'net', true, signed, 'net'], ['Pace', 'pace', null, f1, 'pace'], ['3P%', 'tpp', true, pct], ['REB', 'rpg', true, f1], ['TOV%', 'tovPct', false, f1, 'tovPct']];
    const edge = edgeRows.map(([l, k, hi, fmt, gl]) => {
      const va = ra[k], vb = rb[k];
      const ea = hi !== null && va != null && vb != null && (hi ? va > vb : va < vb);
      const eb = hi !== null && va != null && vb != null && (hi ? vb > va : vb < va);
      return `<tr><td class="${ea ? 'b' : ''}" style="color:${ea ? 'var(--a-txt)' : ''}">${va == null ? '–' : fmt(va)} <span class="rk">${ra.rk?.[k] ? ordinal(ra.rk[k]) : ''}</span></td><td class="mut" style="text-align:center">${l}${gl ? q(gl, lg) : ''}</td><td class="${eb ? 'b' : ''}" style="color:${eb ? 'var(--b-txt)' : ''}"><span class="rk">${rb.rk?.[k] ? ordinal(rb.rk[k]) : ''}</span> ${vb == null ? '–' : fmt(vb)}</td></tr>`;
    }).join('');
    const meetings = da.events.filter(e => e.oppId === B.id);
    let proj = '';
    if (da.bpi?.bpi != null && db.bpi?.bpi != null) {
      const next = meetings.find(e => e.state !== 'post');
      const hca = next?.neutral ? 0 : (lg === 'nba' ? 2.2 : 3.2);
      const m = (db.bpi.bpi - da.bpi.bpi) + hca;
      const pB = 1 / (1 + Math.exp(-1.7 * m / (lg === 'nba' ? 12.5 : 10.5)));
      proj = `<div class="small"><b>Projection:</b> ${esc((m >= 0 ? B : A).abbr)} by ${Math.abs(m).toFixed(1)} · win prob ${esc(A.abbr)} ${Math.round((1 - pB) * 100)}% / ${esc(B.abbr)} ${Math.round(pB * 100)}% <span class="mut2">(BPI estimate)</span></div>`;
    }
    const series = meetings.length ? meetings.map(e => e.state === 'post' ? `<span class="${e.win ? 'good' : 'bad'}">${fmtDate(e.date, { month: 'short', day: 'numeric' })}: ${esc(A.abbr)} ${e.win ? 'W' : 'L'} ${e.us}-${e.them}</span>` : `<span class="mut">${fmtDate(e.date, { month: 'short', day: 'numeric' })}${e.note ? ' · ' + esc(e.note) : ''}</span>`).join(' · ') : '<span class="mut">No other meetings this season.</span>';
    const stories = storylines(A, B, da, db, lg, rA, rB);
    grid.innerHTML = `
      <div class="card gd-card"><h3 class="h3">Storylines</h3><ul class="notes small">${stories.slice(0, 9).map(s => `<li>${s}</li>`).join('')}</ul></div>
      <div class="card gd-card"><h3 class="h3">Edge sheet</h3><table class="minitable gd-edge"><thead><tr><th style="text-align:left;color:var(--a-txt)">${esc(A.abbr)}</th><th></th><th style="color:var(--b-txt)">${esc(B.abbr)}</th></tr></thead><tbody>${edge}</tbody></table><div class="tiny mut2" style="margin-top:4px">${n ? `League rank of ${n} · bold = edge` : ''}</div></div>
      <div class="card gd-card"><h3 class="h3">Series, projection &amp; style</h3>${proj}<div class="small" style="margin-top:6px"><b>Season series:</b> ${series}</div>
        <div class="small" style="margin-top:8px"><b style="color:var(--a-txt)">${esc(A.abbr)}:</b> ${esc(teamStyle(ra, lg, n).slice(0, 2).join(' ') || 'No clear tendencies yet.')}</div>
        <div class="small" style="margin-top:4px"><b style="color:var(--b-txt)">${esc(B.abbr)}:</b> ${esc(teamStyle(rb, lg, n).slice(0, 2).join(' ') || 'No clear tendencies yet.')}</div></div>`;
  };

  // ---------- team columns
  const teamHead = (s, key) => {
    const { team: t, d } = s;
    const st = d.std, r = d.ranks || {}, rk = r.rk || {}, n = d.n;
    const chips = [];
    if (lg === 'nba') {
      if (st) chips.push(st.overall || `${st.w}-${st.l}`, st.seed ? `${ordinal(st.seed)} ${st.confAbbr || ''}` : '', st.streak ? st.streak : '', st.last10 ? `L10 ${st.last10}` : '');
      if (d.power) chips.push(`Power #${d.power.rank}`);
    } else {
      const ap = d.polls?.find(p => /AP/.test(p.name));
      if (ap) chips.push(`AP #${ap.rank.current}`);
      if (st) chips.push(st.overall, `${st.conf || '0-0'} conf`);
      if (d.bpi?.bpirank) chips.push(`BPI #${d.bpi.bpirank}`);
    }
    const kp = (l, v, k, fmt = f1) => `<span class="gd-k"><span class="mut2">${l}</span> <b>${v == null ? '–' : fmt(v)}</b>${rk[k] ? `<span class="rk ${rk[k] <= n * 0.2 ? 'top' : rk[k] > n * 0.8 ? 'bot' : ''}">${ordinal(rk[k])}</span>` : ''}</span>`;
    const hurt = s.r.players.filter(p => p.injShort);
    return `<div class="gd-head gd-${key}"><img src="${esc(t.logo)}" alt=""><div style="min-width:0"><div class="gd-name">${esc(t.name)}</div><div class="gd-chips">${chips.filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('')}${s.r.coach ? `<span>Coach ${esc(s.r.coach.lastName)}</span>` : ''}</div></div><span class="sp"></span><span class="gd-score" data-score="${key}"></span></div>
      <div class="gd-team">${kp('PPG', r.ppg, 'ppg')}${kp('OPP', r.oppg, 'oppg')}${kp('ORtg', r.ortg, 'ortg')}${kp('DRtg', r.drtg, 'drtg')}${kp('Pace', r.pace, 'pace')}${kp('3P%', r.tpp, 'tpp', v => f1(v))}
        ${hurt.length ? `<div class="gd-inj"><b>Injuries:</b> ${hurt.map(p => `#${esc(p.jersey ?? '')} ${esc(p.last || p.name)} (${esc(p.injShort)})`).join(', ')}</div>` : ''}</div>`;
  };

  const oneLiner = (p, ros) => {
    if (p.injShort && /out/i.test(p.injShort)) return `⚕ ${p.injury}`;
    const facts = factNotes(p, ros, lg, { wiki: p.wiki });
    const hot = facts.find(x => /Heating up|20\+ in|Double-doubles in|Hot from deep|Cooling off|Milestone/.test(x));
    if (hot) return hot;
    const ps = playStyle(p, lg).filter(x => !x.startsWith('('));
    const pick = ps.find(x => /Knockdown|Rim protector|Primary playmaker|Gets to the line|Strong rebounder|Active hands|Elite ball|Automatic|Struggles at the line|Turnover-prone|Perimeter-oriented/.test(x)) || ps[0];
    return pick || roleNotes(p, ros, lg)[0] || '';
  };

  const liveCell = (p) => {
    const L = live?.stats?.[p.id];
    if (!live || live.state === 'pre') return '';
    if (!L) return '<span class="gd-tn mut2">DNP</span>';
    const pfCls = lg === 'nba' ? (L.pf >= 5 ? 'red' : L.pf >= 4 ? 'amber' : '') : (L.pf >= 4 ? 'red' : L.pf >= 3 ? 'amber' : '');
    return `<span class="gd-tn"><b>${L.pts}</b>p ${L.reb}r ${L.ast}a <span class="mut2">${esc(L.fg)} FG · ${esc(L.tp)} 3P · ${L.min}m</span>${L.pf ? ` <span class="chip ${pfCls}" title="Personal fouls">${L.pf} PF</span>` : ''}</span>`;
  };

  const quick = (p, ros) => {
    const style = playStyle(p, lg).filter(x => !x.startsWith('(')).slice(0, 3);
    const role = roleNotes(p, ros, lg).slice(0, 2);
    const facts = factNotes(p, ros, lg, { wiki: p.wiki }).slice(0, 6);
    const bg = [];
    if (p.birthPlace) bg.push(`From ${p.birthPlace}`);
    const hs = p.recruit?.hs || p.portal?.[0]?.hs || p.wiki?.hs;
    if (hs) bg.push(`HS: ${hs}`);
    if (lg === 'cbb' && p.recruit?.stars) bg.push(`${stars(p.recruit.stars)} ${p.recruit.rank ? '#' + p.recruit.rank + ' ' : ''}(${p.recruit.cls})`);
    if (lg === 'cbb' && p.schoolPath?.length > 1) bg.push(`Path: ${p.schoolPath.map(x => x.nm).join(' → ')}`);
    if (lg === 'nba' && (p.college || p.wiki?.college)) bg.push(`College: ${p.college || p.wiki.college}`);
    if (lg === 'nba' && p.draft) bg.push(`Draft: ${p.draft}`);
    if (p.mock) bg.push(`Mock draft #${p.mock.pick}`);
    if (p.wiki?.nickname) bg.push(`Nickname: ${p.wiki.nickname}`);
    const a = p.cur?.a, x = p.adv;
    const adv = x ? `TS ${f1(x.ts)}% · eFG ${f1(x.efg)}%${x.usg != null ? ` · USG ${f1(x.usg)}%` : ''}${x.per != null ? ` · PER ${f1(x.per)}` : ''} · GmSc ${f1(x.gmsc)}` : '';
    const car = p.career ? `Career: ${f1(p.career.avgPoints)} / ${f1(p.career.avgRebounds)} / ${f1(p.career.avgAssists)} in ${p.career.gamesPlayed} games` : '';
    const last = (p.gamelog || []).slice(0, 5).map(g => `<span title="${esc(g.atVs || '')} ${esc(g.opp)} ${esc(g.result || '')} ${esc(g.score || '')}">${esc(g.opp)} <b>${g.pts ?? '–'}</b>/${g.reb ?? '–'}/${g.ast ?? '–'}</span>`).join(' · ');
    const nk = `${lg}:${p.id}`;
    return `<div class="gd-quick">
      <div><div class="h3">Style &amp; role</div><ul class="notes small">${[...style, ...role].map(s => `<li>${esc(s)}</li>`).join('') || '<li class="mut">Not enough minutes yet.</li>'}</ul>
        ${adv ? `<div class="small mut" style="margin-top:4px">${adv}</div>` : ''}${car ? `<div class="small mut">${car}</div>` : ''}</div>
      <div><div class="h3">Talking points</div><ul class="notes small">${facts.map(s => `<li>${esc(s)}</li>`).join('') || '<li class="mut">Loading…</li>'}</ul></div>
      <div><div class="h3">Background</div><div class="small">${bg.map(esc).join('<br>') || '<span class="mut">Loading…</span>'}</div>
        ${last ? `<div class="h3" style="margin-top:8px">Last 5 (pts/reb/ast)</div><div class="small">${last}</div>` : ''}
        ${p.rotowire?.headline ? `<div class="h3" style="margin-top:8px">Latest</div><div class="small">${esc(p.rotowire.headline)}</div>` : ''}
        <textarea class="mynotes" data-key="${esc(nk)}" placeholder="My notes (saved in this browser)" style="margin-top:8px;min-height:44px">${esc(myNotes.get(nk))}</textarea>
        <button class="btn sm" data-full="${p.id}" style="margin-top:6px">Full card ↗</button></div>
    </div>`;
  };

  const row = (p, ros, key) => {
    const a = p.cur?.a;
    const line = a ? `${f1(a.avgPoints)} <span class="mut2">pts</span> ${f1(a.avgRebounds)} <span class="mut2">reb</span> ${f1(a.avgAssists)} <span class="mut2">ast</span> <span class="mut">${f1(a.fieldGoalPct)} FG · ${f1(a.threePointFieldGoalPct ?? a.threePointPct)} 3P · ${f1(a.avgMinutes)}m</span>` : `<span class="mut">${p.loaded.stats ? 'No games this season' : 'loading…'}</span>`;
    const tags = [];
    if (p.injShort) tags.push(`<span class="chip red">${esc(p.injShort)}</span>`);
    if (lg === 'cbb' && p.recruit?.stars >= 4) tags.push(`<span class="chip amber">${p.recruit.stars}★${p.recruit.rank ? ' #' + p.recruit.rank : ''}</span>`);
    if (lg === 'cbb' && (p.portal?.[0]?.from || p.transferFrom)) tags.push(`<span class="chip">↪ ${esc(p.portal?.[0]?.from || p.transferFrom)}</span>`);
    if (p.mock) tags.push(`<span class="chip green">Mock #${p.mock.pick}</span>`);
    if (lg === 'nba' && p.expYears === 0) tags.push('<span class="chip amber">Rookie</span>');
    const isOpen = expanded.has(p.id);
    return `<div class="gd-row ${isOpen ? 'open' : ''}" data-pid="${p.id}" data-no="${esc(p.jersey ?? '')}" data-side="${key}">
      <div class="gd-main">
        <div class="gd-no">${esc(p.jersey ?? '–')}</div>
        <img class="gd-hs" src="${esc(p.headshot || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="gd-who"><div class="gd-pn">${esc(p.name)} ${tags.join(' ')}</div>
          <div class="gd-bio">${esc([p.pos, p.ht, lg === 'cbb' ? p.exp : (p.age ? 'Age ' + p.age : ''), p.wt].filter(Boolean).join(' · '))}</div>
          <div class="gd-line">${line}</div>
          <div class="gd-live-line" data-live="${p.id}">${liveCell(p)}</div>
          <div class="gd-one">${esc(oneLiner(p, ros))}</div></div>
      </div>
      ${isOpen ? quick(p, ros) : ''}
    </div>`;
  };

  const ordered = (ros) => {
    const ps = ros.players.slice();
    if (sort.v === 'num') return ps.sort((x, y) => (x.jersey === undefined || x.jersey === '' ? 999 : +x.jersey) - (y.jersey === undefined || y.jersey === '' ? 999 : +y.jersey));
    // rotation order: tonight's starters first if live, else by minutes
    return ps.sort((x, y) => {
      const sx = live?.stats?.[x.id]?.starter ? 1 : 0, sy = live?.stats?.[y.id]?.starter ? 1 : 0;
      if (sx !== sy) return sy - sx;
      return (y.cur?.a?.avgMinutes || 0) - (x.cur?.a?.avgMinutes || 0);
    });
  };

  const drawCol = (key) => {
    const s = side[key];
    if (!s.r.ready) return;
    const ta = s.el.querySelector('textarea.mynotes:focus');
    if (ta) return; // never redraw while typing
    const ps = ordered(s.r);
    let html = teamHead(s, key) + '<div class="gd-list">';
    let starterBreak = sort.v === 'min' && live && live.state !== 'pre';
    ps.forEach((p, i) => {
      if (starterBreak && i > 0 && !live.stats?.[p.id]?.starter && live.stats?.[ps[i - 1].id]?.starter) html += '<div class="gd-div">Bench</div>';
      html += row(p, s.r.players, key);
    });
    html += '</div>';
    s.el.innerHTML = html;
    updateScores();
  };
  const drawCols = () => { drawCol('a'); drawCol('b'); };

  // clicks: expand/collapse rows, open drawer
  for (const key of ['a', 'b']) {
    const el = side[key].el;
    el.addEventListener('click', e => {
      const full = e.target.closest('[data-full]');
      if (full) { openDrawer(key, full.dataset.full); return; }
      if (e.target.closest('textarea, a, button, input')) return;
      const r = e.target.closest('.gd-row');
      if (!r) return;
      const id = r.dataset.pid;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      const p = side[key].r.players.find(x => x.id === id);
      const tmp = document.createElement('div');
      tmp.innerHTML = row(p, side[key].r.players, key);
      r.replaceWith(tmp.firstElementChild);
    });
    el.addEventListener('input', e => { const t = e.target.closest('textarea.mynotes'); if (t) myNotes.set(t.dataset.key, t.value); });
  }

  // drawer with the complete player card
  const drawer = body.querySelector('#drawer');
  function openDrawer(key, id) {
    const s = side[key];
    const p = s.r.players.find(x => x.id === id);
    if (!p) return;
    body.querySelector('#drawerT').textContent = `#${p.jersey ?? ''} ${p.name} · ${s.team.abbr}`;
    body.querySelector('#drawerB').innerHTML = bodyHTML(p, lg, s.r.players);
    drawer.classList.remove('hidden');
  }
  function closeDrawer() { drawer.classList.add('hidden'); }
  body.querySelector('#drawerX').addEventListener('click', closeDrawer);
  drawer.addEventListener('click', e => { if (e.target === drawer) closeDrawer(); });
  drawer.addEventListener('input', e => { const t = e.target.closest('textarea.mynotes'); if (t) myNotes.set(t.dataset.key, t.value); });

  // progressive updates as player details arrive
  let tmr;
  const sched = () => { clearTimeout(tmr); tmr = setTimeout(() => { drawCols(); drawPre(); }, 450); };
  const u1 = rA.subscribe(sched), u2 = rB.subscribe(sched);
  onLeave(u1); onLeave(u2);
  drawPre(); drawCols();

  // ---------- live game hookup
  const now = Date.now();
  const ev = da.events.find(e => e.oppId === B.id && (e.state === 'in' || (Math.abs(new Date(e.date) - now) < 16 * 3600e3)));
  const liveEl = body.querySelector('#gdLive');
  if (!ev) {
    const next = da.events.find(e => e.oppId === B.id && e.state === 'pre');
    liveEl.innerHTML = next ? `<span class="small"><b>Next meeting:</b> ${esc(fmtDate(next.date))} · ${esc(fmtTime(next.date))}${next.tv ? ' · ' + esc(next.tv) : ''}${next.venue ? ' · ' + esc(next.venue) : ''}</span>` : '<span class="small mut">No game between these teams today. Live stats appear here automatically on game day.</span>';
    return;
  }
  let timer;
  onLeave(() => clearTimeout(timer));
  const poll = async () => {
    const s = await safe(espn.summary(lg, ev.id, 0), null);
    if (!document.body.contains(body)) return;
    if (s?.header) {
      const comp = s.header.competitions[0];
      const st = comp.status.type;
      const aw = comp.competitors.find(c => c.homeAway === 'away'), hm = comp.competitors.find(c => c.homeAway === 'home');
      const stats = {};
      for (const tp of s.boxscore?.players || []) {
        const sst = tp.statistics?.[0];
        if (!sst) continue;
        const idx = (k) => (sst.names || sst.keys || []).indexOf(k);
        const lab = (k) => (sst.labels || []).indexOf(k);
        const get = (r, nameKey, label) => { const i = idx(nameKey) >= 0 ? idx(nameKey) : lab(label); return i >= 0 ? r.stats?.[i] : undefined; };
        for (const r of sst.athletes || []) {
          if (r.didNotPlay || !r.stats?.length) continue;
          stats[r.athlete.id] = {
            starter: r.starter, min: get(r, 'minutes', 'MIN') ?? '0', pts: +(get(r, 'points', 'PTS') ?? 0), reb: +(get(r, 'rebounds', 'REB') ?? 0), ast: +(get(r, 'assists', 'AST') ?? 0),
            fg: get(r, 'fieldGoalsMade-fieldGoalsAttempted', 'FG') ?? '', tp: get(r, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT') ?? '', pf: +(get(r, 'fouls', 'PF') ?? 0),
          };
        }
      }
      const was = live?.state;
      live = { state: st.state, detail: st.state === 'pre' ? `${fmtDate(comp.date)} · ${fmtTime(comp.date)}` : st.shortDetail || st.detail, aw, hm, stats };
      const tv = (comp.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(', ');
      liveEl.innerHTML = `<a href="#/${lg}/game/${ev.id}" class="gd-sc" title="Open full box score">${st.state === 'in' ? '<span class="livedot"></span>' : ''}<b>${esc(aw.team.abbreviation)} ${st.state === 'pre' ? '' : esc(aw.score)}</b><span class="mut2">–</span><b>${st.state === 'pre' ? '' : esc(hm.score)} ${esc(hm.team.abbreviation)}</b><span class="${st.state === 'in' ? 'bad b' : 'mut'} small">${esc(live.detail)}</span>${tv ? `<span class="mut small">${esc(tv)}</span>` : ''}<span class="link small">Box score →</span></a>`;
      if (was !== live.state || sort.v === 'min' && !was) drawCols();
      else for (const k of ['a', 'b']) for (const p of side[k].r.players) { const c = side[k].el.querySelector(`[data-live="${p.id}"]`); if (c) c.innerHTML = liveCell(p); }
      updateScores();
      if (st.state === 'in') timer = setTimeout(poll, 20000);
      else if (st.state === 'pre') timer = setTimeout(poll, 60000);
      // collapse pregame notes automatically once the game tips (only if user hasn't chosen)
      if (st.state === 'in' && pref.get('pre', null) === null) { showPre = false; body.querySelector('#gdPreWrap').classList.add('hidden'); body.querySelector('#gdPre').textContent = 'Show pregame notes'; }
    } else timer = setTimeout(poll, 30000);
  };
  function updateScores() {
    if (!live || live.state === 'pre') return;
    for (const [k, c] of [['a', live.aw], ['b', live.hm]]) {
      const el = body.querySelector(`[data-score="${k}"]`);
      const team = side[k].team;
      const comp = [live.aw, live.hm].find(x => x?.team?.id === team.id);
      if (el && comp) el.textContent = comp.score ?? '';
      void c;
    }
  }
  poll();
}
