"use client";

import type { Circle, CircleMarker, LayerGroup, Map as LeafletMap, Marker, Polyline, TileLayer } from "leaflet";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { shortName, type Airport } from "@/lib/airports";
import { CATCH_RANGE_MI, moveBy, type LatLon } from "@/lib/geo";

export type MapPlane = {
  id: string;
  position: LatLon;
  /** Direction of travel, degrees from north: the icon points that way, with a dashed line ahead. Null if unknown. */
  heading: number | null;
  /** Read aloud and shown on hover: "United 787-8, 3.2 miles northeast". */
  label: string;
  /** Faded when it can't be caught (out of range, or over an airport). */
  catchable: boolean;
};

const MI_TO_M = 1609.34;
/** How far ahead the "heading" line reaches. */
const HEADING_LINE_MI = 2;
/** Zone codes stay on the map from this zoom in; further out, zones are labelled only on hover or tap. */
const LABEL_ZOOM = 10;

const PLANE_SVG =
  '<svg viewBox="-8 -8 16 16" width="26" height="26" aria-hidden="true"><path d="M0,-6 L1,-2 L6,1 L6,2.5 L1,1.2 L0.8,4 L2.5,5.4 L2.5,6.3 L0,5.6 L-2.5,6.3 L-2.5,5.4 L-0.8,4 L-1,1.2 L-6,2.5 L-6,1 L-1,-2 Z"/></svg>';

/** `selected` matches the app's accent color (--accent), so the chosen plane reads as "picked". */
type Palette = { range: string; you: string; zone: string; heading: string; selected: string; tiles: "World_Light_Gray" | "World_Dark_Gray" };
const LIGHT: Palette = { range: "#2563eb", you: "#2563eb", zone: "#6b7280", heading: "#141a21", selected: "#1c5d8c", tiles: "World_Light_Gray" };
const DARK: Palette = { range: "#60a5fa", you: "#60a5fa", zone: "#9ca3af", heading: "#e8edf2", selected: "#8cc8f0", tiles: "World_Dark_Gray" };

/**
 * Street map tiles: Esri's grey "Canvas" basemaps, which need no API key (CARTO's now do).
 * Each is two layers: the map itself, then street and place names on top.
 */
