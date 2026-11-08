# AFrame user guide

Every feature, in the order you will meet it. Where something is a prototype or has not been tried on
a real-world case, it says so.

## Your first five minutes

1. **Open AFrame.** An empty canvas offers six ways to begin: draw a frame, explore the sample
   project, connect Claude Code or Codex, use an API key, or bring a design in.
2. **Look around.** Left: Layers, Assets, Tokens, Icons. Middle: the canvas. Right: Design (properties),
   Notes and Chat. Top: the project name, undo and redo, Ctrl+K for every command, Import, Check, Export,
   the theme switch and Connect AI.
3. **Ask an AI to improve something.** Select a frame, open the **Chat** tab (Ctrl+L), add an API key
   once, and press *Improve the selected frame*. Or paste what **Connect AI** shows into Claude Code.

## The canvas

- **Tools** (single keys): V select, F frame, R rectangle, O ellipse, T text, A note, H hand. Space-drag
  or the hand tool pans; Ctrl+wheel (or pinch) zooms; Shift+1 fits everything, Shift+2 the selection.
- **Frames** can lay their children out automatically (row or column, gap, padding, alignment, wrap).
  A child can be a fixed size, **hug** its content or **fill** the space. Use auto-layout for anything that
  should flow; place by hand (layout "none") only for overlaps and badges.
- **Everything is undoable** (Ctrl+Z, Ctrl+Shift+Z), including whole AI turns.
- **Right-click** a layer for cut, copy, duplicate, wrap in a frame, add auto-layout, order, hide, lock,
  export as code and export as image.
- **Tokens** (Tokens tab): named colours, fonts, spacing and radii. Use `$name` anywhere a colour or
  font goes; change the token and everything that uses it changes.
- **Images and icons.** Drop, paste or pick images (Assets tab). The Icons tab searches 165 solid icons;
  pick one to place it. Display fonts for games (Lilita One, Luckiest Guy, Bungee, Fredoka) are built in.
- **Components.** Turn a frame into a reusable master with hover, pressed, disabled and selected states;
  place instances; each instance can override text and colours. Check them all with a screenshot at
  state "all" (agents) or by selecting an instance and changing its state.
- **Patterns and presets** for game UI: stripes, halftone, sunburst, noise fills; bevel, gloss, inner
  glow and hard-3D presets.
- **Templates.** New project offers a product landing page, SaaS dashboard, mobile app, pricing page,
  game HUD, game shop, game inventory or a blank canvas, each with tokens and a component kit.

## Working with an AI

There are two ways, and both use the same tools.

### Claude Code, Codex, Cursor (their own model and account)

Press **Connect AI**, choose your tool and paste the text into it. It installs a small MCP server and
a skill. Afterwards say things like *"in aframe, make a pricing page"*, *"improve my design"*, *"match
the reference I added"*, *"address my open annotations"*. The agent sees your selection, takes
screenshots of the canvas, edits, checks its own work and replies to your notes. The green dot in the
Connect pill shows when an agent is talking to the app.

### The built-in chat (your own API key)

- Open **Chat** (Ctrl+L). First use shows a short note on what is sent where. Then **AI settings**: pick
  Anthropic, OpenAI or an OpenAI-compatible server (including a local one such as Ollama), a model, and
  paste your key. The key goes into your system keychain (Windows Credential Manager, macOS Keychain,
  Secret Service on Linux); it is never in a file, the design or the page, and **Test connection**
  proves it works.
- Type, or press a suggestion. Tool use shows as plain lines ("Edited the design", "Took a screenshot");
  open one to see the screenshot it looked at. Attach up to four images (paste, drag or the picture
  button). **Stop** halts it at once; **Undo AI change** (or Ctrl+Z) reverses the whole reply.
- Errors say what to do: a rejected key, a busy provider, no network, a conversation that is too long,
  a model that cannot see images.
