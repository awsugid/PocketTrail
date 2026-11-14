---
name: PocketTrail
description: Shadcn-inspired organizer workspace, server-rendered with SvelteKit
colors:
  bg: "#fafafa"
  surface: "#fff"
  surface-2: "#f4f4f5"
  text: "#18181b"
  text-secondary: "#62626b"
  border: "#e4e4e7"
  border-strong: "#a1a1aa"
  control-edge: "#8f8f94"
  link: "#27272a"
  link-hover: "#9a4614"
  accent: "#b45309"
  focus: "#a15120"
  primary: "#27272a"
  primary-hover: "#3f3f46"
  primary-active: "#18181b"
  row-hover: "#fcfcfc"
  danger: "#b42318"
  danger-bg: "#fff1f0"
  success: "#176343"
  success-bg: "#edf8f1"
  warning-text: "#854d0e"
  warning-bg: "#fff8e8"
  attention-text: "#9a4614"
  attention-bg: "#fff2e8"
  info-text: "#315c78"
  info-bg: "#eff6fa"
  neutral-bg: "#f0f0f2"
  nav-bg: "#27272a"
  nav-hover: "#333338"
  nav-line: "#45454c"
  nav-text: "#e9e9ec"
  nav-muted: "#bdbdc5"
  selection: "#f3d9bf"
  nav-accent: "#f0b36b"
  placeholder: "#71717a"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  small:
    fontSize: "13px"
    lineHeight: 1.5
  caption:
    fontSize: "12px"
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
elevation:
  shadow-menu: "0 8px 24px -6px rgb(24 24 27 / 0.22), 0 2px 6px rgb(24 24 27 / 0.08)"
layout:
  topbar-h: "56px"
rounded:
  panel: "12px"
  control: "6px"
  badge: "5px"
  chip: "16px"
spacing:
  field-gap: "14px"
  panel: "20px"
  section: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px"
---

# PocketTrail Design System

## Overview

**Creative North Star: "A clear organizer workspace"**

Shadcn-inspired visual language, not React or a component-library migration.
Light zinc/white work areas, charcoal navigation and primary actions, restrained
warm community accent. The former Cloudscape-inspired navy/orange treatment is
superseded. Mode: **Operate**; real financial records and next actions lead.

**Key Characteristics:**
- Strong page hierarchy and quiet, precise table typography.
- Bounded, linear forms rather than wide multi-column input grids.
- Flat surfaces; floating menus carry depth.
- Functional feedback, never invented metrics or decorative dashboards.

## Colors

Frontmatter records shipped CSS token values. Primary charcoal carries actions;
warm accent carries focus, selection and small navigation details. Links remain
charcoal, with warm hover emphasis. Zinc hairlines separate white work surfaces.

Shell colors are the `nav-*` tokens (charcoal); `--topbar-h` and `--shadow-menu`
are the shared layout and elevation tokens. `--muted` aliases secondary text.

Two zinc tones, two jobs. `border` and `border-strong` are separators and
decoration. `control-edge` (`#8f8f94`, 3.2:1 on `surface`, 3.1:1 on `bg`) is the
boundary of every input, select trigger, date trigger, chip, button and
checkbox, so a control is visible without relying on hue. Focus on the dark
sidebar uses `nav-accent` (`#f0b36b`, 8:1) because the default focus color is
too dim there. Status pairs remain semantic: green approved,
amber pending, warm orange needs details, red error, blue informational, zinc
suppressed/neutral. Suppression never visually implies approval.

**The State Rule.** Color supports visible status text; it never replaces it.

## Typography

System fonts only; no external font requests or licensed Amazon Ember assets.
Monospace is reserved for opaque bank references and history detail, not branding.
Body text uses the frontmatter scale; page headings reduce to 22px on narrow
phones (the only off-ramp step). Labels and table text are compact, with supporting metadata smaller and
muted. Amounts and fact values use tabular numerals. Explanatory text is bounded
at 76ch (`.prose-block`, hints); financial tables may use the full work area.

