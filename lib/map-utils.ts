import type { LatLng } from "./types";

export const FALLBACK_CENTER: LatLng = { lat: 59.9139, lng: 10.7522 }; // Oslo

export const darkMapStyle: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#16161b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#16161b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9a9aa8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#26262e" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#22232a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1b21" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c2d36" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b0c10" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3a3b45" }] },
];

/**
 * Decodes an encoded polyline string into an array of lat/lng points.
 * Implementation of Google's polyline algorithm.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
