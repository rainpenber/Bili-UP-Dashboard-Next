import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBiliAccount,
  fetchBiliAccounts,
  patchBiliAccount,
  revokeBiliAccount,
  verifyBiliAccount,
} from '@/api/accounts-client';
import type { CreateBiliAccountRequest, PatchBiliAccountRequest } from '@studio/contracts';

export const biliAccountsQueryKey = ['accounts', 'bili'] as const;

export function useBiliAccountsQuery(enabled = true) {
  return useQuery({
    queryKey: biliAccountsQueryKey,
    queryFn: fetchBiliAccounts,
    enabled,
  });
}

export function useCreateBiliAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBiliAccountRequest) => createBiliAccount(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: biliAccountsQueryKey });
    },
  });
}

export function usePatchBiliAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: PatchBiliAccountRequest }) =>
      patchBiliAccount(input.id, input.patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: biliAccountsQueryKey });
    },
  });
}

export function useRevokeBiliAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeBiliAccount(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: biliAccountsQueryKey });
    },
  });
}

export function useVerifyBiliAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => verifyBiliAccount(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: biliAccountsQueryKey });
    },
  });
}
