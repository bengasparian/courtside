"""Courtside data builder.

Runs in GitHub Actions on a schedule. Collects the data the site cannot read directly from the browser (sites without
CORS, or data that needs many requests to compute league-wide ranks) and writes compact JSON files into OUT, which the
workflow publishes to the `data` branch. Each task keeps the previous file if its source fails, so one broken source
never takes the rest of the site down.

Sources (all free): ESPN public site/core APIs, Wikipedia API, Tankathon (mock draft + big board),
On3 (industry recruiting rankings + transfer portal), ncaa-api.henrygd.me (NCAA NET rankings).
"""
import concurrent.futures as cf
import datetime as dt
import html as htmllib
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
FORCE = "--force" in sys.argv
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball"
SITEV2 = "https://site.api.espn.com/apis/v2/sports/basketball"
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues"
WEB3 = "https://site.web.api.espn.com/apis/site/v3/sports/basketball"
LG = {"nba": "nba", "cbb": "mens-college-basketball"}
NOW = dt.datetime.now(dt.timezone.utc)
META_PATH = os.path.join(OUT, "meta.json")
META = {}
if os.path.exists(META_PATH):
    try:
        META = json.load(open(META_PATH))
    except Exception:
        META = {}
META.setdefault("updated", {})
META.setdefault("errors", {})


# ----------------------------------------------------------------------------------------------------------- helpers
def fetch(url, kind="json", tries=3, timeout=40):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            if body[:2] == b"\x1f\x8b":
                import gzip
                body = gzip.decompress(body)
            text = body.decode("utf-8", "replace")
            return json.loads(text) if kind == "json" else text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def pmap(fn, items, workers=8):
    out = {}
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(fn, it): it for it in items}
        for f in cf.as_completed(futs):
            it = futs[f]
            try:
                out[it] = f.result()
            except Exception as e:  # noqa: BLE001
                out[it] = None
                print("  ! ", it, e)
    return out


def save(rel, obj):
    p = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


def load(rel, default=None):
    p = os.path.join(OUT, rel)
    if os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            pass
    return default


def due(task, hours):
    if FORCE:
        return True
    t = META["updated"].get(task)
    if not t:
        return True
    try:
        return (NOW - dt.datetime.fromisoformat(t)).total_seconds() > hours * 3600 - 600
    except Exception:
        return True


def run(task, hours, fn):
    if not due(task, hours):
        print(f"- {task}: fresh, skipped")
        return
    t0 = time.time()
    try:
        fn()
        META["updated"][task] = NOW.isoformat()
        META["errors"].pop(task, None)
        print(f"+ {task}: ok ({time.time() - t0:.0f}s)")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        META["errors"][task] = f"{NOW.isoformat()} {e}"[:400]
        print(f"! {task}: FAILED, keeping previous file")


def num(v):
    try:
        if isinstance(v, str):
            v = v.replace(",", "").replace("%", "")
        return float(v)
    except Exception:
        return None


def norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    s = re.sub(r"[^a-z]", "", s)
    return s


def logo_of(team):
    for l in team.get("logos", []) or []:
        if "default" in l.get("rel", []) or "full" in l.get("rel", []):
            return l.get("href")
    return (team.get("logos") or [{}])[0].get("href")


def dark_logo_of(team):
    for l in team.get("logos", []) or []:
        if "dark" in l.get("rel", []):
            return l.get("href")
    return None


# ---------------------------------------------------------------------------------------------------------- seasons
def season_info():
    info = {}
    for key, lg in LG.items():
        sb = fetch(f"{SITE}/{lg}/scoreboard")
        season = sb.get("season", {})
        lgi = (sb.get("leagues") or [{}])[0]
        types = []
        try:
            for it in (lgi.get("season", {}).get("types") or []):
                types.append({"id": it.get("id"), "name": it.get("name"), "start": it.get("startDate"), "end": it.get("endDate")})
        except Exception:
            pass
        ls = lgi.get("season", {}) or {}
        yr = season.get("year") or ls.get("year")
        if not types and yr:
            for tid in (1, 2, 3, 5):
                try:
                    tj = fetch(f"{CORE}/{lg}/seasons/{yr}/types/{tid}", tries=1)
                    types.append({"id": str(tid), "name": tj.get("name"), "start": tj.get("startDate"), "end": tj.get("endDate")})
                except Exception:
                    pass
        info[key] = {"year": season.get("year") or ls.get("year"), "type": season.get("type") or (ls.get("type") or {}).get("type"),
                     "startDate": lgi.get("season", {}).get("startDate"), "endDate": lgi.get("season", {}).get("endDate"),
                     "types": types}
    return info


