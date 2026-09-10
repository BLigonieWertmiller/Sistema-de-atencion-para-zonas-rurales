import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { textToSpeech } from '@qvac/sdk';

import { buildMonoPcm16Wav } from './wav';

const SUPERTONIC_SAMPLE_RATE = 44100;

/**
 * Confirma una acción por voz. Primero intenta el TTS on-device de QVAC
 * (Supertonic, multilingüe); si el modelo TTS no llegó a cargar (por
 * ejemplo, todavía se está descargando) cae a la voz nativa del sistema
 * (`expo-speech`) para que la confirmación hablada nunca falle en demo.
 */
export async function speakConfirmation(ttsModelId: string | null, text: string): Promise<void> {
  if (!ttsModelId) {
    Speech.speak(text, { language: 'es-ES' });
    return;
  }

  try {
    const result = textToSpeech({
      modelId: ttsModelId,
      text,
      inputType: 'text',
      stream: false
    });
    const samples = await result.buffer;

    const wavBytes = buildMonoPcm16Wav(samples, SUPERTONIC_SAMPLE_RATE);
    const file = new File(Paths.cache, `agente-tts-${Date.now()}.wav`);
    file.write(wavBytes);

    const { sound } = await Audio.Sound.createAsync({ uri: file.uri }, { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch (error) {
    console.warn('QVAC TTS falló, usando voz del sistema como respaldo:', error);
    Speech.speak(text, { language: 'es-ES' });
  }
}
