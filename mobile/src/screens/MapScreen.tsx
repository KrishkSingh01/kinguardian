import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { ActionButton } from "../components/ActionButton";
import { colors } from "../theme/colors";

type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

async function loadMapLibre(): Promise<MapLibreModule> {
  // Keep this native package out of app startup. Some low-memory or older
  // devices can still use sign-in and safety features if map support fails.
  return import("@maplibre/maplibre-react-native");
}

export function MapScreen() {
  const [point, setPoint] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [mapLibre, setMapLibre] = useState<MapLibreModule | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!point || !mapLibre || mapLoaded || mapFailed) return undefined;
    const timer = setTimeout(() => {
      setMapFailed(true);
      setMessage("Map data did not respond. Your internet may still work while the free map service is unavailable or blocked.");
    }, 15_000);
    return () => clearTimeout(timer);
  }, [point, mapLibre, mapLoaded, mapFailed, mapAttempt]);

  async function showPosition() {
    setLoading(true); setMessage("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { setMessage("Location permission was not granted. You can still use KinGuardian without showing your position."); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPoint({ latitude: current.coords.latitude, longitude: current.coords.longitude, accuracy: current.coords.accuracy || 0 });
      try {
        setMapLoaded(false);
        setMapFailed(false);
        setMapLibre(await loadMapLibre());
        setMessage("Location found. Loading the map… Your location stays on this phone.");
      } catch {
        setMapFailed(true);
        setMessage("Your location was found, but the map renderer could not start. The coordinates stay on this phone and are not shared.");
      }
    } catch {
      setMessage("Could not read your location. Check the phone's location setting and try again.");
    } finally { setLoading(false); }
  }

  async function retryMap() {
    setLoading(true); setMapLoaded(false); setMapFailed(false);
    setMessage("Retrying the map…");
    try {
      setMapLibre(await loadMapLibre());
      setMapAttempt((value) => value + 1);
    } catch {
      setMapFailed(true);
      setMessage("The map renderer could not start. Your internet may work while the map service or browser network is unavailable.");
    } finally { setLoading(false); }
  }

  return <View style={styles.page}>
    <Text style={styles.title}>Map</Text>
    <Text style={styles.copy}>Show your current position on an OpenFreeMap map. This is a one-time foreground location request. It is not shared with trusted people.</Text>
    <ActionButton label={point ? "Update my position" : "Show my position"} onPress={() => { void showPosition(); }} busy={loading} />
    {loading ? <ActivityIndicator color={colors.green} /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    {point ? mapLibre ? <>
      <View style={styles.map}>
        <mapLibre.Map key={mapAttempt} mapStyle={MAP_STYLE_URL} attribution androidView="texture"
          onDidFinishLoadingMap={() => { setMapLoaded(true); setMapFailed(false); setMessage("Map loaded. Your location is shown on this phone only."); }}
          onDidFailLoadingMap={() => { setMapLoaded(false); setMapFailed(true); setMessage("Map data could not load. Your internet may still work; the free map service may be unavailable or blocked."); }}>
          <mapLibre.Camera center={[point.longitude, point.latitude]} zoom={15} />
          <mapLibre.Marker id="current-position" lngLat={[point.longitude, point.latitude]}>
            <View style={styles.marker}><View style={styles.markerDot} /></View>
          </mapLibre.Marker>
        </mapLibre.Map>
        {!mapLoaded || mapFailed ? <View style={styles.mapOverlay}>
          {mapFailed ? <Text style={styles.mapOverlayText}>Map could not load. Your coordinates are still shown below.</Text> : <ActivityIndicator color={colors.green} />}
        </View> : null}
      </View>
      {mapFailed ? <ActionButton label="Retry map" onPress={() => { void retryMap(); }} busy={loading} /> : null}
      <Text style={styles.attribution}>Map tiles by OpenFreeMap · © OpenStreetMap contributors · Internet required · No offline tile downloads</Text>
      <Text style={styles.coordinates}>About {Math.round(point.accuracy)} m accuracy · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text>
    </> : <View style={styles.empty}><Text style={styles.emptyTitle}>Map display is unavailable.</Text><Text style={styles.copy}>{message}</Text><Text style={styles.coordinates}>About {Math.round(point.accuracy)} m accuracy · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text><ActionButton label="Retry map" onPress={() => { void retryMap(); }} busy={loading} /></View> : <View style={styles.empty}><Text style={styles.emptyTitle}>Your map stays hidden until you ask for it.</Text><Text style={styles.copy}>Map tiles come from the free OpenFreeMap service. The map needs internet access; KinGuardian does not download map areas for offline use.</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: 18, paddingTop: 26, gap: 12 },
  title: { color: colors.text, fontWeight: "800", fontSize: 27 },
  copy: { color: colors.muted, lineHeight: 20 },
  message: { color: colors.green, lineHeight: 20 },
  map: { flex: 1, minHeight: 260, borderRadius: 14, overflow: "hidden", borderColor: colors.border, borderWidth: 1 },
  mapOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#dfe8e1cc" },
  mapOverlayText: { color: colors.text, textAlign: "center", lineHeight: 20 },
  marker: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff", borderColor: "#156f43", borderWidth: 2 },
  markerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#156f43" },
  attribution: { color: colors.muted, fontSize: 11, textAlign: "center" },
  coordinates: { color: colors.muted, fontSize: 11, textAlign: "center" },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 8, marginTop: 8 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
