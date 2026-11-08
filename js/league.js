// League definitions: everything that differs between the NBA, WNBA, men's and women's college game.
export const LEAGUES = {
  nba: { key: 'nba', espn: 'nba', name: 'NBA', short: 'NBA', full: 'NBA', pro: true, women: false, mins: 240, per: 36, quarters: true, hca: 2.2, sd: 12.5, ts: 0, foulOut: 6, scoreHi: 120 },
  wnba: { key: 'wnba', espn: 'wnba', name: 'WNBA', short: 'WNBA', full: 'WNBA', pro: true, women: true, mins: 200, per: 36, quarters: true, hca: 2.0, sd: 11, ts: 3, foulOut: 6, scoreHi: 90 },
  cbb: { key: 'cbb', espn: 'mens-college-basketball', name: "Men's College", short: 'NCAA M', full: "men's college basketball", pro: false, women: false, mins: 200, per: 40, quarters: false, hca: 3.2, sd: 10.5, ts: 3, foulOut: 5, scoreHi: 80 },
  wcbb: { key: 'wcbb', espn: 'womens-college-basketball', name: "Women's College", short: 'NCAA W', full: "women's college basketball", pro: false, women: true, mins: 200, per: 40, quarters: true, hca: 3.0, sd: 11, ts: 6, foulOut: 5, scoreHi: 75 },
};
export const LEAGUE_KEYS = Object.keys(LEAGUES);
export const L = lg => LEAGUES[lg] || LEAGUES.nba;
export const isPro = lg => L(lg).pro;
export const isCollege = lg => !L(lg).pro;
/** The draft feeding a league's players: NBA draft for the men's game, WNBA draft for the women's. */
export const draftLeague = lg => (L(lg).women ? 'wnba' : 'nba');
/** "the NBA" / "the WNBA" / "the nation" */
export const scope = lg => (isPro(lg) ? `the ${L(lg).name}` : 'the nation');

/** Swap he/his/him for she/her in generated notes for women's leagues. */
export function gender(lg, s) {
  if (!s || !L(lg).women) return s;
  return s.replace(/\bhimself\b/g, 'herself').replace(/\bHe's\b/g, "She's").replace(/\bhe's\b/g, "she's")
    .replace(/\bHe\b/g, 'She').replace(/\bhe\b/g, 'she').replace(/\bHis\b/g, 'Her').replace(/\bhis\b/g, 'her').replace(/\bhim\b/g, 'her');
}
