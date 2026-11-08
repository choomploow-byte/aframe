---
name: game-motion
description: Motion design notes for game UI: button press and bounce, hover, pop-in, shine sweeps, count-ups, easing and durations, written as a spec the designer can hand to a developer. AFrame designs are static, so this describes what to specify and how to show states. Load when the user asks about animation, juice, feel, or hover and open transitions.
---

# Motion for game UI

AFrame draws still frames. It can show the **states** of a control (`screenshot { state: "all" }`) but not the transition between them, so motion is something you **specify**, next to the design, so a developer (Roblox TweenService, CSS, Unity) can build it exactly. Put the spec in a text layer called `Motion notes` next to the screen, or in the reply, and keep numbers concrete.

## 1. Durations and easing
| Moment | Duration | Easing |
|---|---|---|
| Hover in / out | 80-120 ms | ease-out |
| Press down | 60-80 ms | ease-out |
| Release / bounce back | 160-240 ms | back-out (small overshoot) |
| Panel or modal open | 180-260 ms | back-out for the pop, ease-out for the fade |
| Panel close | 120-160 ms | ease-in (faster than open) |
| Toast in / out | 200 ms in, 150 ms out | ease-out |
| Number count-up | 400-800 ms | ease-out |
| Shine sweep | 500-700 ms, repeated every 3-5 s | linear |

Rules: closing is faster than opening; nothing UI-critical takes more than 300 ms; never block input during an animation.

## 2. The recipes
- **Button press**: scale to 0.94-0.96 and move down by the height of the 3D ledge (the `hard-3d-bottom` offset) in the `pressed` state; release overshoots to 1.04 then settles at 1.0. The component's `pressed` state in AFrame is the end frame of the press.
- **Hover**: brighten the fill one step (the `hover` state), lift 2 px, optionally scale 1.04. On touch screens there is no hover; do not depend on it.
- **Pop-in (open)**: start at scale 0.85 and opacity 0; overshoot to 1.05; settle at 1.0. Stagger children by 40-60 ms (cards in a shop appear one after another, left to right, top to bottom, up to about 8 items; the rest appear together).
- **Shine sweep**: a white diagonal band (a rotated rect with `blendMode: "overlay"` or a white-to-transparent gradient) clipped to the button's rounded shape, moving left to right once; wait 3-5 seconds; repeat. Use it on the one primary offer, not everywhere.
- **Count-up**: currency changes roll to the new number; flash the pill's outline in the gold or green tone for 300 ms. Pair with a coin icon that pops (scale 1.2 and back).
- **Reward burst**: sunburst pattern rotating slowly (10-20 degrees per second) behind the item, sparkle icons popping at random times with different sizes, the item itself arriving with the pop-in.
- **Selection**: the selected slot gets the `selected` state (gold outline, inner glow) and a short 1.08 pulse once.
- **Error / cannot afford**: horizontal shake, 3 cycles, 6-10 px, 240 ms total, with the price flashing the danger colour.

## 3. Showing motion in AFrame
- Design the **start and end frames** as states: `default`, `hover`, `pressed`, `disabled`, `selected` on components, and a second copy of a screen for "opening" if needed (scaled 0.85, opacity 0.5).
- Check them with `screenshot { state: "all" }` and say in the reply which state follows which.
- For sequences, lay the key frames out in a row on the canvas (frame 1, 2, 3) with a label under each (`0 ms`, `120 ms`, `240 ms`), so the timing is readable.

## 4. Handing it over
For each animated control give: trigger, property changes (scale, position, opacity, colour), start and end values, duration, easing, and delay for staggers. Example:
> Shop card, on open: scale 0.85 -> 1.0 (overshoot 1.05), opacity 0 -> 1, 220 ms back-out, stagger 50 ms per card, max 8.

## 5. Restraint
- One signature motion per screen (usually the primary button's shine or the featured item's burst). More than that and nothing reads as special.
- Respect reduced motion: provide the same information without movement (a colour change instead of a shake).
