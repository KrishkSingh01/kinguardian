import { queueLatestPoint } from "./map-point-queue.js";
import * as maplibre from "maplibre-gl";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
maplibre.setWorkerUrl("/js/maplibre-gl-worker.mjs");
const markers = new Map();
const pendingPoints = [];
let pendingFocus;
const state = document.querySelector("#map-state");
const canvas = document.querySelector("#safety-map");
const locateButton = document.querySelector("#map-locate");
const retryButton = document.querySelector("#map-retry");
const tiltButton = document.querySelector("#map-tilt");
const resetButton = document.querySelector("#map-reset");

let map;
let MarkerClass;
let is3d = false;
let mapLoadTimeout;
let lastMapError = "";
let mapLoadAttempt = 0;

if (canvas && state && locateButton && retryButton && tiltButton && resetButton) {
  locateButton.addEventListener("click", locateOnMap);
  retryButton.addEventListener("click", () => { void startMap(); });
  tiltButton.addEventListener("click", toggle3d);
  resetButton.addEventListener("click", resetMap);
  window.addEventListener("kinguardian:map-point", (event) => addPoint(event.detail));
  window.addEventListener("kinguardian:map-focus", (event) => focusPoint(event.detail));
  void startMap();
}

async function startMap() {
  const attempt = ++mapLoadAttempt;
  window.clearTimeout(mapLoadTimeout);
  lastMapError = "";
  retryButton.hidden = true;
  canvas.dataset.ready = "false";
  setMapState("Loading map data…");
  map?.remove();
  map = undefined;
  mapLoadTimeout = window.setTimeout(() => {
    if (attempt !== mapLoadAttempt || canvas.dataset.ready === "true") return;
    mapLoadAttempt += 1;
    map?.remove();
    map = undefined;
    setMapState("Map data did not respond. Your internet may still work while the map service or a browser filter is unavailable.", "error");
    retryButton.hidden = false;
  }, 15_000);
  try {
    if (attempt !== mapLoadAttempt) return;
    MarkerClass = maplibre.Marker;
    addStylesheet("/css/maplibre-gl.css");
    map = new maplibre.Map({
      container: canvas,
      style: MAP_STYLE_URL,
      center: [0, 20],
      zoom: 2,
      pitch: 0,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibre.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    map.on("load", () => {
      if (attempt !== mapLoadAttempt) return;
      window.clearTimeout(mapLoadTimeout);
      try { addBuildingsLayer(); } catch { /* Keep the 2D safety map usable if optional 3D buildings fail. */ }
      for (const point of pendingPoints.splice(0)) addPoint(point);
      if (pendingFocus) focusPoint(pendingFocus);
      setMapState("Map ready. Choose Show my location to display your position.", "ready");
      canvas.dataset.ready = "true";
      retryButton.hidden = true;
    });
    map.on("error", (event) => { lastMapError = event?.error?.message || "Map request failed."; });
  } catch (error) {
    if (attempt !== mapLoadAttempt) return;
    window.clearTimeout(mapLoadTimeout);
    map?.remove();
    map = undefined;
    const webglFailure = error?.name === "GPUInitializationError" || /webgl|web worker/iu.test(error?.message || "");
    setMapState(webglFailure
      ? "This browser or graphics hardware could not start the map renderer. Your location has not been shared."
      : "The map library could not load. Your internet may work while the map CDN is blocked or unavailable.", "error");
    retryButton.hidden = false;
  }
}

function addStylesheet(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.crossOrigin = "anonymous";
  document.head.append(link);
}

function addBuildingsLayer() {
  if (!map || map.getLayer("kinguardian-3d-buildings")) return;
  const style = map.getStyle();
  const tileSourceId = Object.entries(style.sources || {}).find(([, source]) => {
    const urls = [source.url, ...(source.tiles || [])].filter((url) => typeof url === "string");
    return source.type === "vector" && urls.some((url) => url.includes("tiles.openfreemap.org/planet"));
  })?.[0];
  if (!tileSourceId) return;
  const labelLayer = map.getStyle().layers?.find((layer) =>
    layer.type === "symbol" && layer.layout?.["text-field"],
  )?.id;
  map.addLayer({
    id: "kinguardian-3d-buildings",
    source: tileSourceId,
    "source-layer": "building",
    type: "fill-extrusion",
    minzoom: 15,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["get", "render_height"], 0, "#9ac9ad", 80, "#217451", 240, "#164d39"],
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 16, ["coalesce", ["get", "render_height"], 0]],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.88,
    },
  }, labelLayer);
}

