import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  readCachedMedia,
  readCachedPages,
  type CachedMediaOption,
  type CachedPageOption,
} from "./cmsCacheReader";
import {
  isMediaSessionAvailable,
  isPagesSessionAvailable,
  subscribeSessionMarkers,
} from "./sessionMarkers";

export function useCachedCmsMedia(): {
  sessionAvailable: boolean;
  cacheHasData: boolean;
  items: CachedMediaOption[];
  refreshFromCache: () => void;
} {
  const qc = useQueryClient();
  const [sessionAvailable, setSessionAvailable] = useState(isMediaSessionAvailable);
  const [items, setItems] = useState<CachedMediaOption[]>([]);
  const [cacheHasData, setCacheHasData] = useState(false);

  const refreshFromCache = useCallback(() => {
    const result = readCachedMedia(qc);
    setItems(result.items);
    setCacheHasData(result.available);
  }, [qc]);

  useEffect(() => {
    setSessionAvailable(isMediaSessionAvailable());
    refreshFromCache();
    const unsubMarker = subscribeSessionMarkers(() => {
      setSessionAvailable(isMediaSessionAvailable());
      refreshFromCache();
    });
    // Cache subscription — local only, no refetch
    const unsubCache = qc.getQueryCache().subscribe(() => {
      if (isMediaSessionAvailable()) refreshFromCache();
    });
    return () => {
      unsubMarker();
      unsubCache();
    };
  }, [qc, refreshFromCache]);

  return {
    sessionAvailable,
    cacheHasData: sessionAvailable && cacheHasData,
    items: sessionAvailable ? items : [],
    refreshFromCache,
  };
}

export function useCachedCmsPages(): {
  sessionAvailable: boolean;
  cacheHasData: boolean;
  items: CachedPageOption[];
  refreshFromCache: () => void;
} {
  const qc = useQueryClient();
  const [sessionAvailable, setSessionAvailable] = useState(isPagesSessionAvailable);
  const [items, setItems] = useState<CachedPageOption[]>([]);
  const [cacheHasData, setCacheHasData] = useState(false);

  const refreshFromCache = useCallback(() => {
    const result = readCachedPages(qc);
    setItems(result.items);
    setCacheHasData(result.available);
  }, [qc]);

  useEffect(() => {
    setSessionAvailable(isPagesSessionAvailable());
    refreshFromCache();
    const unsubMarker = subscribeSessionMarkers(() => {
      setSessionAvailable(isPagesSessionAvailable());
      refreshFromCache();
    });
    const unsubCache = qc.getQueryCache().subscribe(() => {
      if (isPagesSessionAvailable()) refreshFromCache();
    });
    return () => {
      unsubMarker();
      unsubCache();
    };
  }, [qc, refreshFromCache]);

  return {
    sessionAvailable,
    cacheHasData: sessionAvailable && cacheHasData,
    items: sessionAvailable ? items : [],
    refreshFromCache,
  };
}

import { readCachedForms, type CachedFormOption } from "./cmsCacheReader";
import { isFormsSessionAvailable } from "./sessionMarkers";

export function useCachedCmsForms(): {
  sessionAvailable: boolean;
  cacheHasData: boolean;
  items: CachedFormOption[];
  refreshFromCache: () => void;
} {
  const qc = useQueryClient();
  const [sessionAvailable, setSessionAvailable] = useState(isFormsSessionAvailable);
  const [items, setItems] = useState<CachedFormOption[]>([]);
  const [cacheHasData, setCacheHasData] = useState(false);

  const refreshFromCache = useCallback(() => {
    const result = readCachedForms(qc);
    setItems(result.items);
    setCacheHasData(result.available);
  }, [qc]);

  useEffect(() => {
    setSessionAvailable(isFormsSessionAvailable());
    refreshFromCache();
    const unsubMarker = subscribeSessionMarkers(() => {
      setSessionAvailable(isFormsSessionAvailable());
      refreshFromCache();
    });
    const unsubCache = qc.getQueryCache().subscribe(() => {
      if (isFormsSessionAvailable()) refreshFromCache();
    });
    return () => {
      unsubMarker();
      unsubCache();
    };
  }, [qc, refreshFromCache]);

  return {
    sessionAvailable,
    cacheHasData: sessionAvailable && cacheHasData,
    items: sessionAvailable ? items : [],
    refreshFromCache,
  };
}

import { readCachedFormSubmissionCount } from "./cmsCacheReader";

export function useCachedFormSubmissionCount(formId: number | null | undefined): {
  available: boolean;
  count: number | null;
  source: "CMS CACHE" | null;
} {
  const qc = useQueryClient();
  const [state, setState] = useState<{ available: boolean; count: number | null; source: "CMS CACHE" | null }>({
    available: false,
    count: null,
    source: null,
  });

  const refresh = useCallback(() => {
    if (formId == null) {
      setState({ available: false, count: null, source: null });
      return;
    }
    setState(readCachedFormSubmissionCount(qc, formId));
  }, [qc, formId]);

  useEffect(() => {
    refresh();
    const unsub = qc.getQueryCache().subscribe(() => refresh());
    return () => unsub();
  }, [qc, refresh]);

  return state;
}