SEASONS = {}


# --------------------------------------------------------------------------------------------------------- NBA tasks
def nba_teams():
    js = fetch(f"{SITE}/nba/teams")
    teams = []
    for t in js["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        teams.append({"id": t["id"], "abbr": t.get("abbreviation"), "name": t.get("displayName"), "short": t.get("shortDisplayName"),
                      "location": t.get("location"), "nick": t.get("name"), "color": t.get("color"), "alt": t.get("alternateColor"),
                      "logo": logo_of(t), "logoDark": dark_logo_of(t), "slug": t.get("slug")})
    conf, div = {}, {}

    def walk(node, path):
        for e in (node.get("standings") or {}).get("entries", []) or []:
            tid = e["team"]["id"]
            if len(path) >= 1:
                conf.setdefault(tid, path[0])
            if len(path) >= 2:
                div[tid] = path[1]
        for c in node.get("children", []) or []:
            walk(c, path + [c.get("abbreviation") if not path else c.get("name")])
    walk(fetch(f"{SITEV2}/nba/standings"), [])
    try:
        walk(fetch(f"{SITEV2}/nba/standings?level=3"), [])
    except Exception as e:  # noqa: BLE001
        print("  division standings failed", e)
    details = pmap(lambda tid: fetch(f"{SITE}/nba/teams/{tid}"), [t["id"] for t in teams])
    for t in teams:
        t["conf"] = conf.get(t["id"])
        t["division"] = div.get(t["id"])
        d = (details.get(t["id"]) or {}).get("team", {})
        t["standingSummary"] = d.get("standingSummary")
    save("nba/teams.json", teams)


def standings_map(lg):
    st = fetch(f"{SITEV2}/{lg}/standings")
    out = {}

    def walk(node, conf_name=None):
        if node.get("standings", {}).get("entries"):
            for e in node["standings"]["entries"]:
                s = {x["name"]: x.get("value", num(x.get("displayValue"))) for x in e.get("stats", []) if "name" in x}
                d = {(x.get("name") or x.get("type")): x.get("displayValue") for x in e.get("stats", [])}
                d.update({x.get("type"): x.get("summary") for x in e.get("stats", []) if x.get("type")})
                out[e["team"]["id"]] = {"conf": conf_name or node.get("name"), "confAbbr": node.get("abbreviation"), "v": s, "d": d}
        for c in node.get("children", []) or []:
            walk(c, c.get("name"))
    walk(st)
    return out, st


def team_adv(stats_js, std, games_minutes):
    """Advanced team numbers from ESPN season totals (possession estimate: FGA - ORB + TOV + 0.44*FTA)."""
    cats = {}
    for c in stats_js.get("results", {}).get("stats", {}).get("categories", []):
        for s in c.get("stats", []):
            cats[s["name"]] = s.get("value") if s.get("value") is not None else num(s.get("displayValue"))
    gp = cats.get("gamesPlayed") or 0
    if not gp:
        return None
    fga = cats.get("avgFieldGoalsAttempted") or 0
    fta = cats.get("avgFreeThrowsAttempted") or 0
    orb = cats.get("avgOffensiveRebounds") or 0
    tov = cats.get("avgTurnovers") or 0
    pts = cats.get("avgPoints") or 0
    fgm = cats.get("avgFieldGoalsMade") or 0
    tpm = cats.get("avgThreePointFieldGoalsMade") or 0
    tpa = cats.get("avgThreePointFieldGoalsAttempted") or 0
    poss = fga - orb + tov + 0.44 * fta
    opp = (std or {}).get("v", {}).get("avgPointsAgainst")
    if opp is None and std:
        pa = std["v"].get("pointsAgainst")
        g = (std["v"].get("wins") or 0) + (std["v"].get("losses") or 0)
        opp = pa / g if pa and g else None
    o = {
        "gp": gp, "ppg": pts, "oppg": opp, "rpg": cats.get("avgRebounds"), "apg": cats.get("avgAssists"),
        "spg": cats.get("avgSteals"), "bpg": cats.get("avgBlocks"), "tpg": tov, "orpg": orb, "drpg": cats.get("avgDefensiveRebounds"),
        "fgp": cats.get("fieldGoalPct"), "tpp": cats.get("threePointFieldGoalPct") or cats.get("threePointPct"), "ftp": cats.get("freeThrowPct"),
        "fgm": fgm, "fga": fga, "tpm": tpm, "tpa": tpa, "ftm": cats.get("avgFreeThrowsMade"), "fta": fta,
        "pace": poss, "ortg": 100 * pts / poss if poss else None, "drtg": 100 * opp / poss if poss and opp else None,
        "efg": 100 * (fgm + 0.5 * tpm) / fga if fga else None, "ts": 100 * pts / (2 * (fga + 0.44 * fta)) if fga else None,
        "tovPct": 100 * tov / poss if poss else None, "tpaRate": 100 * tpa / fga if fga else None, "ftRate": 100 * fta / fga if fga else None,
        "astRatio": 100 * (cats.get("avgAssists") or 0) / fgm if fgm else None, "ast2to": cats.get("assistTurnoverRatio"),
        # raw season totals the site needs to compute player usage / assist rate
        "tot": {"fga": fga * gp, "fta": fta * gp, "tov": tov * gp, "fgm": fgm * gp, "min": gp * games_minutes},
    }
    if o["ortg"] is not None and o["drtg"] is not None:
        o["net"] = o["ortg"] - o["drtg"]
    return o


