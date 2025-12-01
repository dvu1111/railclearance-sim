import React, { useRef, useEffect, useState } from 'react';
import { SimulationResult, SimulationParams, Point } from '../types';

interface VisualizerProps {
    data: SimulationResult;
    params: SimulationParams;
}

const Visualizer: React.FC<VisualizerProps> = ({ data, params }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Handle Resize
    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                });
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Drawing Logic
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || dimensions.width === 0 || dimensions.height === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
        ctx.scale(dpr, dpr);

        const width = dimensions.width;
        const height = dimensions.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // --- Coordinate System Setup ---
        const { polygons, studyPoints, pivot } = data;
        let allX: number[] = [pivot.x];
        let allY: number[] = [pivot.y];

        (['left', 'right'] as const).forEach(s => {
            const p = polygons[s];
            allX.push(...p.x, ...p.static_x, ...p.rot_static_x);
            allY.push(...p.y, ...p.static_y);
        });
        studyPoints.forEach(sp => {
            allX.push(sp.p.x);
            allY.push(sp.p.y);
        });

        const minX = Math.min(...allX);
        const maxX = Math.max(...allX);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);

        // Viewport config
        const marginX = 800;
        const marginY = 800;
        const dataW = (maxX - minX) + marginX * 2;
        const dataH = (maxY - minY) + marginY * 2;

        const plotXStart = 60;
        const plotYStart = 60;
        const plotW = width - plotXStart - 20;
        const plotH = height - plotYStart - 40;

        const scaleX = plotW / dataW;
        const scaleY = plotH / dataH;
        const scale = Math.min(scaleX, scaleY);

        const dataCx = (minX + maxX) / 2;
        const dataCy = (minY + maxY) / 2;

        const cx = plotXStart + plotW / 2;
        const cy = plotYStart + plotH / 2;

        const toScreen = (x: number, y: number): Point => ({
            x: cx + (x - dataCx) * scale,
            y: cy - (y - dataCy) * scale
        });

        // --- Grid ---
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 4]);

        const gridSize = 500;
        const startGridX = Math.floor((minX - marginX) / gridSize) * gridSize;
        const endGridX = Math.ceil((maxX + marginX) / gridSize) * gridSize;
        const startGridY = Math.floor((minY - marginY) / gridSize) * gridSize;
        const endGridY = Math.ceil((maxY + marginY) / gridSize) * gridSize;

        ctx.font = '10px Arial';
        ctx.fillStyle = '#9ca3af';

        ctx.textAlign = 'center';
        for (let gx = startGridX; gx <= endGridX; gx += gridSize) {
            const p = toScreen(gx, 0);
            if (p.x >= plotXStart && p.x <= width) {
                ctx.beginPath(); ctx.moveTo(p.x, plotYStart); ctx.lineTo(p.x, height - 20); ctx.stroke();
                if (gx % 1000 === 0) ctx.fillText(gx.toString(), p.x, height - 5);
            }
        }
        ctx.textAlign = 'right';
        for (let gy = startGridY; gy <= endGridY; gy += gridSize) {
            const p = toScreen(0, gy);
            if (p.y >= plotYStart && p.y <= height - 20) {
                ctx.beginPath(); ctx.moveTo(plotXStart, p.y); ctx.lineTo(width, p.y); ctx.stroke();
                if (gy % 1000 === 0) ctx.fillText(gy.toString(), plotXStart - 5, p.y + 3);
            }
        }
        ctx.restore();

        // Axis Titles
        ctx.save();
        ctx.fillStyle = '#374151';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText("x (mm)", plotXStart + plotW / 2, height - 5);
        ctx.translate(15, plotYStart + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("y (mm)", 0, 0);
        ctx.restore();

        // --- 1. Draw Original Static (Solid Blue) ---
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.0;
        ctx.setLineDash([]);
        ctx.beginPath();
        (['left', 'right'] as const).forEach(s => {
            const p = polygons[s];
            if (p.static_x.length > 0) {
                const start = toScreen(p.static_x[0], p.static_y[0]);
                ctx.moveTo(start.x, start.y);
                for (let i = 1; i < p.static_x.length; i++) {
                    const pt = toScreen(p.static_x[i], p.static_y[i]);
                    ctx.lineTo(pt.x, pt.y);
                }
            }
        });
        ctx.stroke();

        // --- 2. Draw Rotated Static (Dotted Blue + Fill) ---
        const rotPoly: Point[] = [];
        polygons.left.rot_static_x.forEach((x, i) => rotPoly.push(toScreen(x, polygons.left.rot_static_y[i])));
        for (let i = polygons.right.rot_static_x.length - 1; i >= 0; i--) {
            rotPoly.push(toScreen(polygons.right.rot_static_x[i], polygons.right.rot_static_y[i]));
        }

        ctx.save();
        ctx.beginPath();
        if (rotPoly.length) {
            ctx.moveTo(rotPoly[0].x, rotPoly[0].y);
            for (let i = 1; i < rotPoly.length; i++) ctx.lineTo(rotPoly[i].x, rotPoly[i].y);
            ctx.closePath();
        }
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.restore();

        // --- 3. Dynamic Envelope (Polygon) ---
        const envPoly: Point[] = [];
        polygons.left.x.forEach((x, i) => envPoly.push(toScreen(x, polygons.left.y[i])));
        for (let i = polygons.right.x.length - 1; i >= 0; i--) {
            envPoly.push(toScreen(polygons.right.x[i], polygons.right.y[i]));
        }

        ctx.save();
        ctx.beginPath();
        if (envPoly.length) {
            ctx.moveTo(envPoly[0].x, envPoly[0].y);
            for (let i = 1; i < envPoly.length; i++) ctx.lineTo(envPoly[i].x, envPoly[i].y);
            ctx.closePath();
        }

        if (data.globalStatus === 'FAIL') ctx.fillStyle = 'rgba(254, 202, 202, 0.4)'; // Red
        else if (data.globalStatus === 'BOUNDARY') ctx.fillStyle = 'rgba(251, 191, 36, 0.4)'; // Amber
        else ctx.fillStyle = 'rgba(230, 249, 230, 0.4)'; // Green
        
        ctx.fill();
        ctx.strokeStyle = '#FF6347'; // Tomato
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.restore();

        // --- Pivot ---
        const piv = toScreen(pivot.x, pivot.y);
        ctx.strokeStyle = 'black'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(piv.x - 6, piv.y); ctx.lineTo(piv.x + 6, piv.y);
        ctx.moveTo(piv.x, piv.y - 6); ctx.lineTo(piv.x, piv.y + 6);
        ctx.stroke();

        // --- Study Points & Annotations ---
        studyPoints.forEach(sp => {
            const scr = toScreen(sp.p.x, sp.p.y);
            const isET = sp.throwType === 'ET';
            const color = isET ? '#059669' : '#d946ef';

            // Marker
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(scr.x - 4, scr.y); ctx.lineTo(scr.x + 4, scr.y);
            ctx.moveTo(scr.x, scr.y - 4); ctx.lineTo(scr.x, scr.y + 4);
            ctx.stroke();

            // Text Setup
            const isLeft = sp.side === 'left';
            const textAlign = isLeft ? 'right' : 'left';
            const textXOffset = isLeft ? -10 : 10;

            // Y Label
            ctx.font = '11px Arial';
            ctx.fillStyle = '#008000';
            ctx.textAlign = textAlign;
            ctx.fillText(`y:${sp.p.y.toFixed(0)}`, scr.x + textXOffset, scr.y - 30);

            // X Drop line
            ctx.save();
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = '#008000'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(scr.x, scr.y); ctx.lineTo(scr.x, height - 20); ctx.stroke();
            ctx.restore();
            ctx.textAlign = 'center';
            ctx.fillText(sp.p.x.toFixed(0), scr.x, height - 5);

            // A. Shift Delta (Static vs Rotated Static)
            if (sp.rotStaticX !== null && sp.origStaticX !== null) {
                const rotScr = toScreen(sp.rotStaticX, sp.p.y);
                const origScr = toScreen(sp.origStaticX, sp.p.y);
                const dist = Math.abs(sp.rotStaticX - sp.origStaticX);

                if (dist > 0.5) {
                    ctx.beginPath();
                    ctx.strokeStyle = '#2563eb';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 2]);
                    ctx.moveTo(origScr.x, origScr.y);
                    ctx.lineTo(rotScr.x, rotScr.y);
                    ctx.stroke();

                    ctx.fillStyle = '#2563eb';
                    ctx.beginPath(); ctx.arc(origScr.x, origScr.y, 2, 0, 2 * Math.PI); ctx.fill();
                    ctx.beginPath(); ctx.arc(rotScr.x, rotScr.y, 2, 0, 2 * Math.PI); ctx.fill();

                    const midX = (rotScr.x + origScr.x) / 2;
                    ctx.font = '10px Arial';
                    ctx.fillStyle = '#1d4ed8';
                    ctx.textAlign = 'center';
                    ctx.fillText(`Shift: ${dist.toFixed(1)}`, midX, scr.y - 18);
                }
            }

            // B. Static Delta (Rotated Static vs Point)
            if (sp.rotStaticX !== null) {
                const statScr = toScreen(sp.rotStaticX, sp.p.y);
                ctx.beginPath(); ctx.strokeStyle = 'red'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
                ctx.moveTo(statScr.x, statScr.y); ctx.lineTo(scr.x, scr.y); ctx.stroke();
                ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(statScr.x, statScr.y, 2, 0, 2 * Math.PI); ctx.fill();

                const dist = Math.abs(sp.p.x - sp.rotStaticX);
                ctx.font = 'bold 11px Arial';
                ctx.fillStyle = 'red';
                ctx.textAlign = textAlign;
                ctx.fillText(`Δ ${sp.throwType} Static: ${dist.toFixed(1)}`, scr.x + textXOffset, scr.y - 18);
            }

            // C. Env Delta (Envelope vs Point)
            if (sp.envX !== null) {
                const envScr = toScreen(sp.envX, sp.p.y);
                ctx.beginPath(); ctx.strokeStyle = '#800080'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
                ctx.moveTo(envScr.x, envScr.y); ctx.lineTo(scr.x, scr.y); ctx.stroke();

                const dist = Math.abs(sp.p.x - sp.envX);
                ctx.font = 'bold 11px Arial';
                ctx.fillStyle = '#4B0082';
                ctx.textAlign = textAlign;
                ctx.fillText(`Δ Env: ${dist.toFixed(1)}`, scr.x + textXOffset, scr.y - 6);
            }
        });

        // --- Header Info ---
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        const dirText = params.direction === 'cw' ? "Clockwise (Right Turn)" : "Counter-Clockwise (Left Turn)";
        ctx.fillText(`Vehicle Outline Simulation - ${dirText}`, cx, 20);

        ctx.font = '14px Arial';
        let statusText = "PASS (Inside)";
        if (data.globalStatus === 'FAIL') statusText = "FAIL (Outside)";
        else if (data.globalStatus === 'BOUNDARY') statusText = "BOUNDARY (On Line)";

        let tolText = params.enableTolerances 
            ? ` | Tol Lat: ±${data.calculatedParams.tolLatShift}mm | Cant Tol: ${data.calculatedParams.cantTolUsed.toFixed(2)}°` 
            : "";
        ctx.fillText(`Status: ${statusText} | Roll: ±${Math.abs(data.calculatedParams.rollUsed).toFixed(2)}° | Play: ±${params.latPlay.toFixed(1)}mm${tolText}`, cx, 40);
        ctx.restore();

        // --- Legend ---
        drawLegend(ctx, width - 140, 10);

    }, [data, params, dimensions]); // Re-draw when data or size changes

    return (
        <div ref={containerRef} className="w-full h-full relative bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
            <canvas ref={canvasRef} className="block w-full h-full" />
        </div>
    );
};

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const w = 130;
    const h = 150;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);

    const items = [
        { color: 'black', text: 'Pivot (0, 1100)', type: 'symbol' },
        { color: 'rgba(230, 249, 230, 1)', text: 'Dynamic Env', type: 'rect' },
        { color: 'rgba(59, 130, 246, 0.4)', text: 'Static (Rotated)', type: 'dottedRect' },
        { color: '#2563eb', text: 'Original Static', type: 'line' },
        { color: '#008000', text: 'Point (ET/CT)', type: 'symbol' },
        { color: '#2563eb', text: 'Shift (Lat+Roll)', type: 'dashed' },
        { color: 'red', text: 'Δ Static (Red)', type: 'dashed' },
        { color: '#800080', text: 'Δ Env (Purple)', type: 'dashed' },
    ];

    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let cy = y + 10;
    const lx = x + 10;
    const tx = x + 25;

    items.forEach(item => {
        ctx.fillStyle = 'black'; ctx.fillText(item.text, tx, cy);
        if (item.type === 'line') {
            ctx.strokeStyle = item.color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(lx - 6, cy); ctx.lineTo(lx + 6, cy); ctx.stroke();
        } else if (item.type === 'dashed') {
            ctx.strokeStyle = item.color; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(lx - 6, cy); ctx.lineTo(lx + 6, cy); ctx.stroke();
        } else if (item.type === 'rect') {
            ctx.fillStyle = item.color; ctx.strokeStyle = '#FF6347'; ctx.setLineDash([2, 1]); ctx.lineWidth = 1;
            ctx.fillRect(lx - 6, cy - 3, 12, 6); ctx.strokeRect(lx - 6, cy - 3, 12, 6);
        } else if (item.type === 'dottedRect') {
            ctx.fillStyle = item.color; ctx.strokeStyle = '#2563eb'; ctx.setLineDash([1, 2]); ctx.lineWidth = 1;
            ctx.fillRect(lx - 6, cy - 3, 12, 6); ctx.strokeRect(lx - 6, cy - 3, 12, 6);
        } else if (item.type === 'symbol') {
            ctx.strokeStyle = item.color; ctx.lineWidth = 2; ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(lx - 3, cy); ctx.lineTo(lx + 3, cy);
            ctx.moveTo(lx, cy - 3); ctx.lineTo(lx, cy + 3);
            ctx.stroke();
        }
        cy += 16;
    });
    ctx.restore();
}

export default Visualizer;