import { OUTLINE_DATA_SETS } from "../constants";
import { Point, SimulationParams, SimulationResult, StudyPointResult, PolyCoords } from "../types";

// --- Math Helpers ---
function radians(deg: number) { return deg * Math.PI / 180; }
function degrees(rad: number) { return rad * 180 / Math.PI; }

function getRotatedCoords(x: number, y: number, angleDeg: number, cx: number, cy: number): Point {
    const rad = radians(angleDeg);
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + dx * c - dy * s,
        y: cy + dx * s + dy * c
    };
}

// Linear interpolation to find X at a given Y
function getXAtY(targetY: number, polyPoints: Point[], side: 'right' | 'left' = 'right'): number | null {
    const intersections: number[] = [];
    for (let i = 0; i < polyPoints.length - 1; i++) {
        const p1 = polyPoints[i];
        const p2 = polyPoints[i + 1];

        const y1 = p1.y, y2 = p2.y;
        const x1 = p1.x, x2 = p2.x;

        if ((y1 <= targetY && targetY <= y2) || (y2 <= targetY && targetY <= y1)) {
            if (y1 === y2) {
                intersections.push(x1, x2);
            } else {
                const slope = (x2 - x1) / (y2 - y1);
                const x = x1 + (targetY - y1) * slope;
                intersections.push(x);
            }
        }
    }
    if (intersections.length === 0) return null;
    return side === 'right' ? Math.max(...intersections) : Math.min(...intersections);
}

