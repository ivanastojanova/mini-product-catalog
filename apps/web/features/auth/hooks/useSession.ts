"use client";

import { useQuery } from "@tanstack/react-query";

import { getSession } from "@/features/auth/api/auth";
import { authKeys } from "@/features/auth/queries/authKeys";

/** The logged-in customer, or `null` if logged out. `undefined` data means still loading. */
export function useSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: getSession,
    // Session state rarely changes outside of login/logout, which already
    // update this query's cache directly — no need to poll or refetch on
    // every window focus.
    staleTime: 1000 * 60 * 5,
  });
}
