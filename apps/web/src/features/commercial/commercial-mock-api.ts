import { commercialProjectsMock, defaultWorkflowTemplate } from './mock-data';
import type { CommercialProject, DefaultWorkflowTemplate } from './types';

const LOAD_DELAY_MS = 280;

async function delay(): Promise<void> {
  await new Promise((r) => setTimeout(r, LOAD_DELAY_MS));
}

export type CommercialFetchOptions = {
  simulateError?: boolean;
};

export async function fetchCommercialProjects(
  options: CommercialFetchOptions = {},
): Promise<CommercialProject[]> {
  await delay();
  if (options.simulateError) {
    throw new Error('演示数据暂时读不出来，请稍后重试。');
  }
  return commercialProjectsMock;
}

export async function fetchCommercialProject(
  id: string,
  options: CommercialFetchOptions = {},
): Promise<CommercialProject | null> {
  await delay();
  if (options.simulateError) {
    throw new Error('这个项目没加载出来，请回到列表再试。');
  }
  return commercialProjectsMock.find((p) => p.id === id) ?? null;
}

export async function fetchDefaultWorkflowTemplate(
  options: CommercialFetchOptions = {},
): Promise<DefaultWorkflowTemplate> {
  await delay();
  if (options.simulateError) {
    throw new Error('默认流程模板加载失败。');
  }
  return defaultWorkflowTemplate;
}
