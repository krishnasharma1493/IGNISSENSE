import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Hotspot, Facility, Classification, Alert, AnalyticsSummary } from '../types';

// -- Live NASA FIRMS Synchronization --

export function useSyncFirms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options?: { scope?: string; dayRange?: number }) => {
      const res = await api.post('/ingestion/firms', {
        scope: options?.scope || 'india',
        dayRange: options?.dayRange || 2,
      });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotspots'] });
      queryClient.invalidateQueries({ queryKey: ['all-classifications'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['temporal-trend'] });
      queryClient.invalidateQueries({ queryKey: ['ingestion-status'] });
    },
  });
}

// -- Hotspots --

export function useHotspots(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['hotspots', params],
    queryFn: async () => {
      const res = await api.get('/hotspots', { params });
      return res.data.data as { hotspots: Hotspot[]; count: number };
    },
    refetchInterval: 60000,
  });
}

export function useHotspot(id: string | null) {
  return useQuery({
    queryKey: ['hotspot', id],
    queryFn: async () => {
      const res = await api.get(`/hotspots/${id}`);
      return res.data.data as Hotspot;
    },
    enabled: !!id,
  });
}

// -- Facilities --

export function useFacilities(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['facilities', params],
    queryFn: async () => {
      const res = await api.get('/facilities', { params });
      return res.data.data as { facilities: Facility[]; count: number };
    },
  });
}

export function useNearbyFacilities(lng: number | null, lat: number | null, radius = 5000) {
  return useQuery({
    queryKey: ['facilities-nearby', lng, lat, radius],
    queryFn: async () => {
      const res = await api.get('/facilities/nearby', {
        params: { longitude: lng, latitude: lat, radius },
      });
      return res.data.data as { facilities: Facility[]; count: number };
    },
    enabled: lng !== null && lat !== null,
  });
}

// -- Classification --

export function useClassification(hotspotId: string | null) {
  return useQuery({
    queryKey: ['classification', hotspotId],
    queryFn: async () => {
      const res = await api.get(`/classifications/${hotspotId}`);
      return res.data.data as Classification;
    },
    enabled: !!hotspotId,
  });
}

// -- Alerts --

export function useAlerts(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['alerts', params],
    queryFn: async () => {
      const res = await api.get('/alerts', { params });
      return res.data.data as { alerts: Alert[]; count: number };
    },
    refetchInterval: 30000,
  });
}

export function useUpdateAlertStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'open' | 'acknowledged' | 'resolved' }) => {
      const res = await api.patch(`/alerts/${id}`, { status });
      return res.data.data as Alert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] });
    },
  });
}


// -- Analytics & Real Provenance --

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics-summary'],
    queryFn: async () => {
      const res = await api.get('/analytics/summary');
      return res.data.data as AnalyticsSummary & {
        lastDataUpdate: string | null;
        latestObservationMetadata?: {
          satellite: string;
          instrument: string;
          version: string;
        } | null;
        modelVersion: string;
      };
    },
    refetchInterval: 30000,
  });
}

export function useTemporalTrend(days = 7) {
  return useQuery({
    queryKey: ['temporal-trend', days],
    queryFn: async () => {
      const res = await api.get('/analytics/temporal-trend', { params: { days: String(days) } });
      return res.data.data as {
        daysRequested: number;
        points: Array<{
          date: string;
          count: number;
          meanFrp: number;
          maxFrp: number;
        }>;
      };
    },
    refetchInterval: 60000,
  });
}

export function useHotspotHistory(hotspotId: string | null) {
  return useQuery({
    queryKey: ['hotspot-history', hotspotId],
    queryFn: async () => {
      const res = await api.get(`/analytics/hotspot-history/${hotspotId}`);
      return res.data.data as {
        hotspotId: string;
        totalHistoricalPasses: number;
        points: Array<{
          hotspotId: string;
          detectedAt: string;
          frp: number;
          brightness: number;
          satellite: string;
          instrument: string;
          dayNight: string;
          distanceMeters: number;
          isCurrentSelection: boolean;
        }>;
      };
    },
    enabled: !!hotspotId,
  });
}

export function useIngestionStatus() {
  return useQuery({
    queryKey: ['ingestion-status'],
    queryFn: async () => {
      const res = await api.get('/ingestion/status');
      return res.data.data as {
        latestLog: any;
        totalLogs: number;
      };
    },
    refetchInterval: 60000,
  });
}

export interface SystemStatusData {
  firmsConnected: boolean;
  lastSuccessfulPoll: string | null;
  lastNewObservationAt: string | null;
  lastProcessedObservationAt: string | null;
  newObservationsLastPoll: number;
  pollStatusMessage: string;
  sensorsQueried: string[];
  modelVersion: string;
  modelStatus: 'ready' | 'unavailable';
  databaseStatus: 'connected' | 'disconnected';
  enrichmentStatus: { osm: string; landCover: string };
  demoMode: boolean;
  counts: {
    totalHotspots: number;
    totalFacilities: number;
    totalClassifications: number;
    openAlerts: number;
  };
  timestamp: string;
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await api.get('/system/status');
      return res.data.data as SystemStatusData;
    },
    refetchInterval: 15000,
  });
}


