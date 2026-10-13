import { useEffect, useState } from 'react';
import {
  resolveChartColors,
  subscribeChartColorUpdates,
  type ResolvedChartColors,
} from '@/lib/chart-colors';

export function useResolvedChartColors(): ResolvedChartColors {
  const [colors, setColors] = useState<ResolvedChartColors>(() =>
    typeof document !== 'undefined'
      ? resolveChartColors()
      : {
          series: ['#888', '#888', '#888', '#888', '#888'],
          foreground: '#111',
          mutedForeground: '#666',
          border: '#ccc',
          background: '#fff',
        },
  );

  useEffect(() => {
    setColors(resolveChartColors());
    return subscribeChartColorUpdates(() => setColors(resolveChartColors()));
  }, []);

  return colors;
}
