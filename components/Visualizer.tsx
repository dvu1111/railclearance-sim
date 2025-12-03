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
        const { polygons, studyVehicle, studyPoints, globalStatus, calculatedParams, pivot } = data;

        // 1. Dynamic Envelope (Filled)
        const envX = [...polygons.left.x, ...[...polygons.right.x].reverse(), polygons.left.x[0]];
        const envY = [...polygons.left.y, ...[...polygons.right.y].reverse(), polygons.left.y[0]];
        
        const statusColors = {
            'PASS': 'rgba(230, 249, 230, 0.6)',
            'FAIL': 'rgba(254, 202, 202, 0.6)',
            'BOUNDARY': 'rgba(251, 191, 36, 0.6)'
        };

        traces.push({
            x: envX, y: envY,
            fill: 'toself',
            fillcolor: statusColors[globalStatus],
            line: { color: '#FF6347', dash: 'dash', width: 2 },
            name: 'Dynamic Envelope',
            type: 'scatter', mode: 'lines',
            hoveron: 'points',
            hovertemplate: '<b>Dynamic Envelope</b><br>x: %{x:.2f}<br>y: %{y:.2f}<extra></extra>'
        });

        // 2. Rotated Static Ghost (Visual Context)
        if (polygons.left.rot_static_x.length > 0) {
            const rX = [...polygons.left.rot_static_x, ...[...polygons.right.rot_static_x].reverse(), polygons.left.rot_static_x[0]];
            const rY = [...polygons.left.rot_static_y, ...[...polygons.right.rot_static_y].reverse(), polygons.left.rot_static_y[0]];
            traces.push({
                x: rX, y: rY,
                fill: 'toself',
                fillcolor: 'rgba(59, 130, 246, 0.1)',
                line: { color: '#2563eb', dash: 'dot', width: 1 },
                name: 'Rotated Static',
                type: 'scatter', mode: 'lines',
                hoveron: 'points',
                hovertemplate: '<b>Rotated Static</b><br>x: %{x:.2f}<br>y: %{y:.2f}<extra></extra>'
            });
        }

        // 3. Original Static Reference
        ['left', 'right'].forEach(side => {
            const p = polygons[side as 'left' | 'right'];
            traces.push({
                x: p.static_x, y: p.static_y,
                line: { color: '#2563eb', width: 2 },
                name: 'Original Static',
                type: 'scatter', mode: 'lines',
                legendgroup: 'static',
                showlegend: side === 'left',
                hovertemplate: '<b>Original Static</b><br>x: %{x:.2f}<br>y: %{y:.2f}<extra></extra>'
            });
        });

        // 4. Study Vehicle Overlay
        if (params.showStudyVehicle) {
            traces.push({
                x: studyVehicle.static_x, y: studyVehicle.static_y,
                mode: 'lines', line: { color: '#4b5563', dash: 'dash', width: 1.5 },
                name: 'Static Study Veh',
                hoverinfo: 'skip'
            });
            if (studyVehicle.dynamic_x.length > 0) {
                traces.push({
                    x: studyVehicle.dynamic_x, y: studyVehicle.dynamic_y,
                    mode: 'lines', line: { color: '#f97316', dash: 'dot', width: 1.5 },
                    name: 'Dynamic Study Veh',
                    hoverinfo: 'skip'
                });
            }
        }

        // 5. Study Points & Measurements
        studyPoints.forEach((sp, i) => {
            const y = sp.p.y;
            const color = sp.throwType === 'ET' ? '#059669' : '#d946ef';

            // Point
            traces.push({
                x: [sp.p.x], y: [sp.p.y],
                mode: 'markers',
                marker: { size: 10, color, symbol: 'cross', line: { width: 2, color } },
                name: `Study Point (${sp.side})`,
                showlegend: false,
                hovertemplate: 
                    `<b>${sp.side.toUpperCase()} Point (${sp.throwType})</b><br>` +
                    `x: %{x:.2f} mm<br>` +
                    `y: %{y:.2f} mm<br>` +
                    `<extra></extra>`
            });

            // Measurement Lines
            const addMeasure = (targetX: number | null, name: string, lineColor: string, legendGroup: string) => {
                if (targetX === null) return;
                traces.push({
                    x: [sp.p.x, targetX], y: [y, y],
                    mode: 'lines',
                    line: { color: lineColor, dash: 'dash', width: 1.5 },
                    name: name,
                    legendgroup: legendGroup,
                    showlegend: i === 0,
                    hoverinfo: 'text',
                    text: `${name}: ${Math.abs(sp.p.x - targetX).toFixed(2)}mm`
                });
            };

            addMeasure(sp.envX, 'Δ Envelope', '#800080', 'delta_env');
            addMeasure(sp.rotStaticX, 'Δ Static', 'red', 'delta_static');
            if (params.showStudyVehicle) addMeasure(sp.staticStudyX, 'Δ Study Veh', '#2563eb', 'delta_study');

            // --- DETAILED TEXT LABELS ---
            const valStatic = sp.rotStaticX !== null ? Math.abs(sp.p.x - sp.rotStaticX).toFixed(2) : '-';
            const valEnv = sp.envX !== null ? Math.abs(sp.p.x - sp.envX).toFixed(2) : '-';
            const valStudy = (params.showStudyVehicle && sp.staticStudyX !== null) 
                ? Math.abs(sp.p.x - sp.staticStudyX).toFixed(2) 
                : null;

            // Calculate anchor X (outermost point) to avoid overlapping the line
            let textAnchorX = sp.p.x;
            if (sp.side === 'left') {
                if (sp.envX !== null) textAnchorX = Math.min(textAnchorX, sp.envX);
                if (sp.rotStaticX !== null) textAnchorX = Math.min(textAnchorX, sp.rotStaticX);
                if (sp.staticStudyX !== null && params.showStudyVehicle) textAnchorX = Math.min(textAnchorX, sp.staticStudyX);
            } else {
                if (sp.envX !== null) textAnchorX = Math.max(textAnchorX, sp.envX);
                if (sp.rotStaticX !== null) textAnchorX = Math.max(textAnchorX, sp.rotStaticX);
                if (sp.staticStudyX !== null && params.showStudyVehicle) textAnchorX = Math.max(textAnchorX, sp.staticStudyX);
            }
            
            // Offset to create a small gap between the line end and the text
            const offset = sp.side === 'left' ? -20 : 20;

            let labelHtml = 
                `<span style="color: #15803d; font-weight:bold;">y:${sp.p.y.toFixed(0)}</span><br>` +
                `<span style="color: #dc2626; font-weight:bold;">Δ ${sp.throwType} Static: ${valStatic}</span><br>` +
                `<span style="color: #7e22ce; font-weight:bold;">Δ Env: ${valEnv}</span>`;
            
            if (valStudy !== null) {
                labelHtml += `<br><span style="color: #2563eb; font-weight:bold;">Δ Study: ${valStudy}</span>`;
            }

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

        // 6. Pivot
        traces.push({
            x: [pivot.x], y: [pivot.y],
            mode: 'markers', marker: { size: 12, color: 'black', symbol: 'x' },
            name: 'Pivot Center',
            hovertemplate: '<b>Pivot Center</b><br>x: %{x:.2f}<br>y: %{y:.2f}<extra></extra>'
        });

        // --- Calculate Labels for Annotation ---
        const vertTol = params.enableTolerances ? params.tol_vert : 0;
        const rollLabel = `Roll: ${calculatedParams.rollUsed.toFixed(2)}° ±${calculatedParams.cantTolUsed.toFixed(2)}°`;
        const latLabel = `Lat: ±${params.latPlay}mm ±${calculatedParams.tolLatShift}mm`;
        const bounceLabel = `Bounce: ${params.bounce}mm +${vertTol}mm`;
        const statsLabel = `${rollLabel} | ${latLabel} | ${bounceLabel}`;

        const directionText = params.direction === 'cw' ? "Clockwise (Right Turn)" : "Counter-Clockwise (Left Turn)";

        // Layout
        const layout: Partial<Layout> = {
            autosize: true,
            title: {
                text: `<b>Vehicle Outline Simulation</b><br><span style="font-size: 12px;">${directionText}</span><br><span style="font-size: 11px; color: #555;">${statsLabel}</span>`,
                font: { family: 'Arial', size: 18 }
            },
            font: { family: 'Arial, sans-serif' },
            showlegend: true,
            legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center' },
            margin: { l: 60, r: 60, b: 80, t: 100 },
            xaxis: { 
                title: { text: 'Lateral Position (mm)' }, 
                zeroline: true, 
                showgrid: true,
                gridcolor: '#e5e7eb',
                zerolinecolor: '#9ca3af',
                scaleanchor: 'y', 
                scaleratio: 1 
            },
            yaxis: { 
                title: { text: 'Height (mm)' }, 
                zeroline: true,
                showgrid: true,
                gridcolor: '#e5e7eb',
                zerolinecolor: '#9ca3af'
            },
            hovermode: 'closest',
            annotations: [
                {
                    xref: 'paper', yref: 'paper',
                    x: 0, y: 1.08,
                    xanchor: 'left',
                    text: `Status: <b>${globalStatus}</b>`,
                    showarrow: false,
                    font: { color: globalStatus === 'FAIL' ? 'red' : (globalStatus === 'BOUNDARY' ? '#eab308' : 'green'), size: 14 }
                }
            ]
        };

        return { plotData: traces, layout };
    }, [data, params]);

    return (
        <div className="w-full h-full bg-white rounded-lg shadow-lg border border-gray-200">
            <Plot
                data={plotData}
                layout={layout}
                useResizeHandler={true}
                className="w-full h-full"
                config={{ 
                    displayModeBar: true, 
                    responsive: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['lasso2d', 'select2d']
                }}
            />
        </div>
    );
};

export default Visualizer;