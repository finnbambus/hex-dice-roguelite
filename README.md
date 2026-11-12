# Hex & Dice Roguelite — first playable draft

A solo roguelite built on hex-and-dice settlement rules: develop one island across an endless run, bend the **dice** and the **fields**, and pay an escalating **tribute** after every round. Miss one and the run ends.

This is draft 0.1, built to **test the workflows** of the rulebook (*Hex & Dice Roguelite — Rulebook, working title*). The interface is a full design pass (see below); the art is generated and still placeholder-grade for a public release.

> Working title and placeholder theme. The resource names and board follow a well-known base game only so the rules are easy to test; a public release needs its own name, theme and art.

## Play

- **Online:** once GitHub Pages is on, at `https://<your-user>.github.io/hex-dice-roguelite/`
- **Locally:** the game uses ES modules, so it must be served over HTTP (opening `index.html` as a file won't work):

  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

No build step, no dependencies. It's plain HTML, CSS and JavaScript.

### How the screen works

The interface is dark and modern: greys, one vermilion accent for things you can press, medieval display type for titles and numbers.

- **One stage, no side columns.** Everything sits on the table around the island:
  - **Right column** (top to bottom): one **run card** at the top (the boss and its description first, then an ante indicator ("Ante 1 · Small round") that sits directly above the tribute so it is clear whose tribute it is, the tribute with a bar per resource and "Ready to pay", and a PAID stamp once settled), with the **action card** anchored to the bottom right.
  - **Menu** button (top-left): How to play, Tutorial, Game log, the screen-shake switch and, set apart at the bottom, New run. Dev tools appear only with `?dev` in the address or when served from localhost.
  - **Score** is the VP number in the top left corner, next to the Road and Army title cards. The **Storehouse** sits beside the resource stacks it was shipped from.
  - **Action card:** a three-step flow on top (Roll → Build & trade → Tribute; the result of a roll belongs to Roll) with the Small / Big / Boss slider right under it (the same size and look as the step flow), the step in the middle (**Rolls left** are shown inside the Roll button), and the main button at the bottom. Under it sits one row with the secondary button (Skip all rolls, End round now, Reroll boss) and the **?** button, which opens the how-to and tips for the current step over the board (closed by default; it pulses until you first open it).
  - **Titles:** two small cards next to the score show **Road** (longest road) and **Army** (knights played) with what they are worth. Hover for the VP rules and, for Road, the chain of roads is highlighted and numbered on the island.
  - **Tutorial:** a guided tour that dims the screen and points at each part of the real interface. It is offered on the action card before the first roll (and always in the menu).
  - **Dice faces:** faces with a Knight or Robber trigger show a sword or robber instead of every pip (the number of symbols is the face's value); Lucky Number and Hidden do the same with a clover or an eye. Rare triggers have a gold frame. The same art is used in the shop and on the dice.
  - **Face upgrades** (Raise, Lower, Reforge, …) show a bell curve of the chance of each roll total; hover a face to see how the curve changes.
  - **Ports:** each port is just its stack of resource cards (two cards for 2:1, three "?" cards for 3:1, like the packs in the shop) with the rate centred on a layer above it, floating beside its coast piece. A thin dashed pier runs from the stack to each of the two intersections it serves, ringed in the resource colour. Upgrade tags sit above the stack; while a port is being picked, the stack glows and is clickable.
  - **Shop:** a popup over the board after the tribute is paid; every offer shares the same rows, so art, names, prices and Buy buttons line up; the run card and your hand stay visible. Reroll offers sits in its footer. The action card stays in place with the **Next round** button exactly where the main button always is, plus Reroll boss. Your dice are not repeated in the popup.
  - **Dice:** in the Roll and Shop steps they are shown big, without boxes. Drag a die to spin it and see every face (double-click to reset), or click it to open a sheet with its six faces and upgrades (hover a face for what it does). In the Result step they are compact at the bottom of the card; the Build & trade step has no dice. **Face upgrades:** after you buy one, the action card shows the dice big; spin them and click the face you want to upgrade (Cancel backs out).
- **Island** (centre): isometric halftone tiles with 3D-rendered pieces, number tokens in perspective, lying flat like printed paper on a very quiet black-and-white halftone tabletop (faint wood fibres) (the paper itself never moves, except when the table is hit). Drag to pan. Field upgrades show as a finish and rim on the hex and a ring on the token (hover for the upgrade's figure).
- **Score and titles** (top left, next to the menu button): the VP number plus the Longest road and Largest army cards (hover for the breakdown).
- **Hand row** (bottom of the island): resources as card stacks, your single-use cards and your guilds, all in one row on one baseline at the same card size. The row is scaled to fill all the width left of the action card (`fitHand` in `ui.js`). Placement spots are plain static dots (no animations on the board: with the lamp blend on top, pulsing dots made it laggy). Click a single-use card to pick it; its Play button appears on the card (click elsewhere or press Esc to put it back). Cards carry rarity in their border: grey, silver-blue, or holo for legendary.
- **Action card** (right): what you can do right now, with one main button. How-to text sits behind the **?** button at the bottom of the card. Hovering a build option highlights the cards it would use. After a roll, what it changed or triggered pulses on screen and is listed under "Changed by this roll".
- **Printed, not rendered:** cards, dice, number tokens and pieces look like things printed on stock: each card sits a hair off-axis (stacks are slightly uneven), the art plate is printed barely out of register, the board pieces have a faint red/cyan plate fringe, there is a light paper tooth over cards and dice, and cards carry a thin warm bone outline. It is deliberately only slightly noticeable. All of it is CSS (`--tooth`, `--bone-line`, `rotate: var(--rot)`); the tilt is steady per card, never random per frame.
- **Shop:** upgrades are shown as objects with the same figure they get in play (a face, die, token, hex or port modification); cards are shown as cards.

| Key | Action |
| --- | --- |
| `Enter` / `Space` | The step's main button (roll, continue, pay, next round) |
| `Esc` | Cancel the current choice / close a dialog or drawer |

Every run has a **seed** (shown top right and in the URL, e.g. `?seed=4242`). The same seed gives the same board and the same dice (start one from New run), as long as you make the same choices, so a bug or a fun situation can be shared as a link.

### Dev tools

Open the game with `?dev` in the address (e.g. `index.html?dev`) and the menu gains a **Dev tools** entry. It opens a testing panel: add resources, force the next roll, give yourself any item for free, skip straight to the shop, and add shop budget. Use it to set up specific situations (e.g. Echo + Copycat + Mirror) without grinding for them.

## Publish on GitHub Pages

1. Create a repository (e.g. `hex-dice-roguelite`) and push this folder to its `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the game is live at `https://<your-user>.github.io/<repo>/`.

The `.nojekyll` file stops GitHub from running Jekyll over the files. All paths are relative, so the game also works from a sub-path or a custom domain.

### Pay now on the tribute counter (v46)

Ending a round early moved from the action card to the run card: when the tribute is payable during the Roll or Build & trade step, the "Ready to pay" badge becomes a **Pay now · +N VP** button (N = unused rolls). "Skip all rolls" and "End round now" are gone from the action card. While the tribute is not payable there is no early end; once the rolls are used up the main button still leads to the tribute.

### Step line and tips button (v44)

The Roll / Build & trade / Tribute line uses the same markers as the Small / Big / Boss track above it: caps, a dot per step (filled when done, ringed when current) and hairline joins. The **?** tips button is smaller (22 px) with a grey outline; until it has been opened once only the question mark is orange.

### Result step reworked (v43)

The roll reads as one line at the top of the action card, in the adjust and Result steps: die + die = total (a 7 is red). Below it the Result step is one ledger: a row per resource with its art, where it came from (e.g. "Forest 5 ×2") and the amount; losses to the robber and Storehouse changes use the same rows. An empty roll shows why, with the dry-roll track. Everything else that fired is listed under **Also this roll**.

### Counted face on top (v41)

Dice are seen from above. The face that counts lies on top and is the lightest; the side faces are shaded darker. While choosing a face for an upgrade the dice keep the earlier front view with even shading.

### Die effects as markers (v40)

In the adjust and Result steps, whatever touched a die on this roll (Loaded, Nudge, Recast, Echo hold…) shows as small orange dots beside its value, one per effect, so the dice row keeps its height. Hover the dots for the list; the die sheet lists the same under **This roll**. White marks on dark faces (Mirror ring, R, ?) glow.

### Solid dice (v39)

The six faces of a die have opaque edges that overlap slightly at the seams, and dark faces (Mirror, Robber's Face, Blank) are a shade lighter than the panel, so the die keeps a closed outline at every angle.

### Odds in the die sheet (v36)

Clicking a die opens its six faces and, below them, the chance of each total 2–12 with both dice as they stand (changed faces, Loaded weights, Mirror, Blank and Robber's Face included), plus the chance of a 7 and the average total. While the sheet is open in the Roll and Shop steps the big dice shrink so everything fits.

### Looking at the board from the shop (v35)

**View board** in the shop's footer hides the shop sheet so the island, tokens and ports can be inspected (hover works as usual). **Back to the shop** at the top of the board, or Esc, returns.

### Interface layer (v34)

`css/v1.css` is the last stylesheet and holds the v1 interface pass: spacing, radius and type tokens, the fixed action-card frame, and the shop, pack, menu, title and game-over layouts. Board, dice and card rendering stay in `css/style.css`. The audit behind it is in `docs/ui-audit-v1.md`.

## Project structure

```
index.html          page shell
css/style.css       placeholder styling (light and dark mode)
js/main.js          bootstraps the UI, reads ?seed=
js/ui.js            rendering (status bar, SVG board, step panel, hand, dialogs) and the browser `io`
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

- **Starting position:** you place 4 free settlements, each with a free road (base game: 2). Set with `START_SETTLEMENTS` in `js/content.js`.
- **Starting resources:** every starting settlement pays one card per adjacent hex (the base game pays only the last one). Switch with `SETUP_RESOURCES` in `js/content.js`.
- **Losing streak (new rule):** if all 4 rolls of a round produce no resources for you, you draw a free development card. Skipping rolls doesn't count. Switch off with `LOSING_STREAK` in `js/content.js`.
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
- No sound yet (`Feel.sound()` in `js/feel.js` is the hook for a later synthesised pass); placeholder graphics only.
- Characters (planned in the rulebook) are not in.
- **Balance is untested.** The naive bot rarely clears ante 1: with only two starting settlements, a Small tribute of 3 cards of one type after 4 rolls is a real hurdle. The rulebook already flags the first-ante simulation as the next open question, and the bot runs give a starting point for it.


## Code map (interface)

- `js/ui.js`: stations, action card (step indicator, step, dice area), hand, shop, dialogs; implements the engine's `io` (board clicks, choices).
- `js/feel.js`: game feel only, no rules: table shake and lamp flare on big hits (shake has a switch in the menu; reduced-motion turns shake, flare and counting off) and numbers that count up. The UI starts them when a roll lands (cards drop onto their stacks, score counts up), when a boss or the robber hits, and when a tribute is paid.
- `js/board-view.js`: the island (tiles, pieces, ports, tokens, tabletop, camera, targets). Draws only; no rules.
- `js/ports-atlas.js` + `assets/ports.webp`: the port pieces (generated): six 3D-modelled ports (brick, lumber, wool, grain, ore, generic), each rendered for the six coast directions with the same camera as the tiles and printed in the same two-tone halftone.
- `js/figures.js`: the 43 upgrade figures, exported as `figure(id, scale)` (HTML), plus `portPlate(type, width)`, the harbour card used on the board.
- `css/fonts.css`, `css/style.css`: fonts (self-hosted in `assets/fonts`) and the theme.
- `assets/`: `terrain.webp` (6 single-ink terrains), `pieces.webp` (settlement, city, robber, roads), `art.webp` (halftone card art), `hexprint.webp` (cardboard hex print).
