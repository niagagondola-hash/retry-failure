import { paymentClient } from './setup';

export async function getMetricsText(): Promise<string> {
  const { data } = await paymentClient.get<string>('/metrics', {
    headers: { Accept: 'text/plain' },
    transformResponse: [(d: string) => d],
  });
  return data;
}

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export function parseMetrics(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-z_]+)(?:\{([^}]*)\})?\s+([\d.]+)/);
    if (!match) continue;
    const [, name, labelsStr, valueStr] = match;
    const labels: Record<string, string> = {};
    if (labelsStr) {
      for (const pair of labelsStr.split(',')) {
        const [k, v] = pair.split('=');
        if (k && v) labels[k.trim()] = v.replace(/"/g, '');
      }
    }
    samples.push({ name, labels, value: parseFloat(valueStr) });
  }
  return samples;
}

export async function getMetric(name: string, labelFilter: Record<string, string> = {}): Promise<number> {
  const text = await getMetricsText();
  const samples = parseMetrics(text).filter(
    (s) => s.name === name && Object.entries(labelFilter).every(([k, v]) => s.labels[k] === v)
  );
  return samples.reduce((sum, s) => sum + s.value, 0);
}
