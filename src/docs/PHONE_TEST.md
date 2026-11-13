# Phone Testing Guide

## How to serve the folder on the LAN

1. Find your PC's LAN IP: run `ipconfig` and look for "IPv4 Address" (e.g. 192.168.1.42).
2. Start the server bound to all interfaces:
   ```
   cd "C:\Users\ASUS Vivo\Desktop\DAC_Frontend"
   python -m http.server 8724 --bind 0.0.0.0
   ```
3. Allow it through Windows Firewall for private networks (one-time):
   - Windows Defender Firewall → Allow an app → python.exe → Private.
   - Or via your existing tunnel — open the tunnel URL directly on the phone.

## Switch inspector (snap-fix verification)

`dev/settings-perf.html` is a copy of the Settings page + `dev/perf-hud.js`
(a fixed overlay in the bottom-right corner, green monospace). It records
every theme/background switch:

- **tier** — the current TD.fx tier (`reveal`, `cover`, `fade`, `instant`).
- **last p50/p95/max** — rAF frame deltas across the whole switch.
- **tail p95/max** — the last 30% of the switch (the reveal's tail).
- **handoff max** — the 3 frames around `vt.finished`.
- **EARLY_END** — red if a switch ended before the animation completed
  (platform cancel / viewport change). Each one downgrades the tier for the
  next switch (never upgrades), so repeats mean a real problem.
- **geo** — live viewport geometry and the radius actually used
  (`R_true` = distance to the farthest snapshot corner, `R_safe` = applied;
  R_safe must always be larger).

### What to do on the phone

1. Open `http://<PC-IP>:8724/dev/settings-perf.html` (or via the tunnel).
2. Toggle **light → dark 10 times**: from the top of the page, from the
   bottom (scrolled down), and with the address bar visible and collapsed.
3. Repeat **dark → light** 10 times.
4. Toggle **background (OLED/grey)** a few times.
5. Tap **Copy report** and paste the JSON back.

### What a good report looks like

- `EARLY_END: none` on every switch after the first one or two (the very
  first switch after a cold page load may show one warmup abort — that is
  expected and does not downgrade the tier).
- `R_safe` ≥ `R_true` in every run; `geo` shows `vv` matching the screen.
- tail p95 ≤ ~33 ms on a mid-range phone; occasional long frames in the
  middle of the switch are the theme flip happening behind the cover
  (invisible by design).
- If the tier shows `cover` after an early abort, later switches must show
  no `EARLY_END` and no snap — the solid wipe replaces the circle.

## What to send back

- The copied JSON from the HUD.
- Device model, browser version, and whether the circle or the solid wipe
  was visible (the HUD shows the tier).
- Any switch where the screen visibly snapped or flashed.
