import { useMemo, useState } from 'react';
import { WorkflowCanvas } from './canvas';
import { WorkflowEntry } from './entry';
import { layoutWithDagre } from './layout';
import { buildMockVersions, type FlowGraph, type VersionId } from './model';

export function WorkflowMockScreen() {
  const seeded = useMemo(() => buildMockVersions(layoutWithDagre), []);
  const [versions, setVersions] = useState(seeded);
  const [versionId, setVersionId] = useState<VersionId>('v1');
  const [open, setOpen] = useState(false);
  const current = versions.find((version) => version.id === versionId) ?? versions[0]!;

  if (!open) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <WorkflowEntry
          versionId={versionId}
          onVersion={setVersionId}
          onOpen={() => setOpen(true)}
        />
      </div>
    );
  }

  return (
    <WorkflowCanvas
      key={current.id}
      label={current.label}
      initial={current.graph}
      onBack={(graph: FlowGraph) => {
        setVersions((items) =>
          items.map((item) => (item.id === current.id ? { ...item, graph } : item)),
        );
        setOpen(false);
      }}
    />
  );
}
