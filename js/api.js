// Data access: ESPN (live, read straight from the browser), the `data` branch built by the scheduled job,
// and Wikipedia. Everything goes through a small cache and a request pool so a matchup with ~35 players stays fast.

export const REPO_DATA = 'https://raw.githubusercontent.com/bengasparian/courtside/data/';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/';
const SITEV2 = 'https://site.api.espn.com/apis/v2/sports/basketball/';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/';
const WEB3 = 'https://site.web.api.espn.com/apis/site/v3/sports/basketball/';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/';
import { LEAGUES } from './league.js?v=653f72bd97';
export const LG = Object.fromEntries(Object.entries(LEAGUES).map(([k, v]) => [k, v.espn]));

const mem = new Map();
const inflight = new Map();
let active = 0;
const queue = [];

function slot() {
  return new Promise(res => {
    if (active < 10) { active++; res(); } else queue.push(res);
  });
}
function release() {
  active--;
  if (queue.length) { active++; queue.shift()(); }
}

function ssGet(key, ttl) {
  try {
    const raw = sessionStorage.getItem('cs:' + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttl * 1000) return null;
    return v;
  } catch { return null; }
}
function ssSet(key, v) {
  try {
    const s = JSON.stringify({ t: Date.now(), v });
    if (s.length < 400000) sessionStorage.setItem('cs:' + key, s);
  } catch { /* storage full or unavailable: memory cache still works */ }
}

/** GET JSON with caching. ttl in seconds (0 = always fresh). */
export async function getJSON(url, ttl = 300, { persist = true, text = false } = {}) {
  const hit = mem.get(url);
  if (ttl > 0 && hit && Date.now() - hit.t < ttl * 1000) return hit.v;
  if (ttl > 0 && persist) {
    const s = ssGet(url, ttl);
    if (s) { mem.set(url, { t: Date.now(), v: s }); return s; }
  }
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    await slot();
    try {
      let lastErr;
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetch(url, { cache: ttl === 0 ? 'no-store' : 'default' });
          if (!r.ok) throw new Error(`${r.status} ${url}`);
          const v = text ? await r.text() : await r.json();
          mem.set(url, { t: Date.now(), v });
          if (ttl > 0 && persist) ssSet(url, v);
          return v;
        } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400)); }
      }
      throw lastErr;
    } finally { release(); inflight.delete(url); }
  })();
  inflight.set(url, p);
  return p;
}

/** Same as getJSON but returns `fallback` instead of throwing. */
export async function safe(promise, fallback = null) {
  try { return await promise; } catch (e) { console.warn('[courtside]', e.message || e); return fallback; }
}

// ---------- data branch (built every 2 hours by GitHub Actions)
export const repo = (path, ttl = 600) => getJSON(REPO_DATA + path, ttl);

// ---------- ESPN
export const espn = {
  scoreboard: (lg, date, extra = '') => getJSON(`${SITE}${LG[lg]}/scoreboard?${date ? 'dates=' + date + '&' : ''}${LEAGUES[lg] && !LEAGUES[lg].pro ? 'groups=50&limit=400' : 'limit=100'}${extra}`, 20),
  scoreboardRange: (lg, range, extra = '') => getJSON(`${SITE}${LG[lg]}/scoreboard?dates=${range}&limit=1000${extra}`, 600),
  summary: (lg, id, ttl = 15) => getJSON(`${SITE}${LG[lg]}/summary?event=${id}`, ttl, { persist: false }),
  roster: (lg, id) => getJSON(`${SITE}${LG[lg]}/teams/${id}/roster`, 600),
  teamStats: (lg, id) => getJSON(`${SITE}${LG[lg]}/teams/${id}/statistics`, 900),
  schedule: (lg, id, season, type) => getJSON(`${SITE}${LG[lg]}/teams/${id}/schedule${season ? '?season=' + season + (type ? '&seasontype=' + type : '') : ''}`, 600),
  news: (lg, team, limit = 25) => getJSON(`${SITE}${LG[lg]}/news?limit=${limit}${team ? '&team=' + team : ''}`, 600),
  standings: (lg, extra = '') => getJSON(`${SITEV2}${LG[lg]}/standings${extra}`, 900),
  rankings: (lg = 'cbb') => getJSON(`${SITE}${LG[lg]}/rankings`, 1800),
  athlete: (lg, id) => getJSON(`${WEB}${LG[lg]}/athletes/${id}`, 1800),
  athleteStats: (lg, id) => getJSON(`${WEB}${LG[lg]}/athletes/${id}/stats`, 1800),
  athleteOverview: (lg, id) => getJSON(`${WEB}${LG[lg]}/athletes/${id}/overview`, 900),
  gamelog: (lg, id) => getJSON(`${WEB}${LG[lg]}/athletes/${id}/gamelog`, 1800),
  leaders: (lg, season) => getJSON(`${WEB3}${LG[lg]}/leaders?season=${season}&seasontype=2`, 3600),
  coach: (lg, id) => getJSON(`${CORE}${LG[lg]}/coaches/${id}`, 86400),
  coachSeason: (lg, season, id) => getJSON(`${CORE}${LG[lg]}/seasons/${season}/types/2/coaches/${id}/record`, 3600),
  prevAthletes: (lg, season, teamId) => getJSON(`${CORE}${LG[lg]}/seasons/${season}/teams/${teamId}/athletes?limit=200`, 86400),
  coreAthlete: (lg, id) => getJSON(`${CORE}${LG[lg]}/athletes/${id}`, 86400),
  core: (url, ttl = 86400) => getJSON(String(url).replace('http://', 'https://'), ttl),
  record: (lg, season, id) => getJSON(`${CORE}${LG[lg]}/seasons/${season}/types/2/teams/${id}/record`, 86400),
  injuries: (lg) => getJSON(`${SITE}${LG[lg]}/injuries`, 900),
};

// ---------- Wikipedia (CORS via origin=*)
const WAPI = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&';
export const wiki = {
  search: (q, n = 5) => getJSON(`${WAPI}action=query&list=search&srlimit=${n}&srsearch=${encodeURIComponent(q)}`, 86400),
  intro: (title) => getJSON(`${WAPI}action=query&prop=extracts|pageprops&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`, 86400),
  lead: (title) => getJSON(`${WAPI}action=parse&prop=wikitext&section=0&redirects=1&page=${encodeURIComponent(title)}`, 86400),
  summary: (title) => getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, 86400),
};
