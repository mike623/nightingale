import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { loadRemoteImports, submitRemoteImport } from '@/bridge/remote-control';
import { t } from '@/i18n';

const REMOTE_IMPORTS = ['remote-imports'];

/** A download moves without anything telling this page, so it polls while open. */
const IMPORTS_POLL_MS = 3000;

/**
 * The host's import queue. Errors when the host has phone imports turned off,
 * which is how the page learns whether to offer the tab at all.
 */
export const useRemoteImports = () =>
  useQuery({
    queryKey: REMOTE_IMPORTS,
    queryFn: loadRemoteImports,
    retry: false,
    refetchInterval: (data) => (data === undefined ? false : IMPORTS_POLL_MS),
  });

export const useRemoteImportAllowed = (): boolean => useRemoteImports().data !== undefined;

export const useSubmitRemoteImport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitRemoteImport,
    onSuccess: (queued) => {
      void queryClient.invalidateQueries({ queryKey: REMOTE_IMPORTS });
      toast.success(t('remote.import.queued', { title: queued.title }));
    },
    onError: (error: Error) =>
      toast.error(t('remote.import.submitFailed', { error: error.message })),
  });
};
