// Shared app state + team directory.
import { repo, espn, safe } from './api.js?v=65d43e4ab4';
import { teamAccent, teamBand, onColor } from './util.js?v=65d43e4ab4';

export const state = {
  lg: (() => { try { return localStorage.getItem('cs-lg') || 'nba'; } catch { return 'nba'; } })(),
  get theme() { return document.documentElement.dataset.theme || 'dark'; },
};

const teamCache = {};
export async function teams(lg) {
  if (teamCache[lg]) return teamCache[lg];
  let list = await safe(repo(`${lg}/teams.json`, 3600), null);
  if (!list || !list.length) {
    // fallback straight from ESPN standings if the data branch is unreachable
    const st = await safe(espn.standings(lg), null);
    list = [];
    const walk = (n, conf) => {
      for (const e of n?.standings?.entries || []) {
        const t = e.team;
        list.push({ id: t.id, abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName, location: t.location, nick: t.name,
          logo: t.logos?.[0]?.href, conf: conf || n.name });
      }
      for (const c of n?.children || []) walk(c, c.abbreviation || c.name);
    };
    walk(st);
  }
  const byId = {};
  for (const t of list) byId[t.id] = t;
  teamCache[lg] = { list: list.sort((a, b) => (a.name || '').localeCompare(b.name || '')), byId };
  return teamCache[lg];
}

export async function meta() {
  return (await safe(repo('meta.json', 600), {})) || {};
}

export async function seasonYear(lg) {
  const m = await meta();
  if (m?.seasons?.[lg]?.year) return m.seasons[lg].year;
  const sb = await safe(espn.scoreboard(lg), null);
  return sb?.season?.year || sb?.leagues?.[0]?.season?.year || (new Date().getMonth() >= 7 ? new Date().getFullYear() + 1 : new Date().getFullYear());
}

/** Apply team colors as CSS variables on an element (or root). which = 'acc' | 'a' | 'b' */
export function paint(el, team, which = 'acc') {
  if (!team) return;
  const th = state.theme;
  const band = teamBand(team.color, team.alt);
  const acc = teamAccent(team.color, team.alt, th);
  if (which === 'acc') {
    el.style.setProperty('--acc', acc);
    el.style.setProperty('--acc-on', onColor(acc));
    el.style.setProperty('--band', band);
    el.style.setProperty('--band-on', onColor(band));
  } else {
    el.style.setProperty(`--${which}`, band);
    el.style.setProperty(`--${which}-on`, onColor(band));
    el.style.setProperty(`--${which}-txt`, acc);
  }
}
export function unpaint(el) {
  for (const v of ['--acc', '--acc-on', '--band', '--band-on', '--a', '--a-on', '--a-txt', '--b', '--b-on', '--b-txt']) el.style.removeProperty(v);
}

// user notes (saved in this browser)
export const myNotes = {
  get(key) { try { return localStorage.getItem('cs-note:' + key) || ''; } catch { return ''; } },
  set(key, v) { try { if (v) localStorage.setItem('cs-note:' + key, v); else localStorage.removeItem('cs-note:' + key); } catch { /* ignore */ } },
};

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// favorites + recent matchups (saved in this browser)
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
export const favs = {
  list(lg) { return lsGet('cs-fav', []).filter(x => x.startsWith(lg + ':')).map(x => x.split(':')[1]); },
  has(lg, id) { return lsGet('cs-fav', []).includes(`${lg}:${id}`); },
  toggle(lg, id) { const a = lsGet('cs-fav', []); const k = `${lg}:${id}`; const i = a.indexOf(k); if (i >= 0) a.splice(i, 1); else a.push(k); lsSet('cs-fav', a); return i < 0; },
};
export const recents = {
  add(lg, a, b) { const r = lsGet('cs-recent', []).filter(x => !(x.lg === lg && x.a === a && x.b === b)); r.unshift({ lg, a, b, t: Date.now() }); lsSet('cs-recent', r.slice(0, 20)); },
  list(lg) { return lsGet('cs-recent', []).filter(x => x.lg === lg).slice(0, 8); },
  clear(lg) { lsSet('cs-recent', lsGet('cs-recent', []).filter(x => x.lg !== lg)); },
};

export const pron = {
  get(lg, id) { try { return localStorage.getItem(`cs-pron:${lg}:${id}`) || ''; } catch { return ''; } },
  set(lg, id, v) { try { if (v) localStorage.setItem(`cs-pron:${lg}:${id}`, v); else localStorage.removeItem(`cs-pron:${lg}:${id}`); } catch { /* ignore */ } },
};
export const sayName = (p, lg) => pron.get(lg, p.id) || p.wiki?.pron || '';
