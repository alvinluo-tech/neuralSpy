# NeuralSpy Design System (Linear-Inspired, Business-Fitted)

## 1. Visual Theme & Atmosphere

NeuralSpy uses a dark, precision-first visual language inspired by Linear, but tailored for a fast multiplayer party game loop. The UI must keep players focused through five short stages: Entry -> Lobby -> Play -> Vote -> Result.

Core tone:
- Background-first dark canvas: `#08090a`
- Information appears by luminance steps, not heavy color blocks
- Indigo-violet accent communicates game progression and call-to-action
- High-contrast status messages for time-sensitive game actions

Design goals for this product:
- Reduce cognitive load during high-pressure vote moments
- Keep host controls discoverable but not noisy
- Make role reveal and whiteboard interactions feel special
- Keep realtime updates visible without visual chaos

## 2. Color Palette & Roles

### Surfaces
- Page Background: `#08090a`
- Core Panel Surface: `rgba(255,255,255,0.03)`
- Elevated Surface: `rgba(255,255,255,0.05)`
- Recessed Surface: `rgba(255,255,255,0.02)`

### Text
- Primary Text: `#f7f8f8`
- Secondary Text: `#d0d6e0`
- Muted Text: `#8a8f98`
- Disabled Text: `#62666d`

### Accent and State
- Primary Action: `#5e6ad2`
- Interactive Hover: `#7170ff`
- Highlight Glow: `#828fff`
- Success: `#27a644`
- Error: `#ff6a6a`
- Warning/Host Attention: `#ffd675`

### Borders & Dividers
- Primary Border: `rgba(255,255,255,0.08)`
- Subtle Border: `rgba(255,255,255,0.05)`
- Section Divider: `rgba(255,255,255,0.12)`

## 3. Typography Rules

### Fonts
- Primary: Inter Variable (via Next font loader)
- Mono: Geist Mono fallback chain for technical labels
- OpenType features: `"cv01", "ss03"`

### Scale
- Hero title: 32px-48px, weight 510, tight tracking
- Section title: 18px-20px, weight 590
- Body: 15px-16px, weight 400
- Label/UI emphasis: 14px-15px, weight 510
- Micro metadata: 12px-13px, weight 400-510

### Product-specific usage
- Countdown numbers: strong, compact, always center-aligned
- Player tags: small but high-contrast and role-distinct
- Host controls: dense layout with clear hierarchy through weight and spacing

## 4. Component Stylings

### 4.1 Entry (Home)
Used in `src/app/page.tsx`.

- Hero card introduces realtime room mode with concise value proposition
- Flow tracker (`home-flow-*`) indicates current step and next action
- Create vs Join cards use visual priority:
  - Create path as primary panel
  - Join path as secondary/drawer path
- Invite code cells are large, monospaced-feel, and high-contrast

### 4.2 Lobby
Used in `src/components/RoomGame.tsx` when status is `lobby`.

- Lobby steps (`lobby-steps`) show readiness progression
- Room config editor grouped under subtle separators
- Category search dropdown styled as dark command list (not white browser-default)
- Host save actions show transient states: idle/saving/saved

### 4.3 Play State
Used in `RoomGame` when status is `playing`.

- Word card is the emotional center
- Whiteboard card uses restrained animation and luminous hint text
- Player list keeps seat order, self badge, host badge, and alive/out states readable
- Game progress card gives round + alive ratio at a glance

### 4.4 Vote State
Used in `RoomGame` when status is `voting`.

- Circular countdown ring is the visual anchor
- Urgent state color shifts to red for low remaining time
- Vote selection and vote record stay secondary to timer and action button
- Tie/force-publish interactions remain explicit, never hidden

### 4.5 Result State
Used in result page flow and final room summary.

- Winning side should be immediately identifiable
- Elimination history and final role mapping remain readable in dense states
- Success/error/info notices use distinct tinted dark surfaces

### 4.6 Feedback Layers
- Toast stack (`notice-toast-stack`) top-right desktop, full-width inset mobile
- Overlay dialogs (`global-overlay-*`) use deep dim backdrop for focus
- Drawer (`join-drawer`, `whiteboard-drawer`) uses elevated surface and clear drag-handle affordance on mobile

