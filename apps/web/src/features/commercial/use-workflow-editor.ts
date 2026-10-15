import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowGraph } from './types';
import {
  advanceWorkflowNode,
  blockWorkflowNode,
  clearWorkflowBlock,
  cloneWorkflowGraph,
  rollbackWorkflowNode,
  type WorkflowEditResult,
} from './workflow-edit-logic';

const MAX_HISTORY = 64;

function applyResult(
  result: WorkflowEditResult,
  setGraph: (g: WorkflowGraph) => void,
  setError: (m: string | null) => void,
  pushHistory: (g: WorkflowGraph) => void,
  current: WorkflowGraph,
): boolean {
  if (!result.ok) {
    setError(result.message);
    return false;
  }
  pushHistory(current);
  setGraph(result.graph);
  setError(null);
  return true;
}

export function useWorkflowEditor(initialGraph: WorkflowGraph) {
  const [graph, setGraph] = useState(() => cloneWorkflowGraph(initialGraph));
  const [past, setPast] = useState<WorkflowGraph[]>([]);
  const [future, setFuture] = useState<WorkflowGraph[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setGraph(cloneWorkflowGraph(initialGraph));
    setPast([]);
    setFuture([]);
    setSelectedNodeId(null);
    setActionError(null);
  }, [initialGraph]);

  const pushHistory = useCallback((snapshot: WorkflowGraph) => {
    setPast((p) => [...p.slice(-MAX_HISTORY + 1), cloneWorkflowGraph(snapshot)]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      setGraph((current) => {
        setFuture((f) => [cloneWorkflowGraph(current), ...f]);
        setActionError(null);
        return cloneWorkflowGraph(previous);
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setGraph((current) => {
        setPast((p) => [...p, cloneWorkflowGraph(current)]);
        setActionError(null);
        return cloneWorkflowGraph(next);
      });
      return f.slice(1);
    });
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const advance = useCallback(
    (nodeId: string) => {
      applyResult(advanceWorkflowNode(graph, nodeId), setGraph, setActionError, pushHistory, graph);
    },
    [graph, pushHistory],
  );

  const rollback = useCallback(
    (nodeId: string) => {
      applyResult(
        rollbackWorkflowNode(graph, nodeId),
        setGraph,
        setActionError,
        pushHistory,
        graph,
      );
    },
    [graph, pushHistory],
  );

  const block = useCallback(
    (nodeId: string, reason: string) => {
      applyResult(
        blockWorkflowNode(graph, nodeId, reason),
        setGraph,
        setActionError,
        pushHistory,
        graph,
      );
    },
    [graph, pushHistory],
  );

  const clearBlock = useCallback(
    (nodeId: string) => {
      applyResult(clearWorkflowBlock(graph, nodeId), setGraph, setActionError, pushHistory, graph);
    },
    [graph, pushHistory],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (canUndo) undo();
      } else if (event.key === 'z' && event.shiftKey) {
        event.preventDefault();
        if (canRedo) redo();
      } else if (event.key === 'y') {
        event.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  return useMemo(
    () => ({
      graph,
      selectedNodeId,
      setSelectedNodeId,
      advance,
      rollback,
      block,
      clearBlock,
      undo,
      redo,
      canUndo,
      canRedo,
      actionError,
      clearActionError: () => setActionError(null),
    }),
    [
      graph,
      selectedNodeId,
      advance,
      rollback,
      block,
      clearBlock,
      undo,
      redo,
      canUndo,
      canRedo,
      actionError,
    ],
  );
}