def rank_table(table, keys_desc, keys_asc):
    ids = [k for k, v in table.items() if v]
    for key in keys_desc + keys_asc:
        vals = [(table[i].get(key), i) for i in ids if table[i].get(key) is not None]
        vals.sort(key=lambda x: x[0], reverse=key in keys_desc)
        for r, (_, i) in enumerate(vals, 1):
            table[i].setdefault("rk", {})[key] = r
    return len(ids)


DESC = ["ppg", "rpg", "apg", "spg", "bpg", "orpg", "drpg", "fgp", "tpp", "ftp", "ortg", "efg", "ts", "net", "tpm", "tpa", "pace", "tpaRate", "ftRate", "astRatio", "ast2to"]
ASC = ["oppg", "drtg", "tpg", "tovPct"]


def team_stats(key):
    lg = LG[key]
    stmap, _ = standings_map(lg)
    if key == "nba":
        ids = [t["id"] for t in load("nba/teams.json", [])]
    else:
        ids = [t["id"] for t in load("cbb/teams.json", [])]
    raw = pmap(lambda tid: fetch(f"{SITE}/{lg}/teams/{tid}/statistics"), ids, workers=10)
    opp = {}
    if key == "cbb":
        scheds = pmap(lambda tid: fetch(f"{SITE}/{lg}/teams/{tid}/schedule"), ids, workers=10)
        for tid, js in scheds.items():
            pts, n = 0, 0
            for e in (js or {}).get("events", []):
                c = (e.get("competitions") or [{}])[0]
                if not (c.get("status", {}).get("type", {}).get("completed")):
                    continue
                o = next((x for x in c.get("competitors", []) if x.get("id") != tid and (x.get("team") or {}).get("id") != tid), None)
                sc = (o or {}).get("score")
                v = num(sc.get("value") if isinstance(sc, dict) else sc)
                if v is not None:
                    pts += v; n += 1
            if n:
                opp[tid] = pts / n
    table = {}
    mins = 240 if key == "nba" else 200
    for tid in ids:
        try:
            std = stmap.get(tid)
            if tid in opp:
                std = {"v": {**((std or {}).get("v") or {}), "avgPointsAgainst": opp[tid]}, "d": (std or {}).get("d", {})}
            elif std and not std["v"].get("avgPointsAgainst"):
                std = {"v": {k: v for k, v in std["v"].items() if k not in ("avgPointsAgainst", "pointsAgainst")}, "d": std["d"]}
            table[tid] = team_adv(raw.get(tid) or {}, std, mins)
        except Exception as e:  # noqa: BLE001
            print("  adv fail", tid, e)
            table[tid] = None
    n = rank_table(table, DESC, ASC)
    # league averages (for context in the site)
    avg = {}
    for k in DESC + ASC:
        vals = [v[k] for v in table.values() if v and v.get(k) is not None]
        if vals:
            avg[k] = sum(vals) / len(vals)
    save(f"{key}/teamstats.json", {"n": n, "avg": avg, "teams": {k: v for k, v in table.items() if v}})


