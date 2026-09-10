import * as Location from 'expo-location';

import type { GeoTag } from '../types';

/**
 * Devuelve la última ubicación conocida sin bloquear la UI esperando un fix
 * GPS nuevo (típico en zonas rurales con señal débil). Si no hay permiso o
 * no hay ubicación disponible, devuelve null y el registro se guarda igual,
 * sin geoetiqueta.
 */
export async function getCurrentGeoTag(): Promise<GeoTag | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }

    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });
    return { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
  } catch {
    return null;
  }
}
