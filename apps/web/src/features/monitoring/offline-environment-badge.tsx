import { useQuery } from '@tanstack/react-query';
import { parseHealthResponse } from '@studio/contracts';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const HEALTH_URL = import.meta.env.VITE_API_HEALTH_URL ?? '/api/health';

async function fetchHealth() {
  const res = await fetch(HEALTH_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseHealthResponse(await res.json());
}

export function OfflineEnvironmentBadge() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const detail =
    health.status === 'success'
      ? `API ${health.data.status} · ${health.data.service} v${health.data.version}`
      : health.status === 'error'
        ? `API 不可用：${health.error instanceof Error ? health.error.message : '未知错误'}`
        : '正在检测 API…';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="info" className="cursor-default font-normal">
            离线 CSV · 不访问 B 站
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
