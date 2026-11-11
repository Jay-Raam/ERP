'use client';

import { hasPermission, type Viewer } from '@erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { gqlRequest, restPost } from '@/lib/api-client';

export const VIEWER_QUERY_KEY = ['viewer'] as const;

const ME = /* GraphQL */ `
  query Me {
    me {
      user {
        id
        email
        fullName
      }
      organisation {
        id
        slug
        name
      }
      role {
        key
        name
        dataScope
      }
      permissions
      branches {
        id
        code
        name
        isHeadOffice
      }
    }
  }
`;

export function useViewerQuery() {
  return useQuery({
    queryKey: VIEWER_QUERY_KEY,
    queryFn: async () => (await gqlRequest<{ me: Viewer }>(ME)).me,
    staleTime: 60_000,
    retry: false,
  });
}

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

/** The signed-in user. Only usable under the app layout, which guarantees one exists. */
export function useViewer(): Viewer {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error('useViewer must be used inside the signed-in app layout');
  return viewer;
}

export function usePermission(permission: string): boolean {
  return hasPermission(useViewer().permissions, permission);
}

/**
 * Renders children only when the user holds the permission. This hides
 * controls; the API still checks the same key on every operation.
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await restPost('/auth/logout');
    } catch {
      // Even if the call fails, leave the signed-in area; the cookies expire on their own.
    }
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);
}
