---
name: roblox-ui
description: Designing game UI that will be rebuilt in Roblox Studio (or any engine with scale-based UI): fixed design resolution, safe areas, scaling from phone to PC, sizes that survive, and how AFrame layers map to ScreenGui, Frame, UICorner, UIStroke and UIGradient. Load when the user says Roblox, Studio, ScreenGui, or asks for UI that must work on every screen.
---

# Roblox and engine-scaled UI

AFrame designs at one fixed size; the game runs on phones, tablets, consoles and wide monitors. Design so the translation is mechanical.

## 1. Pick the design resolution and say so
- Make one **reference frame** per screen at a single size (for example 1920 x 1080, or the 2000 x 1125 the project already uses) and name it `Screen - <name> - 1920x1080`. Everything inside is positioned against that frame.
- Treat that frame as the *scaled* area: in Studio a `UIScale` (or scale-based `Size`) shrinks or grows the whole thing to the screen. Design for the **narrowest** and **shortest** screen you must support, not the biggest.
- Test the design at other shapes by making a second reference frame with another aspect ratio (a tall phone at 19.5:9, a 4:3 tablet) and checking nothing important falls off the edge.

## 2. Safe areas
- Keep anything a player must read or press at least **5% of the frame's width** away from the left and right edges and **8%** from the top and bottom. Notches, rounded corners and the Roblox top bar take space; the exact insets vary by device.
- The top-left corner on the Roblox client is taken by the platform's own buttons. Put your menu button and currency pills away from it (top-right and bottom are safer).
- Corner anchors beat absolute coordinates: group HUD pieces by the corner or edge they belong to (top-right currencies, bottom-centre hotbar) and lay each group out with auto-layout, so only the anchor moves when the screen changes.

## 3. Sizes that survive scaling
- Prefer **proportions**: a panel that is 60% of the frame wide with a fixed aspect ratio scales cleanly; one with a fixed pixel size does not. In AFrame use `w: "fill"` and fixed `h`, or fixed `w` and `h` inside a frame whose size you note as a percentage of the reference.
- Lock the aspect ratio of art-heavy pieces (item icons, avatars, buttons with art). A stretched icon looks broken; a slightly smaller one does not. That is `UIAspectRatioConstraint` in Studio.
- Set a **minimum tap size of about 44 x 44 px at the reference size** for anything pressable, since phone screens shrink everything.
- Text: pick sizes that are still readable when the whole screen is scaled to a phone (about 0.45x of 1080p). Body text below about 24 px at 1080p becomes unreadable on a phone; titles 48 px and up.
- Use `$radius` tokens, not literal radii, so corner rounding is one change.

## 4. How AFrame layers map to Studio objects
| In AFrame | In Studio |
|---|---|
| Top-level screen frame | `ScreenGui` (set `ResetOnSpawn` as the game needs), with the design resolution noted |
| `frame` with a fill | `Frame` (`BackgroundColor3`, `BackgroundTransparency` from opacity) |
| `radius` | `UICorner` (`CornerRadius`; a full-pill radius is `UDim.new(1, 0)`) |
| `stroke` + `strokeWidth` | `UIStroke` (`Thickness`, `Color`); text outline (`textStroke`) is `UIStroke` on a `TextLabel` with `ApplyStrokeMode` = Contextual |
| gradient fill or gradient text `color` | `UIGradient` (`Color` as a `ColorSequence`, `Rotation` from the angle) |
| auto-layout `row` / `column` | `UIListLayout` (`FillDirection`, `Padding` from gap, alignments from align/justify) |
| `wrap: true` row of equal items | `UIGridLayout` (set `CellSize` and `CellPadding`) |
| `padding` | `UIPadding` |
| `text` | `TextLabel` (`TextScaled` only for fixed boxes; set `TextSize` otherwise) |
| `image` | `ImageLabel` or `ImageButton` (`ScaleType` from fit; tile is `ScaleType.Tile` with `TileSize`) |
| `icon` | an `ImageLabel` with the exported PNG, tinted with `ImageColor3` |
| button component | `TextButton` / `ImageButton` with hover and press tweens (see the `game-motion` skill) |
| `shadow` | a second darker `Frame` offset behind (Studio has no box-shadow); `hard-3d-bottom` is exactly that |
| `blendMode`, `blur` | not available on ordinary GUI objects; avoid them in Roblox designs |

## 5. Exporting art
- Layers Roblox cannot draw (bevels, glossy gradients made of many stops, patterns, glow) should be **baked into images** with `export_image` at scale 2 or 3, transparent background, one image per control state where it differs. Keep text, icons that need recolouring, and simple fills live in Studio.
- Name the layers as you want the Studio objects named: `PlayButton`, `CoinsLabel`. Avoid spaces and punctuation.
- Report the design resolution, the anchor of each group and the list of baked images, so whoever rebuilds the screen does not have to guess.

## 6. Checklist before you hand over
1. One reference frame per screen, at the stated resolution, and a second at a phone aspect ratio.
2. Everything pressable is at least about 44 px; text is at least about 24 px (titles 48 px and up).
3. Nothing important inside the safe margins' outer band; nothing in the top-left platform corner.
4. Groups are anchored to a corner or edge; no long chains of absolute offsets.
5. Colours and radii are tokens; fonts are two at most.
