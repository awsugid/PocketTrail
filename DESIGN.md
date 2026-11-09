---
name: PocketTrail
description: Shadcn-inspired organizer workspace, server-rendered with HTMX
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
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  title:
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
rounded:
  panel: "12px"
  control: "6px"
  badge: "5px"
spacing:
  field-gap: "20px"
  panel: "24px"
  section: "32px"
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
    padding: "24px"
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
Body text uses the frontmatter scale; page headings reduce to 25px on narrow
phones. Labels and table text are compact, with supporting metadata smaller and
muted. Amounts and fact values use tabular numerals. Explanatory text is bounded
at roughly 76ch; financial tables may use the full work area.

## Layout

Desktop shell uses a white sticky 64px topbar and charcoal 224px sidebar. Main
work area has 36px vertical / 40px horizontal inset and a 1440px maximum width.
At 1100px the sidebar contracts and section intro/body columns become linear.
At 800px the sidebar becomes a native disclosure menu; organization selection
moves to its own visible full-width header row. At 480px the main inset reduces,
forms stay linear and split-purpose rows stack. Target minimum viewport: 320px.

Forms and field groups are bounded at 640px. Toolbars may align compact filters
horizontally, wrapping when needed. Settings use anchor navigation, section
introductions and bounded bodies. Tables scroll within their own wrapper; do not
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

- **Navigation:** labeled sidebar links, SVG icons, visible current state and
  `aria-current`. Organization/account and mobile menus use native disclosures.
  Current organization remains visible on phones. Notification disablement is
  separate from transaction status.
- **Buttons:** charcoal primary, white bordered secondary, red-text destructive.
  Hover, active, disabled and visible focus states are defined. Small row actions
  expand to touch-sized controls on narrow phones.
- **Forms:** visible labels, required markers and contextual hints. White fields,
  zinc borders and warm focus outlines. Read-only/disabled fields use a muted
  surface; invalid fields use an error border. Preserve native validation,
  names, permissions, CSRF and submission semantics when enhancing controls.
- **Custom controls:** progressive select/date enhancements live separately in
  `static/components.css` and `static/components.js`; retain native controls as
  the source of form values and a usable fallback. Triggers match field borders,
  six-pixel corners and 40px desktop / 44px mobile height. Native top-layer
  popovers use white surfaces, eight-pixel corners and their own floating shadow.
  Selects provide keyboard navigation, typeahead, disabled options and visible
  selection. Date controls provide a seven-column calendar, month/year fields,
  typed ISO date input and constraint errors; selected days are charcoal, today
  outlined. Forced-colors mode preserves selection outlines. Enhancement initializes
  after HTMX swaps and observes added controls; labels, focus, required validation
  and original submitted values remain connected to native fields.
- **Tables:** sentence-case muted headers, generous rows, subtle hover, aligned
  tabular amounts and secondary metadata within cells. Captions identify tables.
- **Feedback:** status/alert regions, extraction and allocation live updates,
  local/synthetic banners, explicit empty-state actions. HTMX request styling
  identifies busy submissions; existing JavaScript owns lifecycle behavior.
- **Motion:** menus enter over 160ms with a short upward offset and slight scale;
  disclosure carets rotate, button states transition over 120ms, request feedback
  pulses while busy. No staged page entrances. Reduced-motion preference removes
  CSS animations and transitions; feedback remains visible without motion.

Accessibility features are implementation choices, not a claim of certification.
Verify keyboard navigation, custom widget semantics, contrast and local overflow
against rendered pages after changes.

## Do's and Don'ts

### Do:
- Do preserve server-side permission checks, form semantics and financial facts.
- Do keep organization context visible and forms bounded on phones.
- Do use visible labels, focus indicators and text alongside status colors.
- Do preserve meaningful loading feedback with reduced motion enabled.

### Don't:
- Don't restore Cloudscape styling or require React for this visual language.
- Don't add external paid services, fonts, fabricated records or metrics.
- Don't nest cards or stretch ordinary forms across the workspace.
- Don't confuse notification suppression with completed evidence or approval.
