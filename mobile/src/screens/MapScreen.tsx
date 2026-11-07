import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { ActionButton } from "../components/ActionButton";
import { colors } from "../theme/colors";

type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_USER_AGENT = "KinGuardian/1.0 (https://kinguardian.pages.dev)";
let osmHeaderRegistered = false;

async function loadMapLibre(): Promise<MapLibreModule> {
  // Keep this native package out of app startup. Some low-memory or older
  // devices can still use sign-in and safety features if map support fails.
  const mapLibre = await import("@maplibre/maplibre-react-native");
  if (!osmHeaderRegistered) {
    mapLibre.TransformRequestManager.addHeader({
      id: "kinguardian-osm-identification",
      name: "User-Agent",
      value: OSM_USER_AGENT,
      match: /^https:\/\/tile\.openstreetmap\.org\//u,
    });
    osmHeaderRegistered = true;
  }
  return mapLibre;
}

const BASE_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": "#dfe8e1" } }],
};

export function MapScreen() {
  const [point, setPoint] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [mapLibre, setMapLibre] = useState<MapLibreModule | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function showPosition() {
    setLoading(true); setMessage("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { setMessage("Location permission was not granted. You can still use KinGuardian without showing your position."); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPoint({ latitude: current.coords.latitude, longitude: current.coords.longitude, accuracy: current.coords.accuracy || 0 });
      try {
        const alreadyLoaded = Boolean(mapLibre);
        setMapLibre(await loadMapLibre());
        if (!alreadyLoaded) setMapStatus("loading");
        setMessage("This position is shown on this phone only. The map does not upload it.");
      } catch {
        setMapStatus("error");
        setMessage("Your position was found, but the map could not open on this phone. It is still shown below and is not shared.");
      }
    } catch {
      setMessage("Could not read your location. Check the phone's location setting and try again.");
    } finally { setLoading(false); }
  }

  return <View style={styles.page}>
    <Text style={styles.title}>Map</Text>
    <Text style={styles.copy}>Show your current position on an OpenStreetMap map. This is a one-time foreground location request. It is not shared with trusted people.</Text>
    <ActionButton label={!point ? "Show my position" : mapLibre ? "Update my position" : "Retry map and update my position"} onPress={() => { void showPosition(); }} busy={loading} />
    {loading ? <ActivityIndicator color={colors.green} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    {point ? mapLibre ? <>
      <View style={styles.map}>
        <mapLibre.Map key={mapAttempt} mapStyle={BASE_STYLE} attribution
          onDidFinishLoadingMap={() => setMapStatus("ready")}
          onDidFinishLoadingStyle={() => setMapStatus("ready")}
          onDidFailLoadingMap={() => setMapStatus("error")}>
          <mapLibre.Camera center={[point.longitude, point.latitude]} zoom={15} />
          <mapLibre.RasterSource id="osm-raster" tiles={[OSM_TILE_URL]} tileSize={256} maxzoom={19} attribution="© OpenStreetMap contributors">
            <mapLibre.Layer id="osm-raster-layer" type="raster" />
          </mapLibre.RasterSource>
          <mapLibre.Marker id="current-position" lngLat={[point.longitude, point.latitude]}>
            <View style={styles.marker}><View style={styles.markerDot} /></View>
          </mapLibre.Marker>
        </mapLibre.Map>
        {mapStatus !== "ready" ? <View style={styles.mapFeedback}>
          {mapStatus === "loading" ? <ActivityIndicator color={colors.green} /> : <>
            <Text style={styles.emptyTitle}>The map could not load.</Text>
            <Text style={styles.copy}>Check your internet connection and try again. Your position stays on this phone.</Text>
            <Pressable accessibilityRole="button" onPress={() => { setMapStatus("loading"); setMapAttempt((value) => value + 1); }} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry map</Text>
            </Pressable>
          </>}
        </View> : null}
      </View>
      <Text style={styles.attribution}>© OpenStreetMap contributors · Internet required · No offline tile downloads</Text>
      <Text style={styles.coordinates}>About {Math.round(point.accuracy)} m accuracy · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text>
    </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Map display is unavailable.</Text><Text style={styles.copy}>{message}</Text><Text style={styles.coordinates}>About {Math.round(point.accuracy)} m accuracy · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text></View> : <View style={styles.empty}><Text style={styles.emptyTitle}>Your map stays hidden until you ask for it.</Text><Text style={styles.copy}>Map tiles come from the public OpenStreetMap tile service. It may be unavailable or rate limited; KinGuardian does not download map areas for offline use.</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: 18, paddingTop: 26, gap: 12 },
  title: { color: colors.text, fontWeight: "800", fontSize: 27 },
  copy: { color: colors.muted, lineHeight: 20 },
  message: { color: colors.green, lineHeight: 20 },
  map: { flex: 1, minHeight: 260, borderRadius: 14, overflow: "hidden", borderColor: colors.border, borderWidth: 1, position: "relative" },
  mapFeedback: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 10, padding: 20, backgroundColor: "#f7f7f1ee" },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.greenDark },
  retryText: { color: colors.white, fontWeight: "800" },
  marker: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", borderColor: "#156f43", borderWidth: 2 },
  markerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#156f43" },
  attribution: { color: colors.muted, fontSize: 11, textAlign: "center" },
  coordinates: { color: colors.muted, fontSize: 11, textAlign: "center" },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 8, marginTop: 8 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
