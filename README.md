# CF Survivor League

Standings site for the Cornerstone Fellowship staff and family Survivor fantasy pool.
Plain HTML, CSS and JavaScript. No build step, no framework, no server.

## How it works

Everything on the page renders from JSON in `data/`. The page itself never
changes between weeks. Only the data does.

```
index.html              the whole site, one page, tabbed sections
assets/css/site.css     styling
assets/js/app.js        rendering
assets/img/             season logo and favicon
data/config.json        current season, episode schedule, feature flags
data/season51.json      generated from the tracking workbook
data/season50.json      archive
data/season49.json      archive
data/season48.json      archive
build.py                reads a tracking workbook, writes a season JSON
```

## Updating after an episode

1. Check the boxes in `Survivor Tracking Season 51.xlsx` as usual.
2. Run the build:

   ```
   python3 build.py 51
   ```

   Or `python3 build.py all` to rebuild every season.

3. Commit and push. GitHub Pages redeploys on its own within a minute.

`build.py` looks for the workbooks in the CF OneDrive Survivor folder by
default. Point it somewhere else with `--root` or `--workbook`.

## Turning sections on and off

`data/config.json` has a `features` block. Set any of these to `false` and
that section disappears from the navigation without touching any code.

| Flag | Section |
| --- | --- |
| `standings` | Standings table |
| `draftBoard` | Draft board and ownership bars |
| `castTracker` | Cast grid |
| `scoringRules` | Point values |
| `pastSeasons` | Champions from prior seasons |
| `countdown` | Next episode countdown in the header |

The remaining flags (`myTeam`, `headToHead`, `scoreChart`, `weeklyAwards`,
`bootOrder`, `episodeRecaps`, `castPhotos`) are reserved for sections that
are planned but not built yet. They do nothing right now.

## Adding a new season

1. Add the season to `data/config.json` under `seasons`, with its tribes and
   episode air dates.
2. Set `currentSeason` to the new number and move the old one into
   `archiveSeasons`.
3. Add the season number to `SEASONS` in `build.py`.
4. Run `python3 build.py <number>`.

## Scoring

The point table is read from the workbook itself, not hardcoded here. Change
a point value in the workbook and it changes on the site at the next build.

## Notes

- Castaways show as name cards. Real photos can be dropped into
  `assets/img/cast/` later and wired up through the `castPhotos` flag.
- Episode air dates in `config.json` are estimates past the premiere. Correct
  them as CBS confirms the schedule.