const tileUrl = (layer: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
/** Kept short; the data credits that matter stay: Esri (tiles) and OpenStreetMap (the map data). */
const TILE_CREDIT = "&copy; Esri, OpenStreetMap";
const darkQuery = () => matchMedia("(prefers-color-scheme: dark)");

/**
 * The live map (not used in onboarding, which has the simpler radar):
 *   - you, as a blue dot, with a light blue circle for your catch range
 *   - grey no-catch zones around airports, with their names
 *   - planes, pointing where they're heading, with a short line showing their path ahead
 * Zoom with the + and − buttons, the scroll wheel, a pinch, or the + and − keys. It follows you
 * until you drag it; then "Back to me" re-centers. Street map tiles: © Esri, with OpenStreetMap data.
 */
export function FlightMap({
  center,
  airports,
  planes = [],
  selectedId,
  onSelect,
  onMapClick,
  caption,
  children,
}: {
  center: LatLon | null;
  airports: Airport[] | null;
  planes?: MapPlane[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** A click on the map itself (not on a plane), e.g. to close the open plane. */
  onMapClick?: () => void;
  /** A short summary for screen readers: "Map around Chicago. No planes in range." */
  caption: string;
  /** Laid over the bottom of the map, e.g. an empty-state message. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const tiles = useRef<{ style: string; layers: TileLayer[] } | null>(null);
  const you = useRef<{ dot: CircleMarker; range: Circle } | null>(null);
  const zoneLayer = useRef<LayerGroup | null>(null);
  const planeLayer = useRef<LayerGroup | null>(null);
  /** Plane markers by ID, kept between updates (see the planes effect). */
  const markers = useRef(new Map<string, { marker: Marker; line: Polyline | null; iconKey: string }>());
  const [ready, setReady] = useState(0); // bumps when the map exists or the color scheme changes
  const [view, setView] = useState(0); // bumps after each pan or zoom (only the airport zones use it)
  const [following, setFollowing] = useState(true);
  const centered = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onMapClickRef.current = onMapClick;
  }, [onSelect, onMapClick]);

  // Create the map once (Leaflet needs the browser, so it's loaded here, not on the server).
  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    const planeMarkers = markers.current;
    void import("leaflet").then((mod) => {
      if (cancelled || !box.current) return;
      const leaflet = mod.default;
      L.current = leaflet;
      const m = leaflet.map(box.current, {
        center: [41.88, -87.63],
        zoom: 11,
        minZoom: 6,
        maxZoom: 16,
        zoomControl: true,
        attributionControl: true,
      });
      map.current = m;
      // No "Leaflet" link in the corner (not required by its license), just the map data credit.
      m.attributionControl.setPrefix(false);
      zoneLayer.current = leaflet.layerGroup().addTo(m);
      planeLayer.current = leaflet.layerGroup().addTo(m);
      // Dragging means "let me look around": stop following until "Back to me".
      m.on("dragstart", () => setFollowing(false));
      // Zones and their labels depend on zoom and on what's in view.
      m.on("moveend", () => setView((n) => n + 1));
      // Clicks on planes don't reach the map; this is a click on empty map.
      m.on("click", () => onMapClickRef.current?.());
      const scheme = darkQuery();
      const onScheme = () => setReady((n) => n + 1);
      scheme.addEventListener("change", onScheme);
      stop = () => scheme.removeEventListener("change", onScheme);
      setReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
      stop();
      map.current?.remove();
      map.current = null;
      planeMarkers.clear();
      tiles.current = null;
      you.current = null;
      centered.current = false;
    };
  }, []);

  const palette = typeof window !== "undefined" && darkQuery().matches ? DARK : LIGHT;

  // Street tiles, light or dark to match the page.
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    if (!leaflet || !m) return;
    if (tiles.current?.style === palette.tiles) return;
    tiles.current?.layers.forEach((t) => t.remove());
    tiles.current = {
      style: palette.tiles,
      layers: [
        leaflet.tileLayer(tileUrl(`${palette.tiles}_Base`), { maxNativeZoom: 16, attribution: TILE_CREDIT }).addTo(m),
        leaflet.tileLayer(tileUrl(`${palette.tiles}_Reference`), { maxNativeZoom: 16 }).addTo(m),
      ],
    };
  }, [ready, palette.tiles]);

  // You and your catch range. Follows you unless you've dragged the map away.
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    if (!leaflet || !m || !center) return;
    const at: [number, number] = [center.lat, center.lon];
    if (!you.current) {
      you.current = {
        range: leaflet
          .circle(at, {
            radius: CATCH_RANGE_MI * MI_TO_M,
            color: palette.range,
            weight: 1.5,
            fillColor: palette.range,
            fillOpacity: 0.08,
            interactive: false,
          })
          .addTo(m),
        dot: leaflet
          .circleMarker(at, { radius: 7, color: "#ffffff", weight: 2.5, fillColor: palette.you, fillOpacity: 1, interactive: false })
          .addTo(m),
      };
    } else {
      you.current.range.setLatLng(at).setStyle({ color: palette.range, fillColor: palette.range });
      you.current.dot.setLatLng(at).setStyle({ fillColor: palette.you });
    }
    if (!centered.current) {
      centered.current = true;
      m.fitBounds(you.current.range.getBounds(), { padding: [24, 24] });
    } else if (following && !m.getCenter().equals(at, 1e-5)) {
      m.panTo(at);
    }
  }, [center, following, ready, palette.range, palette.you]);

  // Airport no-catch zones in view (plus a margin), with names when zoomed in.
  useEffect(() => {
    const leaflet = L.current;
    const m = map.current;
    const layer = zoneLayer.current;
    if (!leaflet || !m || !layer) return;
    layer.clearLayers();
    if (!airports) return;
    const inView = m.getBounds().pad(0.3);
    const labelled = m.getZoom() >= LABEL_ZOOM;
    for (const a of airports) {
      if (!inView.contains([a.lat, a.lon])) continue;
      // Zoomed in, each zone shows just its code ("ORD"). Hovering (or tapping) shows the full name.
      const short = a.code;
      const full = `${shortName(a)} (${a.code}) · no catching`;
      const zone = leaflet
        .circle([a.lat, a.lon], {
          radius: a.zoneMi * MI_TO_M,
          color: palette.zone,
          weight: 1,
          dashArray: "4 4",
          fillColor: palette.zone,
          fillOpacity: 0.28,
        })
        .bindTooltip(labelled ? short : full, {
          permanent: labelled,
          direction: "center",
          className: "airport-label",
        })
        .addTo(layer);
      if (labelled) {
        zone.on("mouseover click", () => zone.setTooltipContent(full));
        zone.on("mouseout", () => zone.setTooltipContent(short));
      }
    }
  }, [airports, ready, view, palette.zone]);

  // Planes, pointing where they're heading, each a keyboard-reachable button.
  // Markers are kept and updated in place: moved when the plane moves, re-drawn only when its direction,
  // selection, or catchability changes. Rebuilding them on every render (the page re-renders each second
  // for "updated X s ago") could swallow a click that landed mid-rebuild.
  useEffect(() => {
    const leaflet = L.current;
    const layer = planeLayer.current;
    if (!leaflet || !layer) return;
    const seen = new Set<string>();
    for (const p of planes) {
      seen.add(p.id);
      const at: [number, number] = [p.position.lat, p.position.lon];
      const selected = p.id === selectedId;
      const iconKey = `${p.heading ?? 0}|${selected}|${p.catchable}`;
      let entry = markers.current.get(p.id);
      if (!entry) {
        const marker = leaflet
          .marker(at, {
            title: p.label,
            alt: p.label,
            keyboard: true,
            icon: planeIcon(leaflet, p, selected),
            zIndexOffset: selected ? 1000 : 0,
          })
          .on("click", () => onSelectRef.current?.(p.id))
          .addTo(layer);
        entry = { marker, line: null, iconKey };
        markers.current.set(p.id, entry);
      } else {
        const now = entry.marker.getLatLng();
        if (now.lat !== at[0] || now.lng !== at[1]) entry.marker.setLatLng(at);
        if (entry.iconKey !== iconKey) {
          entry.marker.setIcon(planeIcon(leaflet, p, selected));
          // The selected plane is drawn on top of any it overlaps.
          entry.marker.setZIndexOffset(selected ? 1000 : 0);
          entry.iconKey = iconKey;
        }
        const el = entry.marker.getElement();
        if (el && el.title !== p.label) {
          el.title = p.label;
          el.setAttribute("alt", p.label);
        }
      }
      // The dashed line ahead of it, in its direction of travel.
      if (p.heading === null) {
        entry.line?.remove();
        entry.line = null;
      } else {
        const rad = (p.heading * Math.PI) / 180;
        const ahead = moveBy(p.position, Math.sin(rad) * HEADING_LINE_MI, Math.cos(rad) * HEADING_LINE_MI);
        const path: [number, number][] = [at, [ahead.lat, ahead.lon]];
        // The selected plane's line is in the accent color and bolder, so its path stands out.
        const style = selected
          ? { color: palette.selected, opacity: 0.95, weight: 2.5 }
          : { color: palette.heading, opacity: p.catchable ? 0.7 : 0.35, weight: 1.5 };
        if (entry.line) entry.line.setLatLngs(path).setStyle(style);
        else {
          entry.line = leaflet.polyline(path, { ...style, dashArray: "3 5", interactive: false }).addTo(layer);
        }
      }
    }
    // Planes no longer shown.
    for (const [id, entry] of markers.current) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      entry.line?.remove();
      markers.current.delete(id);
    }
  }, [planes, selectedId, ready, palette.heading, palette.selected]);

  function backToMe() {
    setFollowing(true);
    if (center && map.current) map.current.setView([center.lat, center.lon], Math.max(map.current.getZoom(), 11));
  }

  return (
    <figure className="relative isolate overflow-hidden rounded-2xl border border-line">
      <div ref={box} role="region" aria-label={caption} className="h-[26rem] w-full bg-surface sm:h-[30rem]" />
      {!following && center && (
        <button
          type="button"
          onClick={backToMe}
          className="absolute top-3 right-3 z-[1000] min-h-9 rounded-lg border border-control bg-surface px-3 text-sm font-medium text-ink shadow-sm hover:bg-bg"
        >
          Back to me
        </button>
      )}
      {children && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[1000] flex justify-center px-6">
          <div className="pointer-events-auto max-w-[19rem] rounded-xl border border-line bg-surface/95 px-4 py-3 text-center text-sm shadow-sm">
            {children}
          </div>
        </div>
      )}
    </figure>
  );
}

/**
 * A plane's icon, rotated to its direction of travel. Selected: bigger, in the accent color, on a
 * highlighted disc with a soft pulsing ring (see .plane-marker in globals.css).
 */
function planeIcon(leaflet: typeof import("leaflet"), p: MapPlane, selected: boolean) {
  const size = selected ? 48 : 34;
  return leaflet.divIcon({
    className: `plane-marker${selected ? " is-selected" : ""}${p.catchable ? "" : " is-faded"}`,
    html: `<span class="plane-halo"></span><span class="plane-icon" style="transform: rotate(${p.heading ?? 0}deg)">${PLANE_SVG}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
