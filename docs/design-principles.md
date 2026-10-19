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
Decided 2026-10-19 (docs/decisions.md): the Mac app and its download site look Apple-native with more bubble than the ledger. Rules 1, 3 (figures: tabular, one decimal convention, units), 4, 5, 7, 9 and 10 still apply; rules 2 and 8 are replaced here by:

- **Materials, not paper.** The panel sits on the system material (Liquid Glass on macOS 26, the menu material before). Cards are platters: glass on macOS 26, a 4 to 6 percent fill with a hairline before. Corners are continuous: 24 pt for the hero, 18 for cards, 16 for pills, capsules for buttons and chips.
- **One green bubble.** The month's figure sits on a ledger-green to mint gradient (`#0E5444`, `#1E7A62`, `#22A386`, `#6FD9B8`; a mesh on macOS 15+) with a white rim highlight and a soft green shadow. White soap bubbles (radial highlight, thin rim) decorate it and nothing else. Ledger green (`#1E7A62`, dark `#4FBE9C`) stays the only accent; provider colours match the dashboard; amber and red still mean warning and critical (a budget ring turns amber on the bubble when the pace would exceed it).
- **Type.** SF Pro, rounded design for everything in the panel and the site's headings (`ui-rounded` on the web); figures monospaced-digit. Hero figure 40 pt bold; pills 17 pt bold; labels 10.5 to 12.5 pt semibold.
- **Motion with a purpose, once.** Figures roll to their value when they first appear or change; cards rise in once when the panel first shows numbers; bubbles bloom once and drift a few points with the pointer; buttons swell on hover and squish on press with springs. On the site, background bubbles drift slowly. Reduced motion removes all of it. Nothing pulses to get attention.
- **Say what leaves the Mac.** The panel footer says "Usage data stays on this Mac"; the only network call is the opt-out daily update check, and settings say so.
- **Sample data is labelled.** Screenshots and the site's panel image use the engine's sample snapshot and say so; marketing figures beyond that are the founder's real ones with their basis.
