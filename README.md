# collaborative_game — Contest Board

A single-page web app for running a live classroom-style contest: split
participants into groups, keep the groups balanced, award points, and declare a
winner. Everything is stored locally in the browser — no server, no backend, no
sign-in.

Built with plain HTML/CSS/JavaScript. **Vite** and **Tailwind CSS** are
dev/build tools only; the deployed site has no runtime libraries.

## How does it work?

1. **Create groups** (2 is a good minimum, up to 6) with one click — no naming
   needed: each group is automatically named after its color. Colors come from
   the chromatic wheel: a random starting hue is drawn, and the wheel is split
   evenly among the groups (constant saturation/lightness, pure HSL), so every
   group wears a distinct color name (red, orange, green, cyan, …).
2. **Add users** by name. Each user lands in a random group chosen among the
   groups with the *fewest* members, so no group starves while others fill up.
   You can remove a member or an empty group at any time.
3. **Award points** with the quick buttons (`+5 +1 −1 −5`) or a custom amount
   (integers only; negatives allowed).
4. **End contest** freezes the board and announces the winner full-screen
   (ties are joint winners). Everyone's scores and groups are locked.
5. **Reset to start a new contest** archives the finished play — with its start
   timestamp and winner — into the "Past plays" list (last 20 kept), then clears
   the board.

The current board also survives page refreshes: state is auto-saved to
`localStorage` after every change. All data lives in *your* browser only.

## Run it locally

```bash
npm install
npm run dev
# → http://localhost:5173
```

Production build and local preview:

```bash
npm run build
npm run preview
```

## Tests

```bash
npm test                 # logic + UI (DOM via linkedom)
npm run test:e2e         # Playwright against vite preview
```

`linkedom`, Vite, Tailwind, and Playwright are **devDependencies** only.

## Hosting on GitHub Pages

The repo ships a GitHub Action (`.github/workflows/pages.yml`) that builds with
Vite and deploys the `dist/` folder:

1. Push this repository to GitHub (site sources at the repo root).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: GitHub Actions**.
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually).
5. The site appears at `https://<your-username>.github.io/collaborative_game/`
   (first deployment can take a couple of minutes).

---

Created as a course project for Programming I (UPM, 2026/27).
