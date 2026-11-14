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
  control-border: "#d4d4d8"
  link: "#27272a"
  link-hover: "#9a4614"
  accent: "#b45309"
  focus: "#a15120"
  primary: "#27272a"
  primary-hover: "#3f3f46"
  primary-active: "#18181b"
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
  navy-900: "#202023"
  navy-800: "#303034"
  navy-700: "#45454c"
  navy-text: "#fafafa"
  navy-muted: "#bdbdc5"
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

Legacy `navy-*` token names now describe charcoal shell colors, not blue.
`--muted` aliases secondary text. Status pairs remain semantic: green approved,
amber pending, warm orange needs details, red error, blue informational, zinc
suppressed/neutral. Suppression never visually implies approval.

**The State Rule.** Color supports visible status text; it never replaces it.

## Typography

System fonts only; no external font requests or licensed Amazon Ember assets.
Monospace is reserved for opaque bank references and history detail, not branding.
Body text uses the frontmatter scale; page headings reduce to 22px on narrow
phones (the only off-ramp step). Labels and table text are compact, with supporting metadata smaller and
muted. Amounts and fact values use tabular numerals. Explanatory text is bounded
at roughly 76ch; financial tables may use the full work area.

## Layout

The shell is full-bleed: a white sticky 56px topbar spans the viewport and a
charcoal 208px sidebar sits under it, with no outer gutter or max-width wrapper.
Only the work area is bounded (1360px, 24px vertical / 32px horizontal inset),
so financial tables still use the width. Account pages (organizations, platform)
use the same topbar without a sidebar. At 1100px the sidebar contracts to a 64px
icon rail (labels stay in the accessibility tree and as tooltips). At 800px it
becomes a drawer opened by the topbar Menu button; the organization switcher
stays visible in the topbar. At 480px the main inset reduces, forms stay linear
and split-purpose rows stack. Target minimum viewport: 320px.

Forms and field groups are bounded at 640px. Toolbars may align compact filters
horizontally, wrapping when needed. Settings open on a status list (one linked
row per section, with live counts and flags) and each section is its own page
with an icon tab row; the overview has no tab row because its rows are the
navigation. Tables scroll within their own wrapper; do not
hide financial facts to fit a phone. Avoid page-level horizontal scrolling.

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
  press and after a choice. The current organization is always visible, also on
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
- **Controls:** native `select`, `date`, `time`, `file` and `textarea` elements
  are the source of form values and the no-JavaScript fallback. Styling lives in
  `src/app.css` (`.input`, `.select`, `.btn`); no custom control library is
  vendored. Destructive actions (revoke access, revoke invitation, delete mapping,
  revoke platform admin) confirm in one native `<dialog>` (`confirmDialog` in
  `src/lib/forms.ts`) whose sentence states the consequence; Escape, Cancel and a
  backdrop press all cancel. Without JavaScript the form posts directly, as the
  server remains the authority. Every control keeps a `<label for>` association, so keyboard
  focus, required validation and screen-reader names survive enhancement.
- **Tables:** sentence-case muted headers, generous rows, subtle hover, aligned
  tabular amounts and secondary metadata within cells. Captions identify tables.
- **Feedback:** status/alert regions (`Notice`), extraction and allocation live
  updates, explicit empty-state actions. Forms are ordinary POST submissions that
  still work without JavaScript. Every form carries `use:submit` (form actions) or
  `use:guard` (plain endpoints) from `src/lib/forms.ts`: the form is `aria-busy`
  and its submitter pulses while pending, a second submit is ignored, a rejection
  renders inline in an alert and keeps what was typed, and a redirect is followed
  in place. Domain rejections and audit codes are translated
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