def bpi(key):
    """ESPN BPI. The core API has every field but (for college) only the top 25; the fitt endpoint has every team.
    Merge: fitt as the base, core values on top, then fill in any missing ranks."""
    lg = LG[key]
    merged, updated = {}, None
    try:
        js = fetch(f"https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/{lg}/powerindex?limit=500")
        names = {c["name"]: c.get("names") or [] for c in js.get("categories", [])}
        for t in js.get("teams", []):
            tid = str((t.get("team") or {}).get("id"))
            d = merged.setdefault(tid, {})
            for c in t.get("categories", []):
                for n, v in zip(names.get(c.get("name"), []), c.get("values") or []):
                    if n and d.get(n) is None:
                        d[n] = v
        updated = js.get("lastUpdated")
    except Exception as e:  # noqa: BLE001
        print("  fitt BPI failed", e)
    try:
        core = bpi_core(key)
        for tid, d in core["teams"].items():
            merged.setdefault(tid, {}).update({k: v for k, v in d.items() if v is not None})
        updated = updated or core.get("updated")
    except Exception as e:  # noqa: BLE001
        print("  core BPI failed", e)
    if not merged:
        raise RuntimeError("no BPI data")
    for k, desc in (("bpioffense", True), ("bpidefense", True), ("bpi", True)):
        rk = k + "rank" if k != "bpi" else "bpirank"
        vals = sorted([(d.get(k), t) for t, d in merged.items() if d.get(k) is not None], reverse=desc)
        for i, (_, t) in enumerate(vals, 1):
            if merged[t].get(rk) is None:
                merged[t][rk] = i
    save(f"{key}/bpi.json", {"updated": updated, "teams": merged})


