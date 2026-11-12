# Hex & Dice — UI audit and v1 action plan

Audited build: `b406b4d` ("fix ports", v33), 12 Nov 2026.
Method: the game was run in headless Chrome and driven through every phase and state (52 screenshots at 1440×900, plus the main states at 1280×720, 1920×1080, 1100×760 and 390×844). Each element was judged against the usual rules: Nielsen's ten heuristics, Gestalt grouping and alignment, visual hierarchy, signifiers and affordance, Fitts's and Hick's laws, a 4/8 px spacing grid, a bounded type scale, and WCAG 2.1 AA contrast and text size.

**Overall grade for the beta: C+** — and **D as shipped**, because of one regression that breaks every card (finding 1). The art direction is the strong part: the halftone board, the cards, the dice and the lamp are distinctive and consistent. What reads as "unfinished and loaded" is the chrome around them: the same fact stated three or four times, controls that look pressable but are not, a type scale with 35 sizes, and layout that jumps between steps.

## 1. Release blockers

| # | Finding | Evidence |
|---|---|---|
| 1 | **Cards and guild cards are broken.** The base `.pcard` rule (size, border, `container-type`) was deleted in commit `HEAD~9` ("Port cards: fix class clash with hand cards"). Card text is sized in `cqw`, so without a container it falls back to the viewport: a card name renders about 216 px tall across the whole screen as soon as you hold one card or guild, and card offers in the shop collapse into each other. | Hold any development card; open any shop with a card offer. |
| 2 | **The board prompt covers the score HUD.** "Click the board: Fertile Soil: choose a hex" is centred at a fixed top offset and runs over the Road and Army chips whenever the text is longer than about 40 characters. | Place any hex upgrade. |
| 3 | **Laptop-height screens do not fit.** At 1280×720 (and 1366×768) the run card plus the action card exceed the column: Build & trade shows two of its four sections, and the shop-step dice overflow the card's right edge. | Any build step at 720 px height. |
| 4 | **A dormant boss rule is the loudest text on screen.** The boss only applies in the Boss round (`bossActive` is `blind === 2`), but its rule is printed in bold white 14 px under a 29 px name in all three rounds. "Rolls of 2, 3, 11 and 12 produce nothing" reads as true now when it is not. | Small round, ante 1. |

## 2. Element grades

| Element | Grade | Main flaws | Rule broken |
|---|---|---|---|
| Board and stage | A− | Prompt collision (finding 2). Otherwise clear: tokens legible, targets marked, lamp sets the mood per phase. | — |
| Score HUD (VP, Road, Army) | C+ | Labels at 8.5 px; "3 to go" in `--dim` on dark is 3.6:1; the VP unit sits off the number's baseline; chips 58 px tall next to a 40 px menu button, so the row has three different heights. | Contrast, alignment |
| Run card (boss, ante, tribute) | C | Hierarchy is inverted and does not change with state (finding 4): the objective, the tribute, is the smallest text. The round is named three times in 190 px ("Small round" badge, "Small tribute" eyebrow, and the selector below). Five text styles in one card. | Hierarchy, redundancy |
| Action card header | D+ | Two identical segmented controls stacked (Roll / Build & trade / Tribute and Small / Big / Boss). Both look like tabs and neither can be clicked. About 95 px of chrome that repeats the run card. | False affordance, minimalism |
| Action card frame | C | The card is content-sized, so its top edge moves at every step (y = 265 in Build, 400 in Result, 425 in Roll, 495 in Tribute at 900 px height). The primary button stays put, which is right; everything above it has to be found again each step. | Consistency |
| Roll step | B | Good primary with rolls-left pips. The heading repeats the round a fourth time. | Redundancy |
| Roll result | C+ | Section labels sit 0–2 px above their content and 10 px below the previous block, so they attach to the wrong group. The gain is a card with the number underneath rather than beside it. Engine strings are lower-case ("mountains (8) → +3 ore"). | Proximity |
| Build & trade | C− | The most-used screen. Tile text is cut to "No legal spot: needs you…". Resource names are lower-case at 10.5 px. The Ship section is clipped by the footer with no sign that the list scrolls. Three different tile styles in one panel. | Visibility of status, consistency |
| Tribute step | C | A bare "1" with no label; the tribute is shown twice, in two visual languages, 250 px apart; the "?" button sits alone in its own row. | Recognition, alignment |
| Hand bar | B− | Strong card art. The bar is scaled with `zoom`, so "No brick" renders at an effective 6.5 px. Count badges hang off the card corner. | Legibility |
| Cards and guild cards | F as shipped | Finding 1. | — |
| Shop | C | Card offers have no meta row and ride 25 px higher than the others. Every price is shown twice (pill, then button). Budget is stated three times. No hover feedback on offers. | Alignment, redundancy |
| Pack opening and choice dialogs | D | The reward moment of the run is a text list: "Lower (common) — Decrease a face by 1". No figure, no rarity colour, nothing shared with the shop's offer layout. | Consistency, aesthetics |
| Discard picker | B− | Clear. A disabled Confirm is dimmed orange, which reads as "dangerous" rather than "not yet". | Signifiers |
| Menu | C | Five bordered buttons of equal weight; "New run" (ends the run) looks the same as "Log"; "Dev tools" is offered to players. | Error prevention |
| Detail cards (tooltips) | B+ | Consistent and useful. | — |
| Tips popover and tutorial | B+ | Good. The tutorial copy mentions "the three bars below", which the header change makes obsolete. | — |
| Log and dev drawer | B | Fine. | — |
| Game over | D | The end of a run is a small card in the bottom-right corner: "You survived 1 round(s)". No cause, no summary, weak retry. | Feedback, closure |
| First load | D | No title; a first-time visitor lands in a placement prompt. | Onboarding |

