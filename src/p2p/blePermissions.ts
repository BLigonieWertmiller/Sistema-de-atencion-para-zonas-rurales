import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Bluetooth en Android 12+ (API 31+) requiere permisos de runtime
 * ("dispositivos cercanos") además de estar declarados en el manifest —
 * `app.json` los declara, pero eso solo habilita que se puedan pedir, no
 * los otorga. Sin este paso, `bare-bluetooth-android` no hace ningún check
 * ni pedido propio (llama directo a la API nativa de BLE), así que el
 * escaneo/advertising fallaría en silencio o con `SecurityException`.
 *
 * En Android < 12, BLE scan requiere en cambio permiso de ubicación —ya
 * lo pedimos para geoetiquetar, pero acá nos aseguramos de que esté
 * otorgado antes de arrancar el swarm, no después—. En iOS no hace falta
 * nada explícito: el sistema muestra el prompt de Bluetooth automáticamente
 * la primera vez que se usa `CBCentralManager`/`CBPeripheralManager`.
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    if (Platform.Version >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE
      ]);
      return Object.values(results).every((status) => status === PermissionsAndroid.RESULTS.GRANTED);
    }

    const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return status === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.warn('No se pudieron pedir los permisos de Bluetooth:', error);
    return false;
  }
}
