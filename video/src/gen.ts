/**
 * Manifest of AI-generated assets in public/gen.
 * Images: Google Nano Banana 2 Pro @ 2K. Videos: KLING 2.5 @ 720p/10s.
 * `hasVideo` flips to true once the KLING clip is downloaded next to the still.
 */
export const GEN = {
  core: { img: "gen/core.jpg", video: "gen/core.mp4", hasVideo: true },
  command: { img: "gen/command.jpg", video: "gen/command.mp4", hasVideo: true },
  city: { img: "gen/city.jpg", video: "gen/city.mp4", hasVideo: true },
  burst: { img: "gen/burst.jpg", video: "gen/burst.mp4", hasVideo: true },
  panels: { img: "gen/panels.jpg", video: "", hasVideo: false },
  monolith: { img: "gen/monolith.jpg", video: "", hasVideo: false },
  horizon: { img: "gen/horizon.jpg", video: "", hasVideo: false },
  network: { img: "gen/network.jpg", video: "", hasVideo: false },
} as const;

export type GenKey = keyof typeof GEN;