def bpi_core(key):
    lg = LG[key]
    year = SEASONS[key]["year"]
    url = f"{CORE}/{lg}/seasons/{year}/powerindex?limit=25&page="
    first = fetch(url + "1")
    size = first.get("pageSize") or len(first.get("items", [])) or 25
    pages = max(first.get("pageCount", 1), -(-(first.get("count") or 0) // size))
    items = list(first.get("items", []))
    rest = pmap(lambda p: fetch(url + str(p)), list(range(2, pages + 1)))
    for p in range(2, pages + 1):
        items += (rest.get(p) or {}).get("items", [])
    out = {}
    for it in items:
        ref = it.get("team", {}).get("$ref", "")
        m = re.search(r"/teams/(\d+)", ref)
        if not m:
            continue
        out[m.group(1)] = {s["name"]: s.get("value") for s in it.get("stats", [])}
    return {"updated": (first.get("items") or [{}])[0].get("lastUpdated"), "teams": out}


def nba_power():
    """Courtside power rankings: blend of ESPN BPI, net rating, win% and last-10 form. Keeps daily snapshots."""
    teams = load("nba/teams.json", [])
    b = (load("nba/bpi.json", {}) or {}).get("teams", {})
    ts = (load("nba/teamstats.json", {}) or {}).get("teams", {})
    stmap, _ = standings_map("nba")
    rows = []
    for t in teams:
        tid = t["id"]
        sv = stmap.get(tid, {}).get("v", {})
        sd = stmap.get(tid, {}).get("d", {})
        w, l = sv.get("wins") or 0, sv.get("losses") or 0
        last10 = sd.get("Last Ten Games") or sd.get("lasttengames") or ""
        m = re.match(r"(\d+)-(\d+)", last10 or "")
        l10 = int(m.group(1)) / max(1, int(m.group(1)) + int(m.group(2))) if m else (w / max(1, w + l))
        bp = (b.get(tid) or {}).get("bpi")
        net = (ts.get(tid) or {}).get("net")
        wp = w / max(1, w + l)
        rows.append({"id": tid, "w": w, "l": l, "bpi": bp, "net": net, "wp": wp, "l10": l10, "last10": last10, "streak": sd.get("streak")})

    def z(key):
        vals = [r[key] for r in rows if r[key] is not None]
        if not vals:
            return
        mu = sum(vals) / len(vals)
        sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** 0.5 or 1
        for r in rows:
            r["z_" + key] = ((r[key] if r[key] is not None else mu) - mu) / sd
    for k in ("bpi", "net", "wp", "l10"):
        z(k)
    for r in rows:
        r["score"] = 0.40 * r.get("z_bpi", 0) + 0.25 * r.get("z_net", 0) + 0.20 * r.get("z_wp", 0) + 0.15 * r.get("z_l10", 0)
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    prev = load("nba/power.json", {}) or {}
    snaps = prev.get("snapshots", {})
    today = NOW.strftime("%Y-%m-%d")
    snaps[today] = {r["id"]: r["rank"] for r in rows}
    keep = sorted(snaps)[-21:]
    snaps = {k: snaps[k] for k in keep}
    week_ago = [k for k in keep if k <= (NOW - dt.timedelta(days=7)).strftime("%Y-%m-%d")]
    base = snaps[week_ago[-1]] if week_ago else snaps[keep[0]]
    for r in rows:
        r["prev"] = base.get(r["id"])
    save("nba/power.json", {"date": today, "baseDate": week_ago[-1] if week_ago else keep[0], "rows": rows, "snapshots": snaps})


def nba_leaders():
    year = SEASONS["nba"]["year"]
    js = fetch(f"{WEB3}/nba/leaders?season={year}&seasontype=2")
    cats = {}
    per = {}
    for c in js.get("leaders", {}).get("categories", []):
        lst = []
        for i, l in enumerate(c.get("leaders", []), 1):
            a = l.get("athlete", {})
            tm = (l.get("team") or a.get("team") or {})
            entry = {"id": a.get("id"), "name": a.get("displayName"), "team": tm.get("abbreviation"), "teamId": tm.get("id"),
                     "v": l.get("displayValue"), "rank": i}
            if len(lst) < 15:
                lst.append(entry)
            if c.get("name") == "PER":
                per[a.get("id")] = {"per": l.get("value"), "rank": i}
        cats[c.get("name")] = {"label": c.get("displayName") or c.get("name"), "leaders": lst}
    save("nba/leaders.json", {"categories": cats, "per": per})


def nba_cup():
    """NBA Cup: group membership from Wikipedia, every Cup game from ESPN team schedules, group tables computed here."""
    teams = load("nba/teams.json", [])
    by_name = {t["name"]: t for t in teams}
    year = SEASONS["nba"]["year"]
    start_year = int(year) - 1
    groups = {}
    try:
        wt = fetch(f"https://en.wikipedia.org/w/api.php?action=parse&page={start_year}_NBA_Cup&prop=wikitext&format=json&redirects=1")
        text = wt["parse"]["wikitext"]["*"]
        # Each group block: heading "East Group A" followed by name_XXX=[[... season|Team Name]] lines.
        parts = re.split(r"\n=+\s*((?:East|West)(?:ern Conference)?\s+group\s+[A-C])\s*=+", text, flags=re.I)
        for i in range(1, len(parts), 2):
            m2 = re.match(r"(East|West)\w*(?: Conference)?\s+group\s+([A-C])", parts[i], re.I)
            gname = f"{m2.group(1).title()} Group {m2.group(2).upper()}"
            block = parts[i + 1]
            names = re.findall(r"\|name_[A-Z]+\s*=\s*\[\[[^\]|]*\|([^\]]+)\]\]", block)
            ids = []
            for n in names:
                t = by_name.get(n) or next((x for x in teams if x.get("nick") and n.strip().endswith(x["nick"])), None)
                if t:
                    ids.append(t["id"])
            if len(ids) >= 4:
                groups[gname] = ids[:5]
    except Exception as e:  # noqa: BLE001
        print("  cup wiki failed", e)
    # Every Cup game from the 30 team schedules (regular season + postseason types)
    scheds = pmap(lambda tid: fetch(f"{SITE}/nba/teams/{tid}/schedule?season={year}"), [t["id"] for t in teams])
    games = {}
    for tid, js in scheds.items():
        for e in (js or {}).get("events", []):
            c = e["competitions"][0]
            note = " ".join(n.get("headline", "") for n in c.get("notes", []) or [])
            if "Cup" not in note:
                continue
            comp = {x["homeAway"]: x for x in c["competitors"]}
            st = c.get("status", {}).get("type", {})

            def sc(x):
                s = x.get("score")
                if isinstance(s, dict):
                    return s.get("value")
                return num(s)
            games[e["id"]] = {"id": e["id"], "date": e["date"], "note": note, "state": st.get("state"), "detail": st.get("shortDetail"),
                              "home": comp["home"]["team"]["id"], "away": comp["away"]["team"]["id"],
                              "hs": sc(comp["home"]), "as": sc(comp["away"])}
    games = sorted(games.values(), key=lambda g: g["date"])
    group_games = [g for g in games if "Group" in g["note"]]
    if not groups:  # fallback: groups are the connected components of the group-play schedule
        adj = {}
        for g in group_games:
            adj.setdefault(g["home"], set()).add(g["away"])
            adj.setdefault(g["away"], set()).add(g["home"])
        seen = set()
        conf = {t["id"]: t.get("conf") for t in teams}
        n = {"East": 0, "West": 0}
        for tid in sorted(adj):
            if tid in seen:
                continue
            comp, stack = set(), [tid]
            while stack:
                x = stack.pop()
                if x in comp:
                    continue
                comp.add(x)
                stack += list(adj.get(x, []))
            seen |= comp
            cf_ = conf.get(tid) or "East"
            n[cf_] = n.get(cf_, 0) + 1
            groups[f"{cf_} Group {chr(64 + n[cf_])}"] = sorted(comp)
    tables = {}
    for gname, ids in groups.items():
        rows = {i: {"id": i, "w": 0, "l": 0, "pf": 0, "pa": 0, "left": 0} for i in ids}
        for g in group_games:
            if g["home"] in rows and g["away"] in rows:
                if g["state"] == "post" and g["hs"] is not None and g["as"] is not None:
                    h, a = rows[g["home"]], rows[g["away"]]
                    h["pf"] += g["hs"]; h["pa"] += g["as"]; a["pf"] += g["as"]; a["pa"] += g["hs"]
                    if g["hs"] > g["as"]:
                        h["w"] += 1; a["l"] += 1
                    else:
                        a["w"] += 1; h["l"] += 1
                else:
                    rows[g["home"]]["left"] += 1; rows[g["away"]]["left"] += 1
        lst = list(rows.values())
        for r in lst:
            r["diff"] = r["pf"] - r["pa"]
        lst.sort(key=lambda r: (-(r["w"] / max(1, r["w"] + r["l"])), -r["w"], -r["diff"], -r["pf"]))
        tables[gname] = lst
    ko = [g for g in games if "Group" not in g["note"]]
    save("nba/cup.json", {"season": year, "groups": tables, "games": games, "knockout": ko,
                          "source": "Groups: Wikipedia; results: ESPN"})


def parse_tankathon(h, mock):
    rows = []
    for seg in re.split(r'<div class="mock-row"', h)[1:]:
        def t(rx):
            m = re.search(rx, seg, re.S)
            return htmllib.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else None
        pick = t(r'mock-row-pick-number">(.*?)</div>')
        name = t(r'mock-row-name">(.*?)</div>')
        if not name or not pick:
            continue
        sp = t(r'mock-row-school-position">(.*?)</div>') or ""
        pos, _, school = [x.strip() for x in sp.partition("|")]
        hw = re.findall(r'height-weight"><div>(.*?)</div><div>(.*?)</div>', seg)
        ya = re.findall(r'year-age[^"]*"><div>(.*?)</div><div>(.*?)</div>', seg)
        logos = re.findall(r'<img class="[^"]*" alt="([^"]*)"', seg)
        stats = {}
        for grp, body in re.findall(r'universal-stat (stats-[a-z0-9-]+)"[^>]*>(.*?)</div></div></div>', seg + "</div></div></div>", re.S):
            stats[grp.replace("stats-", "")] = {lab: val for lab, val in re.findall(r'label">([^<]+)</div><div class="value[^"]*">([^<]+)</div>', body)}
        r = {"pick": int(re.sub(r"\D", "", pick) or 0), "name": name, "pos": pos, "school": school,
             "ht": htmllib.unescape(re.sub(r"<[^>]+>", "", hw[0][0])) if hw else None,
             "wt": re.sub(r"<[^>]+>|\s*lbs", "", hw[0][1]).strip() if hw else None,
             "year": ya[0][0] if ya else None, "age": ya[0][1] if ya else None, "stats": stats}
        if mock:
            r["team"] = logos[0] if logos else None
            r["via"] = logos[1].replace("From ", "") if len(logos) > 1 else None
        rows.append(r)
    return rows


def draft():
    mock = parse_tankathon(fetch("https://www.tankathon.com/mock_draft", "text"), True)
    board = parse_tankathon(fetch("https://www.tankathon.com/big_board", "text"), False)
    if len(mock) < 30 or len(board) < 30:
        raise RuntimeError(f"tankathon parse too small {len(mock)} {len(board)}")
    save("draft.json", {"source": "Tankathon (tankathon.com)", "mock": mock, "board": board})


# --------------------------------------------------------------------------------------------------------- CBB tasks
def cbb_teams():
    """All Division I teams (ESPN team list) with conference membership from the full standings."""
    tl = fetch(f"{SITE}/mens-college-basketball/teams?limit=1000")
    stmap, _ = standings_map("mens-college-basketball")
    teams = []
    confs = {}
    for t in tl["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        st = stmap.get(t["id"], {})
        conf = st.get("conf")
        if conf:
            c = confs.setdefault(conf, {"name": conf, "abbr": st.get("confAbbr"), "n": 0})
            c["n"] += 1
        teams.append({"id": t["id"], "abbr": t.get("abbreviation"), "name": t.get("displayName"), "short": t.get("shortDisplayName"),
                      "nick": t.get("name"), "location": t.get("location"), "color": t.get("color"), "alt": t.get("alternateColor"),
                      "logo": logo_of(t), "logoDark": dark_logo_of(t), "conf": conf, "confAbbr": st.get("confAbbr"), "slug": t.get("slug")})
    if len(teams) < 300:
        raise RuntimeError(f"too few cbb teams {len(teams)}")
    save("cbb/teams.json", teams)
    save("cbb/conferences.json", sorted(confs.values(), key=lambda c: c["name"]))


def wl(rec):
    m = re.match(r"\s*(\d+)-(\d+)", rec or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def cbb_standings():
    stmap, raw = standings_map("mens-college-basketball")
    confs = {}
    for tid, s in stmap.items():
        v, d = s["v"], s["d"]
        overall = d.get("total") or d.get("overall") or d.get("Overall") or ""
        conf = d.get("vsconf") or d.get("vs. Conf.") or d.get("vsConf") or d.get("conference") or ""
        w, l = wl(overall)
        cw, cl = wl(conf)
        confs.setdefault(s["conf"], []).append({
            "id": tid, "overall": overall or f"{w}-{l}", "conf": conf or "0-0", "w": w, "l": l, "cw": cw, "cl": cl,
            "cwp": cw / (cw + cl) if cw + cl else None, "wp": w / (w + l) if w + l else None,
            "streak": d.get("streak") if d.get("streak") not in (None, "-", "") else None, "home": d.get("home") or d.get("Home"), "road": d.get("road") or d.get("Road") or d.get("away"),
            "gb": d.get("gamesBehind")})
    for k, lst in confs.items():
        lst.sort(key=lambda r: (-(r["cwp"] if r["cwp"] is not None else -1), -r["cw"], r["cl"], -(r["wp"] or 0), -r["w"]))
        for i, r in enumerate(lst, 1):
            r["confRank"] = i
    save("cbb/standings.json", confs)


def cbb_net():
    js = fetch("https://ncaa-api.henrygd.me/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings")
    if not js.get("data"):
        raise RuntimeError("no NET data")
    save("cbb/net.json", {"updated": js.get("updated"), "rows": js["data"]})


def on3_next(url):
    h = fetch(url, "text")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        raise RuntimeError("no __NEXT_DATA__")
    return json.loads(m.group(1))["props"]["pageProps"]


def recruits():
    year = int(SEASONS["cbb"]["year"])
    out = {}
    for cls in range(year - 6, year + 1):
        base = f"https://www.on3.com/rivals/rankings/industry-player/basketball/{cls}/"
        try:
            first = on3_next(base)
        except Exception as e:  # noqa: BLE001
            print("  recruits", cls, e)
            continue
        pages = ((first.get("playerData") or {}).get("pagination") or {}).get("pageCount", 1)
        lists = [first]
        more = pmap(lambda p: on3_next(f"{base}?page={p}"), list(range(2, pages + 1)), workers=4)
        lists += [more[p] for p in sorted(more) if more[p]]
        for pp in lists:
            for e in (pp.get("playerData") or {}).get("list", []):
                p = e.get("person") or {}
                r = p.get("rating") or {}
                st = p.get("status") or {}
                rec = {"name": p.get("name"), "cls": p.get("classYear") or cls, "stars": r.get("consensusStars") or r.get("stars"),
                       "rank": r.get("consensusNationalRank") or e.get("consensusOverallRank"), "posRank": r.get("consensusPositionRank"),
                       "stateRank": r.get("consensusStateRank"), "rating": r.get("consensusRating"), "pos": p.get("positionAbbreviation"),
                       "state": r.get("stateAbbr"), "hs": p.get("highSchoolName"), "hometown": p.get("homeTownName"),
                       "ht": p.get("formattedHeight"), "wt": p.get("weight"), "committed": (st.get("committedOrganizationSlug") or "").replace("-", " ").title(),
                       "slug": p.get("slug")}
                k = norm_name(rec["name"])
                if k and (k not in out or (out[k].get("cls") or 0) < rec["cls"]):
                    out[k] = rec
    if len(out) < 300:
        raise RuntimeError(f"too few recruits {len(out)}")
    save("cbb/recruits.json", {"source": "On3 Industry Ranking (on3.com)", "players": out})


def portal():
    year = int(SEASONS["cbb"]["year"])
    out = {}
    root = "https://www.on3.com/transfer-portal/wire/basketball/"
    cur = on3_next(root)
    cur_year = int(cur.get("selectedYear") or year - 1)
    for py in sorted({cur_year - 1, cur_year}):
        base = root if py == cur_year else f"{root}{py}/"
        try:
            first = cur if py == cur_year else on3_next(base)
            if int(first.get("selectedYear") or py) != py:
                print("  portal year mismatch", py, first.get("selectedYear"))
                continue
        except Exception as e:  # noqa: BLE001
            print("  portal", py, e)
            continue
        pages = (first.get("pagination") or {}).get("pageCount", 1)
        k0 = norm_name(((first.get("list") or [{}])[0].get("player") or {}).get("fullName"))
        param = None
        for cand in ("page", "pageNumber", "p", "currentPage"):
            try:
                test = on3_next(f"{base}?{cand}=2")
            except Exception:
                continue
            k2 = norm_name(((test.get("list") or [{}])[0].get("player") or {}).get("fullName"))
            print("  portal paging", cand, k0, k2, (test.get("pagination") or {}).get("currentPage"))
            if k2 and k2 != k0:
                param = cand
                break
        META.setdefault("notes", {})["portal_param"] = param
        more = pmap(lambda p: on3_next(f"{base}?{param}={p}"), list(range(2, min(pages, 80) + 1)), workers=4) if param else {}
        for pp in [first] + [more[p] for p in sorted(more) if more[p]]:
            for e in pp.get("list", []) or []:
                pl = e.get("player") or {}
                hist = e.get("organizationHistory") or []
                st = e.get("status") or {}
                ca = st.get("committedAsset") or {}
                tr = e.get("transferRating") or e.get("rating") or {}
                frm = (e.get("organization") or {}).get("fullName")
                rec = {"name": pl.get("fullName"), "year": py, "pos": (pl.get("position") or {}).get("abbr"), "cls": pl.get("classRank"),
                       "from": frm, "to": ca.get("fullName"), "status": st.get("type"), "date": st.get("date"),
                       "stars": tr.get("consensusStars") or tr.get("stars"), "rank": tr.get("consensusNationalRank") or tr.get("nationalRank"),
                       "hs": pl.get("highSchoolName"), "hometown": (pl.get("hometown") or {}).get("abbr"),
                       "history": [{"team": (h.get("team") or {}).get("fullName"), "from": h.get("startYear"), "to": h.get("latestYear")} for h in hist]}
                k = norm_name(rec["name"])
                if k:
                    out.setdefault(k, [])
                    if not any(x["year"] == py and x["from"] == rec["from"] for x in out[k]):
                        out[k].append(rec)
    if len(out) < 40:
        raise RuntimeError(f"too few portal entries {len(out)}")  # keeps previous file
    save("cbb/portal.json", {"source": "On3 Transfer Portal (on3.com)", "players": out})


def news_digest():
    """Small digest of league headlines (the site also reads ESPN news live)."""
    for key, lg in LG.items():
        js = fetch(f"{SITE}/{lg}/news?limit=50")
        arts = [{"h": a.get("headline"), "d": a.get("description"), "t": a.get("published"), "u": ((a.get("links") or {}).get("web") or {}).get("href"),
                 "img": ((a.get("images") or [{}])[0]).get("url")} for a in js.get("articles", [])]
        save(f"{key}/news.json", arts)


# ------------------------------------------------------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)
    global SEASONS
    SEASONS = season_info()
    META["seasons"] = SEASONS
    run("nba_teams", 20, nba_teams)
    run("cbb_teams", 20, cbb_teams)
    run("nba_teamstats", 1, lambda: team_stats("nba"))
    run("nba_bpi", 1, lambda: bpi("nba"))
    run("nba_power", 1, nba_power)
    run("nba_leaders", 1, nba_leaders)
    run("nba_cup", 1, nba_cup)
    run("cbb_standings", 1, cbb_standings)
    run("cbb_bpi", 1, lambda: bpi("cbb"))
    run("cbb_teamstats", 5, lambda: team_stats("cbb"))
    run("cbb_net", 5, cbb_net)
    run("draft", 11, draft)
    run("portal", 11, portal)
    run("recruits", 70, recruits)
    run("news", 1, news_digest)
    META["built"] = NOW.isoformat()
    save("meta.json", META)
    bad = META.get("errors") or {}
    print("errors:", json.dumps(bad, indent=1))


if __name__ == "__main__":
    main()