function pointInPolygon(point: Point, vs: Point[]) {
    const x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, yi = vs[i].y;
        const xj = vs[j].x, yj = vs[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// --- Main Simulation Function ---
export function calculateEnvelope(params: SimulationParams): SimulationResult {
    const R_mm = params.radius * 1000;
    const isCW = params.direction === 'cw';

    const outlineData = OUTLINE_DATA_SETS[params.outlineId];
    if (!outlineData) {
        throw new Error("Invalid Outline ID");
    }

    const PIVOT_POINT: Point = { x: 0, y: outlineData.h_roll || 1100 };
    const rawPoints = outlineData.points;

    // 1. Calculations - Tolerances
    let tolLatShift = 0;
    let cantTolAngleDeg = 0;
    let bounce = params.bounce;

    if (params.enableTolerances) {
        bounce += params.tol_vert;
        
        // Cant Tolerance (Uncertainty) - Always Widens Envelope
        // Converted from mm using roughly 1137mm gauge center
        const cantTolRad = params.tol_cant / 1137; 
        cantTolAngleDeg = degrees(cantTolRad);
        
        tolLatShift = params.tol_lat + params.tol_gw;
    }

    // 2. Calculations - Applied Cant (Deterministic Bias)
    // Affects the whole vehicle body lean based on track banking
    const appliedCantRad = params.appliedCant / 1137;
    const appliedCantDeg = degrees(appliedCantRad);
    
    // Determine Bias Direction
    // If CW (Right Turn): Left rail high -> Tilt Right (Negative Angle)
    // If CCW (Left Turn): Right rail high -> Tilt Left (Positive Angle)
    const cantBiasAngle = isCW ? -appliedCantDeg : appliedCantDeg;

    // Kinematic Throws
    let calc_ET = 0, calc_CT = 0;
    let veh_ET = 0, veh_CT = 0;

    if (R_mm !== 0) {
        calc_ET = (Math.pow(params.L_outline, 2) - Math.pow(params.B_outline, 2)) / (8 * R_mm);
        calc_CT = Math.pow(params.B_outline, 2) / (8 * R_mm);

        veh_ET = (Math.pow(params.L_veh, 2) - Math.pow(params.B_veh, 2)) / (8 * R_mm);
        veh_CT = Math.pow(params.B_veh, 2) / (8 * R_mm);
    }

    const polyCoords: { left: PolyCoords; right: PolyCoords } = {
        left: { x: [], y: [], static_x: [], static_y: [], rot_static_x: [], rot_static_y: [] },
        right: { x: [], y: [], static_x: [], static_y: [], rot_static_x: [], rot_static_y: [] }
    };

    // Roll Logic
    // Start with Dynamic Roll Limits (+/- Body Roll)
    let rollLeftAngle = Math.abs(params.roll);
    let rollRightAngle = -Math.abs(params.roll);

    // Apply Deterministic Cant Bias (Shift both limits)
    rollLeftAngle += cantBiasAngle;
    rollRightAngle += cantBiasAngle;

    // Apply Cant Tolerance (Widen both limits)
    // Extend Left limit more Left (Positive)
    // Extend Right limit more Right (Negative)
    rollLeftAngle += cantTolAngleDeg;
    rollRightAngle -= cantTolAngleDeg;

    // Process Left and Right sides of the vehicle outline
    (['right', 'left'] as const).forEach(side => {
        const xMult = (side === 'right') ? 1 : -1;
        let throwVal = 0;

        if (isCW) {
            if (side === 'left') throwVal = calc_ET;
            else throwVal = calc_CT;
        } else {
            if (side === 'left') throwVal = calc_CT;
            else throwVal = calc_ET;
        }

        const stdLatShift = (side === 'right') ? params.latPlay : -params.latPlay;
        const preRotTolShift = (side === 'right') ? tolLatShift : -tolLatShift;

        // Static lean angle for visualization
        // Apply roll to widen both sides:
        // Left side -> Rotate CCW (Positive)
        // Right side -> Rotate CW (Negative)
        const sideRoll = (side === 'left') ? Math.abs(params.roll) : -Math.abs(params.roll);
        const staticLeanAngle = cantBiasAngle + sideRoll;

        // Iterate through outline segments
        for (let i = 0; i < rawPoints.length - 1; i++) {
            const curr = rawPoints[i];
            const next = rawPoints[i + 1];

            const sx1 = curr.x * xMult, sy1 = curr.y;
            const sx2 = next.x * xMult, sy2 = next.y;

            let b1 = (curr.y > params.bounceYThreshold) ? bounce : 0;
            let b2 = (next.y > params.bounceYThreshold) ? bounce : 0;

            const segPoints = [
                { x: sx1, y: sy1, bounceOffset: b1 },
                { x: sx2, y: sy2, bounceOffset: b2 }
            ];

            segPoints.forEach(p => {
                // 1. Original Static
                polyCoords[side].static_x.push(p.x);
                polyCoords[side].static_y.push(p.y);

                // 2. Rotated Static (Visualization of Nominal Cant + Roll)
                const rotS = getRotatedCoords(p.x, p.y, staticLeanAngle, PIVOT_POINT.x, PIVOT_POINT.y);
                polyCoords[side].rot_static_x.push(rotS.x + stdLatShift);
                // Apply Y-rotation to visualization if enabled, otherwise use original Y
                polyCoords[side].rot_static_y.push(params.considerYRotation ? rotS.y : p.y);

                // 3. Dynamic Calculation
                // A. Pre-Rotation Translation (Throw + Tolerance)
                const x_pre = p.x + (throwVal * xMult) + preRotTolShift;
                const y_pre = p.y + p.bounceOffset;

                // B. Rotation - Calculate BOTH extremes to find envelope
                const rotOpt1 = getRotatedCoords(x_pre, y_pre, rollLeftAngle, PIVOT_POINT.x, PIVOT_POINT.y);
                const rotOpt2 = getRotatedCoords(x_pre, y_pre, rollRightAngle, PIVOT_POINT.x, PIVOT_POINT.y);

                let rot: Point;
                // Match Static Visualization Logic: Use side-specific rotation angle
                // Left Side -> Left Roll (rotOpt1)
                // Right Side -> Right Roll (rotOpt2)
                if (side === 'right') {
                    rot = rotOpt2;
                } else {
                    rot = rotOpt1;
                }

                // C. Post-Rotation Translation
                const final_x = rot.x + stdLatShift;
                // If flag is enabled, use the rotated Y coordinate. Otherwise maintain constant Y (legacy).
                const final_y = params.considerYRotation ? rot.y : y_pre; 

                polyCoords[side].x.push(final_x);
                polyCoords[side].y.push(final_y);
            });
        }
    });

    // --- Study Points Logic ---
    // Calculate effective height for bounce scaling
    const ys = rawPoints.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const vHeight = (maxY - minY) || 1;
    const h_bounced = params.h + ((params.h - minY) / vHeight) * bounce;

    const studyPoints: StudyPointResult[] = [];

    (['right', 'left'] as const).forEach(side => {
        const xMult = (side === 'right') ? 1 : -1;
        let ptThrowVal = 0;
        let ptThrowType = '';

        if (isCW) {
            if (side === 'left') { ptThrowVal = veh_ET; ptThrowType = 'ET'; }
            else { ptThrowVal = veh_CT; ptThrowType = 'CT'; }
        } else {
            if (side === 'left') { ptThrowVal = veh_CT; ptThrowType = 'CT'; }
            else { ptThrowVal = veh_ET; ptThrowType = 'ET'; }
        }

        const stdLatShift = (side === 'right') ? params.latPlay : -params.latPlay;
        const preRotTolShift = (side === 'right') ? tolLatShift : -tolLatShift;

        // A. Pre-Rotation
        const x_raw = (params.w / 2 * xMult) + (ptThrowVal * xMult) + preRotTolShift;
        const y_pos = h_bounced;

        // B. Rotate
        const p_r1 = getRotatedCoords(x_raw, y_pos, rollLeftAngle, PIVOT_POINT.x, PIVOT_POINT.y);
        const p_r2 = getRotatedCoords(x_raw, y_pos, rollRightAngle, PIVOT_POINT.x, PIVOT_POINT.y);

        let p_rot: Point;
        // Match Static Visualization Logic: Use side-specific rotation angle
        if (side === 'right') {
            p_rot = p_r2;
        } else {
            p_rot = p_r1;
        }

        // C. Post-Rotation
        const x_final = p_rot.x + stdLatShift;
        // Apply Y-rotation to study points if enabled
        const final_y_sp = params.considerYRotation ? p_rot.y : y_pos;

        // --- Calculate Deltas for Analysis ---
        // If Y-Rotation is enabled, we need to check the envelopes at the NEW height of the point
        const y_check = final_y_sp;
        
        const rotStaticPts = polyCoords[side].rot_static_x.map((x, i) => ({ x: x, y: polyCoords[side].rot_static_y[i] }));
        const rotStaticX = getXAtY(y_check, rotStaticPts, side);

        const origStaticPts = polyCoords[side].static_x.map((x, i) => ({ x: x, y: polyCoords[side].static_y[i] }));
        const origStaticX = getXAtY(y_check, origStaticPts, side);

        const envPts = polyCoords[side].x.map((x, i) => ({ x: x, y: polyCoords[side].y[i] }));
        const envX = getXAtY(y_check, envPts, side);

        studyPoints.push({
            p: { x: x_final, y: final_y_sp },
            side,
            throwType: ptThrowType,
            rotStaticX,
            origStaticX,
            envX
        });
    });

    // --- Global Pass/Fail ---
    // Construct full polygon for "Point In Polygon" test
    const fullPoly: Point[] = [];
    polyCoords.left.x.forEach((x, i) => fullPoly.push({ x: x, y: polyCoords.left.y[i] }));
    for (let i = polyCoords.right.x.length - 1; i >= 0; i--) {
        fullPoly.push({ x: polyCoords.right.x[i], y: polyCoords.right.y[i] });
    }

    let globalStatus: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';
    
    if (fullPoly.length > 0 && studyPoints.length > 0) {
        let hasFail = false;
        let hasBoundary = false;
        studyPoints.forEach(sp => {
            const isStrictlyInside = pointInPolygon(sp.p, fullPoly);
            let isLocalBoundary = false;
            
            if (sp.envX !== null) {
                const dist = Math.abs(sp.p.x - sp.envX);
                if (dist <= 1e-9) { // Visual tolerance of 1e-9mm
                    hasBoundary = true;
                    isLocalBoundary = true;
                }
            }
            if (!isLocalBoundary && !isStrictlyInside) hasFail = true;
        });
        if (hasFail) globalStatus = 'FAIL';
        else if (hasBoundary) globalStatus = 'BOUNDARY';
    }

    return {
        polygons: polyCoords,
        studyPoints,
        globalStatus,
        calculatedParams: {
            rollUsed: params.roll,
            cantTolUsed: cantTolAngleDeg,
            appliedCantUsed: appliedCantDeg,
            tolLatShift
        },
        pivot: PIVOT_POINT
    };
}