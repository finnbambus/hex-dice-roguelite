# Hex & Dice Roguelite — first playable draft

A solo roguelite built on hex-and-dice settlement rules: develop one island across an endless run, bend the **dice** and the **fields**, and pay an escalating **tribute** after every round. Miss one and the run ends.

This is draft 0.1, built to **test the workflows** of the rulebook (*Hex & Dice Roguelite — Rulebook, working title*). Graphics are deliberately plain placeholders.

> Working title and placeholder theme. The resource names and board follow a well-known base game only so the rules are easy to test; a public release needs its own name, theme and art.

## Play

- **Online:** once GitHub Pages is on, at `https://<your-user>.github.io/hex-dice-roguelite/`
- **Locally:** the game uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work):

  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

No build step, no dependencies. It's plain HTML, CSS and JavaScript.

### Controls

| Key | Action |
| --- | --- |
| `R` / `Space` | Roll (or resolve a pending roll) |
| `E` | End the round |
| `Esc` | Cancel the current choice / close a panel |

Every run has a **seed** (shown top right and in the URL, e.g. `?seed=4242`). The same seed gives the same board and the same dice, as long as you make the same choices, so a bug or a fun situation can be shared as a link.

### Dev tools

The **Dev tools** button opens a testing panel: add resources, force the next roll, give yourself any item for free, skip straight to the shop, and add shop budget. Use it to set up specific situations (e.g. Echo + Copycat + Mirror) without grinding for them.

## Publish on GitHub Pages

1. Create a repository (e.g. `hex-dice-roguelite`) and push this folder to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the game is live at `https://<your-user>.github.io/<repo>/`.

The `.nojekyll` file stops GitHub from running Jekyll over the files. All paths are relative, so the game also works from a sub-path or a custom domain.

## Project structure

```
index.html          page shell
css/style.css       placeholder styling (light and dark mode)
js/main.js          bootstraps the UI, reads ?seed=
js/ui.js            rendering (SVG board, panels, modals) and the browser `io`
js/game.js          the rules engine (no DOM access)
js/content.js       all shop items, bosses and tables as data
js/board.js         board geometry and random board generation
js/rng.js           seeded random number generator
tests/sim.mjs       headless bot runs (crash test, coverage, rough balance)
```

The engine never touches the DOM. Whenever it needs a decision it awaits an `io` object (`chooseHex`, `chooseOption`, `chooseResources`, …). The browser UI implements `io` with clicks and dialogs; the test bot implements it with random choices. Any future front end (a proper art pass, a canvas renderer, a mobile app) can reuse `game.js` as is.

### Changing numbers

Prices, rarities, descriptions, the loading table, tribute sequences, reroll prices and the boss list all live in `js/content.js`. Most balancing passes only need that file.

## Tests

```bash
node tests/sim.mjs 300 coverage   # bot gets extra resources and budget, reaches deep content
node tests/sim.mjs 300 balance    # honest play by a naive bot
```

The runs fail loudly on crashes or broken invariants (negative resources, negative budget, piece limits exceeded) and report how many rounds the bot survived and which items it never managed to buy. A GitHub Action runs both on every push.

## What's implemented

Everything in the rulebook's current version:

- Board setup with random terrain, tokens (no adjacent 6/8) and 9 ports; two free settlements and roads
- Antes of Small / Big / Boss rounds, tribute table and ×1.5 extrapolation, boss drawbacks, boss reveal and reroll
- 4 rolls per round, build window after each roll, +1 VP per unused roll
- Robber and 7s (choose your discards, robber jumps onto one of your hexes), knights, largest army, longest road
- Bank and port trading, Storehouse shipping with batch rates, surplus VP
- VP score as shop budget; shop with 5 slots, packs, rerolls, uniqueness rules
- All face and die upgrades (incl. Loaded 1–10, Echo chains and "You broke the game", Copycat, Mirror vs Mirror)
- All token, hex and port upgrades; all classic cards, Edicts, Guilds and Charters (incl. Forgery and Lost and Found)
- All 9 bosses

## Interpretations made in this draft

Where the rulebook was open, the draft picks one reading. Each is a single spot in `game.js` to change.

- **Building before the first roll:** allowed. The build window is open any time during a round when no roll is pending.
- **Levy Delay:** carried tribute parts may use any type, even one already used by this round's parts.
- **Overflow:** leftover cards smaller than a batch ship 1:1 (so 7 ore at 6+1 → 8 in total).
- **Double Token:** the second number is random (2–12, not 7, not the hex's own number).
- **Order of production modifiers:** flat bonuses first (Fertile Soil, Lucky Number, Mathematicians, Monoculture), then multipliers (Jackpot, Twin Token, Volcanic, Haven, Bumper Harvest, Omen).
- **Next boss after a boss round:** revealed in that shop, so it can be rerolled there.
- **Fire Priests:** the once-per-round eruption reroll happens automatically on the first eruption.
- **Nudge:** clamps at 1 and 6 (no wrap-around), unlike Raise and Lower.
- **Robber's Face:** the roll counts as 7 and is never a double.
- **Demolition:** removes a city completely (not back to a settlement) and gives double the city cost.
- **Dev card from the stack with full slots:** you may discard a card to make room; otherwise the drawn card is lost.
- **Loaded:** buying again levels up the same face. Moving the weight to another face is not in the draft yet.

## Known gaps

- No save and resume (a refresh starts a new run with the same seed).
- No animations or sound; placeholder graphics only.
- Characters (planned in the rulebook) are not in.
- **Balance is untested.** The naive bot rarely clears ante 1: with only two starting settlements, a Small tribute of 3 cards of one type after 4 rolls is a real hurdle. The rulebook already flags the first-ante simulation as the next open question, and the bot runs give a starting point for it.