## 3. System-level findings

- **Type scale.** 35 distinct font sizes, 21 rules under 10 px, sizes such as 8.5, 9.5, 10.5, 11.5, 12.5 and 13.5 px. A UI of this size needs about eight.
- **Contrast.** `--dim` (#6f6e69) is 3.3–3.8:1 on the panel colours and is used for captions at 8.5–11 px. AA asks for 4.5:1.
- **Spacing.** Paddings and gaps use 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18… There is no grid, which is why adjacent blocks never quite line up.
- **Radii.** Fourteen values between 1 and 18 px, plus pills.
- **States.** Disabled primary buttons keep their orange; there is no `:active` feedback; hover exists on buttons but not on offers.
- **Responsive.** Tuned for about 1440×900. Shorter screens overflow (finding 3), 1920×1080 and up leave the chrome at laptop size, and phones are not playable.
- **Stylesheet.** 816 rules in layers: `.hand` is declared 8 times, `.boss-row .name` 6, `.stage-overlay` 5. Later layers silently depend on earlier ones, which is how finding 1 happened.

## 4. Action plan

Ordered by what a first-time player meets.

**A. Fix what is broken**
1. Restore the `.pcard` base rule.
2. Move the board prompt into the free space right of the HUD so the two cannot overlap.
3. Make the right column fit from 680 px height: compact run card, dice sized to the card.

**B. Say each thing once**
4. Run card in reading order: ante and a three-dot round track; the boss, quiet while dormant and loud in the Boss round; the tribute last, next to the card where you act on it.
5. Replace both segmented controls with one numbered step line that does not look pressable.
6. Remove repeated round names, prices and budgets.

**C. One stable frame**
7. The action card fills the column: fixed top edge, primary button fixed at the bottom, secondary action above it, "?" in the card's top-right corner on every step.
8. One section rhythm inside the card: 16 px between groups, 8 px between a label and its content.

**D. Bring the weak screens up to the level of the board**
9. Build & trade: full-width rows with name, cost and status on one line; capitalised resource tiles; a fade where the list scrolls.
10. Roll result and tribute: the amount beside what it refers to, labelled.
11. Shop: one grid for all offers, price in the button only, hover lift, clear "need N more" and "bought" states.
12. Pack and upgrade choices rendered as offers with their figure, rarity and text.
13. Game over as a centred summary: what ended the run, rounds, ante, score, seed, retry.
14. Menu as a list with the destructive entry separated; dev tools only with `?dev`.
15. A title card on first load.

**E. System**
16. Tokens: 4 px spacing steps, three radii plus pill, an eight-step type scale with a 10 px floor, `--dim` raised to #8b8a84 (5.3:1).
17. States: neutral disabled buttons, pressed feedback, visible focus.
18. Scale the chrome up on screens from 1800×1000.
19. All of the above in one new stylesheet layer (`css/v1.css`) so the existing board, dice and card rendering is not disturbed.

**Not in this pass:** a phone layout (the board, hand and action card need a different arrangement, not a restyle), saving a run across reloads, and collapsing the old stylesheet layers into one file.

## 5. Status after the v1 pass (v34)

Implemented: all of A–E above (items 1–19). Checked by walking one run through every screen in headless Chrome at 1440×900 with no page errors, by repeating the main states at 1280×720, 1366×768, 1100×760, 1920×1080 and 2560×1440, and with the 300-run simulation.

Also changed along the way:
- A detail card can no longer open over the game-over summary.
- With no seed in the address the game opens on the title card; a seeded link goes straight in.

Still open:
- Phone layout (390 px wide) is not playable; see "Not in this pass".
- The shop shows every affordable offer with a filled orange button, so up to five primaries sit side by side. Worth a second look once real players have used it.
- The old stylesheet layers in `css/style.css` are untouched; `css/v1.css` overrides them.