- Not in this version: replies are not streamed (each step's text appears when the step finishes), and
  the assistant cannot write to disk (use Export, or an external agent).
- **Not yet run against a live provider by the author:** it is tested against scripted replies and a
  local server. Use Test connection first and tell us what you find.

### Notes and references

Press **A** and click to drop a numbered pin, or drag for a region. The pin follows the layer it is on.
The **Notes** tab lists them (open, resolved, all) with who wrote each and the AI's reply; **Ask AI to
address N open notes** sends them to the built-in chat (or copies a sentence for an external agent).
Add reference images in the Assets tab with a note and a scope (style, layout, everything); **Compare**
shows one over or beside a frame.

### Skills

Skills are short markdown guides the AI loads on demand (typography, colour, layout, patterns,
accessibility, critique, game UI...). Put your own in `~/.aframe/skills/`; see `skills/README.md`.

## Checking a design

**Check** (top bar) counts problems and opens a list: faint text, tiny type (14px minimum on phone-width
frames), tap targets, off-scale spacing, near-miss alignment, too many fonts, text touching text, long
lines, inconsistent corners, raw colours that match a token. **Show** finds the layer; **Fix** repairs one
thing; **Fix automatically** repairs everything with an unambiguous fix, as one undo.

## Export

**Export** (Ctrl+Shift+E, the top bar, or right-click):

- **Code:** HTML + CSS, React + CSS Modules, or React + Tailwind v4. Preview and copy each file; save
  to a folder you choose (a download in a browser). Colours, fonts and radii stay variables; images
  become files; class names come from your layer names and stay stable between exports. If a file already
  exists with different content, nothing is written until you choose *Replace existing files*. A
  `README-aframe.md` lists what was generated, the fonts to install and any warnings (missing alt text,
  absolutely placed layers).
- **Image:** PNG at 1x, 2x or 3x with an optional transparent background, SVG (text stays live text),
  or copy the picture.
- Agents have the same through `export_code` and `export_image`, and can only write inside a folder you
  confirmed.

## Import

**Import** (top bar):

- **SVG:** rectangles, circles, text and groups become layers; drawn paths come in as a picture of that
  drawing.
- **Figma:** paste a file link and a personal access token (kept in the keychain), pick a frame. Layout,
  text, fills, corners and shadows come across. Not tried on a real file by the author.
- **Web page (prototype):** `npm run capture-dom -- http://localhost:3000`, then choose the file.
- **Canva or an image:** the picture is added and the AI rebuilds it. Canva files cannot be opened by
  anyone else, and the app says so.
Each import shows what came across, what changed and what was left out, and is one undo.

## Files, safety and privacy

- Projects are plain JSON in `~/.aframe/projects/<id>/project.aframe.json`, saved as you work; a
  damaged file is recovered from its backup. Export a project file from the Export menu.
- Nothing leaves your computer except what you send to an AI you chose (messages, an outline of the
  design, screenshots) and Figma requests you make. There is no telemetry.
- Delete everything by uninstalling the app and removing `~/.aframe`; remove API keys in AI settings.
- If a screen ever fails you get a recovery page with **Copy diagnostics** (version, system and the
  error; never your design, notes or keys).

## Keyboard

Ctrl+K command palette (every command) · Ctrl+/ all shortcuts · Ctrl+L chat · Ctrl+Shift+E export ·
Ctrl+Z / Ctrl+Shift+Z undo and redo · Ctrl+C/V/D copy, paste, duplicate · Ctrl+G wrap in a frame ·
Ctrl+Alt+A add auto-layout · Del delete · V F R O T A H tools · arrows nudge (Shift for 10px).

## Troubleshooting

| Problem | Try |
|---|---|
| The AI says AFrame is not running | Open the app. Most tools work without it; screenshots and image export need it. |
| Claude Code does not see AFrame | Run `node aframe-mcp.mjs doctor` (or `npx -y aframe-mcp doctor`) and follow its lines. |
| Chat says add a key / key rejected | AI settings: save the key again, then Test connection. Check the model name. |
| Export refuses a folder | Folders under system locations, hidden credential folders and your home folder itself are refused: pick a project folder. |
| Windows warns about an unknown publisher | The installer is not code-signed yet. *More info*, then *Run anyway*. |
| Something looks wrong | Copy diagnostics from the recovery page, or run `doctor`, and open an issue. |
