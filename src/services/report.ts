import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { ChecklistItem, LogEntry } from '../types';

const TYPE_LABELS: Record<LogEntry['type'], string> = {
  nota: 'Nota',
  traduccion: 'Traducción',
  checklist: 'Checklist',
  reporte: 'Reporte',
  sos: 'SOS'
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Arma el reporte del día en texto plano, sin depender de red ni del LLM. */
export function buildDailyReportText(entries: LogEntry[], checklist: ChecklistItem[]): string {
  const today = new Date().toLocaleDateString('es-AR');
  const lines: string[] = [`Reporte de campo — ${today}`, ''];

  if (entries.length === 0) {
    lines.push('Sin registros todavía en el día de hoy.');
  } else {
    for (const entry of entries) {
      const geo = entry.latitude != null && entry.longitude != null
        ? ` (${entry.latitude.toFixed(5)}, ${entry.longitude.toFixed(5)})`
        : '';
      lines.push(`[${formatTime(entry.createdAt)}] ${TYPE_LABELS[entry.type]}: ${entry.text}${geo}`);
    }
  }

  lines.push('', 'Checklist:');
  if (checklist.length === 0) {
    lines.push('  (sin ítems)');
  } else {
    for (const item of checklist) {
      lines.push(`  [${item.done ? 'x' : ' '}] ${item.label}`);
    }
  }

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Genera un PDF simple del reporte y devuelve la ruta local del archivo. */
export async function generateReportPdf(reportText: string): Promise<string> {
  const html = `
    <html>
      <body style="font-family: -apple-system, Roboto, sans-serif; padding: 24px;">
        <pre style="white-space: pre-wrap; font-size: 14px;">${escapeHtml(reportText)}</pre>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return uri;
}

export async function shareReport(pdfUri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(pdfUri);
  }
}
