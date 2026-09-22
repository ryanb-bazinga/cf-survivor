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
assets/img/             season logo, favicon, share card, home screen icons
site.webmanifest        name and icons for "add to home screen"
data/config.json        current season, episode schedule, feature flags
data/season51.json      generated from the tracking workbook
data/season50.json      archive
data/season49.json      archive
data/season48.json      archive
data/recaps51.json      written episode recaps
data/bios51.json        cast bios
build.py                reads a tracking workbook, writes a season JSON
make_share_assets.py    regenerates the share card and home screen icons
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
| `episodeRecaps` | Episodes tab and written recaps |
| `castPhotos` | Real headshots instead of lettered cards |
| `bootOrder` | Who is left and who has gone out, above the cast grid |
| `pickSubmission` | Make Picks tab and the draft form |
| `welcome` | Welcome tab |

Every flag in the block is wired to something. If you add a new one, wire it
up in `app.js` at the same time, otherwise it sits in config doing nothing and
the next person reading this file assumes the section exists.

## Eliminations

Every episode tab has an **ELIMINATED** checkbox as its last column, at V.
Tick it on the episode a castaway leaves the game. That drives the boot order
strip on the site, the struck-through picks in the standings, and the Status
column on the Cast tab.

It is worth zero points and sits outside the range the Points column sums, so
ticking it can never move anyone's score.

How someone left comes from the boxes already next to it. Quit Game, Med
Visit EVAC or Voted Out WITH Idol next to a ticked ELIMINATED gives that
reason. ELIMINATED on its own means an ordinary vote-out. Quit and medical
show a grey badge on the site instead of a red one, since neither is a vote.

Eliminations are recorded even on an episode marked as not counting, such as
a premiere that airs before the draft. Leaving the game is not a score.

Seasons 48 through 50 have no ELIMINATED column. `build.py` falls back to the
old behaviour there, which only knows about people who went out holding an
idol, so their boot order is incomplete. Nothing on the live site reads it.

## Link preview and home screen icons

`make_share_assets.py` builds `assets/img/share-card.png` (what Teams,
iMessage and email show when the link is pasted) and the three home screen
icons, all from `assets/img/season-logo.png` and `assets/img/favicon.svg`:

```
python3 make_share_assets.py
```

Run it once a season, after dropping in the new season logo. Then bump the
`?v=` number on the `og:image` and `twitter:image` tags in `index.html`.
Teams and iMessage cache preview images hard, and the version number is what
forces them to fetch the new one.

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

## Pick submission

Players submit their three castaways on the site itself, on the "Make Picks" tab.
That tab only exists while the draft window is open. Once the deadline in
`config.json` passes it removes itself from the nav and the Draft Board takes over.

**How it works.** The page writes one row per submission to a Supabase table and
can never read a row back: the table has an insert policy and no select policy,
so picks are not visible to anyone browsing the site, including the person who
just submitted. Submitting again does not overwrite anything, it adds another
row. The newest row per owner is that owner's real entry, which is what makes
"change my picks" work with no login.

**The deadline is enforced twice.** The page hides the form after the date
derived from `config.json`, and the database refuses the insert outright after
`league_settings.picks_close_at`. The database one is the real cutoff. Leaving
the tab open past the deadline does not buy anyone extra time.

**Changing the deadline** means changing it in both places: the episode air date
and `draft.hoursBefore` in `config.json` for the display, and the
`league_settings` row for enforcement.

**Reading the picks.** Ask Claude. The `latest_picks` view already returns the
newest submission per owner per season, which is what gets typed into the
workbook. Nothing on this site reads it.

**New season checklist:** insert a `league_settings` row for the new season
number with its open and close times, and confirm `supabase.url` and
`supabase.key` in `config.json` still point at the right project. The key in
that file is a publishable key and is meant to be public; it can only insert.

## Browser caching

GitHub Pages tells browsers to hang on to `app.js` and `site.css`, so anyone who
has opened the site before keeps running the old code and will not see a new
section until they hard refresh. `build.py` handles this: it stamps the links in
`index.html` with a short hash of each file's contents, so a changed file gets a
new URL and a changed URL always gets fetched. The hash only moves when the file
actually changes, so a normal weekly rebuild leaves `index.html` alone.

Nothing to remember here, just do not hand-edit those `?v=` values, and run
`build.py` after changing the CSS or JS rather than committing them on their own.
