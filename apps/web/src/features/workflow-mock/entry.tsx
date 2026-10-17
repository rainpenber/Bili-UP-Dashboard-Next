import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VersionId } from './model';

const OPTIONS: { id: VersionId; label: string }[] = [
  { id: 'v1', label: 'V1' },
  { id: 'v2', label: 'V2' },
  { id: 'v3', label: 'V3' },
];

export function WorkflowEntry({
  versionId,
  onVersion,
  onOpen,
}: {
  versionId: VersionId;
  onVersion: (id: VersionId) => void;
  onOpen: () => void;
}) {
  return (
    <Card className="w-full max-w-xs" data-testid="workflow-mock-entry">
      <CardHeader>
        <CardTitle>流程</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
          aria-label="版本"
          data-testid="workflow-mock-version"
          value={versionId}
          onChange={(event) => onVersion(event.target.value as VersionId)}
        >
          {OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Button type="button" className="w-full" onClick={onOpen}>
          打开
        </Button>
      </CardContent>
    </Card>
  );
}
