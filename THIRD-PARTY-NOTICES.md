# Third-party notices

AFrame is MIT licensed (see `LICENSE`). It bundles the following third-party material.

## Icons: Font Awesome Free (solid)

A selection of icons in `src/core/icon-data.ts` (every entry with `source: "fontawesome-free"`) comes
from **Font Awesome Free** by Fonticons, Inc. (<https://fontawesome.com>), version 7.3.1, solid
style.

- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
  <https://creativecommons.org/licenses/by/4.0/>. The icon paths are unmodified; only a selection was
  made (`scripts/gen-icons.mjs`).
- Attribution as required by the licence, in Font Awesome's own wording: "Font Awesome Free 7.3.1 by
  @fontawesome - https://fontawesome.com. License - https://fontawesome.com/license/free (Icons: CC BY 4.0,
  Fonts: SIL OFL 1.1, Code: MIT License). Copyright 2026 Fonticons, Inc."
- The same notice is kept in the header of `src/core/icon-data.ts` and added to the end of every shipped
  JavaScript file by the build (`scripts/attribution.mjs`: the app's bundle and `aframe-mcp.mjs`). A test checks
  that it is there.

The package `@fortawesome/free-solid-svg-icons` is a development dependency only: it is read when the
icon data is generated and is not shipped.

## Icons drawn for AFrame

The icons marked `source: "aframe"` (sword, swords, potion, chest, sparkles; `scripts/icons-custom.mjs`)
were drawn for this project and are released under the MIT licence.

## Fonts: SIL Open Font License 1.1

Bundled through Fontsource (<https://fontsource.org>); each family keeps its own licence file inside
its package under `node_modules`. Nine of the ten are licensed under the **SIL Open Font License,
Version 1.1** (<https://openfontlicense.org>), which allows bundling and redistribution with
software. **Luckiest Guy is the exception: it is licensed under the Apache License 2.0**, not the OFL
(copy in `licenses/LuckiestGuy-Apache-2.0.txt`).

| Family | Package | Licence | Copyright, as stated in the package |
|---|---|---|---|
| Inter | `@fontsource-variable/inter` | OFL 1.1 | 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| DM Sans | `@fontsource-variable/dm-sans` | OFL 1.1 | 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |
| Space Grotesk | `@fontsource-variable/space-grotesk` | OFL 1.1 | 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |
| Fraunces | `@fontsource-variable/fraunces` | OFL 1.1 | 2020 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) |
| Playfair Display | `@fontsource-variable/playfair-display` | OFL 1.1 | 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display) |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | OFL 1.1 | 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Lilita One | `@fontsource/lilita-one` | OFL 1.1 | (c) 2011 Juan Montoreano |
| Luckiest Guy | `@fontsource/luckiest-guy` | **Apache 2.0** | (c) 2010 Brian J. Bonislawsky DBA Astigmatic (AOETI) |
| Bungee | `@fontsource/bungee` | OFL 1.1 | 2023 The Bungee Project Authors (https://github.com/djrrb/Bungee) |
| Fredoka | `@fontsource-variable/fredoka` | OFL 1.1 | 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One) |

## Not included

Nothing is taken from ui-resources.com or uiverse.io. See decision #81 in
`docs/20-decision-log-and-consistency-checklist.md`.
