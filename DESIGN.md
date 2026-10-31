# Kairos design system

Kairos is a planning instrument. People open it to answer one question: *when will this land?* The
interface is built like a precise drafting tool for that question: paper-toned ground, hairline
rules, tabular figures, one ink colour for decisions, and red only where something is late or at risk.

## Read

**Design read.** A work tool for engineering and product teams who plan sprints and report dates
upward. Quiet instrument-panel language: bone paper ground, hairlines instead of boxes, monospaced
figures that line up in columns.

| Dial | Setting | Meaning here |
|---|---|---|
| Energy | 1 of 5 | No hero gradients, no colour fields. Colour is reserved for state. |
| Rhythm | 2 of 5 | Dense, even rows. Sections are separated by rules and headings, never by floating cards. |
| Motion | 1 of 5 | Movement only where it explains a change of place: drawers, toasts, a pressed button. |

**Product read.** Tracker surface at standard density. Almost every mutation is reversible (move,
reassign, re-date), so they apply instantly with optimistic updates. Delete is the one destructive
action and always passes through an alert dialog.

## Colour

One accent, three signals, everything else is graphite on bone.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#efefea` | `#141615` | App ground (sidebar, login) |
| `--surface` | `#fbfbf8` | `#191b1a` | Working area |
| `--raised` | `#ffffff` | `#1f2220` | Cards, drawer, inputs |
| `--sunken` | `#e7e7e0` | `#262a27` | Wells, segmented controls |
| `--ink` | `#1a1c1b` | `#e9eae4` | Text and strong rules |
| `--ink-soft` | `#535851` | `#a9ada4` | Secondary text |
| `--ink-faint` | `#82877f` | `#7c8178` | Keys, captions, axis labels |
| `--line` | `#dcddd5` | `#2c302d` | Hairlines |
| `--accent` | `#1f4d3a` | `#7fb69a` | Primary action, selection, progress |
| `--risk` | `#a5361f` | `#e0816b` | Overdue, blocked, critical path, over capacity |
| `--caution` | `#9a6412` | `#d6a659` | Medium-severity risks, in-progress state |
| `--done` | `#2f6b4f` | `#7fb69a` | Completed state |

Why forest green: delivery tools default to blue and purple. A deep green reads as ink on paper,
holds contrast on the bone ground, and keeps red free to mean "late".

People, labels and projects take their colour from a small earth palette (slate, moss, ochre, clay,
plum, teal, stone) so a row of avatars or labels never turns into confetti. Avatars show initials on
a 20% tint of that colour.

The dark theme is a separate palette with the same roles, tuned for contrast on a warm near-black.
It follows the OS setting and can be switched from the account menu (stored in `localStorage`).

## Type

* **IBM Plex Sans** (variable) for interface text; **IBM Plex Mono** for task keys, dates, points and
  every number that sits in a column.
* Why Plex: it was drawn for engineering documentation, so it carries the precision this product is
  about, and its mono companion has true tabular figures. Dates and point totals align without
  extra work, which matters on a tool where most of the content is numbers.
* Sizes: 12 / 13 / 14 / 19 (statement) / 22 (page title) / 44 (sign-in headline). Weights 400, 550, 600.
* `font-variant-numeric: tabular-nums` on every figure; `text-wrap: balance` on headings and
  `pretty` on body copy.

## Space, shape, depth

* 4 px scale: `--s1` 4 through `--s12` 48.
* Radius 6 px for controls and cards, 4 px for tags and swatches. Nothing is fully rounded except
  avatars and status dots.
* Three elevations: `--e1` (a 1 px under-rule on cards), `--e2` (popovers, toasts), `--e3` (drawer,
  dialogs, command bar). No glow, no glass, no gradients.
* Z-index scale: drawer 20, assistant 25, modal 30, command bar 35, toast 40.

## Glyphs

* The mark is a dial with a single hand: a planning instrument, drawn in SVG at any size.
* Task state and priority use custom glyphs (`components/Icons.tsx`): an outlined circle that fills
  as work progresses, and three ascending bars for priority with a filled square for urgent. They
  read at 12 px and need no colour to be told apart.
* Interface icons come from Lucide at a 1.75 stroke, which matches the 1 px hairline system. Product
  concepts (state, priority, the mark) are drawn here.
* No emoji anywhere in the interface.

## Motion

* Easing: `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` for things entering; `--ease-drawer`
  `cubic-bezier(0.32, 0.72, 0, 1)` for the task drawer.
* Durations: 120 to 150 ms for hover and colour, 180 to 200 ms for dialogs and their scrim, 220 ms for
  toasts, 260 ms for the drawer and assistant panel.
* The command bar opens instantly. People open it many times a day; animating it would only slow them.
* Buttons scale to 0.97 on press. Hover styles are gated behind `(hover: hover) and (pointer: fine)`
  so touch devices do not get stuck hover states.
* `prefers-reduced-motion` removes every transition and animation.

## Layout patterns

* **Rows for tracker data.** Lists, risks, activity, capacity and the inbox are ruled rows. Cards
  appear only on the board, where they are the object being dragged.
* **Statement first.** Insights opens with one sentence that states the forecast, then a single
  ledger line with the supporting figures, then the evidence. There is no row of metric cards.
* **The active item has a needle.** A 2 px accent bar marks the current page in the sidebar and the
  current tab in a view. It marks real state; it is never used as decoration.
* Full-height layouts use `100dvh`.

## Copy

* Plain statements with real numbers: "23% chance of finishing by 12 November", "Dor Levi is at 181%
  of capacity". The interface never praises itself.
* Buttons are verbs: Sign in, New task, Plan my day, Split into subtasks, Comment.
* Empty states say what is true and what to do next: "Nothing started. Pick the first task from Up next."
* AI features are named by what they do (Ask, Fill in, Suggest, Plan my day). There is no sparkle
  icon or "AI" badge; the assistant's work is shown as a receipt of the changes it made.
* No em dashes in interface copy.

## Accessibility

* Every icon button has an accessible name; decorative icons are `aria-hidden`.
* Cards and rows are keyboard-operable (Enter/Space), with a visible 2 px accent focus ring.
* Sortable list headers expose `aria-sort`; tabs and sidebar links expose `aria-current`.
* Delete uses `role="alertdialog"`; Escape closes the topmost layer only.
* Colour is never the only signal: blocked, critical and overdue items also carry an icon and a word.

## Checklist before shipping a screen

1. Does every colour on it mean something (accent, risk, caution, done)?
2. Do numbers line up in columns?
3. Is there a loading, empty and error state?
4. Does it work from the keyboard alone, in both themes, with reduced motion?
5. Is every sentence specific to this product and its data?
