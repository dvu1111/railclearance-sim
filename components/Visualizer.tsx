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
            hoverinfo: 'skip'
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
                hoverinfo: 'skip'
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
                showlegend: side === 'left'
            });
        });

        // 4. Study Vehicle Overlay
        if (params.showStudyVehicle) {
            traces.push({
                x: studyVehicle.static_x, y: studyVehicle.static_y,
                mode: 'lines', line: { color: '#4b5563', dash: 'dash', width: 1.5 },
                name: 'Study Veh (Static)'
            });
            if (studyVehicle.dynamic_x.length > 0) {
                traces.push({
                    x: studyVehicle.dynamic_x, y: studyVehicle.dynamic_y,
                    mode: 'lines', line: { color: '#f97316', dash: 'dot', width: 1.5 },
                    name: 'Study Veh (Dynamic)'
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
                name: `${sp.side.toUpperCase()} Point`,
                showlegend: false,
                hovertemplate: `<b>${sp.side} (${sp.throwType})</b><br>x: %{x:.1f}<br>y: %{y:.1f}<extra></extra>`
            });

            // Measurement Lines
            const addMeasure = (targetX: number | null, name: string, lineColor: string) => {
                if (targetX === null) return;
                traces.push({
                    x: [sp.p.x, targetX], y: [y, y],
                    mode: 'lines',
                    line: { color: lineColor, dash: 'dot', width: 1 },
                    showlegend: false,
                    hoverinfo: 'text',
                    text: `${name}: ${Math.abs(sp.p.x - targetX).toFixed(1)}mm`
                });
            };

            addMeasure(sp.envX, 'Δ Env', '#800080');
            if (params.showStudyVehicle) addMeasure(sp.staticStudyX, 'Δ Veh', '#2563eb');
        });

        // 6. Pivot
        traces.push({
            x: [pivot.x], y: [pivot.y],
            mode: 'markers', marker: { size: 10, color: 'black', symbol: 'x' },
            name: 'Pivot', showlegend: false
        });

        // Layout
        const layout: Partial<Layout> = {
            autosize: true,
            title: {
                text: `<b>Simulation Results</b><br><span style="font-size: 12px; color: gray;">Roll: ${calculatedParams.rollUsed.toFixed(2)}° | Bounce: ${params.bounce}mm | Status: ${globalStatus}</span>`,
                font: { family: 'Arial', size: 18 }
            },
            showlegend: true,
            legend: { orientation: 'h', y: -0.1 },
            margin: { l: 50, r: 50, b: 50, t: 80 },
            xaxis: { title: 'Lateral (mm)', zeroline: true, scaleanchor: 'y', scaleratio: 1 },
            yaxis: { title: 'Vertical (mm)', zeroline: true },
            hovermode: 'closest'
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
                config={{ displayModeBar: true, responsive: true }}
            />
        </div>
    );
};

export default Visualizer;