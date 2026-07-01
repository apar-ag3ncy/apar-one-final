# Apar One — "The Bookkeeping OS" — epic launch film

A self-contained [Remotion](https://remotion.dev) project that renders a 60-second
**cinematic, 3D, generative** SaaS launch film for the Apar One **OS** module. It
has its **own** `package.json` so it never touches the Next.js app's build.

- **Composition:** `OsIntro` — authored at 1920×1080, 30fps, 1800 frames (60s)
- **Output:** rendered at `--scale=2` → **true 3840×2160 (4K)**, H.264.
- **Look:** AI-generated cinematic backdrops + KLING motion clips + the **real OS
  screenshots on floating 3D glass panels** + kinetic typography + particles,
  cut to an epic trailer soundtrack. Brand accent `#ee3a24` on near-black.

## Story beats (`src/OsIntro.tsx`)

| # | Scene | Media |
|---|-------|-------|
| A | Ignition | Energy-core motion clip powers up · "Your books just came alive" |
| B | Problem | Kinetic slams (Spreadsheets / Silos / Month-end dread) over a node network |
| C | Brand | APAR logo ignites over the glowing monolith |
| D | OS reveal | Real desktop flies in as a 3D glass slab over the holographic command center |
| E | Features | Real Trial Balance / P&L / Statement / Balance-Sheet screenshots on flying 3D panels, over the neon ledger-city fly-through |
| F | Momentum | Real OS app icons explode into a ring over an energy burst · stat slams |
| G | CTA | Logo lockup over the neon horizon · "See the OS in action" |

## Generated assets

- **Images** (`public/gen/*.png`): Google **Nano Banana 2 Pro** @ 2K, 16:9.
- **Motion clips** (`public/gen/*.mp4`): **KLING 2.5** @ 720p/10s, image-to-video
  from the stills above.
- **Soundtrack** (`public/soundtrack-epic.mp3`): 60s epic instrumental.
- **Real OS screenshots** (`public/os/*.png`): 4K captures of the live product
  (dark mode), reproducible via `node video/scripts/capture-os.mjs`.

The `src/gen.ts` manifest maps each asset; `HeroMedia` plays the KLING clip when
`hasVideo` is set, otherwise Ken Burns the still.

## Commands

```bash
cd video
npm install
npm run studio      # live editor
npm run render      # → out/apar-os-epic-4k.mp4 (4K)
```

## Reusable building blocks (`src/components`)

`HeroMedia` (video/still backdrop), `KenBurns`, `Glass3DPanel` (3D screenshot
slab), `KineticText` (`KineticWords` + `SlamText`), `Particles` (deterministic
embers), `Overlays` (`Vignette`, `Scanlines`, `Grid3D`, `LightSweep`,
`RgbGlitch`, `Flash`), `OsIcons` (the real OS icon set), `AparLogo`.
