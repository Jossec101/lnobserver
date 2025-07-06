/// <reference types="vite/client" />
import React, { useEffect, useState, useRef } from "react";
import LightningGraph from "./LightningGraph";

type Node = {
  id: string;
  x?: number;
  y?: number;
  geo?: { lat: number; lon: number; country?: string };
};

type Channel = {
  id: string;
  source: string;
  target: string;
  status: "open" | "closed";
  geo?: { lat: number; lon: number; country?: string };
  // Metadata fields from /api/v1/lightning/channels/:channelId
  short_id?: string;
  capacity?: number;
  transaction_id?: string;
  transaction_vout?: number;
  closing_transaction_id?: string | null;
  closing_reason?: string | null;
  updated_at?: string;
  created?: string;
  fee_rate?: number;
  base_fee_mtokens?: number;
  cltv_delta?: number;
  is_disabled?: number;
  max_htlc_mtokens?: number;
  min_htlc_mtokens?: number;
  node_left?: any;
  node_right?: any;
};

// Read config from environment variables (with fallbacks)
const CHANNELS_GEO_API = import.meta.env.CHANNELS_GEO_API || "https://mempool.space/api/v1/lightning/channels-geo";
const DEBUG_LIGHTNING = (import.meta.env.DEBUG_LIGHTNING_ANIM || "false") === "true";
const POLL_INTERVAL = (parseInt(import.meta.env.POLL_INTERVAL || "10", 10)) * 1000;
const MAX_CHANNEL_EVENTS = parseInt(import.meta.env.MAX_CHANNEL_EVENTS || "30", 10);
const ANIMATION_DURATION = (parseInt(import.meta.env.ANIMATION_DURATION || "60", 10)) * 1000;

