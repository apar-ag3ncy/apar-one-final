# Apar One — "The Bookkeeping OS" intro video

A self-contained [Remotion](https://remotion.dev) project that renders a 60-second
SaaS launch video for the Apar One **OS** module. It has its **own** `package.json`
and dependencies so it never touches the Next.js app's build.

- **Composition:** `OsIntro` — 1920×1080, 30fps, 1800 frames (60s)
- **Brand:** color `#ee3a24`, wordmark from `../public/brand/apar-orange.svg`
- **Soundtrack:** `public/soundtrack.mp3` (60s instrumental)

## Story beats (`src/OsIntro.tsx`)

| # | Scene | What it shows |
|---|-------|----------------|
| 1 | Hook | The broken realities of bookkeeping get struck out |
| 2 | Brand | The Apar wordmark draws on → *One · The Bookkeeping OS* |
| 3 | Desktop | macOS-style shell: menu bar, Statement of Account window, dock |
| 4 | Features | Trial Balance, live P&L, ledger statements, AR/AP aging, branded exports |
| 5 | Why it wins | 20+ apps · 0 spreadsheets · 1-click audit-ready exports |
| 6 | CTA | Logo lockup + "See the OS in action" |

## Commands

```bash
cd video
npm install          # first time only
npm run studio       # open the Remotion Studio to edit/preview live
npm run render       # render to out/apar-os-intro.mp4 (h264)
npm run render:hd    # same, crf=18 (higher quality)
npm run still        # export a poster frame
```

## Editing tips

- Copy, colors, and timing live in `src/scenes/*` and `src/theme.ts`.
- Mock product UI (windows, tables, charts) is in `src/components/`.
- Scene durations are wired in `src/OsIntro.tsx`; keep the total at 1800 frames
  (or bump `durationInFrames` in `src/Root.tsx` to match).
