import { renderAppIcon } from "@/lib/app-icon";

export const runtime = "edge";

/** Android/Chrome want both sizes for "Install app"; served at /icon/192 and /icon/512. */
export function generateImageMetadata() {
  return [192, 512].map((px) => ({
    id: String(px),
    size: { width: px, height: px },
    contentType: "image/png",
  }));
}

export default function Icon({ id }: { id: string }) {
  return renderAppIcon(Number(id));
}
