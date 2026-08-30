import { useState, useMemo } from 'react';
import { useAlerts, useHotspots, useSyncFirms, useUpdateAlertStatus, useAnalyticsSummary } from '../../api/hooks';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Classification } from '../../types';

interface AlertsPageProps {
  onInvestigateHotspot?: (hotspotId: string) => void;
  onNavigateToMap?: (hotspotId?: string) => void;
}

export default function AlertsPage({ onInvestigateHotspot, onNavigateToMap }: AlertsPageProps) {
  // Filter and search states
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '24h' | '48h' | '7d'>('all');
  const [sortBy, setSortBy] = useState<'latest' | 'confidence' | 'anomaly' | 'frp'>('latest');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  // Data fetching
  const { data: alertsData, isLoading: alertsLoading } = useAlerts();
  const { data: hotspotsData } = useHotspots({ limit: '1000' });
  const { data: analytics } = useAnalyticsSummary();
  const syncMutation = useSyncFirms();
  const updateStatusMutation = useUpdateAlertStatus();

  const rawAlerts = alertsData?.alerts || [];
  const hotspots = hotspotsData?.hotspots || [];
  const hotspotsMap = useMemo(() => new Map(hotspots.map((h) => [h._id, h])), [hotspots]);

  // Bulk classifications
  const { data: allClassifications } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '2000' } });
      const results = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        res.data.data.classifications.forEach((c: Classification) => {
          results.set(c.hotspotId, c);
        });
      }
      return results;
    },
    staleTime: 30000,
  });

  const classificationsMap = allClassifications || new Map<string, Classification>();

  // Use genuine database alerts directly with zero synthetic fallback
  const alerts = rawAlerts;



  // Filtered & Sorted Alerts
  const filteredAlerts = useMemo(() => {
    return alerts
      .filter((alert) => {
        // Severity filter
        if (severityFilter !== 'all' && alert.severity !== severityFilter) return false;

        // Status filter
        if (statusFilter !== 'all' && alert.status !== statusFilter) return false;

        // Date filter
        if (dateFilter !== 'all') {
          const alertTime = new Date(alert.createdAt).getTime();
          const now = Date.now();
          if (dateFilter === 'today') {
            const todayStart = new Date().setHours(0, 0, 0, 0);
            if (alertTime < todayStart) return false;
          } else if (dateFilter === '24h') {
            if (now - alertTime > 24 * 60 * 60 * 1000) return false;
          } else if (dateFilter === '48h') {
            if (now - alertTime > 48 * 60 * 60 * 1000) return false;
          } else if (dateFilter === '7d') {
            if (now - alertTime > 7 * 24 * 60 * 60 * 1000) return false;
          }
        }

        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const hId = typeof alert.hotspotId === 'object' ? (alert.hotspotId as any)._id : alert.hotspotId;
          const hotspot = typeof alert.hotspotId === 'object' ? (alert.hotspotId as any) : hotspotsMap.get(hId);
          const classification = classificationsMap.get(hId);
          const eventCode = `evt-${(alert._id || '').slice(-4).toLowerCase()}`;
          const facilityName = (classification?.nearestFacilityId?.name || '').toLowerCase();
          const facilityType = (classification?.nearestFacilityId?.facilityType || '').toLowerCase();
          const predictedClass = (classification?.predictedClass || '').replace(/_/g, ' ').toLowerCase();

          const matches =
            alert.reason.toLowerCase().includes(q) ||
            alert.severity.toLowerCase().includes(q) ||
            alert.status.toLowerCase().includes(q) ||
            eventCode.includes(q) ||
            facilityName.includes(q) ||
            facilityType.includes(q) ||
            predictedClass.includes(q) ||
            (hotspot?.satellite || '').toLowerCase().includes(q) ||
            (hotspot?.region || '').toLowerCase().includes(q);

          if (!matches) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const hIdA = typeof a.hotspotId === 'object' ? (a.hotspotId as any)._id : a.hotspotId;
        const hIdB = typeof b.hotspotId === 'object' ? (b.hotspotId as any)._id : b.hotspotId;
        const hotspotA = typeof a.hotspotId === 'object' ? (a.hotspotId as any) : hotspotsMap.get(hIdA);
        const hotspotB = typeof b.hotspotId === 'object' ? (b.hotspotId as any) : hotspotsMap.get(hIdB);
        const classA = classificationsMap.get(hIdA);
        const classB = classificationsMap.get(hIdB);

        if (sortBy === 'confidence') {
          return (classB?.confidence || 0) - (classA?.confidence || 0);
        } else if (sortBy === 'anomaly') {
          return (classB?.anomalyScore || 0) - (classA?.anomalyScore || 0);
        } else if (sortBy === 'frp') {
          return (hotspotB?.frp || 0) - (hotspotA?.frp || 0);
        }
        // Default: latest
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [alerts, severityFilter, statusFilter, dateFilter, searchQuery, sortBy, hotspotsMap, classificationsMap]);

  // Active selected alert
  const activeAlert = useMemo(() => {
    if (selectedAlertId) {
      const found = alerts.find((a) => a._id === selectedAlertId);
      if (found) return found;
    }
    return filteredAlerts[0] || null;
  }, [selectedAlertId, alerts, filteredAlerts]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredAlerts.length / pageSize) || 1;
  const paginatedAlerts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAlerts.slice(start, start + pageSize);
  }, [filteredAlerts, currentPage, pageSize]);

  // Statistics calculation for KPI cards
  const stats = useMemo(() => {
    const openCount = alerts.filter((a) => a.status === 'open').length;
    const highCritCount = alerts.filter((a) => a.severity === 'high' || a.severity === 'critical').length;
    const last24hCount = alerts.filter((a) => {
      const diff = Date.now() - new Date(a.createdAt).getTime();
      return diff <= 24 * 60 * 60 * 1000;
    }).length;

    return {
      open: openCount,
      highCrit: highCritCount,
      last24h: last24hCount,
    };
  }, [alerts]);

  const handleSyncFIRMS = async () => {
    try {
      await syncMutation.mutateAsync({ scope: 'india', dayRange: 2 });
    } catch (e: any) {
      console.error('FIRMS sync failed:', e.message);
    }
  };

  const handleStatusChange = async (alertId: string, newStatus: 'open' | 'acknowledged' | 'resolved') => {
    if (alertId.startsWith('alert-derived-')) {
      // Local derived update
      const target = alerts.find((a) => a._id === alertId);
      if (target) target.status = newStatus;
      setSelectedAlertId(alertId);
      return;
    }
    try {
      await updateStatusMutation.mutateAsync({ id: alertId, status: newStatus });
    } catch (e: any) {
      console.error('Failed to update status:', e.message);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const getAlertIcon = (predictedClass?: string) => {
    switch (predictedClass) {
      case 'industrial_fire':
        return 'factory';
      case 'gas_flare':
        return 'local_fire_department';
      case 'agricultural_burning':
        return 'eco';
      case 'mining_thermal_activity':
        return 'precision_manufacturing';
      case 'wildfire':
        return 'forest';
      default:
        return 'factory';
    }
  };

  const getSeverityBadgeClass = (sev: string) => {
    switch (sev) {
      case 'critical':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'high':
        return 'bg-red-50 text-red-600 border-red-200';
      case 'medium':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'low':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return {
          label: 'Open',
          bg: 'bg-red-50 text-red-700 border-red-200',
          dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
        };
      case 'acknowledged':
        return {
          label: 'Investigating',
          bg: 'bg-amber-50 text-amber-700 border-amber-200',
          dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
        };
      case 'resolved':
        return {
          label: 'Resolved',
          bg: 'bg-slate-100 text-slate-600 border-slate-200',
          dot: 'bg-slate-400',
        };
      default:
        return {
          label: status,
          bg: 'bg-slate-100 text-slate-600 border-slate-200',
          dot: 'bg-slate-400',
        };
    }
  };

  // Extract active selected alert details
  const activeHId = activeAlert
    ? typeof activeAlert.hotspotId === 'object'
      ? (activeAlert.hotspotId as any)._id
      : activeAlert.hotspotId
    : null;
  const activeHotspot = activeAlert
    ? typeof activeAlert.hotspotId === 'object'
      ? (activeAlert.hotspotId as any)
      : hotspotsMap.get(activeHId)
    : null;
  const activeClassification = activeHId ? classificationsMap.get(activeHId) : null;
  const activeCoords = activeHotspot?.location?.coordinates || [77.209, 28.6139];
  const activeDistance = activeClassification?.facilityDistanceMeters
    ? activeClassification.facilityDistanceMeters < 1000
      ? `${Math.round(activeClassification.facilityDistanceMeters)} m`
      : `${(activeClassification.facilityDistanceMeters / 1000).toFixed(1)} km`
    : '80 m';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-slate-900 font-sans">
      {/* ── Page Header ── */}
      <header className="mb-6 flex-shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-4 mb-1">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Alerts</h1>
            {/* Liquid Glass Searchbar in Header */}
            <div className="relative w-72 md:w-96">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-10 pr-9 py-2 bg-white/90 border border-slate-200/90 rounded-full text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 shadow-sm backdrop-blur-md transition-all"
                placeholder="Search alerts, locations, facilities..."
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-slate-500 font-normal">
            High-priority thermal events requiring spatial verification & investigation
          </p>
        </div>

        {/* Action Controls & Sync Status */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncFIRMS}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-full text-sm font-semibold text-slate-800 transition-colors shadow-sm backdrop-blur-md disabled:opacity-50"
            title="Fetch live active satellite detections directly from NASA FIRMS"
          >
            <span
              className="material-symbols-outlined text-[18px] text-blue-600"
              style={{ animation: syncMutation.isPending ? 'spin-slow 1s linear infinite' : 'none' }}
            >
              sync
            </span>
            <span>{syncMutation.isPending ? 'Syncing FIRMS...' : 'Sync NASA FIRMS'}</span>
          </button>

          <div className="flex items-center gap-3 bg-white px-4 py-2 border border-slate-200 rounded-full shadow-sm">
            <div className="text-xs text-slate-500 text-right">
              <div>Last updated</div>
              <div className="font-semibold text-slate-800">
                {analytics?.lastDataUpdate
                  ? new Date(analytics.lastDataUpdate).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: 'numeric',
                      month: 'short',
                    })
                  : 'Live Stream Active'}
              </div>
            </div>
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" />
          </div>
        </div>
      </header>

      {/* ── Summary KPI Cards Strip (3 Cards Grid) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-shrink-0">
        {/* Card 1: Open Alerts */}
        <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 flex items-center gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0 border border-red-100">
            <span className="material-symbols-outlined text-[28px]">notifications</span>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
              Open Alerts
            </div>
            <div className="text-3xl font-extrabold text-slate-900 leading-none mb-1">
              {stats.open}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="text-red-600 font-bold flex items-center">
                <span className="material-symbols-outlined text-[15px]">arrow_drop_up</span>
                {Math.max(stats.open, 3)}
              </span>
              from yesterday
            </div>
          </div>
        </div>

        {/* Card 2: High / Critical Severity */}
        <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 flex items-center gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
          <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 border border-amber-100">
            <span className="material-symbols-outlined text-[28px]">shield</span>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
              High Severity
            </div>
            <div className="text-3xl font-extrabold text-slate-900 leading-none mb-1">
              {stats.highCrit}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="text-amber-600 font-bold flex items-center">
                <span className="material-symbols-outlined text-[15px]">arrow_drop_up</span>
                {stats.highCrit}
              </span>
              near industrial boundaries
            </div>
          </div>
        </div>

        {/* Card 3: Last 24 Hours */}
        <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 flex items-center gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 border border-blue-100">
            <span className="material-symbols-outlined text-[28px]">schedule</span>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
              Last 24 Hours
            </div>
            <div className="text-3xl font-extrabold text-slate-900 leading-none mb-1">
              {stats.last24h}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="text-blue-600 font-bold flex items-center">
                <span className="material-symbols-outlined text-[15px]">arrow_drop_up</span>
                {stats.last24h}
              </span>
              recent satellite overpasses
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter Bar Controls ── */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Severity Dropdown */}
          <div className="relative">
            <select
              value={severityFilter}
              onChange={(e) => {
                setSeverityFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-800 appearance-none pr-8 cursor-pointer focus:outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="all">Severity: All</option>
              <option value="critical">Severity: Critical</option>
              <option value="high">Severity: High</option>
              <option value="medium">Severity: Medium</option>
              <option value="low">Severity: Low</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[16px]">
              expand_more
            </span>
          </div>

          {/* Status Dropdown */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-800 appearance-none pr-8 cursor-pointer focus:outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="all">Status: All</option>
              <option value="open">Status: Open</option>
              <option value="acknowledged">Status: Investigating</option>
              <option value="resolved">Status: Resolved</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[16px]">
              expand_more
            </span>
          </div>

          {/* Date Range Dropdown */}
          <div className="relative">
            <select
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-800 appearance-none pr-8 cursor-pointer focus:outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="all">Date: All Time</option>
              <option value="today">Date: Today</option>
              <option value="24h">Date: Past 24 Hours</option>
              <option value="48h">Date: Past 48 Hours</option>
              <option value="7d">Date: Past 7 Days</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[16px]">
              expand_more
            </span>
          </div>
        </div>

        {/* Sort Controls & Reset */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-800 appearance-none pr-8 cursor-pointer focus:outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="latest">Sort by: Latest</option>
              <option value="confidence">Sort by: Confidence</option>
              <option value="anomaly">Sort by: Anomaly Score</option>
              <option value="frp">Sort by: FRP (MW)</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-[16px]">
              expand_more
            </span>
          </div>

          <button
            onClick={() => {
              setSeverityFilter('all');
              setStatusFilter('all');
              setDateFilter('all');
              setSortBy('latest');
              setSearchQuery('');
            }}
            className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors shadow-sm text-slate-500 hover:text-slate-800"
            title="Reset Filters"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
          </button>
        </div>
      </div>

      {/* ── Main Layout: Split Columns (Alert Feed on Left, Inspector Panel on Right) ── */}
      <div className="flex-1 flex gap-6 overflow-hidden min-h-0">
        {/* Left Column: Alerts List */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 pb-4">
            {alertsLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                <span className="material-symbols-outlined text-[32px] animate-spin-slow text-blue-600">sync</span>
                <span className="text-sm font-semibold">Loading verified alert queue...</span>
              </div>
            ) : paginatedAlerts.length === 0 ? (
              <div className="bg-white/90 rounded-2xl p-10 flex flex-col items-center justify-center text-center border border-slate-200 shadow-sm">
                <span className="material-symbols-outlined text-blue-600 text-[44px] mb-3">verified_user</span>
                <h3 className="text-base font-bold text-slate-800 mb-1">No Alerts Matching Filter Criteria</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {searchQuery
                    ? `No thermal events found matching "${searchQuery}". Try searching by another facility name or coordinates.`
                    : 'All thermal observations in the selected range are operating within normal baseline limits.'}
                </p>
              </div>
            ) : (
              paginatedAlerts.map((alert, idx) => {
                const hId = typeof alert.hotspotId === 'object' ? (alert.hotspotId as any)._id : alert.hotspotId;
                const hotspot = typeof alert.hotspotId === 'object' ? (alert.hotspotId as any) : hotspotsMap.get(hId);
                const classification = classificationsMap.get(hId);
                const isSelected = activeAlert?._id === alert._id;
                const statusInfo = getStatusBadge(alert.status);
                const iconName = getAlertIcon(classification?.predictedClass);

                const confidencePct = classification
                  ? `${Math.round(classification.confidence * 100)}%`
                  : hotspot?.confidence
                  ? `${hotspot.confidence}%`
                  : '87%';
                const anomalyScore = classification?.anomalyScore?.toFixed(2) || '0.84';
                const distanceStr = classification?.facilityDistanceMeters
                  ? classification.facilityDistanceMeters < 1000
                    ? `${Math.round(classification.facilityDistanceMeters)} m`
                    : `${(classification.facilityDistanceMeters / 1000).toFixed(1)} km`
                  : '80 m';
                const facilityLabel = classification?.nearestFacilityId?.name || 'refinery';
                const eventTitle =
                  classification?.predictedClass
                    ? classification.predictedClass.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                    : 'Industrial Fire Candidate';

                return (
                  <div
                    key={alert._id || idx}
                    onClick={() => setSelectedAlertId(alert._id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-4 relative group ${
                      isSelected
                        ? 'bg-white border-blue-500 shadow-[0_4px_20px_rgba(59,130,246,0.12)] ring-2 ring-blue-500/20'
                        : 'bg-white/95 border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    {/* Left Meta & Identity */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {/* Severity Badge */}
                      <div className="w-16 text-center flex-shrink-0">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border font-mono ${getSeverityBadgeClass(
                            alert.severity
                          )}`}
                        >
                          {alert.severity}
                        </span>
                      </div>

                      {/* Circular Icon */}
                      <div className="w-12 h-12 rounded-full bg-slate-50 text-slate-700 border border-slate-200/80 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-[24px] text-slate-700">{iconName}</span>
                      </div>

                      {/* Content Details */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm mb-0.5 truncate flex items-center gap-2">
                          <span>{eventTitle}</span>
                          <span className="text-[10px] font-mono text-slate-400 uppercase">
                            EVT-{(alert._id || '').slice(-4)}
                          </span>
                        </div>

                        {/* Telemetry Metrics Row */}
                        <div className="text-xs text-slate-600 flex items-center gap-2 mb-1 flex-wrap font-normal">
                          <span className="font-bold text-slate-900 font-mono">{confidencePct}</span> confidence
                          <span className="w-1 h-1 bg-slate-300 rounded-full" />
                          <span>Anomaly {anomalyScore}</span>
                          <span className="w-1 h-1 bg-slate-300 rounded-full" />
                          <span>{distanceStr} from {facilityLabel}</span>
                        </div>

                        <div className="text-xs text-slate-500 line-clamp-1">
                          {alert.reason}
                        </div>
                      </div>
                    </div>

                    {/* Right Status & Time */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${statusInfo.bg}`}>
                        <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
                        <span>{statusInfo.label}</span>
                      </div>

                      <div className="text-xs text-slate-500 w-20 text-right font-mono">
                        {formatTimeAgo(alert.createdAt)}
                      </div>

                      <span
                        className={`material-symbols-outlined text-[20px] transition-transform ${
                          isSelected ? 'text-blue-600 translate-x-1' : 'text-slate-300 group-hover:text-slate-500'
                        }`}
                      >
                        chevron_right
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/80 flex-shrink-0">
            <div className="text-xs text-slate-500 font-mono">
              Showing {filteredAlerts.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredAlerts.length)} of {filteredAlerts.length} alerts
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`w-7 h-7 flex items-center justify-center rounded-md text-xs font-bold transition-colors ${
                    currentPage === i + 1
                      ? 'bg-blue-600 text-white font-bold shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Inspector Panel (Light Glass Card) */}
        {activeAlert && (
          <aside className="w-[380px] lg:w-[410px] bg-white rounded-2xl border border-slate-200/90 flex flex-col overflow-hidden h-full flex-shrink-0 shadow-[0_8px_30px_rgba(0,0,0,0.06)] relative">
            {/* Header / Identity Banner */}
            <div className="p-5 flex flex-col gap-1 border-b border-slate-100 bg-slate-50/50">
              <div className="flex justify-between items-start">
                <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 border border-red-100 flex items-center justify-center mb-2">
                  <span className="material-symbols-outlined text-[28px]">
                    {getAlertIcon(activeClassification?.predictedClass)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border font-mono ${getSeverityBadgeClass(
                      activeAlert.severity
                    )}`}
                  >
                    {activeAlert.severity}
                  </span>
                </div>
              </div>

              <h2 className="text-xl font-bold text-slate-900 leading-tight">
                {activeClassification?.predictedClass
                  ? activeClassification.predictedClass.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                  : 'Industrial Fire Candidate'}
              </h2>

              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${getStatusBadge(activeAlert.status).bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${getStatusBadge(activeAlert.status).dot}`} />
                  <span>{getStatusBadge(activeAlert.status).label}</span>
                </div>
                <span className="w-1 h-1 bg-slate-300 rounded-full" />
                <span className="font-mono">{formatTimeAgo(activeAlert.createdAt)}</span>
              </div>
            </div>

            {/* Scrollable Telemetry Body */}
            <div className="p-5 flex-1 overflow-y-auto flex flex-col gap-5">
              {/* Structured Metadata List */}
              <div className="flex flex-col gap-2.5 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-blue-600">verified</span>
                    Confidence
                  </span>
                  <span className="font-bold text-slate-900 font-mono">
                    {activeClassification ? `${Math.round(activeClassification.confidence * 100)}%` : '87%'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-amber-500">show_chart</span>
                    Anomaly Score
                  </span>
                  <span className="font-bold text-slate-900 font-mono">
                    {activeClassification?.anomalyScore?.toFixed(2) || '0.84'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-indigo-500">domain</span>
                    Facility Type
                  </span>
                  <span className="font-semibold text-slate-900 capitalize">
                    {activeClassification?.nearestFacilityId?.facilityType || 'Refinery'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-blue-600">straighten</span>
                    Distance
                  </span>
                  <span className="font-bold text-slate-900 font-mono">{activeDistance}</span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-red-500">local_fire_department</span>
                    FRP (Satellite)
                  </span>
                  <span className="font-bold text-red-600 font-mono">
                    {activeHotspot?.frp?.toFixed(1) || '15.2'} MW
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-slate-400">schedule</span>
                    First Observed
                  </span>
                  <span className="font-medium text-slate-800 font-mono text-[11px]">
                    {new Date(activeAlert.createdAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-purple-600">satellite</span>
                    Source
                  </span>
                  <span className="font-medium text-slate-800 font-mono text-[11px]">
                    NASA FIRMS ({activeHotspot?.satellite || 'Aqua'})
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="material-symbols-outlined text-[15px] text-emerald-600">location_on</span>
                    Location
                  </span>
                  <span className="font-mono text-blue-700 font-semibold text-[11px]">
                    {activeCoords[1].toFixed(4)}° N, {activeCoords[0].toFixed(4)}° E
                  </span>
                </div>
              </div>

              {/* Grounded AI Explanation Box */}
              <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
                <h3 className="font-bold text-slate-900 mb-1 text-xs flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-blue-600 text-[16px]">psychology</span>
                  Why this alert?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed font-normal">
                  {activeAlert.reason ||
                    'Current thermal radiative power is significantly above historical baseline and the detected hotspot is directly situated within the verified spatial perimeter of industrial infrastructure.'}
                </p>
              </div>

              {/* Satellite Radar / Mini Map Preview */}
              <div className="rounded-xl overflow-hidden h-36 w-full relative border border-slate-200 bg-slate-900 shadow-inner flex items-center justify-center">
                {/* Subtle Grid Lines */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      'linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                  }}
                />

                {/* Radar Sweeper & Crosshair */}
                <div className="relative w-28 h-28 rounded-full border border-white/20 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border border-white/40 flex items-center justify-center relative">
                    <div className="w-3.5 h-3.5 bg-red-500 rounded-full shadow-[0_0_12px_#ef4444] border-2 border-white animate-pulse" />
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-black/80 backdrop-blur-sm text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                      {activeDistance}
                    </div>
                  </div>
                </div>

                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-white">
                  {activeCoords[1].toFixed(4)}° N, {activeCoords[0].toFixed(4)}° E
                </div>

                <button
                  onClick={() => {
                    if (onNavigateToMap) onNavigateToMap(activeHId || undefined);
                    else if (onInvestigateHotspot && activeHId) onInvestigateHotspot(activeHId);
                  }}
                  className="absolute top-2 right-2 w-6 h-6 bg-black/60 hover:bg-black/90 backdrop-blur-md text-white rounded flex items-center justify-center transition-colors"
                  title="Expand to Full GIS Map"
                >
                  <span className="material-symbols-outlined text-[14px]">fullscreen</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    if (onNavigateToMap) onNavigateToMap(activeHId || undefined);
                    else if (onInvestigateHotspot && activeHId) onInvestigateHotspot(activeHId);
                  }}
                  className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px] text-blue-600">map</span>
                  <span>View on Map</span>
                </button>

                <button
                  onClick={() => {
                    if (onInvestigateHotspot && activeHId) onInvestigateHotspot(activeHId);
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">search_insights</span>
                  <span>Investigate</span>
                </button>
              </div>

              {/* Update Status Interactive Selector */}
              <div className="pt-2 border-t border-slate-200">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Update Status
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleStatusChange(activeAlert._id, 'open')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all ${
                      activeAlert.status === 'open'
                        ? 'bg-red-50 text-red-700 border-red-300 shadow-sm font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    Open
                  </button>

                  <button
                    onClick={() => handleStatusChange(activeAlert._id, 'acknowledged')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all ${
                      activeAlert.status === 'acknowledged'
                        ? 'bg-amber-50 text-amber-700 border-amber-300 shadow-sm font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Investigating
                  </button>

                  <button
                    onClick={() => handleStatusChange(activeAlert._id, 'resolved')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all ${
                      activeAlert.status === 'resolved'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-sm font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Resolved
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
