import { addLogEntry, getChecklistItems, getTodayLogEntries, upsertChecklistItem } from '../services/database';
import { getCurrentGeoTag } from '../services/location';
import { buildDailyReportText, generateReportPdf, shareReport } from '../services/report';
import { translateText } from '../services/translate';
import type { ClassifiedIntent, LogEntry } from '../types';

export interface ActionResult {
  /** Texto corto que se muestra en pantalla y se lee por voz como confirmación. */
  confirmation: string;
  entry?: LogEntry;
  reportPdfUri?: string;
}

/**
 * Ejecuta la acción local concreta que corresponde a la intención
 * clasificada. Todo lo que pasa acá es lógica de la app (SQLite, archivos)
 * salvo la traducción, que vuelve a invocar al LLM on-device.
 */
export async function runIntentAction(intent: ClassifiedIntent, llmModelId: string | null): Promise<ActionResult> {
  switch (intent.intent) {
    case 'registrar_nota': {
      const texto = intent.texto?.trim() || '(nota vacía)';
      const location = await getCurrentGeoTag();
      const entry = await addLogEntry('nota', texto, location);
      return { confirmation: 'Nota registrada.', entry };
    }

    case 'marcar_checklist': {
      const label = intent.item_checklist?.trim() || 'ítem sin nombre';
      const done = intent.estado_checklist !== 'pendiente';
      const item = await upsertChecklistItem(label, done);
      const location = await getCurrentGeoTag();
      const entry = await addLogEntry(
        'checklist',
        `${item.label}: ${done ? 'completo' : 'pendiente'}`,
        location
      );
      return {
        confirmation: `${item.label} marcado como ${done ? 'completo' : 'pendiente'}.`,
        entry
      };
    }

    case 'traducir': {
      const texto = intent.texto?.trim() || '';
      const idioma = intent.idioma_destino?.trim() || 'inglés';

      if (!llmModelId) {
        return { confirmation: 'No puedo traducir todavía: el modelo se está cargando.' };
      }

      const traduccion = await translateText(llmModelId, texto, idioma);
      const location = await getCurrentGeoTag();
      const entry = await addLogEntry('traduccion', traduccion, location, {
        textoOriginal: texto,
        idiomaDestino: idioma
      });
      return { confirmation: traduccion, entry };
    }

    case 'generar_reporte': {
      const [entries, checklist] = await Promise.all([getTodayLogEntries(), getChecklistItems()]);
      const reportText = buildDailyReportText(entries, checklist);
      const pdfUri = await generateReportPdf(reportText);
      await shareReport(pdfUri);
      return {
        confirmation: `Reporte generado con ${entries.length} registros de hoy.`,
        reportPdfUri: pdfUri
      };
    }

    default: {
      const exhaustiveCheck: never = intent.intent;
      throw new Error(`Intención desconocida: ${String(exhaustiveCheck)}`);
    }
  }
}
