# Kairos design system

Kairos is a planning tool. People open it to answer one question: *when will this land?* Every screen
starts with that answer in a sentence, then shows the work behind it. The interface is a few white panels on a soft cool ground, one dark card for the answer, one blue for action, and coral only where something is late.

## Read

**Design read.** A work tool for engineering and product teams who plan sprints and report dates
upward. Separate rounded panels float on a cool grey ground, controls are raised or inset like
physical objects, charts are drawn with thin lines and hatching, and type is large for the one
sentence that matters and small for everything else.

| Dial | Setting | Meaning here |
|---|---|---|
| Energy | 1 of 5 | No colour fields or hero art. Colour is reserved for state. |
| Rhythm | 2 of 5 | Dense, even rows inside a few large panels. Cards appear only on the board. |
| Motion | 1 of 5 | Movement only where it explains a change of place: panels, toasts, a pressed button. |

**Product read.** Tracker surface at standard density. Almost every mutation is reversible (move,
reassign, re-date), so they apply instantly with optimistic updates. Delete is the one destructive
action and always passes through an alert dialog.

## Layout

* **Rail.** A 64 px white rail on the left: search, inbox (with an unread dot), projects, then the
  theme toggle, sign out and the account at the bottom. Round buttons; the active one is Harbor.
* **Toolbar.** Project switcher as the page title, then Ask (soft pill) and New task (Harbor pill).
* **Headline.** One dark card carries the active sprint's name, a thin progress bar with a tick for
  today, and one sentence: *"21 of 45 points done. At this pace the sprint ends 17 Nov, 5 days late."*
  The date comes from the Monte Carlo forecast (p50). Three facts sit at its right edge.
* **View bar.** A pill tab group (List, Board, Timeline, Sprints, Insights) and the filters.
* **Working panel.** The view itself sits in one white panel with 28 px corners.
* **Side panels.** The task panel and the assistant float over the right edge as white sheets.
* **List first.** Grouped by status in workflow order, most urgent first. Finished work folds behind
  "Show N finished".
* Full-height layouts use `100dvh`.

## Colour

Four colours, each with one job. Everything else is ink on white.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` (Harbor) | `#2c6a86` | `#7fb4d0` | Primary action, selection, progress, the critical path |
| `--review` (Sage) | `#4f8a68` | `#86c09d` | In review, done |
| `--caution` (Apricot) | `#b86f33` | `#e3a36b` | In progress, urgent priority, medium risks |
| `--risk` (Coral) | `#c8513f` | `#ef7b68` | Late dates, over capacity, date conflicts. Nothing else |
| `--canvas-bg` | `#e6ebf0` | `#0d1318` | Ground under the panels |
| `--card` | `#ffffff` | `#19222a` | Panels |
| `--well` | `#f1f4f7` | `#212c35` | Inset fields, selected rows |
| `--ink` | `#141b24` | `#e8edf2` | Text, with soft and faint variants as alpha |

Why Harbor: a muted sea blue reads as calm and trustworthy without the saturated "app blue", and it
leaves coral free to mean "late". Structure flags such as *Blocked* and *Critical* stay in soft ink:
they describe the plan, they are not alarms.

The primary button is a solid Harbor pill. In dark mode Harbor is pale, so text on it is dark. Secondary text clears 4.5:1 in both themes (checked by `e2e/contrast.js`).

The dark theme is a separate palette with the same roles on a deep slate ground. It follows the OS
setting and can be switched from the rail (stored in `localStorage` as `kairos.theme`).

## Type

* **Onest** (variable) for everything. One family, weights 400 to 500; hierarchy comes from size and
  colour rather than heavy weights.
* Sizes: 11.5 / 12.5 / 13 / 13.5 / 15 (panel titles) / 21 (task title) / 28 (headline) / 44 (sign-in).
* Proportional figures throughout: Onest's tabular figures open wide gaps, so columns align by fixed
  widths instead.
* `text-wrap: balance` on headings and `pretty` on body copy.

## Material, shape, depth

* **Raised and inset.** Buttons and icon tiles are raised (`--raise`: a hairline shadow plus a top
  highlight). Fields are inset wells (`--inset`). Nothing is a bordered box.
* **Buttons.** Soft raised pills; one Harbor pill for the action of the screen; an outlined pill for
  "more"; raised 38 px tiles for lone icons.
* **Popups.** 30 px corners, a round close tile, pill tabs with icon tiles, fields as wells with a
  round chevron tile beside them. Native selects and date inputs stay native underneath.
* **Charts.** Burndown is one 3 px line per day (solid for days that happened, faded for the
  projection) with a coral Today line. Weekly output is hatched rounded tiles with the value inside,
  the latest week solid and a low week in coral hatch. Capacity is a row of ticks, three per point.
  Part-to-whole is a segmented ring with the total in the centre.
* Radii: 28 px panels, 30 px dialogs, 14 to 18 px fields and tiles, full pills for buttons.
* Z-index scale: drawer 20, assistant 25, modal 30, command bar 35, toast 40.

## Glyphs

* The mark is a dial with a single hand, drawn in SVG at any size.
* Task state and priority use custom glyphs (`components/Icons.tsx`): an outlined circle that fills
  as work progresses, and three ascending bars for priority with a filled square for urgent. They
  read at 12 px and need no colour to be told apart.
* Interface icons come from Lucide at a light stroke to match the hairlines.
* No emoji anywhere in the interface.

## Motion

* Easing: `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for things entering; `--ease-drawer`
  `cubic-bezier(0.32, 0.72, 0, 1)` for side panels.
* Durations: 120 to 150 ms for hover and colour, 180 to 200 ms for dialogs, 220 ms for toasts, 260 ms
  for side panels.
* The command bar opens instantly. People open it many times a day; animating it would only slow them.
* Buttons scale to 0.97 on press. Hover styles are gated behind `(hover: hover) and (pointer: fine)`.
* `prefers-reduced-motion` removes every transition and animation.

## Copy

* Plain statements with real numbers: "23% chance of finishing by 12 November", "Dor Levi is at 181%
  of capacity". The interface never praises itself.
* Buttons are verbs: Sign in, New task, Plan my day, Split into subtasks, Comment.
* Empty states say what is true and what to do next.
* AI features are named by what they do (Ask, Fill in, Suggest, Plan my day). There is no sparkle
  icon or "AI" badge; the assistant's work is shown as a receipt of the changes it made.
* No em dashes in interface copy.

## Accessibility

* Every icon button has an accessible name; decorative icons are `aria-hidden`.
* Cards and rows are keyboard-operable (Enter/Space), with a visible accent focus ring.
* View tabs expose `role="tab"`; rail links expose `aria-current`.
* Delete uses `role="alertdialog"`; Escape closes the topmost layer only.
* Colour is never the only signal: state has a glyph and a word, late dates sit next to the date itself.

## Checklist before shipping a screen

1. Does every colour on it mean something (Harbor, Sage, Apricot, Coral)?
2. Is coral used only for something late or over capacity?
3. Is there a loading, empty and error state?
4. Does it work from the keyboard alone, in both themes, with reduced motion?
5. Is every sentence specific to this product and its data?
