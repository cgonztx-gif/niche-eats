# UI Design Outline

Proposed overhaul of the dashboard and manage views. Nothing here is implemented yet — this is the spec to approve or amend first.

**Direction:** near-black surfaces, white text, green for open and red for closed, one professional typeface. Denser and more confident than the current slate-blue treatment.

---

## 1. Color

Currently everything is Tailwind `slate` (a blue-tinted gray). Moving to true neutrals makes the green/red read as the only color on screen, which is the point.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `bg-base` | `#0a0a0a` | Page background |
| `bg-raised` | `#141414` | Cards, textarea, notice bars |
| `bg-hover` | `#1c1c1c` | Pressed/hover card state |
| `border` | `#262626` | Card and input borders |
| `border-strong` | `#3d3d3d` | Focus rings, button outlines |

Not pure `#000`: on OLED phones pure black against pure white causes halation (text smearing during scroll) and makes card edges invisible. `#0a0a0a` reads as black while keeping the surface hierarchy visible.

### Text

| Token | Value | Use |
|---|---|---|
| `text-primary` | `#fafafa` | Spot names, headings |
| `text-secondary` | `#a3a3a3` | Category, distance, helper copy |
| `text-muted` | `#6b6b6b` | Footer, counts, placeholders |

Off-white rather than `#ffffff` for the same halation reason. Still ~19:1 contrast on `bg-base` — far above the WCAG AA 4.5:1 floor.

### Status

| Token | Value | Use |
|---|---|---|
| `open` | `#22c55e` | "Open now" header, status dot |
| `open-dim` | `#16341f` | Open section hairline/tint |
| `closed` | `#ef4444` | "Closed" header, status dot |
| `closed-dim` | `#3a1a1a` | Closed section hairline/tint |
| `error` | `#ef4444` | Load failures (shares the closed red) |

Both status colors clear 4.5:1 on `#0a0a0a`.

---

## 2. Typography

**Recommendation: Inter**, loaded from Google Fonts with `display=swap`, falling back to the system UI stack.

Inter is the default "professional product UI" face — designed for screens, tall x-height, unambiguous `1/l/I`, and excellent at the small sizes the distance/category line uses. It's what Linear, Vercel, and GitHub-adjacent tooling look like.

```
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

**Tradeoff to accept or reject:** this adds one cross-origin request to a page whose selling point is instant launch. Mitigations: `preconnect`, `display=swap` (text renders immediately in the fallback), and adding `fonts.googleapis.com` / `fonts.gstatic.com` to the service worker cache so it's local from the second launch on. **Alternative:** drop Inter and use the system stack alone — zero requests, looks native per-platform, but inconsistent between your iPhone and a friend's Android.

### Scale

| Role | Size / weight | Notes |
|---|---|---|
| App title | 24px / 600, `-0.02em` | "Niche Eats" |
| Subtitle | 13px / 400 | "3 open now · nearest first" |
| Section header | 11px / 600, `0.1em`, uppercase | "OPEN NOW" / "CLOSED" |
| Spot name | 16px / 500 | Primary scan target |
| Meta line | 13px / 400 | Category · distance |
| Button | 14px / 500 | |

Tabular figures (`font-variant-numeric: tabular-nums`) on distances so "0.4 mi" and "11.2 mi" align down the column.

---

## 3. Layout

- Max width `560px`, centered — narrower than today's `672px`, which stretches cards uncomfortably wide on desktop.
- Page padding `16px`, respecting existing safe-area insets.
- Card vertical rhythm: `8px` between cards, `32px` between sections.
- Sticky header on scroll, so the title and Refresh stay reachable in a long list.

---

## 4. Components

### Spot card

```
┌──────────────────────────────────────────┐
│  Franklin Barbecue                    →  │
│  Barbecue Restaurant · 0.7 mi away       │
└──────────────────────────────────────────┘
```

- `bg-raised`, `1px` border, `12px` radius, `14px` padding.
- Name in `text-primary`; meta line in `text-secondary` with a `·` divider.
- Whole card is the tap target (already is) — min height `64px` for comfortable thumbs.
- Press state: `bg-hover` + `scale(0.99)`.
- Chevron in `text-muted`, right-aligned.

### Section headers

- Uppercase, letterspaced, with a count: `OPEN NOW (3)`.
- Colored **dot** (`6px`, status color) preceding the label, plus the colored label text.
- Thin `1px` divider beneath in the dim status color.

### Open vs closed weighting

The brief wants Open Now primary and Closed de-emphasized; a full red treatment would fight that by making closed items *louder*. Proposal:

- **Open:** full-strength cards, green header, green dot.
- **Closed:** red header and red dot, but cards stay at `70%` opacity with `text-secondary` names.

Red marks the section; de-emphasis keeps the eye on what's actually open. If you'd rather closed cards be equally prominent, that's a one-line change.

### Buttons

- **Refresh** (secondary): transparent, `1px` `border-strong`, pill, `text-secondary` → white on press.
- **Add spots** (primary, manage view): solid green `#22c55e` with near-black text.
- Focus-visible ring in `border-strong` for keyboard users.

---

## 5. States

| State | Treatment |
|---|---|
| Loading | Three skeleton cards pulsing at `bg-raised` — replaces today's bare "Loading…" |
| Empty list | Centered, muted: "No spots yet" + link to Manage |
| Nothing open | Card-shaped muted panel above the Closed section |
| Location off | Neutral `bg-raised` bar + "Use my location" button (**not** amber — it isn't a warning) |
| Location blocked | Same bar, settings guidance, no button |
| Load error | Red-bordered bar, message, Refresh stays enabled |

Notices move from amber to neutral. Missing location is a normal state, and amber implies something broke.

---

## 6. Manage view

Inherits every token above.

- Result rows keep their semantic colors: green border for resolved, neutral for ambiguous/not-found, red for errors.
- Ambiguous candidate buttons get the `bg-hover` press state.
- Textarea: `bg-raised`, `border`, green focus ring.

---

## 7. Footer

Change: drop "One shared list ·" — the footer becomes just **Manage spots**, centered, `text-muted`, underline on hover.

---

## 8. Accessibility

Two things to get right, since green/red is load-bearing here:

1. **Green and red are the most common color-blind confusion pair** (deuteranopia/protanopia, ~8% of men). Color must never be the only signal. Mitigations: the section headers are already *worded* "OPEN NOW" and "CLOSED", closed cards are additionally dimmed, and the status dot differs in position from any other UI element. No spot's state depends on hue alone.
2. **Contrast** — every pairing above clears WCAG AA; the muted footer at `#6b6b6b` on `#0a0a0a` sits at ~4.6:1, just over the line. If it feels too dim on a phone in daylight, lighten to `#7a7a7a`.

Also: `prefers-reduced-motion` should disable the card press scale and skeleton pulse.

---

## 9. Files touched

| File | Change |
|---|---|
| `public/index.html` | Font links, Tailwind theme config, header/footer markup |
| `public/manage.html` | Same font + theme block |
| `public/js/app.js` | Card/section/notice class strings, skeleton state |
| `public/js/manage.js` | Result row class strings |
| `public/sw.js` | Cache font origins; **bump `CACHE_VERSION`** |

No logic changes — `spots.js`, `api.js`, and both Edge Functions are untouched, so all 45 tests stay green.

---

## 10. Open questions

1. **Inter, or system stack?** Recommendation above is Inter; the system stack is the zero-request alternative.
2. **Closed cards dimmed, or full strength?** Recommendation is dimmed, to preserve the brief's Open-Now priority.
3. **Sticky header** — worth it for long lists, or keep the page simple?
