"""Probe round 2: fetch sample responses from candidate free data sources and save them (with headers)."""
import json, os, sys, urllib.request, time, gzip
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
E = "https://site.api.espn.com/apis/site/v2/sports/basketball"
W = "https://site.web.api.espn.com/apis/common/v3/sports/basketball"
C = "https://sports.core.api.espn.com/v2/sports/basketball/leagues"
T = {
 "nba_summary": (f"{E}/nba/summary?event=401909938", True),
 "nba_team_noorigin": (f"{E}/nba/teams/13", False),
 "nba_leaders": ("https://site.web.api.espn.com/apis/site/v3/sports/basketball/nba/leaders?season=2027&seasontype=2", True),
 "nba_leaders_core": (f"{C}/nba/seasons/2027/types/2/leaders?limit=10", True),
 "cbb_scoreboard_all": (f"{E}/mens-college-basketball/scoreboard?groups=50&limit=400", True),
 "cbb_summary": (f"{E}/mens-college-basketball/summary?event=401918948", True),
 "cbb_standings_all": ("https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings", True),
 "cbb_athlete": (f"{W}/mens-college-basketball/athletes/5103630", True),
 "cbb_athlete_stats": (f"{W}/mens-college-basketball/athletes/5103630/stats", True),
 "cbb_athlete_overview": (f"{W}/mens-college-basketball/athletes/5103630/overview", True),
 "cbb_news_team": (f"{E}/mens-college-basketball/news?team=150", True),
 "cbb_groups": (f"{E}/mens-college-basketball/groups", True),
 "r247_a": ("https://247sports.com/season/2026-basketball/compositerecruitrankings/", False),
 "r247_tp": ("https://247sports.com/season/2026-basketball/transferportal/", False),
 "on3_ind": ("https://www.on3.com/rivals/rankings/industry-player/basketball/2026/", False),
 "on3_db": ("https://www.on3.com/db/rankings/industry-player/basketball/2026/", False),
 "on3_portal": ("https://www.on3.com/transfer-portal/wire/basketball/", False),
 "espn_rec": ("https://www.espn.com/college-sports/basketball/recruiting/rankings/_/class/2026", False),
 "wiki_cup": ("https://en.wikipedia.org/w/api.php?action=parse&page=2026_NBA_Cup&prop=wikitext&format=json&origin=*", True),
 "wiki_asg": ("https://en.wikipedia.org/api/rest_v1/page/summary/2027_NBA_All-Star_Game", True),
 "wiki_search": ("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=John%20Blackwell%20basketball&format=json&origin=*", True),
}
summary = {}
for k, (u, origin) in T.items():
    h = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7", "Accept-Language": "en-US,en;q=0.9"}
    if origin: h["Origin"] = "https://bengasparian.github.io"
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=40) as r:
            body = r.read(); hdr = dict(r.headers); code = r.status
    except urllib.error.HTTPError as e:
        body = e.read(); hdr = dict(e.headers); code = e.code
    except Exception as e:
        body = repr(e).encode(); hdr = {}; code = -1
    if body[:2] == b"\x1f\x8b": body = gzip.decompress(body)
    ext = "json" if body[:1] in (b"{", b"[") else "txt"
    with open(f"{OUT}/{k}.{ext}", "wb") as f: f.write(body[:3_000_000])
    summary[k] = {"url": u, "code": code, "bytes": len(body), "acao": hdr.get("Access-Control-Allow-Origin") or hdr.get("access-control-allow-origin"), "ctype": hdr.get("Content-Type")}
    time.sleep(0.5)
json.dump(summary, open(f"{OUT}/_summary.json", "w"), indent=1)
