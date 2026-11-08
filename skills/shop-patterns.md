---
name: shop-patterns
description: What makes game shops, gem and coin stores, battle passes and offers convert and read at a glance: price hierarchy, featured items, deals and discounts, limited-time timers, rarity, and the layout of item grids. Load for any shop, store, offer, gacha or upgrade screen.
---

# Shop patterns

A shop is a comparison machine. The player scans, compares, and decides in seconds. Everything on the screen should make one choice obvious and the others easy to dismiss.

## 1. One hero, then a grid
- **One featured offer** gets the most space, the strongest colour, the sunburst or glow, and the biggest button. Everything else is a calm, uniform grid.
- Put the hero where the eye lands first: top-left of the content area, or a wide banner across the top. Never two heroes.
- The grid cards are all the **same size** (`repeat_node` makes them in one call), with the same internal order: name, picture, quantity, price button.

## 2. Price hierarchy
1. **The price button is the loudest thing on a card.** Saturated fill, outline, gloss, `hard-3d-bottom`; the label is the amount with the currency icon next to it.
2. The item picture is second. The name is third, in the display face at a modest size, outlined.
3. Quantity or "x5" sits on the picture's corner in the display face, never as a separate line.
4. Use the currency colours consistently: gold coins, gem blue, premium purple, free green. Never recolour a currency icon to match a card.
5. Free or "Claim" items use the success tone; paid items the primary tone; unaffordable items show the disabled state with a visible price, not a hidden one.

## 3. Showing a deal
- **Discount badge**: a small rotated ribbon or starburst in the top corner, one short number ("-40%", "x2"). Rotate 8-12 degrees; place it half over the card edge.
- **Strike-through the old price** in the muted colour above the new price, smaller. A `text` layer with a thin `line` rect through it is enough.
- **Value stack**: for bundles, show the contents as small slot icons in a row and the total value ("Worth 1,200") in the muted colour; the price stays the hero.
- **Best value**: one pack in a row gets a "BEST VALUE" banner (`title_banner`) on top. Not on every pack.
- **Limited time**: a timer pill with a clock icon in the card header or a banner ("2d 14h"). Keep the digits in the display face; use the danger tone once it is under a day.

## 4. Featured item treatment
- Sunburst pattern behind the picture (`pattern: sunburst`, opacity 0.08 to 0.2), a rarity-coloured outline (4 px), and a larger slot.
- A glow behind the picture: a radial gradient circle with `blendMode: "screen"` or `plus-lighter`.
- Sparkle icons near (not on) the item; two or three, different sizes.
- The featured card is 1.3 to 1.6 times the width of a normal one, not more.

## 5. Rarity
- Common grey, rare blue, epic purple, legendary gold (the item slot widget uses these). Rarity is shown by the **border and a faint background tint**, never by text alone.
- Keep rarity order consistent in sorting: legendary first in shops, common first in inventories.

## 6. Navigation and chrome
- Left or top tabs by category with the active one in the primary tone (`tab_bar`). Four to six tabs; more means a scroll.
- Currencies stay visible in the top-right at all times (`currency_pill`, with the `plus` button where the player can buy more).
- A clear close button (`icon_button` danger, top-right of the panel). A back button when a detail view opens over the shop.
- Confirm dialogs for spending real or premium currency: a `modal` with the item, the price, a green confirm and a neutral cancel.

## 7. Check list
1. Squint: is exactly one thing the hero? Is the price button the loudest thing on each card?
2. Do all cards have identical layout? Do deal badges sit in the same corner?
3. Is the currency balance visible, and does an unaffordable item still show its price?
4. Is every state visible: normal, hover, pressed, disabled, selected (check with `screenshot { state: "all" }`)?
