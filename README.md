# Courtside

Commentator and reporter prep for the **NBA**, **WNBA**, and **men's and women's college basketball**. Live at **https://bengasparian.github.io/courtside/**

Pick any two teams. **Game Day** (the default view) puts both rosters side by side on one screen, with live stats per player, play-by-play, live alerts (season highs, double/triple-double watch, milestones, hot hand, foul trouble), team fouls, bonus and timeouts, scoring runs, pronunciations, coach profiles, roster changes since last season and the last meeting. Press `?` for keyboard shortcuts.

Every view also has full notes:

- **Every player:** season and career averages, advanced stats with plain-English explanations, play style, role on the team, background (birthplace, high school, college, draft, contract), talking points, recent games, latest news and a personal notes box.
- **College extras:** On3 recruiting stars and national rank, high school and hometown, transfer history, national stat ranks, NBA mock-draft and big-board projections.
- **Every team:** stats and advanced stats with league ranks, play style, ESPN BPI outlook and odds, schedule, recent results, five-season history, Wikipedia history facts, interesting facts, injuries and news.
- **Matchup view:** head-to-head stat comparison, BPI projection, season series, players to watch, storylines, injuries, and a printable spotting board.
- **Live box scores** that refresh every 15 seconds, plus a scores page and a live ticker.
- **NBA hub:** switches automatically through the season (NBA Cup group tables and knockouts → All-Star race → playoff race and play-in → playoff bracket and title odds), plus power rankings, standings, leaders and the draft and lottery race.
- **College hub:** AP and Coaches polls, ESPN BPI, NET with quad records, national leaders, conference standings and strength, March Madness projected field and live bracket, transfer portal, and draft prospects.

## How it stays up to date

Nothing needs to be maintained by hand.

- **Live in the browser (ESPN public APIs):** scores, box scores, rosters, player stats, game logs, news, injuries, standings and polls.
- **Every 2 hours (GitHub Actions, `.github/workflows/data.yml`):** league-wide team ranks, power rankings, NBA Cup groups, BPI, conference standings, NET, the Tankathon draft boards, On3 recruiting rankings and the transfer portal. Results are written to the `data` branch. If a source fails, that source keeps its last good file.
- Season years, NBA phases and dates are all read from ESPN, so nothing needs changing for new seasons.

Run `python scripts/stamp.py` before committing site changes; it version-stamps file references so browsers never mix old and new files.

All sources are free: ESPN, Wikipedia, On3, Tankathon, and NCAA NET (via ncaa-api.henrygd.me).
