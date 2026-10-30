# Sleeper Hall of Fame

A live hall of fame for any Sleeper fantasy football league. Type a Sleeper username, pick one of that account's leagues, and the site builds the league's full history straight from Sleeper's public API. No sign-in, no setup, and new seasons show up automatically.

Every page has its own link (`?league=<id>&u=<username>#…`), so you can send a league its hall of fame directly.

**What's on it**
- **All-Time:** trophy case, Wall of Shame (toilet bowl losers), career Manager Score, single-game records, Luck Index, rivalries and trade heists, schedule swap, clutch rating and a head-to-head grid.
- **Stat search:** plain-English questions ("vpcalv's highest scoring player week 7 2023") and all-time rankings ("worst 1st round pick by points per game").
- **Drafts:** every draft round by round, with A–F team grades for redraft and keeper leagues.
- **Awards:** every season award and an award cabinet per manager.
- **Each season:** standings, power rankings, Manager Scores, awards, trades, team MVPs and weekly highs.
- **Current season:** live scores with matchup previews, plus playoff, bye, final and title odds from 10,000 simulated seasons.
- **Manager profiles** with career and season views, awards, and the full Manager Score math; a **compare** page for any two managers.

## How the Manager Score works

Each part is scored against the rest of the league that season (50 = average), then weighted:

| Part | Weight | What it measures |
|---|---|---|
| Results | 35% | Half win %, half all-play win %, plus bonuses for playoffs, the final and the title |
| Start/sit | 20% | Points started ÷ points from the best possible lineup |
| Waivers | 15% | Starter points from waiver and free-agent pickups |
| Trades | 20% | Redraft: value got minus value given, rest of season. Each traded player counts his points above a replacement-level starter at his position (never below 0); each traded pick counts what a pick in its slot is expected to give. Dynasty: starter points gained minus given up |
| Draft | 10% | Each pick's points above a replacement-level starter at its position, compared with what the slot was expected to give: 70% picks around the same slot across the league's drafts, 30% the Nth-best player that season for pick N (`draftHindsight` in config.js) |

The career score averages every season, weighted by games played.

Dynasty leagues leave the draft out of the score (the other parts are reweighted), keep counting traded players in later seasons while they stay on that team, and leave taxi-squad players out of the best-possible lineup.

## Files

- `index.html`, `style.css`: the page
- `js/config.js`: score weights, bonuses and simulation settings
- `js/data.js`: loading from Sleeper (finished seasons are cached in the visitor's browser)
- `js/model.js`: all stats, scores and odds
- `js/rank.js`, `js/search.js`: stat search
- `js/app.js`: start screen, rendering and navigation

Hosted free with GitHub Pages; no build step.
