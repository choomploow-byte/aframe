---
name: game-ui
description: Load for game interfaces and any chunky, glossy, illustrated UI: HUDs, shops, inventories, menus, buttons with bevels and 3D edges, currency pills, item slots, icon-heavy screens, and for building reusable components with hover, pressed, disabled and selected states.
---

# Game UI

Game UI is read at a glance, under motion, on top of busy art. It wants **big shapes, thick outlines, bold colour, one clear focal point per screen, and every control showing it can be pressed.** Atelier has native tools for each of these; use them instead of faking them with stacks of rectangles.

## 1. Set the system first
Tokens before nodes. A game palette is a dark ground, a lighter panel, one hot accent for actions, and a few semantic colours.
```json
set_tokens {
  "colors": { "bg": "#1B1330", "panel": "#2D2250", "slot": "#241A44", "outline": "#120B24",
              "primary": "#FFB020", "gold": "#FFC83D", "gem": "#38D6FF", "hp": "#FF4D6D", "mana": "#4D9FFF" },
  "fonts":  { "display": "Lilita One", "body": "Fredoka" },
  "radii":  { "sm": 8, "md": 14, "lg": 20, "xl": 28, "full": 999 }
}
```
- Dark outline colour (`$outline`) on every control: 3px on buttons and slots, 4px on panels. It is what makes shapes pop off art.
- **Fonts** (`list_fonts`): `Lilita One` is the default chunky face for buttons, titles and numbers; `Luckiest Guy` is louder, for banners; `Bungee` is blocky signage, uppercase only; `Fredoka` (300-700) is soft and readable for body copy. The display faces have **one weight (400)**: leave `fontWeight` alone. Asking for 700 does not fake a bold; `apply_changes` warns.
- Use `letterSpacing: 0.04` on uppercase display text. Keep numbers in the display face so they read as part of the art.

## 2. Icons, not shapes
`search_icons { "query": "treasure" }` finds names; place one in a single op: `{ "type": "icon", "icon": "chest", "w": 40, "h": 40, "color": "$gold" }` (or the `place_icon` tool). The set is one solid style so icons sit together: coins, gems, keys, shields, stars, swords, potions, chests, arrows, close, check, settings and more. A name that does not exist draws a labelled dashed placeholder (and a warning) so a gap is obvious, never a blank square. Sizes: 20-24 inline with text, 32-48 in slots, 56-96 on cards. Colour is the only styling: use a token.

## 3. Depth: patterns and presets, not drop shadows
Flat fills read as cheap. Add one of each:
- **Pattern fill** on panels and backgrounds, very faint (opacity 0.04-0.10) so it textures without competing:
  `"fill": { "pattern": "halftone", "color": "#FFFFFF", "size": 3, "spacing": 8, "opacity": 0.05, "background": "$panel" }`
  `stripes` (angle, size, spacing), `halftone` (dot size, spacing), `sunburst` (ray width and gap in degrees, behind a hero or reward), `noise` (grain on large flat areas). Patterns follow the node's radius and clip.
- **Effect presets** on buttons, pills and slots (`effects`, combinable, each `"name"` or `{ "preset", "intensity", "color" }`):
  - `bevel-raised`: a control standing proud. `bevel-pressed`: pushed in; use it for slots and the pressed state.
  - `gloss-top`: soft highlight along the top edge. `inner-glow`: a lit edge (tint with `color`; use it for the selected state).
  - `hard-3d-bottom`: a solid darker ledge under the node. The classic chunky button is `["gloss-top", "hard-3d-bottom"]` on a saturated fill with a dark outline and a pill radius.
- **The user's library** (`search_library`, then `use_library_asset`) holds richer overlays than the native patterns: halftone corners, sunbursts, sparkles, stars, flames, hexagons, studs, paper. Most are white or grey with transparency: place one over a coloured frame with `opacity` 0.1-0.4, stretched with `w`/`h`, and keep it clipped inside a rounded frame (`clip: true`). Prefer a native pattern for a plain texture; reach for the library for a specific look.
- **Never put a shadow or effect on a text node.** Effects are box recipes and are not drawn on text. For depth behind text, put it on the frame holding the text. For an outlined title, stack two text nodes in a `layout: "none"` frame: a dark copy offset 3px behind the light one.

## 4. Components with states
Anything repeated (buttons, slots, tabs, panels, toasts, shop cards) is a **component**. Build one, define it, place instances. Instances follow the master.
```json
apply_changes { "operations": [ { "op": "create", "parentId": "<page>", "node": {
  "type": "frame", "name": "Button Chunky", "role": "button", "layout": "row", "align": "center", "justify": "center",
  "padding": [12, 32, 16, 32], "radius": "$radius.full", "fill": "$primary", "stroke": "$outline", "strokeWidth": 3,
  "effects": ["gloss-top", "hard-3d-bottom"],
  "children": [ { "type": "text", "name": "Label", "text": "PLAY", "fontFamily": "$font.display", "fontSize": 28, "color": "$outline" } ] } } ] }

define_component { "nodeId": "<id>", "kind": "button", "states": {
  "hover":    { "$self": { "fill": "#FFC24D" } },
  "pressed":  { "$self": { "fill": "#E69500", "effects": ["bevel-pressed"] } },
  "disabled": { "$self": { "fill": "#6B5F8F", "effects": [] }, "Label": { "color": "#B6AAD8" } } } }

create_instance { "component": "Button Chunky", "parentId": "<frame>", "overrides": { "Label": { "text": "ATTACK" } } }
```
- A state lists **only what differs** from the master. Layers are named by layer name, id or `$self`.
- Give every button **hover and pressed** (and disabled when it can be). `lint_design` warns when a button has none. Slots and tabs want `selected`; cards want `hover`.
- Override per instance (label text, icon, width, one colour) through `create_instance { overrides }` or by editing the instance's layer; the change is kept as an override and survives master edits. To change **every** instance, edit the master. Layers inside an instance cannot be deleted or moved: hide one (`visible: false`) or detach the instance (`update` with `instanceOf: null`).
- Components cannot contain components. Build a master from plain frames, text and icons.
- **Check states by looking:** `screenshot { "nodeId": "<button or frame>", "state": "all" }` draws default, hover, pressed, disabled and selected side by side, labelled. `state: "pressed"` shows one. Nothing is saved.

## 5. HUD, shop and inventory layouts
- **HUD** is an overlay: a `layout: "none"` frame the size of the screen with groups pinned to corners and edges by x/y. Inside each group use auto-layout. Keep the centre clear. Top-left: player and bars. Top-right: currency and settings. Bottom: skills. Leave a 32px safe margin.
- **Shop**: header (title left, currency right), a tab row, then a wrapping row of identical item cards (`layout: "row"`, `wrap: true`, `gap: 24`). Every card the same size, the price tag the loudest thing on it, one card highlighted (selected state).
- **Inventory**: a grid is rows of slots (`layout: "row"` inside a `column`). Square slots 72-88px, 12px gap, selected slot gets `inner-glow` and a gold outline, an empty slot just dims. Detail panel beside or below, with the primary action as a chunky button.
- Start from a template when one fits: `create_project` with `game-hud`, `game-shop` or `game-inventory` gives a token set, a component kit and a built screen to restyle.

## 6. Before you finish
`screenshot` every screen at scale 2 once; check contrast of light-on-dark text with `lint_design`; check that the focal point is obvious when you squint; run `screenshot` with `state: "all"` on each button.
