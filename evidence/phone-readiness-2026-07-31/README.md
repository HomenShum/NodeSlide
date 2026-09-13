# NodeSlide phone-readiness proof — 2026-07-31

Temporary HTTPS URL: <https://secretariat-portsmouth-louisiana-works.trycloudflare.com/>

This quick tunnel is for the current attended test only. It has no uptime guarantee and depends on
this computer staying awake. Production remains <https://nodeslide.vercel.app>.

## Observed

- Raw HTTPS response: `200`, `NodeSlide` present in the HTML.
- Desktop `1024 × 768`: the focused **Open on phone** QR is visible with no horizontal overflow.
- Mobile `390 × 844`: the QR handoff is hidden, the landing is usable, and no horizontal overflow
  or application console errors were observed.
- Mobile sample journey: **See an example deck** opened the real editor, and the slide canvas
  rendered at `390 × 844` with zero application console errors.
- Host refusal: an arbitrary hostname still returns `403`; only `.trycloudflare.com` was added.
- QR privacy: deck, share, hash, and owner-capability context are not forwarded. The scan target is
  the safe NodeSlide root for the active HTTPS origin.
- Gates: targeted Vitest `5/5`, Biome clean, full `npm run build` passed, and the five-scenario
  production pack validated.

## Artifacts

- `nodeslide-phone-qr.png` — QR for the temporary HTTPS URL.
- `after-desktop-1024x768.png` — focused desktop handoff.
- `after-mobile-390x844.png` — mobile landing after the change.
- `live-mobile-landing-390x844.png` — live tunnel landing.
- `live-mobile-sample-390x844.png` — live tunnel sample editor.
- `vite.stdout.log` and `cloudflared.stderr.log` — runtime evidence.

## Reproduce

```powershell
npm run dev:web
cloudflared tunnel --url http://127.0.0.1:5180 --no-autoupdate
```

Open the printed HTTPS URL on desktop, select **Open on phone**, and scan the QR. The same commands
are documented in the repository quickstart.

## Honest boundary

This proves access and handoff, not that NodeSlide's generation-quality regressions are resolved.
The QA ledger still records repeated layouts, incomplete requested slide counts, invented logic,
PPTX overflow, and hosted publication failure. The only device-exclusive proof still pending is a
physical phone scan/tap performed by the user.
