# Rootline — Family Tree

A small, fast, dependency-free family tree app. Runs entirely in the browser with no build step or backend — data is stored in `localStorage`.

## Run it

Any static file server works:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Model

- **Person** — `{ id, name, gender: 'M'|'F'|'O', birth, death, notes, unionId, parentUnionId }`
- **Union** — `{ id, partners: [personId, personId?], children: [personId...] }`

A union with two partners renders as a joined couple card; a union with one partner (a single parent) or a person with no union at all renders as a single card. Each tree has one root ancestor; the tree grows downward through unions and their children, and upward via "Add parent" on the current root.

Everything lives under one `Tree` object (`people`, `unions`, `rootPersonId`), and multiple trees are kept side by side in `localStorage` under `rootline.familytree.v1`.

## Features

- Add ancestor, partner, child, or parent from a contextual toolbar on the selected person
- Male / female / other color-coded cards
- Blood relatives (filled cards) are visually distinguished from spouses who married in (dashed outline), with a legend
- Pan, zoom, and fit-to-screen on the tree canvas
- Multiple trees, switchable from the sidebar
- Import / export a tree as JSON
- Print-optimized layout (File → Print / Cmd+P)

## Files

- `index.html` — layout and modals
- `style.css` — theme, cards, animations (light/dark aware)
- `app.js` — data model, layout algorithm, rendering, interactions
