# Quotex Signal Sidebar — Pro

## Quick steps
1. Push this repo to GitHub (main branch).
2. GitHub Actions will build a Windows installer.
3. Go to repo → Actions → download artifact `quotex-signal-app-installer`.
4. Install and run, log in to Quotex in the left pane, open chart, click Get Signal.

## Tuning
- Change minScore in `injector.js` (search for `const minScore = 80;`).
