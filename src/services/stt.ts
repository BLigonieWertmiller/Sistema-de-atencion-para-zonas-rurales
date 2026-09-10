import { transcribe } from '@qvac/sdk';

/**
 * Transcribe un clip de audio local a texto usando Whisper on-device.
 * `audioChunk` acepta una ruta de archivo (ver ejemplo oficial
 * `examples/asr/whispercpp-filesystem.ts`), que es exactamente lo que
 * produce `AudioRecorder.stop()`.
 */
export async function transcribeAudioFile(sttModelId: string, audioFileUri: string): Promise<string> {
  const segments = await transcribe({
    modelId: sttModelId,
    audioChunk: audioFileUri,
    metadata: true
  });

  return segments
    .map((segment) => segment.text)
    .join('')
    .trim();
}
