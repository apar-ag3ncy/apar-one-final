import { loadFont } from "@remotion/google-fonts/Inter";

// Load Inter once; expose the family string for style objects.
const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
});

export const interFamily = fontFamily;