## Layout

The shell is full-bleed: a white sticky 56px topbar spans the viewport and a
charcoal 208px sidebar sits under it, with no outer gutter or max-width wrapper.
Only the work area is bounded (1360px, 24px vertical / 32px horizontal inset),
so financial tables still use the width. Account pages (organizations, platform)
use the same topbar without a sidebar. At 1100px the sidebar contracts to a 64px
icon rail (labels stay in the accessibility tree and as tooltips). At 800px it
becomes an overlay drawer over a scrim, opened by the topbar Menu button: focus
moves to its first link, Escape, the scrim and any link close it, and focus
returns to the button. The organization switcher stays visible in the topbar.
At 480px the main inset reduces, forms stay linear and split-purpose rows stack.
Target minimum viewport: 320px.

Every form, inline ones included, is bounded at 640px, and a panel that holds
only a form is as wide as that form. Fields sit in at most two columns, grouped
on purpose (one column at 480px and below); a field that needs the width takes
`field--wide`. Toolbars may align compact filters horizontally, wrapping when
needed. Settings open on a status list (one linked row per section, with live
counts and flags) and each section is its own page with an icon tab row that
includes Overview as its first tab. The row scrolls on narrow screens, fades its
clipped edges, and keeps the current tab revealed after a resize. Tables use
`table.ledger`; at 640px every table is `stack`ed into labelled rows
(`data-label`, with explicit `role` restored by the `stack` action) so no
column or action hides behind a silent scroll. Avoid page-level horizontal
scrolling.

A synthetic demo organization shows one compact "Synthetic data" chip in the
topbar (icon only on phones); PRODUCT.md requires fixtures to stay distinguishable
from real records.

## Elevation & Depth

Panels have crisp hairline borders, without ambient card shadows. Menus use the
shared soft, offset shadow recorded in the sidecar. Inputs have a subtle small
shadow. Selected sidebar links use a faint inset line, not a bright accent rail.

## Shapes

Panels have softly rounded corners; controls are tighter, and status badges are
small rounded rectangles, not oversized pills. Avatars remain circular. Icons
are small authored inline SVG with consistent stroke treatment, never emoji.

## Components

- **Navigation:** sidebar links pair an SVG icon with a label and mark the
  current page with `aria-current="page"` (filled row plus warm icon). Organization
  switching and the account menu live in the topbar as native `<details>`
  disclosures that close on Escape (focus returns to the trigger), on an outside
  press, when focus leaves, and after a choice. The current organization is always visible, also on
  phones. A skip link precedes the topbar and every page has one `<main id="main">`.
  Notification disablement is separate from transaction status.
- **Chips:** a filter that changes the list is a row of links (`.chip`), one
  per value, with `aria-current="true"` on the active one. No select plus Apply.
- **Buttons:** charcoal primary, white bordered secondary, red-text destructive.
  Hover, active, disabled and visible focus states are defined. Small row actions
  expand to touch-sized controls on narrow phones.
- **Forms:** visible labels, required markers and contextual hints. White fields,
  zinc borders and warm focus outlines. Read-only/disabled fields use a muted
  surface; invalid fields use an error border. Preserve native validation,
  names, permissions, CSRF and submission semantics when enhancing controls.
- **Controls:** `Select`, `Combobox`, `DatePicker` and `Checkbox` live in
  `src/lib/components/ui/` and wrap the headless `bits-ui` primitives (keyboard,
  ARIA, focus and typeahead come from there); styling is ours, from the tokens in
  `src/app.css` (`.ui-*`, `.input`, `.btn`). No Tailwind, no shadcn CLI. Triggers
  look like inputs (`control-edge` border, chevron or calendar icon); popovers use
  `shadow-menu`, mark the selected item with a check, and stay inside the
  viewport at 375px. Each renders a hidden input under the same `name`, so forms
  post exactly what they did natively, and CSRF and server validation are
  unchanged. `Combobox` is a text input with suggestions: a picked option or a
  typed new value is submitted as typed (the routing label picker offers the
  pocket's imported, still-unmapped labels, and is a plain input when there are
  none). `DatePicker` shows one human format ("1 Jan 2025", `fmtDate`) and submits
  ISO `YYYY-MM-DD`. Every control keeps a `<label for>` on its trigger or input.
  Native `<input type=file|time|number>` and `<textarea>` stay native.
  Destructive actions (revoke access, revoke invitation, delete mapping, revoke
  platform admin) confirm inline, not in a dialog: see Feedback.
