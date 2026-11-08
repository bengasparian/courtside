// Game Day: everything on one screen for a live broadcast.
// Sticky score bar (bonus / fouls / timeouts / last play), live panel (play-by-play, alerts, game flow),
// pregame notes (storylines, edges, projection, last meeting), and both rosters side by side with the best note,
// tonight's line, pronunciation, coach and roster changes. Quick notes open in place; the full card slides out.
import { L, L as LG_, isPro, isCollege } from '../league.js?v=fb64bb9f50';
import { esc, f1, pct, ordinal, signed, stars, fmtTime, fmtDate } from '../util.js?v=fb64bb9f50';
import { espn, safe } from '../api.js?v=fb64bb9f50';
import { state, myNotes, teams, pron, sayName } from '../ctx.js?v=fb64bb9f50';
import { teamData, roster, coachProfile, lastMeeting, rosterChanges } from '../teamdata.js?v=fb64bb9f50';
import { playStyle, roleNotes, factNotes, teamStyle } from '../notes.js?v=fb64bb9f50';
import { q } from './common.js?v=fb64bb9f50';
import { bodyHTML } from './players.js?v=fb64bb9f50';
import { storylines } from './matchup.js?v=fb64bb9f50';
import { onLeave, setKeys } from '../app.js?v=fb64bb9f50';

