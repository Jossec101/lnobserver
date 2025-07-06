// LightningGraph.tsx
//
// This React component renders a world map with nodes and channels representing a Lightning Network graph.
// It uses D3 and TopoJSON to draw the map, project node locations, and animate lightning effects for channel events.
//
// Features:
// - Renders a world map using GeoJSON data (excluding Antarctica)
// - Projects nodes (optionally with geo coordinates) onto the map
// - Draws channels as colored lines between nodes
// - Animates lightning effects for channel events (with sound)
// - Supports zooming via mouse wheel
// - Responsive to window resizing
//
// Props:
//   nodes: Array of node objects (id, optional geo {lat, lon, country})
//   channels: Array of channel objects (id, source, target, status)
//   channelEventId: Optional channel id to animate a lightning effect
//   channelEvents: Optional array of recent channel events to animate
//   triggerDebugLightning: Optional number to trigger a random lightning animation
//
// Author: Jossec101
// Date: (2025-07-06)

import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";

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
};

type ChannelEvent = { id: string; ts: number; status: "open" | "closed" };

type Props = {
  nodes: Node[];
  channels: Channel[];
  onChannelEvent?: (channel: Channel) => void;
  channelEventId?: string;
  channelEvents?: ChannelEvent[];
};

const worldMapUrl =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const LightningGraph: React.FC<Props & { triggerDebugLightning?: number }> = ({
  nodes,
  channels,
  channelEventId,
  triggerDebugLightning,
  channelEvents = [],
  // Accept animation config as props (optional, fallback to defaults)
  maxChannelEvents = 30,
  animationDuration = 60000,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [world, setWorld] = useState<any>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight * 0.7 });
  const lastSoundTimeRef = useRef<number>(0);

  useEffect(() => {
    const onResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight * 0.7 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const width = dimensions.width;
  const height = dimensions.height;

  // D3 zoom behavior (scroll only, no drag/pan)
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = svg.select("g#zoom-group");
    if (!g.empty()) {
      svg.call(
        d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.5, 10])
          .filter((event) => event.type === "wheel") // Only allow zoom on scroll
          .on("zoom", (event) => {
            g.attr("transform", event.transform.toString());
          })
      );
    }
  }, [nodes, channels, world, width, height]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("g#zoom-group").remove();
    const g = svg.append("g").attr("id", "zoom-group");

    // Mercator projection
    // Compute the bounding box excluding Antarctica
    let mapFeatures = world;
    if (world) {
      mapFeatures = world.filter(
        (f) =>
          !(
            f.properties &&
            (f.properties.name === "Antarctica" ||
              f.properties.NAME === "Antarctica" ||
              f.id === "010")
          )
      );
    }
    const projection = d3
      .geoMercator()
      .fitSize([width, height], {
        type: "FeatureCollection",
        features: mapFeatures || [],
      });
    const geoPath = d3.geoPath(projection);

    // Draw world map
    if (mapFeatures) {
      g.append("g")
        .selectAll("path")
        .data(mapFeatures)
        .enter()
        .append("path")
        .attr("d", geoPath as any)
        .attr("fill", "#f0f0f0")
        .attr("stroke", "#bbb");
    }

    // Project node positions
    const nodePositions = nodes.map((n) => {
      let x = width / 2,
        y = height / 2;
      if (n.geo) {
        const [px, py] = projection([n.geo.lon, n.geo.lat]) || [x, y];
        x = px;
        y = py;
      }
      return { ...n, x, y };
    });
    // Map id to position for links
    const nodeMap: Record<string, { x: number; y: number }> = {};
    nodePositions.forEach((n) => {
      nodeMap[n.id] = { x: n.x!, y: n.y! };
    });

    // Color scale for edges
    const color = d3.scaleSequential(d3.interpolateCool).domain([0, channels.length]);

    // Draw links (only show all if toggled, otherwise only recent zaps)
    g.append("g")
      .attr("stroke-width", 0.7)
      .selectAll("line")
      .data(channels)
      .enter()
      .append("line")
      .attr("x1", (d) => nodeMap[d.source]?.x)
      .attr("y1", (d) => nodeMap[d.source]?.y)
      .attr("x2", (d) => nodeMap[d.target]?.x)
      .attr("y2", (d) => nodeMap[d.target]?.y)
      .attr("stroke", (d, i) => color(i))
      .attr("class", "channel-link");

    // Draw nodes (smaller)
    g.append("g")
      .selectAll("circle")
      .data(nodePositions)
      .enter()
      .append("circle")
      .attr("r", 3.2)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("fill", (d) =>
        d.geo?.country
          ? d3.interpolateRainbow(
              (d.geo.country.charCodeAt(0) % 24) / 24
            )
          : "#888"
      )
      .attr("stroke", "#222")
      .attr("stroke-width", 1)
      .append("title")
      .text((d) =>
        d.geo?.country ? `${d.id} (${d.geo.country})` : d.id
      );

    // Play sound helper with cooldown
    function playLightningSound() {
      const now = Date.now();
      if (now - lastSoundTimeRef.current > 1000) { // 1 second cooldown
        const audio = new Audio("/lightning.mp3");
        audio.volume = 0.5;
        audio.play().catch(() => {}); // Ignore audio play errors
        lastSoundTimeRef.current = now;
      }
    }

    // Channel animation for channelEventId (draw a jagged polyline)
    let didDebug = false;
    if (channelEventId) {
      const event = channels.find((c) => c.id === channelEventId);
      if (event) {
        const source = nodeMap[event.source];
        const target = nodeMap[event.target];
        if (source && target) {
          playLightningSound();
          const lightningPoints = () => {
            const sx = source.x;
            const sy = source.y;
            const tx = target.x;
            const ty = target.y;
            const numSegments = 7;
            const points = [[sx, sy]];
            for (let i = 1; i < numSegments; ++i) {
              const t = i / numSegments;
              const x = sx + (tx - sx) * t + (Math.random() - 0.5) * 18;
              const y = sy + (ty - sy) * t + (Math.random() - 0.5) * 18;
              points.push([x, y]);
            }
            points.push([tx, ty]);
            return points.map((p) => p.join(",")).join(" ");
          };
          g.append("g")
            .append("polyline")
            .attr("points", lightningPoints)
            .attr("stroke", event.status === "closed" ? "#ff4d4d" : "#ffe066")
            .attr("stroke-width", 4)
            .attr("fill", "none")
            .attr("class", "lightning-anim")
            .attr("filter", "url(#glow)")
            .transition()
            .duration(animationDuration)
            .style("opacity", 0)
            .remove();
          didDebug = true;
        }
      }
    }
    // Debug mode: draw a yellow lightning between two random nodes if enabled or triggerDebugLightning changes
    // Only run random anim if triggerDebugLightning changes and debugRandomOn is true (passed as prop)
    if (typeof triggerDebugLightning === "number" && triggerDebugLightning > 0) {
      const idx1 = Math.floor(Math.random() * nodePositions.length);
      let idx2 = Math.floor(Math.random() * nodePositions.length);
      if (idx1 === idx2) idx2 = (idx2 + 1) % nodePositions.length;
      const source = nodePositions[idx1];
      const target = nodePositions[idx2];
      if (source && target) {
        playLightningSound();
        const lightningPoints = () => {
          const sx = source.x;
          const sy = source.y;
          const tx = target.x;
          const ty = target.y;
          const numSegments = 7;
          const points = [[sx, sy]];
          for (let i = 1; i < numSegments; ++i) {
            const t = i / numSegments;
            const x = sx + (tx - sx) * t + (Math.random() - 0.5) * 18;
            const y = sy + (ty - sy) * t + (Math.random() - 0.5) * 18;
            points.push([x, y]);
          }
          points.push([tx, ty]);
          return points.map((p) => p.join(",")).join(" ");
        };
        g.append("g")
          .append("polyline")
          .attr("points", lightningPoints)
          .attr("stroke", "#ffe066")
          .attr("stroke-width", 4)
          .attr("fill", "none")
          .attr("class", "lightning-anim")
          .attr("filter", "url(#glow)")
          .transition()
          .duration(animationDuration)
          .style("opacity", 0)
          .remove();
      }
    }

    // Channel animation for all channelEvents (draw a jagged polyline for each, limit to env value, play sound only once)
    const MAX_CHANNEL_EVENTS = maxChannelEvents;
    const ANIMATION_DURATION = animationDuration;
    if (channelEvents && channelEvents.length > 0) {
      const limitedEvents = channelEvents.slice(-MAX_CHANNEL_EVENTS); // Only animate the last MAX_CHANNEL_EVENTS events
      if (limitedEvents.length > 0) {
        playLightningSound(); // Play sound once for the batch
      }
      limitedEvents.forEach((event) => {
        const channel = channels.find((c) => c.id === event.id);
        if (channel) {
          const source = nodeMap[channel.source];
          const target = nodeMap[channel.target];
          if (source && target) {
            const lightningPoints = () => {
              const sx = source.x;
              const sy = source.y;
              const tx = target.x;
              const ty = target.y;
              const numSegments = 7;
              const points = [[sx, sy]];
              for (let i = 1; i < numSegments; ++i) {
                const t = i / numSegments;
                const x = sx + (tx - sx) * t + (Math.random() - 0.5) * 18;
                const y = sy + (ty - sy) * t + (Math.random() - 0.5) * 18;
                points.push([x, y]);
              }
              points.push([tx, ty]);
              return points.map((p) => p.join(",")).join(" ");
            };
            g.append("g")
              .append("polyline")
              .attr("points", lightningPoints)
              .attr("stroke", event.status === "closed" ? "#ff4d4d" : "#ffe066")
              .attr("stroke-width", 4)
              .attr("fill", "none")
              .attr("class", "lightning-anim")
              .attr("filter", "url(#glow)")
              .transition()
              .duration(ANIMATION_DURATION)
              .style("opacity", 0)
              .remove();
          }
        }
      });
    }
  }, [nodes, channels, channelEventId, world, dimensions, triggerDebugLightning, channelEvents, maxChannelEvents, animationDuration]);

  // Add SVG filter for glow effect (must be top-level, not inside another useEffect)
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    if (svg.select("#glow").empty()) {
      const defs = svg.append("defs");
      defs.append("filter")
        .attr("id", "glow")
        .html(`
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        `);
    }
  }, [dimensions]);

  // Load world map GeoJSON once
  useEffect(() => {
    fetch(worldMapUrl)
      .then((res) => res.json())
      .then((data) => {
        // Convert TopoJSON to GeoJSON and filter out Antarctica (id: 010 or name: Antarctica)
        let countries = feature(data, data.objects.countries).features;
        countries = countries.filter(
          (f) =>
            !(f.properties &&
              (f.properties.name === "Antarctica" || f.properties.NAME === "Antarctica" || f.id === "010"))
        );
        setWorld(countries);
      });
  }, []);

  return (
    <svg ref={svgRef} width={width} height={height} style={{ border: "1px solid #ccc", width: "100%", height: "70vh", display: "block" }} />
  );
};

export default LightningGraph;