function locateOnMap() {
  if (!navigator.geolocation || !window.isSecureContext) {
    setMapState("Location needs a secure website and browser location support.", "error");
    return;
  }
  locateButton.disabled = true;
  setMapState("Waiting for your browser’s location permission…");
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude, accuracy } = position.coords;
    window.dispatchEvent(new CustomEvent("kinguardian:location-found", { detail: {
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : 0,
      capturedAt: Number.isFinite(position.timestamp) ? Math.trunc(position.timestamp) : Date.now(),
      source: "browser location",
    } }));
    addPoint({ id: "my-location", label: "My location", latitude, longitude, kind: "self" });
    map?.flyTo({ center: [longitude, latitude], zoom: 16, pitch: is3d ? 50 : 0, bearing: is3d ? -12 : 0, duration: 1200 });
    const readout = document.querySelector("#location-coordinate-readout");
    if (readout) {
      readout.textContent = `Your location · accuracy about ${Math.round(accuracy)} m · ${new Intl.DateTimeFormat(navigator.language, { dateStyle: "medium", timeStyle: "short" }).format(position.timestamp)}`;
      readout.hidden = false;
    }
    setMapState("Your location is shown on this map only. It has not been shared with trusted people.", "ready");
    locateButton.disabled = false;
  }, (error) => {
    const messages = {
      1: "Location permission was denied. You can allow it in your browser settings and try again.",
      2: "Your device could not find a location. Try again when location is available.",
      3: "Finding your location took too long. Try again.",
    };
    setMapState(messages[error.code] || "Your location could not be found. Try again.", "error");
    locateButton.disabled = false;
  }, { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 });
}

function addPoint(point) {
  if (!point || typeof point.id !== "string" || !point.id || point.id.length > 160
    || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
  if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return;
  if (!map || !MarkerClass || !map.isStyleLoaded()) {
    queueLatestPoint(pendingPoints, point);
    return;
  }
  markers.get(point.id)?.remove();
  const markerElement = document.createElement("div");
  markerElement.className = "map-marker";
  markerElement.dataset.kind = point.kind === "trusted" ? "trusted" : "self";
  markerElement.dataset.stale = String(Boolean(point.stale));
  markerElement.setAttribute("role", "img");
  markerElement.setAttribute("aria-label", point.kind === "trusted" ? `Shared location: ${point.label}` : "Your current location");
  const markerLetter = document.createElement("span");
  markerLetter.textContent = point.kind === "trusted" ? String(point.label || "T").slice(0, 1).toUpperCase() : "•";
  markerElement.append(markerLetter);
  const marker = new MarkerClass({ element: markerElement, anchor: "bottom" })
    .setLngLat([point.longitude, point.latitude])
    .addTo(map);
  markers.set(point.id, marker);
}

function focusPoint(point) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
  if (!map) { pendingFocus = point; return; }
  map.flyTo({ center: [point.longitude, point.latitude], zoom: 16, pitch: is3d ? 50 : 0, duration: 900 });
  setMapState("Showing the latest saved emergency point. Check its update time before relying on it.", "ready");
}

function toggle3d() {
  if (!map) return;
  is3d = !is3d;
  tiltButton.setAttribute("aria-pressed", String(is3d));
  tiltButton.textContent = is3d ? "Turn off 3D view" : "Turn on 3D view";
  map.easeTo({ pitch: is3d ? 50 : 0, bearing: is3d ? -12 : 0, duration: 700 });
  setMapState(is3d ? "3D camera view is on. Buildings appear where map data includes them." : "Flat map view is on.", "ready");
}

function resetMap() {
  if (!map) return;
  is3d = false;
  tiltButton.setAttribute("aria-pressed", "false");
  tiltButton.textContent = "Turn on 3D view";
  map.flyTo({ center: [0, 20], zoom: 2, pitch: 0, bearing: 0, duration: 900 });
  setMapState("Map view reset. Your location was not changed.", "ready");
}

function setMapState(message, kind = "busy") {
  state.textContent = message;
  state.dataset.state = kind;
}
