import { ImageResponse } from "next/og";

/** Square app icon (red tile with a white "P") rendered to PNG at build time. */
export function renderAppIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#D32027",
          color: "white",
          fontSize: size * 0.62,
          fontWeight: 900,
          fontFamily: "sans-serif",
        }}
      >
        P
      </div>
    ),
    { width: size, height: size },
  );
}
