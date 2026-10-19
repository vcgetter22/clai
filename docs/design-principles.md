# clai design principles

The minimum rules for anything a user sees: landing page, dashboard, CLI output, docs, social cards. They exist so clai does not look like the hundreds of AI SaaS pages generated this year, and so the product's core promise (honest numbers) is visible in its form.

## The idea
clai is an instrument, not a brochure. Its world is ledgers, meters, invoices and terminal output. Design it the way a good bank statement or a good multimeter is designed: dense with real figures, calm, unambiguous, nothing decorative.

## Ten rules

1. **The hero is a number.** Every marketing surface opens with a real figure rendered by the real component: "Your Max 5x plan delivered $3,865 of API-priced work in August. 38.6x." No slogans above it, no abstract illustration. Illustration of AI (brains, sparkles, robots, neural nets, glowing orbs) is banned.
2. **One accent, spent sparingly.** Ledger green `#1E7A62` (dark theme `#4FBE9C`) on a cool paper ground `#F6F7F4` (dark `#101513`) with ink `#171D1A` (dark `#E6EBE7`), muted `#5C665F` (dark `#98A39C`), rules `#D9DFD9` (dark `#2A3330`). Amber `#9A6D00`/`#D9A441` means warning, red `#A83A3A`/`#E06C6C` means critical; semantic colors are never the accent. No gradients, no glass, no glow, no purple-to-blue, no neon on black.
3. **Numbers are the typography.** Display: Fraunces (weight 500-600, used for the wordmark and section titles only). Body: IBM Plex Sans. Data and code: IBM Plex Mono with tabular figures. Amounts right-align, share one decimal convention ($0.0042, $12.35, $1,234, 12.3k tokens, 4.5M tokens), and always carry a unit. Do not use Inter, Space Grotesk, Geist or Söhne as the safe default.
4. **Every figure carries its basis.** Billed, computed (API-equivalent) or estimated is shown next to the number, as a small label, everywhere, including marketing. A figure without a basis is a bug.
5. **Charts obey one scale.** Labelled axes that start at zero, gridlines the same color as rules, one color per provider held constant across the product, endpoints emphasized, no smoothing that invents values, no sparklines without axes when the number matters. Chart colors come from the dataviz palette in the dashboard, not the accent.
6. **Layout is a ledger, not a card grid.** Left-aligned text at about 65 characters, sections sized by content, tables and label/value lists as first-class components, borders and shadows only to lift the one thing that needs it. Radius 4 to 6px. No card inside a card, no accent rail on cards, no centered hero stacks, no 100vh openers.
7. **Copy is specific.** Say what the thing does in the user's words: "Scan reads the logs Claude Code already keeps." Never: supercharge, unlock, seamless, AI-powered, 10x your, effortless, magic, next-gen. Numbers in copy are produced by the product, not typed by hand. Buttons say what happens: "Scan now", then "Scanned 21,175 requests".
8. **Motion explains change, once.** A bar can fill and a number can count up the first time a value appears; nothing loops, floats or pulses. Honour reduced-motion.
9. **Both themes, designed.** Light and dark are both first-class, with contrast checked; the dark theme is not an inversion. Keyboard focus is visible. Touch targets are 40px or larger.
10. **Privacy is a visible state.** Where data is collected or sent, the interface says what leaves the machine (nothing in local mode; metadata only in team mode) as plain text in the flow, not as a trust badge.

## Wordmark
"clai", lowercase, Fraunces 600, optionally preceded by a small tally glyph (four strokes and a diagonal) in the accent. No mascot, no 3D, no gradient letters.

## What "done" looks like
A page passes when a finance lead reads a number and knows where it came from, a developer trusts it enough to paste it in a Slack thread, and neither of them can tell which year it was made in.

## clai for Mac and getclai.vercel.app
Decided 2026-10-19 (docs/decisions.md, quieted the same day): the Mac app and its download site look Apple-native, with system materials and type, one green card and nothing decorative. Rules 1, 3 (figures: tabular, one decimal convention, units), 4, 5, 7, 8, 9 and 10 apply; rule 2 is replaced here by:

- **Materials, not paper.** The panel sits on the system material (Liquid Glass on macOS 26, the menu material before). Cards are platters: glass on macOS 26, a 4 to 6 percent fill with a hairline before. Corners are continuous: 18 pt for the month card and the cards, 16 for pills, capsules for buttons, tabs and chips.
- **One green card.** The month's figure sits on ledger green settling into deep green (`#1E7A62` to `#0E5444`, top to bottom), white text above 5:1, a hairline edge, no shadow or gloss. Ledger green (`#1E7A62`, dark `#4FBE9C`) stays the only accent; provider colours match the dashboard; amber and red still mean warning and critical (the budget ring turns amber on the card when the pace would exceed it). No decorative shapes anywhere: no bubbles, blobs or glow.
- **Type.** SF Pro (`-apple-system` on the web), not rounded; figures monospaced-digit. Month figure 36 pt semibold; pills 17 pt semibold; labels 10.5 to 12.5 pt medium or semibold; the site's headings weight 700.
- **Controls.** Buttons are flat capsules: the one prominent action in ledger green (deeper under the pointer and when pressed), secondary actions a quiet fill. Tabs are a segmented control whose selected tab sits on a raised white capsule (lighter grey in dark mode), as in the system control.
- **Motion only for change.** Values animate when they change (numeric transitions; bars and the budget ring ease to their new length) and pages slide when you navigate. Nothing counts up from zero on open, rises in, bounces, floats or follows the pointer. On the site, sections fade in once. Reduced motion removes all of it.
- **The menu bar figure.** The month so far by default, the same number as the panel's headline; today or the icon alone in Settings. Before the first usage the tally stands alone.
- **Say what leaves the Mac.** The panel footer says "Usage data stays on this Mac"; the only network call is the opt-out daily update check, and settings say so.
- **Sample data is labelled.** Screenshots and the site's panel image use the engine's sample snapshot and say so; marketing figures beyond that are the founder's real ones with their basis.