const App: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [zapChannelId, setZapChannelId] = useState<string | undefined>(); // Will remove this if not used
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showAllChannels, setShowAllChannels] = useState(false);
  const [channelEvents, setChannelEvents] = useState<{ id: string; ts: number; status: "open" | "closed" }[]>([]); // Renamed from recentZaps
  const [debugLightningTrigger, setDebugLightningTrigger] = useState(0);
  const [debugRandomOn, setDebugRandomOn] = useState(false);
  const prevChannelsRef = useRef<Set<string>>(new Set());
  const channelMetaCache = useRef<Record<string, Channel>>({});
  const isFirstLoad = useRef(true);

  // Helper to log and update logs state
  const log = (msg: string) => {
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 199), // keep last 200 logs
    ]);
    // Also print to console
    // eslint-disable-next-line no-console
    console.log(msg);
  };

  // Fetch and process LN channels with geodata and metadata
  async function fetchChannelsGeo() {
    try {
      log(`[API] Fetching Lightning Network channels with geodata from: ${CHANNELS_GEO_API}`);
      const res = await fetch(CHANNELS_GEO_API);
      if (!res.ok) {
        log(`[API] Failed to fetch Lightning Network channels-geo: ${res.status}`);
        return;
      }
      const data = await res.json();
      log(`[API] Received ${data.length} channel geodata entries.`);
      // data is an array of arrays: [node1_pubkey, node1_alias, lon1, lat1, node2_pubkey, node2_alias, lon2, lat2]
      const nodeMap: Record<string, Node> = {};
      const channelArr: Channel[] = [];
      const channelPairs: [string, string][] = [];
      for (const entry of data) {
        const [
          node1_pubkey, node1_alias, lon1, lat1,
          node2_pubkey, node2_alias, lon2, lat2
        ] = entry;
        // Add/update nodes
        if (!nodeMap[node1_pubkey]) {
          nodeMap[node1_pubkey] = {
            id: node1_pubkey,
            geo: { lat: lat1, lon: lon1 },
          };
        }
        if (!nodeMap[node2_pubkey]) {
          nodeMap[node2_pubkey] = {
            id: node2_pubkey,
            geo: { lat: lat2, lon: lon2 },
          };
        }
        // Add channel
        const channelId = `${node1_pubkey}-${node2_pubkey}`;
        channelArr.push({
          id: channelId,
          source: node1_pubkey,
          target: node2_pubkey,
          status: "open",
          geo: undefined,
        });
        channelPairs.push([node1_pubkey, node2_pubkey]);
      }
      const nodeArr = Object.values(nodeMap);
      // Detect channel events (channel open/close)
      const prevChannels = prevChannelsRef.current;
      const currentChannelIds = new Set(channelArr.map((c) => c.id));
      let newEvents: { id: string; ts: number; status: "open" | "closed" }[] = [];
      // Removed all localStorage persistence logic
      // On first load, just set the baseline and don't detect any events
      if (isFirstLoad.current || prevChannels.size === 0) {
        isFirstLoad.current = false;
        prevChannelsRef.current = currentChannelIds;
        setNodes(nodeArr);
        setChannels(channelArr);
        setLastUpdate(new Date());
        setChannelEvents([]);
        log(`[STATE] Initial load: ${nodeArr.length} nodes and ${channelArr.length} channels. No channel event detection.`);
        return;
      }
      // Only detect events if we have a proper previous state
      if (prevChannels.size > 0) {
        for (const id of currentChannelIds) {
          if (!prevChannels.has(id)) {
            log(`[EVENT] Channel opened: ${id}`);
            newEvents.push({ id, ts: Date.now(), status: "open" });
          }
        }
        for (const id of prevChannels) {
          if (!currentChannelIds.has(id)) {
            log(`[EVENT] Channel closed: ${id}`);
            newEvents.push({ id, ts: Date.now(), status: "closed" });
          }
        }
        // Limit new events to prevent spam
        if (newEvents.length > MAX_CHANNEL_EVENTS) {
          log(`[WARNING] Too many channel events detected (${newEvents.length}), limiting to ${MAX_CHANNEL_EVENTS}`);
          newEvents = newEvents.slice(-MAX_CHANNEL_EVENTS);
        }
      }
      prevChannelsRef.current = currentChannelIds;
      setNodes(nodeArr);
      setChannels(channelArr);
      setLastUpdate(new Date());
      setChannelEvents((prev) => {
        // Keep only events from the last 5 seconds and limit to MAX_CHANNEL_EVENTS max
        const now = Date.now();
        const filteredPrev = prev.filter((e) => now - e.ts < 5000);
        const allEvents = [...filteredPrev, ...newEvents];
        return allEvents.slice(-MAX_CHANNEL_EVENTS); // Keep only the last MAX_CHANNEL_EVENTS events
      });
      log(`[STATE] Updated graph with ${nodeArr.length} nodes and ${channelArr.length} channels.`);
    } catch (e) {
      log(`[API] Error fetching Lightning Network channels-geo: ${e}`);
    }
  }

  // Poll every POLL_INTERVAL ms
  useEffect(() => {
    fetchChannelsGeo();
    const interval = setInterval(fetchChannelsGeo, POLL_INTERVAL);
    return () => clearInterval(interval);
    // eslint-disable-next-line
  }, []);

  // Debug random lightning poller
  useEffect(() => {
    if (!DEBUG_LIGHTNING) return;
    if (!debugRandomOn) return;
    const interval = setInterval(() => setDebugLightningTrigger((t) => t + 1), 2000);
    return () => clearInterval(interval);
  }, [DEBUG_LIGHTNING, debugRandomOn]);

  return (
    <div style={{ width: "100vw", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", background: "#181a20", color: "#ffe066" }}>
      <h2 style={{ width: "100%", maxWidth: 1600, margin: "0 auto", color: "#ffe066" }}>Lightning Network Graph</h2>
      <div style={{ width: "100%", maxWidth: 1920 }}>
        <LightningGraph
          nodes={nodes}
          channels={showAllChannels ? channels : [
            // Only channels with a recent event
            ...channels.filter(c => channelEvents.some(e => e.id === c.id)),
            // Add closed channels from channelEvents that are not in channels
            ...channelEvents
              .filter(e => e.status === "closed" && !channels.some(c => c.id === e.id))
              .map(e => {
                const [source, target] = e.id.split("-");
                return { id: e.id, source, target, status: "closed" as "closed" };
              })
          ]}
          channelEvents={channelEvents}
          triggerDebugLightning={debugLightningTrigger}
          maxChannelEvents={MAX_CHANNEL_EVENTS}
          animationDuration={ANIMATION_DURATION}
        />
      </div>
      <div style={{ width: "100%", maxWidth: 1600, marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ display: "inline-block", width: 24, height: 4, background: "#ffe066", marginRight: 4, borderRadius: 2 }} />
          <span>Yellow lightning = channel open</span>
          <span style={{ display: "inline-block", width: 24, height: 4, background: "#ff4d4d", marginRight: 4, borderRadius: 2 }} />
          <span>Red lightning = channel close</span>
        </div>
        <div>
          Last update: {lastUpdate ? lastUpdate.toLocaleString() : "-"}
        </div>
        <button
          style={{ marginLeft: 16, padding: "4px 12px", borderRadius: 4, border: "1px solid #444", background: showLogs ? "#ffe066" : "#23242a", color: showLogs ? "#23242a" : "#ffe066", cursor: "pointer" }}
          onClick={() => setShowLogs((v) => !v)}
        >
          {showLogs ? "Hide logs" : "Show logs"}
        </button>
        <button
          style={{ marginLeft: 16, padding: "4px 12px", borderRadius: 4, border: "1px solid #444", background: showAllChannels ? "#b3e6ff" : "#23242a", color: showAllChannels ? "#23242a" : "#ffe066", cursor: "pointer" }}
          onClick={() => setShowAllChannels((v) => !v)}
        >
          {showAllChannels ? "Hide all channels" : "Show all channels"}
        </button>
        {DEBUG_LIGHTNING && (
          <>
            <button
              style={{ marginLeft: 16, padding: "4px 12px", borderRadius: 4, border: "1px solid #444", background: debugRandomOn ? "#ffb366" : "#ffe066", color: "#23242a", cursor: "pointer" }}
              onClick={() => setDebugRandomOn((v) => !v)}
            >
              {debugRandomOn ? "Stop Debug Random Lightning" : "Start Debug Random Lightning"}
            </button>
            <button
              style={{ marginLeft: 8, padding: "4px 12px", borderRadius: 4, border: "1px solid #444", background: "#ffe066", color: "#23242a", cursor: "pointer" }}
              onClick={() => setDebugLightningTrigger((t) => t + 1)}
            >
              Trigger Debug Lightning
            </button>
          </>
        )}
      </div>
      {showLogs && (
        <div style={{ width: "100%", maxWidth: 1600, background: "#23242a", color: "#ffe066", fontFamily: "monospace", fontSize: 13, margin: "12px auto 0 auto", padding: 12, borderRadius: 6, maxHeight: 300, overflowY: "auto" }}>
          <div style={{ marginBottom: 8, fontWeight: "bold" }}>Event Log</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {logs.map((log, i) => (
              <li key={i}>{log}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default App;

/*
App.tsx

Main application component for the Lightning Network Graph UI.

Features:
- Fetches Lightning Network channel and node geodata from a public API
- Detects channel open/close events ("channel events") in real time
- Displays a world map graph of nodes and channels using the LightningGraph component
- Animates channel events with lightning effects
- Supports debug lightning animation for development
- Provides event logs and UI controls for toggling logs and channel visibility

Environment variables (with defaults):
  VITE_CHANNELS_GEO_API: API endpoint for channel geodata
  VITE_CHANNEL_METADATA_API: API endpoint for channel metadata
  VITE_DEBUG_LIGHTNING_ANIM: Enable debug lightning animation (true/false)
  VITE_POLL_INTERVAL: Polling interval for API (ms)
  VITE_MAX_CHANNEL_EVENTS: Max number of channel events to keep in memory

Author: Jossec101
Date: 2025-07-06
*/
