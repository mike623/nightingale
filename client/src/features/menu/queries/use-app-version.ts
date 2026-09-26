import { useQuery } from '@tanstack/react-query';

import { appVersion } from '@/bridge/platform';
import { APP_VERSION } from '@/shared/query-keys';

/** Version of the running build, or `null` until it has been read. */
export const useAppVersion = (): string | null => {
  const { data } = useQuery({
    queryKey: APP_VERSION,
    queryFn: appVersion,
    staleTime: Infinity,
  });

  return data ?? null;
};