## 5. Layout Principles

### Container
- Main content width: `min(1120px, 100%)`
- Panel rhythm: 16-22px vertical gaps
- Card radius:
  - Functional: 8-10px
  - Panel: 14-22px
  - Pills: 9999px

### Information hierarchy by screen
1. Home: mode selection first, form second
2. Lobby: room status + host configuration first
3. Play: self word + alive players first
4. Vote: timer + vote action first
5. Result: winner + summary first

### Realtime resilience
- Sync hints should be visible but low-noise
- Presence events (join/leave/kick) must not overpower gameplay panel

## 6. Motion Principles

- Keep motion purposeful and sparse
- Key animations:
  - Card enter (short fade/translate)
  - Countdown ring stroke progression
  - Whiteboard hint soft pulse (limited cycles)
- Respect reduced motion media query for attention effects

## 7. Do / Don't

### Do
- Use dark luminance layering for depth
- Reserve indigo accent for actionable/active states
- Keep host actions grouped and explicit
- Keep voting and countdown typography highly legible
- Use semantic lists for step indicators where possible

### Don't
- Do not use bright white panel backgrounds
- Do not mix many accent hues in core game flow
- Do not hide critical host actions behind subtle text links
- Do not animate every component simultaneously
- Do not allow dropdown menus to fall back to mismatched light theme

## 8. Responsive Behavior

### Breakpoints
- Mobile: `< 860px`
- Desktop: `>= 860px`

### Mobile adaptation rules
- Single-column panel stack
- Step arrows can collapse for readability
- Drawers dock to bottom with larger touch targets
- Toast stack stretches to safe viewport width

### Touch targets
- Primary actions >= 44px touch height
- Invite code inputs remain easy to focus and navigate

## 9. Agent Prompt Guide (Project-Specific)

When generating UI for NeuralSpy, use this prompt skeleton:

1. Context:
- "This is a realtime multiplayer social deduction game."
- "The current screen is one of: Entry / Lobby / Play / Vote / Result."

2. Visual constraints:
- "Dark-first surface model using `#08090a` background."
- "Accent only with `#5e6ad2`, `#7170ff`, `#828fff`."
- "Semi-transparent white borders (`rgba(255,255,255,0.05-0.08)`)."

3. Usability constraints:
- "Countdown and primary actions must remain visually dominant in vote state."
- "Host controls must be grouped and explicit in lobby/play states."
- "Realtime toasts should be readable but not block main interactions."

4. Output requirement:
- "Provide desktop + mobile behavior and state-specific variants."
- "Preserve existing business semantics and labels in Chinese."

## 10. Implementation Mapping

Current implementation touchpoints:
- Global tokens and component skinning: `src/app/globals.css`
- Home entry flow and category picker: `src/app/page.tsx`
- Room lifecycle UI (lobby/play/vote/result): `src/components/RoomGame.tsx`
- Font baseline and global shell: `src/app/layout.tsx`

This file is the product-specific style source of truth for future iterations.

## 11. Design Tokens & Component Encapsulation (V2)

This round formalizes a lightweight token layer and component primitives:

### Token groups
- Spacing: `--ds-space-1` to `--ds-space-8`
- Radius: `--ds-radius-sm` to `--ds-radius-xl`
- Motion: `--ds-motion-fast`, `--ds-motion-base`, `--ds-motion-slow`
- Easing: `--ds-ease-standard`, `--ds-ease-emphasis`

### Component layer
- Button primitive classes:
  - `.ui-btn`
  - `.ui-btn--primary|secondary|outline|ghost|danger`
  - `.ui-btn--sm|md|lg|icon`
- Dialog primitive classes:
  - `.ui-dialog-overlay`
  - `.ui-dialog-content`
  - `.ui-dialog-header|title|description|footer`

### Motion policy
- Entry surfaces use subtle `surface-in`
- Dropdown uses `dropdown-in`
- Dialog uses `fade-in` + `dialog-in`
- Toast uses `toast-in`
- `prefers-reduced-motion` disables all non-essential motion

### Scope
Applies directly to:
- Home entry flow page
- Room lifecycle page (lobby/play/vote/result)
- Shared confirmation dialog and button primitives
