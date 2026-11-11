import { useState } from "react";
import {
  View,
  Text,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";

function apiBase(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(":")[0] ?? "localhost";
  return `http://${host}:3000`;
}

export default function App() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  async function checkServer() {
    try {
      const res = await fetch(`${apiBase()}/api/health`);
      setServerOk(res.ok);
    } catch {
      setServerOk(false);
    }
  }

  async function handleAsset(asset: ImagePicker.ImagePickerAsset) {
    setImageUri(asset.uri);
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const base64 = asset.base64;
      if (!base64) throw new Error("No base64 from picker");

      const res = await fetch(`${apiBase()}/api/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: base64 }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      setResult(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera permission denied");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (!r.canceled && r.assets[0]) handleAsset(r.assets[0]);
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Library permission denied");
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (!r.canceled && r.assets[0]) handleAsset(r.assets[0]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Extract</Text>
      <Text style={styles.subtitle}>{apiBase()}</Text>

      <View style={styles.row}>
        <Button title="Check server" onPress={checkServer} />
        {serverOk !== null && (
          <Text style={serverOk ? styles.ok : styles.err}>
            {serverOk ? "reachable" : "unreachable"}
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <Button title="Take photo" onPress={takePhoto} />
        <Button title="Pick image" onPress={pickFromLibrary} />
      </View>

      {imageUri && <Image source={{ uri: imageUri }} style={styles.image} />}

      {loading && (
        <ActivityIndicator size="large" style={{ marginVertical: 12 }} />
      )}

      {error && <Text style={styles.err}>{error}</Text>}

      {result && (
        <ScrollView style={styles.result}>
          <Text style={styles.hash}>
            hash {result.doc_hash.slice(0, 12)}…
            {result.from_correction ? "  (from correction)" : ""}
          </Text>
          <Text style={styles.json}>
            {JSON.stringify(result.extraction, null, 2)}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "600" },
  subtitle: {
    fontSize: 11,
    color: "#666",
    marginBottom: 12,
    fontFamily: "monospace",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 6,
  },
  ok: { color: "green", fontSize: 12 },
  err: { color: "red", fontSize: 12, marginVertical: 6 },
  image: {
    width: 160,
    height: 200,
    alignSelf: "center",
    marginVertical: 8,
    resizeMode: "contain",
  },
  result: {
    flex: 1,
    backgroundColor: "#f4f4f4",
    padding: 12,
    borderRadius: 6,
    marginTop: 8,
  },
  hash: {
    fontSize: 10,
    color: "#666",
    fontFamily: "monospace",
    marginBottom: 6,
  },
  json: { fontSize: 11, fontFamily: "monospace" },
});