- **Tables:** sentence-case muted headers, generous rows, subtle hover, aligned
  tabular amounts and secondary metadata within cells. Captions identify tables.
- **Feedback:** status/alert regions (`Notice`), extraction and allocation live
  updates, explicit empty-state actions. Forms are ordinary POST submissions that
  still work without JavaScript. Every form carries `use:submit` (form actions) or
  `use:guard` (plain endpoints) from `src/lib/forms.ts`: the form is `aria-busy`
  and its submitter pulses while pending, a second submit is ignored, and a
  redirect is followed in place. One rule covers both: a rejection (including a
  `guard` fetch that returns non-2xx) renders in a focused, scrolled-into-view
  alert placed above the actions, marks the named field `aria-invalid` and keeps
  what was typed; the error screen is only for 5xx. Every form, the sign-out and
  sign-in forms included, carries one of the two.
  **Inline confirm.** A destructive button turns, in place, into a short
  consequence sentence ("Revoke Bob? Access and notifications end now.") with
  Revoke and Cancel. Focus moves to the confirming button; Escape or Cancel
  restores the original button and its focus; a prompt left alone reverts after
  about five seconds, but never while focus is inside it. No modal, no dialog.
  Without JavaScript the form posts directly, as the server stays the authority.
  A form with typed-in values can warn before the page is left (`unsavedGuard`,
  memory only; financial drafts are never stored). Domain rejections and audit codes are translated
  to organizer wording on the server (`userMessage`, `actionLabel`); internal
  state names such as Draft/Submitted never render.
- **Motion:** menus enter over 160ms with a short upward offset and slight scale;
  disclosure carets rotate, button states transition over 120ms, request feedback
  pulses while busy. No staged page entrances. Reduced-motion preference removes
  CSS animations and transitions; feedback remains visible without motion.

Accessibility features are implementation choices, not a claim of certification.
Verify keyboard navigation, custom widget semantics, contrast and local overflow
against rendered pages after changes.

## Copy and icons

Operate pages communicate through icons, buttons and real data, not prose. A page
is an icon plus its name; there is no subtitle under a heading that restates what
the heading says, and no paragraph describing what a form does. Text stays only
where it prevents a mistake (a consequence sentence in a confirmation, a format
for an opaque field, a blocked-state reason) or names a status. Controls that
carry only an icon keep an accessible name through `aria-label` or visually
hidden text; icon-only is used for repeated row actions, never for the primary
action. Empty states are one icon, one short title and, when there is a next step,
one button. Counts and flags replace descriptions: "2 mappings", "1 without owner".

Icons are the authored set in `Icon.svelte` (24px grid, 1.6 stroke, round caps),
drawn at 14, 16 or 18px beside text and 22px beside a page title.

## Do's and Don'ts

### Do:
- Do preserve server-side permission checks, form semantics and financial facts.
- Do keep organization context visible and forms bounded on phones.
- Do use visible labels, focus indicators and text alongside status colors.
- Do preserve meaningful loading feedback with reduced motion enabled.
- Do let an icon, a count or a badge say what a paragraph would.

### Don't:
- Don't restore Cloudscape styling or require React for this visual language.
- Don't add external paid services, fonts, fabricated records or metrics.
- Don't nest cards or stretch ordinary forms across the workspace.
- Don't confuse notification suppression with completed evidence or approval.
- Don't add a subtitle, lede or hint that only restates a heading or a label.
