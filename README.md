# collaborative_game — Contest Board

A single-page, zero-dependency web app for running a live classroom-style contest:
how to split participants into groups, keep the groups balanced, award points, and
declare a winner. Everything is stored locally in the browser — no server, no
backend, no sign-in. Built with plain HTML/CSS/JavaScript.

## How does it work?

1. **Create groups** (2 is a good minimum, up to 6). Each group gets a color from
   the chromatic wheel: a random starting hue is drawn, and the wheel is split
   evenly among the groups (constant saturation/lightness, pure HSL).
2. **Add users** by name. Each user lands in a random group chosen among the
   groups with the *fewest* members, so no group starves while others fill up.
   You can remove a member or an empty group at any time.
3. **Award points** with the quick buttons (`+5 +1 −1 −5`) or a custom amount
   (integers only; negatives allowed).
4. **End contest** freezes the board and announces the winner full-screen
   (ties are joint winners). Everyone's scores and groups are locked.
5. **Reset to start a new contest** archives the finished play — with its start
   timestamp and winner — into the "Past plays" list, then clears the board.

The current board also survives page refreshes: state is auto-saved to
`localStorage` after every change. All data lives in *your* browser only.

## Run it

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Tests

```bash
node --test   # logic + UI (DOM via linkedom) tests; no packages to install by hand — `npm i` first
```

`linkedom` is a dev-only dependency for testing the UI in Node. The deployed
site itself uses no libraries at all.

## Hosting on GitHub Pages

The site is fully static and needs no build step (`.nojekyll` is already
included so GitHub serves files as-is):

1. Push this repository to GitHub with the site files (`index.html`,
   `styles.css`, `app.js`) at the **root of the `main` branch**.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**,
   **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. The site appears at `https://<your-username>.github.io/<repo-name>/`
   (first deployment can take a couple of minutes).

---

Created as a course project for Programming I (UPM, 2026/27).
