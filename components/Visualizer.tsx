
import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { SimulationResult, SimulationParams } from '../types';
import { Data, Layout } from 'plotly.js';

interface VisualizerProps {
  data: SimulationResult;
  params: SimulationParams;
}

const Visualizer: React.FC<VisualizerProps> = ({ data, params }) => {
  const { plotData, layout } = useMemo(() => {
    const traces: Data[] = [];

    // --- 1. Dynamic Envelope (Filled Area) ---
    const leftX = data.polygons.left.x;
    const leftY = data.polygons.left.y;
    const rightX = [...data.polygons.right.x].reverse();
    const rightY = [...data.polygons.right.y].reverse();

    const envX = [...leftX, ...rightX, leftX[0]];
    const envY = [...leftY, ...rightY, leftY[0]];

    // Status Colors
    let fillColor = 'rgba(230, 249, 230, 0.6)'; // Green
    let statusText = "PASS";
    if (data.globalStatus === 'FAIL') {
      fillColor = 'rgba(254, 202, 202, 0.6)'; // Red
      statusText = "FAIL";
    } else if (data.globalStatus === 'BOUNDARY') {
      fillColor = 'rgba(251, 191, 36, 0.6)'; // Amber
      statusText = "BOUNDARY";
    }

    traces.push({
      x: envX,
      y: envY,
      fill: 'toself',
      fillcolor: fillColor,
      line: { color: '#FF6347', dash: 'dash', width: 2 },
      name: 'Dynamic Envelope',
      type: 'scatter',
      mode: 'lines',
      hoveron: 'points',
      hovertemplate: `**Dynamic Envelope**x: %{x:.2f}\ny: %{y:.2f}`
    });

    // --- 2. Rotated Static (Ghost) ---
    const rLeftX = data.polygons.left.rot_static_x;
    const rLeftY = data.polygons.left.rot_static_y;
    const rRightX = [...data.polygons.right.rot_static_x].reverse();
    const rRightY = [...data.polygons.right.rot_static_y].reverse();

    if (rLeftX.length > 0) {
      const rotX = [...rLeftX, ...rRightX, rLeftX[0]];
      const rotY = [...rLeftY, ...rRightY, rLeftY[0]];
      traces.push({
        x: rotX,
        y: rotY,
        fill: 'toself',
        fillcolor: 'rgba(59, 130, 246, 0.1)',
        line: { color: '#2563eb', dash: 'dot', width: 1 },
        name: 'Rotated Static',
        type: 'scatter',
        mode: 'lines',
        hoveron: 'points',
        hovertemplate: `**Rotated Static**x: %{x:.2f}\ny: %{y:.2f}`
      });
    }

    // --- 3. Original Static (Solid Blue) ---
    traces.push({
      x: data.polygons.left.static_x,
      y: data.polygons.left.static_y,
      line: { color: '#2563eb', width: 2 },
      name: 'Original Static',
      type: 'scatter',
      mode: 'lines',
      legendgroup: 'static',
      showlegend: true,
      hovertemplate: `**Original Static**x: %{x:.2f}\ny: %{y:.2f}`
    });

    traces.push({
      x: data.polygons.right.static_x,
      y: data.polygons.right.static_y,
      line: { color: '#2563eb', width: 2 },
      name: 'Original Static',
      type: 'scatter',
      mode: 'lines',
      legendgroup: 'static',
      showlegend: false,
      hovertemplate: `**Original Static**x: %{x:.2f}\ny: %{y:.2f}`
    });

    // --- 4. Study Points and Measurements ---
    data.studyPoints.forEach((sp, idx) => {
      const y = sp.p.y;
      const isET = sp.throwType === 'ET';
      const color = isET ? '#059669' : '#d946ef';

      // A. Measurement Lines (Dashed)
      // Delta to Envelope
      if (sp.envX !== null) {
        const dist = Math.abs(sp.p.x - sp.envX);
        traces.push({
          x: [sp.p.x, sp.envX],
          y: [y, y],
          mode: 'lines',
          line: { color: '#800080', dash: 'dash', width: 1.5 },
          name: 'Δ Envelope',
          legendgroup: 'delta_env',
          showlegend: idx === 0,
          hoverinfo: 'text',
          text: `Δ Env: ${dist.toFixed(2)}mm`
        });
      }

      // Delta to Static
      if (sp.rotStaticX !== null) {
        const dist = Math.abs(sp.p.x - sp.rotStaticX);
        traces.push({
          x: [sp.p.x, sp.rotStaticX],
          y: [y, y],
          mode: 'lines',
          line: { color: 'red', dash: 'dash', width: 1.5 },
          name: 'Δ Static',
          legendgroup: 'delta_static',
          showlegend: idx === 0,
          hoverinfo: 'text',
          text: `Δ Static: ${dist.toFixed(2)}mm`
        });
      }

      // B. The Point Itself
      traces.push({
        x: [sp.p.x],
        y: [sp.p.y],
        mode: 'markers',
        marker: { size: 10, color: color, symbol: 'cross', line: { width: 2, color: color } },
        name: `Study Point (${sp.side})`,
        showlegend: false,
        hovertemplate:
          `**${sp.side.toUpperCase()} Point (${sp.throwType})**` +
          `x: %{x:.2f} mm\n` +
          `y: %{y:.2f} mm\n` +
          ``
      });

      // C. Text Labels
      const valStatic = sp.rotStaticX !== null ? Math.abs(sp.p.x - sp.rotStaticX).toFixed(2) : '-';
      const valEnv = sp.envX !== null ? Math.abs(sp.p.x - sp.envX).toFixed(2) : '-';

      // Calculate anchor X (outermost point) to avoid overlapping the line
      let textAnchorX = sp.p.x;
      if (sp.side === 'left') {
        if (sp.envX !== null) textAnchorX = Math.min(textAnchorX, sp.envX);
        if (sp.rotStaticX !== null) textAnchorX = Math.min(textAnchorX, sp.rotStaticX);
      } else {
        if (sp.envX !== null) textAnchorX = Math.max(textAnchorX, sp.envX);
        if (sp.rotStaticX !== null) textAnchorX = Math.max(textAnchorX, sp.rotStaticX);
      }

      // Offset to create a small gap between the line end and the text
      const offset = sp.side === 'left' ? -20 : 20;

      const labelHtml =
        `y:${sp.p.y.toFixed(0)}\n` +
        `Δ ${sp.throwType} Static: ${valStatic}\n` +
        `Δ Env: ${valEnv}`;

      traces.push({
        x: [textAnchorX + offset],
        y: [sp.p.y],
        text: [labelHtml],
        mode: 'text',
        type: 'scatter',
        textposition: sp.side === 'left' ? 'top left' : 'top right',
        showlegend: false,
        hoverinfo: 'none',
        textfont: { size: 11, family: 'Arial, sans-serif' }
      });
    });

    // --- 5. Pivot Point ---
    traces.push({
      x: [data.pivot.x],
      y: [data.pivot.y],
      mode: 'markers',
      marker: { size: 12, color: 'black', symbol: 'x' },
      name: 'Pivot Center',
      hovertemplate: `**Pivot Center**x: %{x:.2f}\ny: %{y:.2f}`
    });

    // --- Summary Labels (Roll, Lat, Bounce) ---

    // Direction-aware cant bias sign: CW (right turn) is negative
    const isCW = params.direction === 'cw';
    const appliedCantDeg = data.calculatedParams.appliedCantUsed; // degrees from physics
    const cantBiasDeg = isCW ? -appliedCantDeg : appliedCantDeg;

    // Roll including applied cant AND cant tolerance (requested)
    const rollTotalDegInclCantAndTol =
      Math.abs(params.roll + cantBiasDeg) + data.calculatedParams.cantTolUsed;

    // Lateral: dynamic lat + track tolerance (lat + gauge widening) — show as ±
    const latTotalMm = params.latPlay + data.calculatedParams.tolLatShift;

    // Bounce: vehicle bounce + vertical tolerance (if enabled)
    const bounceTotalMm = params.bounce + (params.enableTolerances ? params.tol_vert : 0);

    // --- Layout ---
    const layout: Partial<Layout> = {
      autosize: true,
      title: {
        text: `**Vehicle Outline Simulation**${params.direction === 'cw' ? "Clockwise (Right Turn)" : "Counter-Clockwise (Left Turn)"}`,
        font: { family: 'Arial', size: 18 }
      },
      font: { family: 'Arial, sans-serif' },
      showlegend: true,
      legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
      xaxis: {
        title: { text: 'Lateral Position (mm)' },
        scaleanchor: 'y', // Lock Aspect Ratio 1:1
        scaleratio: 1,
        zeroline: true,
        showgrid: true,
        gridcolor: '#e5e7eb',
        zerolinecolor: '#9ca3af'
      },
      yaxis: {
        title: { text: 'Height (mm)' },
        zeroline: true,
        showgrid: true,
        gridcolor: '#e5e7eb',
        zerolinecolor: '#9ca3af'
      },
      hovermode: 'closest',
      margin: { l: 60, r: 60, b: 80, t: 80 },
      // Add annotations for summary stats
      annotations: [
        {
          xref: 'paper',
          yref: 'paper',
          x: 0,
          y: 1.08,
          xanchor: 'left',
          text: `Status: **${statusText}**`,
          showarrow: false,
          font: { color: data.globalStatus === 'FAIL' ? 'red' : 'green', size: 14 }
        },
        {
          xref: 'paper',
          yref: 'paper',
          x: 1,
          y: 1.08,
          xanchor: 'right',
          // Ordered labels: Roll, Lat, Bounce
          text:
            `Roll: ${rollTotalDegInclCantAndTol.toFixed(2)}°\n` +
            `Lat: ±${latTotalMm.toFixed(1)} mm\n` +
            `Bounce: ${bounceTotalMm.toFixed(1)} mm`,
          showarrow: false,
          font: { size: 12, color: '#555' }
        }
      ]
    };

    return { plotData: traces, layout };
  }, [data, params]);

  return (
    <Plot
      data={plotData}
      layout={layout}
      style={{ width: '100%', height: '100%' }}
      config={{ responsive: true, displaylogo: false }}
    />
  );
};

