import type { MetadataRoute } from "next";

/** Lets staff "Add to Home Screen" and launch the optimizer full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Peppes Route Optimizer",
    short_name: "Peppes Routes",
    description: "Delivery dispatch and route optimizer.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0E0E10",
    theme_color: "#0E0E10",
    // The full-bleed red tile keeps the "P" inside the maskable safe zone, so
    // Samsung/Android can crop it to circles or squircles without clipping.
    icons: [192, 512].flatMap((px) =>
      (["any", "maskable"] as const).map((purpose) => ({
        src: `/icon/${px}`,
        sizes: `${px}x${px}`,
        type: "image/png",
        purpose,
      })),
    ),
  };
}
