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
      ? health.data.status === 'ok'
        ? '数据服务正常'
        : '数据服务有响应，但状态不对'
      : health.status === 'error'
        ? '数据服务暂时连不上'
        : '正在检查数据服务…';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="info" className="cursor-default font-normal">
            本地数据 · 不连 B 站
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
