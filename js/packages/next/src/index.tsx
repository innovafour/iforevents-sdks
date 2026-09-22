"use client";

import { IforeventsProvider as BaseProvider, useIforevents, type IforeventsProviderProps } from "@iforevents/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export * from "@iforevents/react";

export interface NextIforeventsProviderProps extends IforeventsProviderProps {
  /** Send a page view on every App Router navigation. Default true. */
  trackPageViews?: boolean;
  children?: ReactNode;
}

function PageViews() {
  const client = useIforevents();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!pathname) return;
    const toRoute = search ? `${pathname}?${search}` : pathname;
    if (previous.current === toRoute) return;
    void client.page(pathname, { search }, { navigationType: previous.current === undefined ? "load" : "route", previousRoute: previous.current, toRoute });
    previous.current = toRoute;
  }, [client, pathname, search]);
  return null;
}

/**
 * App Router provider: creates the browser client once and sends a page view
 * per navigation (`usePathname` + `useSearchParams`). Put it in `app/layout.tsx`.
 */
export function IforeventsProvider({ trackPageViews = true, children, ...rest }: NextIforeventsProviderProps) {
  return (
    <BaseProvider {...rest}>
      {trackPageViews ? <PageViews /> : null}
      {children}
    </BaseProvider>
  );
}