const pref = {
  get(k, d) { try { return localStorage.getItem('cs-gd-' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cs-gd-' + k, v); } catch { /* ignore */ } },
};
export async function gamedayTab(body, A, B, lg) {
  const sort = { v: pref.get('sort', 'min') };
  const expanded = new Set();
  let live = null; // { state, detail, aw, hm, stats, plays, period }
  let showPre = pref.get('pre', '1') === '1';
  let showLive = pref.get('live', '1') === '1';
  let showChanges = pref.get('chg', '1') === '1';
  let sel = null; // keyboard-selected row id
  const alerts = new Map(); // key -> {t, html, kind}
  const year = (await teamData(lg, A)).year;

  body.innerHTML = `
    <div class="gd-bar noprint">
      <div class="gd-live" id="gdLive"><span class="mut small">Looking for tonight's game…</span></div>
      <span class="sp"></span>
      <label class="gd-jump" title="Shortcut: /">Jump to #<input id="gdJump" inputmode="numeric" maxlength="3" placeholder="23" aria-label="Jump to jersey number"></label>
      <div class="subtabs" id="gdSort" style="margin:0"><button data-k="min" title="Shortcut: r">Rotation</button><button data-k="num" title="Shortcut: r">By number</button></div>
      <button class="btn sm" id="gdPre" title="Shortcut: p">${showPre ? 'Hide' : 'Show'} pregame</button>
      <button class="btn sm" id="gdKeys" title="Keyboard shortcuts">⌨ ?</button>
      <div class="gd-sit" id="gdSit"></div>
    </div>
    <div id="gdLiveWrap" class="hidden"><div class="gd-livepanel ${showLive ? '' : 'min'}" id="gdLivePanel"></div></div>
    <div id="gdPreWrap" class="${showPre ? '' : 'hidden'}"><div class="gd-pre" id="gdPreGrid"><div class="loading"></div></div></div>
    <div class="gd-cols">
      <section class="gd-col" id="gdA"><div class="loading">Loading ${esc(A.name)}…</div></section>
      <section class="gd-col" id="gdB"><div class="loading">Loading ${esc(B.name)}…</div></section>
    </div>
    <div class="drawer hidden" id="drawer"><div class="drawer-in"><div class="row drawer-h"><b id="drawerT"></b><span class="sp"></span><button class="btn sm" id="drawerX">Close ✕</button></div><div id="drawerB" class="pc-b"></div></div></div>`;

  const [da, db] = await Promise.all([teamData(lg, A), teamData(lg, B)]);
  const rA = roster(lg, A), rB = roster(lg, B);
  const side = { a: { team: A, d: da, r: rA, el: body.querySelector('#gdA') }, b: { team: B, d: db, r: rB, el: body.querySelector('#gdB') } };
  const extra = { coach: {}, changes: {}, last: null };

  // ---------- controls
  const sortBtns = body.querySelectorAll('#gdSort button');
  const markSort = () => sortBtns.forEach(b => b.classList.toggle('on', b.dataset.k === sort.v));
  markSort();
  const setSort = v => { sort.v = v; pref.set('sort', v); markSort(); drawCols(); };
  body.querySelector('#gdSort').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSort(b.dataset.k); });
  const togglePre = () => {
    showPre = !showPre; pref.set('pre', showPre ? '1' : '0');
    body.querySelector('#gdPreWrap').classList.toggle('hidden', !showPre);
    body.querySelector('#gdPre').textContent = `${showPre ? 'Hide' : 'Show'} pregame`;
  };
  body.querySelector('#gdPre').addEventListener('click', togglePre);
  body.querySelector('#gdKeys').addEventListener('click', () => window.__csHelp?.());
  const jump = body.querySelector('#gdJump');
  jump.addEventListener('input', () => {
    const n = jump.value.trim();
    body.querySelectorAll('.gd-row').forEach(r => r.classList.toggle('hit', !!n && r.dataset.no === n));
    const first = body.querySelector('.gd-row.hit');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  jump.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') jump.blur(); });

  // ---------- pregame strip
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
      const hca = next?.neutral ? 0 : L(lg).hca;
      const m = (db.bpi.bpi - da.bpi.bpi) + hca;
      const pB = 1 / (1 + Math.exp(-1.7 * m / L(lg).sd));
      proj = `<div class="small"><b>Projection:</b> ${esc((m >= 0 ? B : A).abbr)} by ${Math.abs(m).toFixed(1)} · win prob ${esc(A.abbr)} ${Math.round((1 - pB) * 100)}% / ${esc(B.abbr)} ${Math.round(pB * 100)}% <span class="mut2">(BPI estimate)</span></div>`;
    }
    const series = meetings.length ? meetings.map(e => e.state === 'post' ? `<span class="${e.win ? 'good' : 'bad'}">${fmtDate(e.date, { month: 'short', day: 'numeric' })}: ${esc(A.abbr)} ${e.win ? 'W' : 'L'} ${e.us}-${e.them}</span>` : `<span class="mut">${fmtDate(e.date, { month: 'short', day: 'numeric' })}${e.note ? ' · ' + esc(e.note) : ''}</span>`).join(' · ') : '<span class="mut">No other meetings this season.</span>';
    const stories = storylines(A, B, da, db, lg, rA, rB);
    const lm = extra.last;
    const lmHTML = lm === null ? '<div class="small mut">Looking up the last meeting…</div>' : !lm ? '<div class="small mut">No meeting in the last three seasons.</div>' : (() => {
      const e = lm.ev; const aWon = e.win;
      const tops = (tid, t) => (lm.top[tid] || []).map(x => `${esc(x.name)} ${x.pts}p ${x.reb}r ${x.ast}a`).join(', ');
      return `<div class="small"><b>${esc(fmtDate(e.date, { month: 'short', day: 'numeric', year: 'numeric' }))}</b>${lm.venue ? ' · ' + esc(lm.venue) : ''}${e.note ? ' · ' + esc(e.note) : ''}</div>
        <div style="font:700 18px var(--display);margin:4px 0"><span style="color:var(--a-txt)">${esc(A.abbr)} ${e.us}</span> – <span style="color:var(--b-txt)">${e.them} ${esc(B.abbr)}</span> <span class="small mut">${esc(aWon ? A.abbr : B.abbr)} won${e.ot ? ' (OT)' : ''}</span></div>
        <div class="small"><b style="color:var(--a-txt)">${esc(A.abbr)}:</b> ${tops(A.id) || '–'}</div><div class="small"><b style="color:var(--b-txt)">${esc(B.abbr)}:</b> ${tops(B.id) || '–'}</div>
        ${lm.article?.h ? `<div class="small" style="margin-top:6px"><b>Recap:</b> ${esc(lm.article.h)}${lm.article.d ? ` <span class="mut">${esc(lm.article.d)}</span>` : ''}</div>` : ''}
        <a class="link small" href="#/${lg}/game/${e.id}">Full box score →</a>`;
    })();
    grid.innerHTML = `
      <div class="card gd-card"><h3 class="h3">Storylines</h3><ul class="notes small">${stories.slice(0, 9).map(s => `<li>${s}</li>`).join('')}</ul></div>
      <div class="card gd-card"><h3 class="h3">Edge sheet</h3><table class="minitable gd-edge"><thead><tr><th style="text-align:left;color:var(--a-txt)">${esc(A.abbr)}</th><th></th><th style="color:var(--b-txt)">${esc(B.abbr)}</th></tr></thead><tbody>${edge}</tbody></table><div class="tiny mut2" style="margin-top:4px">${n ? `League rank of ${n} · bold = edge` : ''}</div></div>
      <div class="card gd-card"><h3 class="h3">Last meeting</h3>${lmHTML}</div>
      <div class="card gd-card"><h3 class="h3">Series, projection &amp; style</h3>${proj}<div class="small" style="margin-top:6px"><b>This season:</b> ${series}</div>
        <div class="small" style="margin-top:8px"><b style="color:var(--a-txt)">${esc(A.abbr)}:</b> ${esc(teamStyle(ra, lg, n).slice(0, 2).join(' ') || 'No clear tendencies yet.')}</div>
        <div class="small" style="margin-top:4px"><b style="color:var(--b-txt)">${esc(B.abbr)}:</b> ${esc(teamStyle(rb, lg, n).slice(0, 2).join(' ') || 'No clear tendencies yet.')}</div></div>`;
  };

  // ---------- team column parts
  const coachLine = (key) => {
    const c = extra.coach[key];
    const rc = side[key].r.coach;
    if (!rc) return '';
    if (!c) return `<div class="gd-coach"><b>Coach ${esc(rc.firstName)} ${esc(rc.lastName)}</b></div>`;
    const bits = [c.season ? `${c.season} this season` : '', c.career ? `${c.career} career` : (c.wiki?.overall ? `${c.wiki.overall} overall` : ''), c.seasons ? `${c.seasons} seasons as head coach` : (c.exp ? `${c.exp} yrs` : '')].filter(Boolean);
    const say = c.wiki?.pron ? ` <span class="gd-say">🔊 ${esc(c.wiki.pron)}</span>` : '';
    const more = [c.wiki?.extract ? esc(c.wiki.extract) : '', c.wiki?.highlights?.length ? `<b>Highlights:</b> ${c.wiki.highlights.slice(0, 6).map(esc).join(' · ')}` : '', c.born ? `Born ${esc(c.born)}${c.age ? ` (age ${c.age})` : ''}` : ''].filter(Boolean);
    return `<details class="gd-coach"><summary><b>Coach ${esc(c.name)}</b>${say}${bits.length ? ` · <span class="mut">${esc(bits.join(' · '))}</span>` : ''}</summary>${more.length ? `<div class="small" style="margin-top:4px">${more.join('<br>')}${c.wiki?.url ? ` <a class="link" href="${esc(c.wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div>` : '<div class="small mut">No additional background found.</div>'}</details>`;
  };

  const changesHTML = (key) => {
    const ch = extra.changes[key];
    const T = state._teamsById?.[lg] || {};
    if (ch === undefined) return `<details class="gd-chg" ${showChanges ? 'open' : ''}><summary>Roster changes since last season</summary><div class="small mut">Loading…</div></details>`;
    if (!ch) return '';
    const s = side[key];
    const addl = ch.additions.slice().sort((x, y) => (y.cur?.a?.avgMinutes || 0) - (x.cur?.a?.avgMinutes || 0)).slice(0, 8).map(p => {
      let from = '';
      if (p.prev && p.prev.teamId !== s.team.id) from = `from ${T[p.prev.teamId]?.short || (p.prev.teamSlug || '').replace(/-/g, ' ') || 'elsewhere'}`;
      else if (isCollege(lg) && !p.prev) from = p.recruit ? `freshman${p.recruit.stars ? ', ' + p.recruit.stars + '★' : ''}${p.recruit.rank ? ' #' + p.recruit.rank : ''}` : 'newcomer';
      else if (isPro(lg) && p.expYears === 0) from = `rookie${p.draft ? ', ' + p.draft.replace(/^\d{4}: /, '') : ''}`;
      else if (p.portal?.[0]?.from) from = `from ${p.portal[0].from}`;
      else from = 'new';
      const now = p.cur?.a?.gamesPlayed ? ` · ${f1(p.cur.a.avgPoints)} ppg` : '';
      return `<li><b>${esc(p.name)}</b> <span class="mut">(${esc(from)}${now})</span></li>`;
    }).join('');
    const outl = ch.departures.slice(0, 8).map(g => {
      const was = g.last ? `${f1(g.last.avgPoints)} ppg, ${f1(g.last.avgMinutes)} min last season` : 'little or no playing time';
      const now = g.nowTeamId ? `now ${T[g.nowTeamId]?.short || 'elsewhere'}` : (isCollege(lg) ? 'left the program' : 'no longer on a roster');
      return `<li><b>${esc(g.name)}</b> <span class="mut">(${esc(was)}; ${esc(now)})</span></li>`;
    }).join('');
    return `<details class="gd-chg" ${showChanges ? 'open' : ''}><summary>Roster changes since last season <span class="mut">(+${ch.additions.length} / −${ch.departures.length})</span></summary>
      <div class="gd-chg-in"><div><div class="tiny b good">IN</div><ul class="notes small">${addl || '<li class="mut">No new players</li>'}</ul></div><div><div class="tiny b bad">OUT</div><ul class="notes small">${outl || '<li class="mut">No departures</li>'}</ul></div></div></details>`;
  };

  const teamHead = (s, key) => {
    const { team: t, d } = s;
    const st = d.std, r = d.ranks || {}, rk = r.rk || {}, n = d.n;
    const chips = [];
    if (isPro(lg)) {
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
    return `<div class="gd-head gd-${key}"><img src="${esc(t.logo)}" alt=""><div style="min-width:0"><div class="gd-name">${esc(t.name)}</div><div class="gd-chips">${chips.filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('')}</div></div><span class="sp"></span><span class="gd-tsit" data-tsit="${key}"></span><span class="gd-score" data-score="${key}"></span></div>
      <div class="gd-team">${kp('PPG', r.ppg, 'ppg')}${kp('OPP', r.oppg, 'oppg')}${kp('ORtg', r.ortg, 'ortg')}${kp('DRtg', r.drtg, 'drtg')}${kp('Pace', r.pace, 'pace')}${kp('3P%', r.tpp, 'tpp', v => f1(v))}
        ${hurt.length ? `<div class="gd-inj"><b>Injuries:</b> ${hurt.map(p => `#${esc(p.jersey ?? '')} ${esc(p.last || p.name)} (${esc(p.injShort)})`).join(', ')}</div>` : ''}
        <div style="flex-basis:100%" data-coach="${key}">${coachLine(key)}</div>
        <div style="flex-basis:100%" data-chg="${key}">${changesHTML(key)}</div></div>`;
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
    const S = live?.stats?.[p.id];
    if (!live || live.state === 'pre') return '';
    if (!S) return '<span class="gd-tn mut2">DNP</span>';
    const fo = LG_(lg).foulOut;
    const pfCls = S.pf >= fo ? 'red' : S.pf >= fo - 1 ? 'red' : S.pf >= fo - 2 ? 'amber' : '';
    return `<span class="gd-tn"><b>${S.pts}</b>p ${S.reb}r ${S.ast}a${S.stl ? ` ${S.stl}s` : ''}${S.blk ? ` ${S.blk}b` : ''} <span class="mut2">${esc(S.fg)} FG · ${esc(S.tp)} 3P · ${S.min}m</span>${S.pf ? ` <span class="chip ${pfCls}" title="Personal fouls">${S.pf >= fo ? 'FOULED OUT' : S.pf + ' PF'}</span>` : ''}</span>`;
  };

  const quick = (p, ros) => {
    const style = playStyle(p, lg).filter(x => !x.startsWith('(')).slice(0, 7);
    const role = roleNotes(p, ros, lg).slice(0, 2);
    const facts = factNotes(p, ros, lg, { wiki: p.wiki }).slice(0, 6);
    const bg = [];
    if (p.birthPlace) bg.push(`From ${p.birthPlace}`);
    const hs = p.recruit?.hs || p.portal?.[0]?.hs || p.wiki?.hs;
    if (hs) bg.push(`HS: ${hs}`);
    if (isCollege(lg) && p.recruit?.stars) bg.push(`${stars(p.recruit.stars)} ${p.recruit.rank ? '#' + p.recruit.rank + ' ' : ''}(${p.recruit.cls})`);
    if (isCollege(lg) && p.schoolPath?.length > 1) bg.push(`Path: ${p.schoolPath.map(x => x.nm).join(' → ')}`);
    if (isPro(lg) && (p.college || p.wiki?.college)) bg.push(`College: ${p.college || p.wiki.college}`);
    if (isPro(lg) && p.draft) bg.push(`Draft: ${p.draft}`);
    if (p.mock) bg.push(`Mock draft #${p.mock.pick}`);
    if (p.wiki?.nickname) bg.push(`Nickname: ${p.wiki.nickname}`);
    const x = p.adv;
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
        <label class="small mut" style="display:block;margin-top:8px">🔊 Pronunciation${p.wiki?.pron ? ` <span class="tiny">(Wikipedia: ${esc(p.wiki.pron)})</span>` : ''}<input class="gd-pron" data-pron="${p.id}" value="${esc(pron.get(lg, p.id))}" placeholder="${esc(p.wiki?.pron || 'e.g. YAN-iss')}"></label>
        <textarea class="mynotes" data-key="${esc(nk)}" placeholder="My notes (saved in this browser)" style="margin-top:6px;min-height:44px">${esc(myNotes.get(nk))}</textarea>
        <button class="btn sm" data-full="${p.id}" style="margin-top:6px">Full card ↗</button></div>
    </div>`;
  };

  const row = (p, ros, key) => {
    const a = p.cur?.a;
    const line = a ? `${f1(a.avgPoints)} <span class="mut2">pts</span> ${f1(a.avgRebounds)} <span class="mut2">reb</span> ${f1(a.avgAssists)} <span class="mut2">ast</span> <span class="mut">${f1(a.fieldGoalPct)} FG · ${f1(a.threePointFieldGoalPct ?? a.threePointPct)} 3P · ${f1(a.avgMinutes)}m</span>` : `<span class="mut">${p.loaded.stats ? 'No games this season' : 'loading…'}</span>`;
    const tags = [];
    if (p.injShort) tags.push(`<span class="chip red">${esc(p.injShort)}</span>`);
    if (isCollege(lg) && p.recruit?.stars >= 4) tags.push(`<span class="chip amber">${p.recruit.stars}★${p.recruit.rank ? ' #' + p.recruit.rank : ''}</span>`);
    if (isCollege(lg) && (p.portal?.[0]?.from || p.transferFrom)) tags.push(`<span class="chip">↪ ${esc(p.portal?.[0]?.from || p.transferFrom)}</span>`);
    if (p.mock) tags.push(`<span class="chip green">Mock #${p.mock.pick}</span>`);
    if (isPro(lg) && p.expYears === 0) tags.push('<span class="chip amber">Rookie</span>');
    const say = sayName(p, lg);
    const isOpen = expanded.has(p.id);
    return `<div class="gd-row ${isOpen ? 'open' : ''} ${sel === p.id ? 'sel' : ''}" data-pid="${p.id}" data-no="${esc(p.jersey ?? '')}" data-side="${key}">
      <div class="gd-main">
        <div class="gd-no">${esc(p.jersey ?? '–')}</div>
        <img class="gd-hs" src="${esc(p.headshot || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="gd-who"><div class="gd-pn">${esc(p.name)}${say ? ` <span class="gd-say" title="Pronunciation">🔊 ${esc(say)}</span>` : ''} ${tags.join(' ')}</div>
          <div class="gd-bio">${esc([p.pos, p.ht, isCollege(lg) ? p.exp : (p.age ? 'Age ' + p.age : ''), p.wt].filter(Boolean).join(' · '))}</div>
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
    return ps.sort((x, y) => {
      const sx = live?.stats?.[x.id]?.starter ? 1 : 0, sy = live?.stats?.[y.id]?.starter ? 1 : 0;
      if (sx !== sy) return sy - sx;
      return (y.cur?.a?.avgMinutes || 0) - (x.cur?.a?.avgMinutes || 0);
    });
  };

  const drawCol = (key) => {
    const s = side[key];
    if (!s.r.ready) return;
    if (s.el.querySelector('textarea.mynotes:focus, input:focus')) return; // never redraw while typing
    const ps = ordered(s.r);
    let html = teamHead(s, key) + '<div class="gd-list">';
    const starterBreak = sort.v === 'min' && live && live.state !== 'pre';
    ps.forEach((p, i) => {
      if (starterBreak && i > 0 && !live.stats?.[p.id]?.starter && live.stats?.[ps[i - 1].id]?.starter) html += '<div class="gd-div">Bench</div>';
      html += row(p, s.r.players, key);
    });
    s.el.innerHTML = html + '</div>';
    updateScores();
  };
  const drawCols = () => { drawCol('a'); drawCol('b'); };
  const redrawPart = (attr, key, html) => { const el = side[key].el.querySelector(`[${attr}="${key}"]`); if (el) el.innerHTML = html; };

  const replaceRow = (key, id) => {
    const r = side[key].el.querySelector(`.gd-row[data-pid="${id}"]`);
    const p = side[key].r.players.find(x => x.id === id);
    if (!r || !p) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = row(p, side[key].r.players, key);
    r.replaceWith(tmp.firstElementChild);
  };
  const toggleRow = (key, id) => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); replaceRow(key, id); };

  for (const key of ['a', 'b']) {
    const el = side[key].el;
    el.addEventListener('click', e => {
      const full = e.target.closest('[data-full]');
      if (full) { openDrawer(key, full.dataset.full); return; }
      if (e.target.closest('textarea, a, button, input, summary, details')) return;
      const r = e.target.closest('.gd-row');
      if (r) { sel = r.dataset.pid; toggleRow(key, r.dataset.pid); }
    });
    el.addEventListener('input', e => {
      const t = e.target.closest('textarea.mynotes'); if (t) myNotes.set(t.dataset.key, t.value);
      const pr = e.target.closest('input.gd-pron'); if (pr) pron.set(lg, pr.dataset.pron, pr.value.trim());
    });
    el.addEventListener('change', e => { const pr = e.target.closest('input.gd-pron'); if (pr) replaceRow(key, pr.dataset.pron); });
    el.addEventListener('toggle', e => { if (e.target.classList?.contains('gd-chg')) { showChanges = e.target.open; pref.set('chg', showChanges ? '1' : '0'); } }, true);
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

  // ---------- keyboard shortcuts for this screen
  const visibleRows = () => [...body.querySelectorAll('.gd-row')];
  const moveSel = (dir) => {
    const rows = visibleRows();
    if (!rows.length) return;
    let i = rows.findIndex(r => r.dataset.pid === sel);
    i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + dir));
    rows.forEach(r => r.classList.remove('sel'));
    sel = rows[i].dataset.pid; rows[i].classList.add('sel');
    rows[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const selKey = () => body.querySelector(`.gd-row[data-pid="${sel}"]`)?.dataset.side;
  setKeys([
    ['/', 'Jump to a jersey number', () => { jump.focus(); jump.select(); }],
    ['j', 'Next player', () => moveSel(1)],
    ['k', 'Previous player', () => moveSel(-1)],
    ['Enter', 'Open / close quick notes for the selected player', () => { const k = selKey(); if (k) toggleRow(k, sel); }],
    ['f', 'Full card for the selected player', () => { const k = selKey(); if (k) openDrawer(k, sel); }],
    ['p', 'Show / hide pregame notes', togglePre],
    ['l', 'Expand / shrink the live panel', () => { showLive = !showLive; pref.set('live', showLive ? '1' : '0'); body.querySelector('#gdLivePanel')?.classList.toggle('min', !showLive); }],
    ['r', 'Switch rotation / number order', () => setSort(sort.v === 'min' ? 'num' : 'min')],
    ['b', 'Open the full box score', () => { if (ev) location.hash = `#/${lg}/game/${ev.id}`; }],
    ['Escape', 'Close the full card / clear search', () => { closeDrawer(); jump.value = ''; jump.dispatchEvent(new Event('input')); }],
  ]);

  // ---------- progressive updates as player details arrive
  let tmr;
  const sched = () => { clearTimeout(tmr); tmr = setTimeout(() => { drawCols(); drawPre(); }, 450); };
  const u1 = rA.subscribe(sched), u2 = rB.subscribe(sched);
  onLeave(u1); onLeave(u2);
  drawPre(); drawCols();

  // coach profiles, roster changes, last meeting (all lazy)
  const loadExtras = async () => {
    await Promise.all([rA.promise, rB.promise].map(p => p?.catch?.(() => null)));
    if (!document.body.contains(body)) return;
    for (const key of ['a', 'b']) {
      const s = side[key];
      coachProfile(lg, s.team, s.r.coach, year).then(c => { extra.coach[key] = c; redrawPart('data-coach', key, coachLine(key)); });
      rosterChanges(lg, s.team, s.r.players, year).then(c => { extra.changes[key] = c; redrawPart('data-chg', key, changesHTML(key)); });
    }
  };
  loadExtras();
  lastMeeting(lg, A, B, da, year).then(m => { extra.last = m || false; drawPre(); });

  // ---------- live game hookup
  const now = Date.now();
  const ev = da.events.find(e => e.oppId === B.id && (e.state === 'in' || (Math.abs(new Date(e.date) - now) < 16 * 3600e3)));
  const liveEl = body.querySelector('#gdLive');
  if (!ev) {
    const next = da.events.find(e => e.oppId === B.id && e.state === 'pre');
    liveEl.innerHTML = next ? `<span class="small"><b>Next meeting:</b> ${esc(fmtDate(next.date))} · ${esc(fmtTime(next.date))}${next.tv ? ' · ' + esc(next.tv) : ''}${next.venue ? ' · ' + esc(next.venue) : ''}</span>` : '<span class="small mut">No game between these teams today. Live stats, play-by-play and alerts appear here automatically on game day.</span>';
    return;
  }
  let timer;
  onLeave(() => clearTimeout(timer));

  const parseBox = (s) => {
    const stats = {};
    for (const tp of s.boxscore?.players || []) {
      const sst = tp.statistics?.[0];
      if (!sst) continue;
      const keys = sst.names || sst.keys || [];
      const labels = sst.labels || [];
      for (const r of sst.athletes || []) {
        if (r.didNotPlay || !r.stats?.length) continue;
        const get = (k, lab) => { let i = keys.indexOf(k); if (i < 0) i = labels.indexOf(lab); return i >= 0 ? r.stats[i] : undefined; };
        stats[r.athlete.id] = {
          name: r.athlete.displayName, team: tp.team.id, starter: r.starter, min: get('minutes', 'MIN') ?? '0',
          pts: +(get('points', 'PTS') ?? 0), reb: +(get('rebounds', 'REB') ?? 0), ast: +(get('assists', 'AST') ?? 0), stl: +(get('steals', 'STL') ?? 0), blk: +(get('blocks', 'BLK') ?? 0),
          fg: get('fieldGoalsMade-fieldGoalsAttempted', 'FG') ?? '', tp: get('threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT') ?? '', pf: +(get('fouls', 'PF') ?? 0),
          tpm: +(String(get('threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT') ?? '0').split('-')[0]) || 0,
        };
      }
    }
    return stats;
  };

  const allPlayers = () => [...rA.players, ...rB.players];
  const addAlert = (key, html, kind = '') => { if (!alerts.has(key)) alerts.set(key, { t: Date.now(), html, kind }); };

  const computeAlerts = () => {
    if (!live || live.state === 'pre') return;
    const fo = L(lg).foulOut;
    const half = L(lg).quarters ? 2 : 1;
    for (const p of allPlayers()) {
      const S = live.stats[p.id];
      if (!S) continue;
      const nm = esc(p.name);
      const gl = (p.gamelog || []).filter(g => g.id !== ev.id);
      const hi = k => gl.reduce((m, g) => Math.max(m, g[k] ?? 0), 0);
      for (const [k, lab, min] of [['pts', 'points', 12], ['reb', 'rebounds', 8], ['ast', 'assists', 7]]) {
        const h = hi(k);
        if (!gl.length || !h) continue;
        if (S[k] > h && S[k] >= min) addAlert(`hi-${p.id}-${k}-${S[k]}`, `<b>${nm}</b> sets a new season high: <b>${S[k]} ${lab}</b> (previous ${h}).`, 'hot');
        else if (S[k] >= Math.max(min, h - 3) && S[k] <= h) addAlert(`near-${p.id}-${k}`, `${nm} has ${S[k]} ${lab}; season high is ${h}.`, 'watch');
      }
      const cats = [S.pts, S.reb, S.ast, S.stl, S.blk];
      const tens = cats.filter(v => v >= 10).length, sevens = cats.filter(v => v >= 7).length;
      if (tens >= 3) addAlert(`td-${p.id}`, `<b>${nm} has a triple-double</b>: ${S.pts}p ${S.reb}r ${S.ast}a.`, 'hot');
      else if (tens >= 2 && sevens >= 3) addAlert(`tdw-${p.id}`, `Triple-double watch: ${nm} (${S.pts}p ${S.reb}r ${S.ast}a).`, 'watch');
      else if (tens >= 2) addAlert(`dd-${p.id}`, `${nm} has a double-double: ${S.pts}p ${S.reb}r ${S.ast}a.`, '');
      else if (tens === 1 && sevens >= 2) addAlert(`ddw-${p.id}`, `Double-double watch: ${nm} (${S.pts}p ${S.reb}r ${S.ast}a).`, 'watch');
      if (S.pf >= fo) addAlert(`fo-${p.id}`, `<b>${nm} has fouled out.</b>`, 'bad');
      else if (S.pf >= fo - 1) addAlert(`pf${S.pf}-${p.id}`, `${nm} picks up foul No. ${S.pf}; one more and he's out.`.replace("he's", L(lg).women ? "she's" : "he's"), 'bad');
      else if (S.pf >= fo - 2 && (live.period || 1) <= half) addAlert(`pf${S.pf}-${p.id}`, `Foul trouble: ${nm} has ${S.pf} fouls before halftime.`, 'bad');
      // career milestones crossed or close tonight
      const ct = p.careerTot;
      if (ct) {
        for (const [k, cur, step, lab] of [['points', S.pts, isPro(lg) && lg === 'nba' ? 1000 : 500, 'points'], ['totalRebounds', S.reb, lg === 'nba' ? 1000 : 250, 'rebounds'], ['assists', S.ast, lg === 'nba' ? 1000 : 250, 'assists'], ['threePointFieldGoalsMade', S.tpm, lg === 'nba' ? 250 : 100, 'made threes']]) {
          const before = ct[k];
          if (!before || before < step / 2) continue;
          const next = Math.ceil((before + 1) / step) * step;
          if (before + cur >= next) addAlert(`ms-${p.id}-${k}-${next}`, `<b>Milestone:</b> ${nm} reaches ${next.toLocaleString()} career ${lab} tonight.`, 'hot');
          else if (next - (before + cur) <= Math.max(3, Math.round(step / 100))) addAlert(`msw-${p.id}-${k}-${next}`, `Milestone watch: ${nm} is ${next - before - cur} ${lab} from ${next.toLocaleString()} for ${L(lg).women ? 'her' : 'his'} career.`, 'watch');
        }
      }
    }
    // hot hand this period (from the play-by-play)
    const per = live.period;
    const byP = {};
    for (const pl of live.plays || []) {
      if (!pl.scoringPlay || pl.period?.number !== per) continue;
      const id = pl.participants?.[0]?.athlete?.id;
      if (id) byP[id] = (byP[id] || 0) + (pl.scoreValue || 0);
    }
    const perName = L(lg).quarters ? `${ordinal(per)} quarter` : `${ordinal(per)} half`;
    for (const [id, pts] of Object.entries(byP)) {
      const S = live.stats[id];
      if (pts >= (L(lg).quarters ? 10 : 12) && S) addAlert(`hh-${id}-${per}-${Math.floor(pts / 5)}`, `<b>${esc(S.name)}</b> is heating up: ${pts} points in the ${perName}.`, 'hot');
    }
  };

  // ESPN's bonusState is set on the team that is IN the bonus (shooting free throws on the opponent's fouls).
  const bonusText = (b) => !b || b === 'NONE' ? '' : isPro(lg) ? 'in the penalty' : lg === 'cbb' ? (b === 'DOUBLE' ? 'in the double bonus' : 'in the bonus (1-and-1)') : 'in the bonus';
  const flow = () => {
    // current scoring run from the play-by-play
    const sc = (live.plays || []).filter(p => p.scoringPlay && p.team?.id);
    let runTeam = null, run = 0;
    for (let i = sc.length - 1; i >= 0; i--) {
      const t = sc[i].team.id;
      if (runTeam === null) runTeam = t;
      if (t !== runTeam) break;
      run += sc[i].scoreValue || 0;
    }
    const abbr = id => (id === live.aw.team.id ? live.aw.team.abbreviation : live.hm.team.abbreviation);
    const tstats = {};
    for (const t of live.teamStats || []) tstats[t.team.id] = Object.fromEntries((t.statistics || []).map(x => [x.name, x.displayValue]));
    const out = [];
    if (run >= 6) out.push(`<div class="gd-run">${esc(abbr(runTeam))} on a <b>${run}-0 run</b></div>`);
    const la = tstats[live.aw.team.id]?.largestLead, lh = tstats[live.hm.team.id]?.largestLead, lc = tstats[live.hm.team.id]?.leadChanges;
    if (la != null || lh != null) out.push(`<div class="small">Largest lead: ${esc(live.aw.team.abbreviation)} ${esc(la ?? 0)} · ${esc(live.hm.team.abbreviation)} ${esc(lh ?? 0)}${lc != null ? ` · Lead changes: ${esc(lc)}` : ''}</div>`);
    for (const c of [live.aw, live.hm]) {
      const f = c.fouls || {};
      out.push(`<div class="small"><b>${esc(c.team.abbreviation)}</b>: ${c.timeoutsRemaining != null ? `${c.timeoutsRemaining} timeout${c.timeoutsRemaining === 1 ? '' : 's'} left` : ''}${f.teamFoulsCurrent != null ? ` · ${f.teamFoulsCurrent} team fouls this ${L(lg).quarters ? 'quarter' : 'half'}` : ''}${f.foulsToGive != null && f.foulsToGive > 0 ? ` · ${f.foulsToGive} to give` : ''}${bonusText(f.bonusState) ? ` · <span class="chip amber">${bonusText(f.bonusState)}</span>` : ''}</div>`);
    }
    return out.join('') || '<div class="small mut">Game flow appears once play starts.</div>';
  };

  const sitChips = () => {
    if (!live || live.state !== 'in') return '';
    return [live.aw, live.hm].map(c => {
      const f = c.fouls || {};
      const bonus = f.bonusState && f.bonusState !== 'NONE';
      return `<span class="gd-sitt"><b>${esc(c.team.abbreviation)}</b>${c.possession ? ' <span title="Possession">●</span>' : ''} TO ${c.timeoutsRemaining ?? '–'} · TF ${f.teamFoulsCurrent ?? '–'}${bonus ? ` <span class="chip amber" title="${esc(c.team.abbreviation)} is ${bonusText(f.bonusState)}">${lg === 'cbb' && f.bonusState === 'DOUBLE' ? '2× BONUS' : 'BONUS'}</span>` : ''}</span>`;
    }).join('');
  };

  const drawLive = () => {
    const wrap = body.querySelector('#gdLiveWrap');
    if (!live || live.state === 'pre') { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    const plays = (live.plays || []).slice(-14).reverse();
    const al = [...alerts.values()].sort((x, y) => y.t - x.t).slice(0, 10);
    const fresh = t => Date.now() - t < 90e3;
    body.querySelector('#gdLivePanel').innerHTML = `
      <div class="gd-lp"><div class="h3">Play-by-play</div><div class="gd-plays">${plays.map(p => `<div class="gd-play ${p.scoringPlay ? 'sc' : ''}" style="${p.team?.id ? `border-left-color:var(--${p.team.id === A.id ? 'a' : p.team.id === B.id ? 'b' : 'line'})` : ''}"><span class="mut2">${esc(p.period?.displayValue?.replace(/ Quarter| Half/, '').replace(/(\d)(st|nd|rd|th)/, '$1') || '')} ${esc(p.clock?.displayValue || '')}</span><span>${esc(p.text || '')}</span><span class="b">${p.awayScore}-${p.homeScore}</span></div>`).join('') || '<div class="small mut">No plays yet.</div>'}</div></div>
      <div class="gd-lp"><div class="h3">Live alerts</div><div class="gd-alerts">${al.map(x => `<div class="gd-alert ${x.kind} ${fresh(x.t) ? 'new' : ''}">${x.html}</div>`).join('') || '<div class="small mut">Season-high, double-double, milestone, hot-hand and foul-trouble alerts appear here.</div>'}</div></div>
      <div class="gd-lp"><div class="h3">Game flow</div>${flow()}</div>`;
  };

  const poll = async () => {
    const s = await safe(espn.summary(lg, ev.id, 0), null);
    if (!document.body.contains(body)) return;
    if (s?.header) {
      const comp = s.header.competitions[0];
      const st = comp.status.type;
      const aw = comp.competitors.find(c => c.homeAway === 'away'), hm = comp.competitors.find(c => c.homeAway === 'home');
      const was = live?.state;
      live = { state: st.state, detail: st.state === 'pre' ? `${fmtDate(comp.date)} · ${fmtTime(comp.date)}` : st.shortDetail || st.detail, aw, hm, stats: parseBox(s), plays: s.plays || [], period: comp.status?.period, teamStats: s.boxscore?.teams || [] };
      const tv = (comp.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(', ');
      const lastPlay = (live.plays || []).slice(-1)[0];
      liveEl.innerHTML = `<a href="#/${lg}/game/${ev.id}" class="gd-sc" title="Open full box score (shortcut: b)">${st.state === 'in' ? '<span class="livedot"></span>' : ''}<b>${esc(aw.team.abbreviation)} ${st.state === 'pre' ? '' : esc(aw.score)}</b><span class="mut2">–</span><b>${st.state === 'pre' ? '' : esc(hm.score)} ${esc(hm.team.abbreviation)}</b><span class="${st.state === 'in' ? 'bad b' : 'mut'} small">${esc(live.detail)}</span>${tv ? `<span class="mut small">${esc(tv)}</span>` : ''}</a>${st.state === 'in' && lastPlay ? `<span class="gd-last small" title="Last play">${esc(lastPlay.clock?.displayValue || '')} ${esc(lastPlay.text || '')}</span>` : ''}`;
      body.querySelector('#gdSit').innerHTML = sitChips();
      computeAlerts();
      drawLive();
      if (was !== live.state || (sort.v === 'min' && !was)) drawCols();
      else for (const k of ['a', 'b']) for (const p of side[k].r.players) { const c = side[k].el.querySelector(`[data-live="${p.id}"]`); if (c) c.innerHTML = liveCell(p); }
      updateScores();
      if (st.state === 'in') timer = setTimeout(poll, 15000);
      else if (st.state === 'pre') timer = setTimeout(poll, 60000);
      if (st.state === 'in' && pref.get('pre', null) === null && showPre) togglePre();
    } else timer = setTimeout(poll, 30000);
  };
  function updateScores() {
    if (!live || live.state === 'pre') return;
    for (const k of ['a', 'b']) {
      const team = side[k].team;
      const comp = [live.aw, live.hm].find(x => x?.team?.id === team.id);
      const el = body.querySelector(`[data-score="${k}"]`);
      if (el && comp) el.textContent = comp.score ?? '';
      const ts = body.querySelector(`[data-tsit="${k}"]`);
      if (ts && comp && live.state === 'in') {
        const f = comp.fouls || {};
        ts.innerHTML = `<span title="Timeouts left">TO ${comp.timeoutsRemaining ?? '–'}</span><span title="Team fouls this period">TF ${f.teamFoulsCurrent ?? '–'}</span>${f.bonusState && f.bonusState !== 'NONE' ? `<span title="${esc(team.abbr)} is ${bonusText(f.bonusState)}">BONUS</span>` : ''}`;
      }
    }
  }
  poll();
  void teams;
}
