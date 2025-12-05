import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { SimulationResult, SimulationParams } from '../types';
import { Data, Layout } from 'plotly.js';

interface VisualizerProps {
    data: SimulationResult;
    params: SimulationParams;
}

const Visualizer: React.FC<VisualizerProps> = ({ data, params }) => {
    
    const mainPlot = useMemo(() => {
        const traces: Data[] = [];
        const { polygons, studyVehicle, studyPoints, globalStatus, calculatedParams, pivot, structureGauge, throwValues } = data;

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

        // 5. Structure Gauge Lines
        if (params.enableStructureGauge && structureGauge) {
            const maxY = Math.max(...polygons.right.static_y, 4000); // Default high if no points
            
            // Left Structure Line
            traces.push({
                x: [structureGauge.leftX, structureGauge.leftX],
                y: [0, maxY],
                mode: 'lines',
                line: { color: '#444', dash: 'longdash', width: 3 },
                name: 'Structure Gauge',
                legendgroup: 'structure',
                hoverinfo: 'x',
            });

            // Right Structure Line
            traces.push({
                x: [structureGauge.rightX, structureGauge.rightX],
                y: [0, maxY],
                mode: 'lines',
                line: { color: '#444', dash: 'longdash', width: 3 },
                legendgroup: 'structure',
                showlegend: false,
                hoverinfo: 'x',
            });
        }

        // 6. Study Points & Measurements
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

            // --- Structure Gauge Measurement ---
            // Draw from Envelope X (if available) to Structure X, otherwise from point p to structure
            if (params.enableStructureGauge && sp.structureX !== null && sp.envX !== null) {
                traces.push({
                    x: [sp.envX, sp.structureX], y: [y, y],
                    mode: 'lines',
                    line: { color: '#666', dash: 'dot', width: 2 },
                    name: 'Δ Structure',
                    legendgroup: 'delta_struct',
                    showlegend: i === 0,
                    hoverinfo: 'text',
                    text: `Δ Structure: ${Math.abs(sp.envX - sp.structureX).toFixed(2)}mm`
                });
            }

            // --- DETAILED TEXT LABELS ---
            const valStatic = sp.rotStaticX !== null ? Math.abs(sp.p.x - sp.rotStaticX).toFixed(2) : '-';
            const valEnv = sp.envX !== null ? Math.abs(sp.p.x - sp.envX).toFixed(2) : '-';
            const valStudy = (params.showStudyVehicle && sp.staticStudyX !== null) 
                ? Math.abs(sp.p.x - sp.staticStudyX).toFixed(2) 
                : null;
            const valStruct = (params.enableStructureGauge && sp.structureX !== null && sp.envX !== null)
                ? Math.abs(sp.envX - sp.structureX).toFixed(2)
                : null;

            let textAnchorX = sp.p.x;
            // Adjust label anchor based on what lines are shown to avoid overlap
            if (sp.side === 'left') {
                if (sp.envX !== null) textAnchorX = Math.min(textAnchorX, sp.envX);
                if (sp.rotStaticX !== null) textAnchorX = Math.min(textAnchorX, sp.rotStaticX);
                if (sp.staticStudyX !== null && params.showStudyVehicle) textAnchorX = Math.min(textAnchorX, sp.staticStudyX);
                if (sp.structureX !== null && params.enableStructureGauge) textAnchorX = Math.min(textAnchorX, sp.structureX);
            } else {
                if (sp.envX !== null) textAnchorX = Math.max(textAnchorX, sp.envX);
                if (sp.rotStaticX !== null) textAnchorX = Math.max(textAnchorX, sp.rotStaticX);
                if (sp.staticStudyX !== null && params.showStudyVehicle) textAnchorX = Math.max(textAnchorX, sp.staticStudyX);
                if (sp.structureX !== null && params.enableStructureGauge) textAnchorX = Math.max(textAnchorX, sp.structureX);
            }
            
            const offset = sp.side === 'left' ? -20 : 20;

            let labelHtml = 
                `<span style="color: #15803d; font-weight:bold;">y:${sp.p.y.toFixed(0)}</span><br>` +
                `<span style="color: #dc2626; font-weight:bold;">Δ ${sp.throwType} Static: ${valStatic}</span><br>` +
                `<span style="color: #7e22ce; font-weight:bold;">Δ Env: ${valEnv}</span>`;
            
            if (valStudy !== null) {
                labelHtml += `<br><span style="color: #2563eb; font-weight:bold;">Δ Study: ${valStudy}</span>`;
            }

            if (valStruct !== null) {
                labelHtml += `<br><span style="color: #444; font-weight:bold;">Δ Structure: ${valStruct}</span>`;
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

        // 7. Pivot
        traces.push({
            x: [pivot.x], y: [pivot.y],
            mode: 'markers', marker: { size: 12, color: 'black', symbol: 'x' },
            name: 'Pivot Center',
            hovertemplate: '<b>Pivot Center</b><br>x: %{x:.2f}<br>y: %{y:.2f}<extra></extra>'
        });

        const vertTol = params.enableTolerances ? params.tol_vert : 0;
        const rollLabel = `Roll: ${calculatedParams.rollUsed.toFixed(2)}° ±${calculatedParams.cantTolUsed.toFixed(2)}°`;
        const latLabel = `Lat: ±${params.latPlay}mm ±${calculatedParams.tolLatShift}mm`;
        const bounceLabel = `Bounce: ${params.bounce}mm +${vertTol}mm`;
        const cantLabel = `Cant: ${params.appliedCant}mm ±${(params.enableTolerances ? params.tol_cant : 0)}mm`;
        const statsLabel = `${rollLabel} | ${latLabel} | ${bounceLabel} | ${cantLabel}`;

        const directionText = params.direction === 'cw' 
            ? `${params.radius}m Clockwise Curve (Right Turn)` 
            : `${params.radius}m Counter-Clockwise Curve (Left Turn)`;

        // Construct Annotation Text for Status Box
        const getStatusColor = (status: string) => {
            switch(status) {
                case 'FAIL': return '#dc2626'; // red-600
                case 'BOUNDARY': return '#eab308'; // yellow-500
                default: return '#16a34a'; // green-600
            }
        };

        const statusColor = getStatusColor(globalStatus);
        
        let statusAnnotation = 
            `Status: <b style="color:${statusColor}; font-size: 16px;">${globalStatus}</b>`;

        if (params.showThrowInfo) {
            statusAnnotation += 
                `<br><br><b>Reference (${params.outlineId})</b><br>` +
                `L=${params.L_outline}mm B=${params.B_outline}mm<br>` +
                `End Throw: ${throwValues.ref.ET.toFixed(2)} mm<br>` +
                `Center Throw: ${throwValues.ref.CT.toFixed(2)} mm`;

            statusAnnotation += 
                `<br><br><b>Study Vehicle</b><br>` +
                `L=${params.L_veh}mm B=${params.B_veh}mm W=${params.w}mm<br>` +
                `End Throw: ${throwValues.study.ET.toFixed(2)} mm<br>` +
                `Center Throw: ${throwValues.study.CT.toFixed(2)} mm`;
        }

        const layout: Partial<Layout> = {
            autosize: true,
            title: {
                text: `<b>Vehicle Outline Simulation - WORK IN PROGRESS, MAY BE INACCURATE</b><br><span style="font-size: 12px;">${directionText}</span><br><span style="font-size: 11px; color: #555;">${statsLabel}</span>`,
                font: { family: 'Arial', size: 18 }
            },
            font: { family: 'Arial, sans-serif' },
            showlegend: true,
            legend: { orientation: 'h', y: -0.1, x: 0.5, xanchor: 'center' },
            margin: { l: 60, r: 60, b: 60, t: 95 },
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
            // Info box baked into Plotly layout
            annotations: [
                {
                    xref: 'paper',
                    yref: 'paper',
                    x: 0.01,
                    y: 0.99,
                    xanchor: 'left',
                    yanchor: 'top',
                    text: statusAnnotation,
                    showarrow: false,
                    align: 'left',
                    bgcolor: 'rgba(255, 255, 255, 0.9)',
                    bordercolor: '#e5e7eb',
                    borderwidth: 1,
                    borderpad: 10,
                    font: { size: 12, color: '#374151' }
                }
            ]
        };

        return { data: traces, layout };
    }, [data, params]);

    // --- SECOND PLOT: DELTA GRAPH ---
    const deltaPlot = useMemo(() => {
        if (!params.showDeltaGraph || !data.deltaGraphData) return null;

        const { deltaGraphData } = data;
        const isCW = params.direction === 'cw';

        // CW (Right Turn): 
        //   - Right Side is Inner (CT)
        //   - Left Side is Outer (ET)
        // CCW (Left Turn):
        //   - Right Side is Outer (ET)
        //   - Left Side is Inner (CT)

        // Map data to ET/CT based on curve direction
        const etData = isCW ? deltaGraphData.deltaLeft : deltaGraphData.deltaRight;
        const ctData = isCW ? deltaGraphData.deltaRight : deltaGraphData.deltaLeft;

        // X-axis = Height (iterated from 0 to vehicle top)
        // Y-axis = Delta Value (Expansion amount)
        const traces: Data[] = [
            {
                x: deltaGraphData.y, // Height
                y: etData,           // ET Delta
                name: 'ET (End Throw)', 
                type: 'scatter',
                mode: 'lines',
                line: { color: '#059669', width: 2 }, // Green
                hovertemplate: 'Height: %{x:.0f}mm<br>ET Delta: %{y:.2f}mm<extra></extra>'
            },
            {
                x: deltaGraphData.y, // Height
                y: ctData,           // CT Delta
                name: 'CT (Center Throw)', 
                type: 'scatter',
                mode: 'lines',
                line: { color: '#d946ef', width: 2 }, // Magenta
                hovertemplate: 'Height: %{x:.0f}mm<br>CT Delta: %{y:.2f}mm<extra></extra>'
            }
        ];

        const layout: Partial<Layout> = {
            autosize: true,
            title: {
                text: '<b>Clearance Expansion (Delta)</b>',
                font: { family: 'Arial', size: 14 }
            },
            font: { family: 'Arial, sans-serif' },
            showlegend: true,
            legend: { orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center' },
            margin: { l: 60, r: 20, b: 60, t: 40 },
            xaxis: {
                title: { text: 'Height (mm)' }, 
                showgrid: true,
                gridcolor: '#e5e7eb',
                zeroline: true,
            },
            yaxis: {
                title: { text: 'Delta Env (mm)' },
                showgrid: true,
                gridcolor: '#e5e7eb',
                zeroline: true,
            },
            hovermode: 'x unified',
        };

        return { data: traces, layout };
    }, [data, params.showDeltaGraph, params.direction]);

    return (
        <div className="w-full h-full flex flex-col gap-2">
            <div className={`w-full bg-white rounded-lg shadow-lg border border-gray-200 ${params.showDeltaGraph ? 'h-[60%]' : 'h-full'} relative`}>
                <Plot
                    data={mainPlot.data}
                    layout={mainPlot.layout}
                    useResizeHandler={true}
                    className="w-full h-full"
                    config={{ displayModeBar: true, responsive: true, displaylogo: false }}
                />
            </div>
            
            {params.showDeltaGraph && deltaPlot && (
                <div className="w-full h-[40%] bg-white rounded-lg shadow-lg border border-gray-200">
                    <Plot
                        data={deltaPlot.data}
                        layout={deltaPlot.layout}
                        useResizeHandler={true}
                        className="w-full h-full"
                        config={{ displayModeBar: true, responsive: true, displaylogo: false }}
                    />
                </div>
            )}
        </div>
    );
};

export default Visualizer;