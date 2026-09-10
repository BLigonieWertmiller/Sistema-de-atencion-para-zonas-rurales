import { Audio } from 'expo-av';

/**
 * Graba un clip de voz a un archivo local. El SDK de QVAC decodifica el
 * contenedor de audio internamente (vía su addon @qvac/decoder-audio) antes
 * de pasarlo al motor de transcripción, así que alcanza con entregarle la
 * ruta del archivo grabado — no hace falta convertir a PCM a mano.
 */
export class AudioRecorder {
  private recording: Audio.Recording | null = null;

  async requestPermission(): Promise<boolean> {
    const { granted } = await Audio.requestPermissionsAsync();
    return granted;
  }

  async start(): Promise<void> {
    if (this.recording) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true
    });

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    this.recording = recording;
  }

  /** Detiene la grabación y devuelve la ruta local del archivo de audio. */
  async stop(): Promise<string | null> {
    if (!this.recording) return null;

    await this.recording.stopAndUnloadAsync();
    const uri = this.recording.getURI();
    this.recording = null;

    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    return uri;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }
}
