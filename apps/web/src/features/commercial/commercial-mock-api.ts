import { commercialProjectsMock, defaultWorkflowTemplate } from './mock-data';
import type { CommercialProject, DefaultWorkflowTemplate } from './types';

const LOAD_DELAY_MS = 280;

function shouldSimulateError(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('commercialMockError') === '1';
}

async function delay(): Promise<void> {
  await new Promise((r) => setTimeout(r, LOAD_DELAY_MS));
}

export async function fetchCommercialProjects(): Promise<CommercialProject[]> {
  await delay();
  if (shouldSimulateError()) {
    throw new Error('演示数据暂时读不出来，请稍后重试。');
  }
  return commercialProjectsMock;
}

export async function fetchCommercialProject(id: string): Promise<CommercialProject | null> {
  await delay();
  if (shouldSimulateError()) {
    throw new Error('项目详情加载失败，请返回列表重试。');
  }
  return commercialProjectsMock.find((p) => p.id === id) ?? null;
}

export async function fetchDefaultWorkflowTemplate(): Promise<DefaultWorkflowTemplate> {
  await delay();
  if (shouldSimulateError()) {
    throw new Error('默认流程模板加载失败。');
  }
  return defaultWorkflowTemplate;
}
