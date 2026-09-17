import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';

import type { ApiClientError } from './api';

/** Thin `useSWR` wrapper pinning the error type to `ApiClientError` instead of `any`. */
export function useApiSWR<T>(
  key: unknown[] | null,
  fetcher: () => Promise<T>,
  config?: SWRConfiguration<T, ApiClientError>,
): SWRResponse<T, ApiClientError> {
  return useSWR<T, ApiClientError>(key, fetcher, config);
}
