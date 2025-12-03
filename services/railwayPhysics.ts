import { OUTLINE_DATA_SETS } from "../constants";
import { Point, SimulationParams, SimulationResult, StudyPointResult, PolyCoords, DeltaCurveData } from "../types";
import { Clipper, Path64, Point64, FillRule } from "../lib/clipper2-ts/index";

// --- Constants & Helpers ---
const CLIPPER_SCALE = 1000;
const PIVOT_DEFAULT = { x: 0, y: 1100 };
const TOLERANCE = 0.1; // 0.1 mm tolerance for boundary checks

function radians(deg: number) { return deg * Math.PI / 180; }
function degrees(rad: number) { return rad * 180 / Math.PI; }

function toPoint64(p: Point): Point64 {
    return { x: Math.round(p.x * CLIPPER_SCALE), y: Math.round(p.y * CLIPPER_SCALE) };
}

function fromPoint64(p: Point64): Point {
    return { x: p.x / CLIPPER_SCALE, y: p.y / CLIPPER_SCALE };
}

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

// --- Pipeline Steps ---

const calculateThrows = (L: number, B: number, R_mm: number, isCW: boolean, useTrig: boolean) => {
    if (R_mm === 0) return { right: 0, left: 0, ET: 0, CT: 0 };
    
    let ET: number, CT: number;

    if (useTrig) {
        // Precise calculation using exact geometry (from user images)
        // Center Throw (CT): R - sqrt(R^2 - B^2/4)
        // End Throw (ET): sqrt(R^2 - B^2/4) - sqrt(R^2 - L^2/4)
        
        const halfB = B / 2;
        const halfL = L / 2;
        const R2 = Math.pow(R_mm, 2);
        const halfB2 = Math.pow(halfB, 2);
        const halfL2 = Math.pow(halfL, 2);
        
        // Guard against mathematical impossible scenarios (B > 2R)
        if (R2 < halfB2) {
            console.warn("Radius too small for bogie centers, defaulting to approximation");
            ET = (Math.pow(L, 2) - Math.pow(B, 2)) / (8 * R_mm);
            CT = Math.pow(B, 2) / (8 * R_mm);
        } else {
            const rootB = Math.sqrt(R2 - halfB2);
            
            // CT = R - sqrt(R^2 - B^2/4)
            CT = R_mm - rootB;
            
            // ET = sqrt(R^2 - B^2/4) - sqrt(R^2 - L^2/4)
            if (R2 < halfL2) {
                // Should not happen in standard rail contexts (Radius < Half Vehicle Length)
                ET = (Math.pow(L, 2) - Math.pow(B, 2)) / (8 * R_mm);
            } else {
                const rootL = Math.sqrt(R2 - halfL2);
                ET = rootB - rootL;
            }
        }
    } else {
        // Geometric formulas (Approximation / Versine)
        ET = (Math.pow(L, 2) - Math.pow(B, 2)) / (8 * R_mm);
        CT = Math.pow(B, 2) / (8 * R_mm);
    }

    // Apply direction logic
    // CW (Right Turn): Right=Inner(CT), Left=Outer(ET)
    // CCW (Left Turn): Right=Outer(ET), Left=Inner(CT)
    const shiftRight = isCW ? CT : ET;
    const shiftLeft = isCW ? -ET : -CT;

    return { right: shiftRight, left: shiftLeft, ET, CT };
};

const calculateTolerances = (params: SimulationParams) => {
    if (!params.enableTolerances) {
        return { latShift: 0, cantTolDeg: 0, bounce: params.bounce };
    }

    const bounce = params.bounce + params.tol_vert;
    const cantTolRad = params.tol_cant / 1137;
    const cantTolDeg = degrees(cantTolRad);
    const latShift = params.tol_lat + params.tol_gw;

    return { latShift, cantTolDeg, bounce };
};

const transformPath = (
    shape: Point[], 
    rollAngle: number, 
    lateralBias: number, 
    throwRight: number, 
    throwLeft: number,
    bounce: number,
    pivot: Point,
    params: SimulationParams
): Path64 => {
    return shape.map(p => {
        // 1. Vertical Bounce
        let y_bounced = p.y;
        if (p.y > params.bounceYThreshold) {
            y_bounced += bounce;
        }

        // 2. Rotation
        const rot = getRotatedCoords(p.x, y_bounced, rollAngle, pivot.x, pivot.y);

        // 3. Lateral Shift (Geometric Throw + Play + Bias)
        const geomThrow = (p.x >= 0) ? throwRight : throwLeft;
        const totalLat = lateralBias + geomThrow;
        
        // 4. Final Coordinates
        const finalX = rot.x + totalLat;
        const finalY = params.considerYRotation ? rot.y : y_bounced;

        return toPoint64({ x: finalX, y: finalY });
    });
};

// --- Main Calculation ---

export function calculateEnvelope(params: SimulationParams): SimulationResult {
    const R_mm = params.radius * 1000;
    const isCW = params.direction === 'cw';
    const outlineData = OUTLINE_DATA_SETS[params.outlineId];
    const useTrig = params.useTrigCalculation ?? false;
    
    if (!outlineData) throw new Error("Invalid Outline ID");

    const pivot = { x: 0, y: outlineData.h_roll || PIVOT_DEFAULT.y };
    
    // 1. Prepare Vehicle Shapes
    const rawPointsRight = outlineData.points;
    const rawPointsLeft = rawPointsRight.map(p => ({ x: -p.x, y: p.y })).reverse();
    const fullStaticShape = [...rawPointsRight, ...rawPointsLeft];

    // 2. Calculate Physics Parameters
    const tols = calculateTolerances(params);
    const refThrows = calculateThrows(params.L_outline, params.B_outline, R_mm, isCW, useTrig);
    const studyThrows = calculateThrows(params.L_veh, params.B_veh, R_mm, isCW, useTrig);

    const appliedCantRad = params.appliedCant / 1137;
    const appliedCantDeg = degrees(appliedCantRad);
    const cantBiasAngle = isCW ? -appliedCantDeg : appliedCantDeg;

    // Roll Angles
    let rollLeftAngle = Math.abs(params.roll) + cantBiasAngle + tols.cantTolDeg;
    let rollRightAngle = -Math.abs(params.roll) + cantBiasAngle - tols.cantTolDeg;

    const latShiftLeft = -params.latPlay - tols.latShift;
    const latShiftRight = params.latPlay + tols.latShift;

    // 3. Generate Envelopes (Using Clipper)
    // Left Lean State
    const pathLeft = transformPath(
        fullStaticShape, rollLeftAngle, latShiftLeft, 
        refThrows.right, refThrows.left, tols.bounce, pivot, params
    );
    // Right Lean State
    const pathRight = transformPath(
        fullStaticShape, rollRightAngle, latShiftRight, 
        refThrows.right, refThrows.left, tols.bounce, pivot, params
    );

    const solution = Clipper.union([pathLeft], [pathRight], FillRule.NonZero);
    
    // Extract Envelope Polygon
    const envX: number[] = [];
    const envY: number[] = [];
    if (solution.length > 0) {
        const outerPath = solution.reduce((p, c) => c.length > p.length ? c : p, []);
        outerPath.forEach(pt => {
            const p = fromPoint64(pt);
            envX.push(p.x);
            envY.push(p.y);
        });
        envX.push(envX[0]);
        envY.push(envY[0]);
    }

    // 4. Study Vehicle Visualization (Optional)
    const halfW = params.w / 2;
    const studyBox: Point[] = [
        { x: -halfW, y: 0 }, { x: halfW, y: 0 },
        { x: halfW, y: params.h }, { x: -halfW, y: params.h },
        { x: -halfW, y: 0 }
    ];

    const studyPathLeft = transformPath(
        studyBox, rollLeftAngle, latShiftLeft, 
        studyThrows.right, studyThrows.left, tols.bounce, pivot, params
    );
    const studyPathRight = transformPath(
        studyBox, rollRightAngle, latShiftRight, 
        studyThrows.right, studyThrows.left, tols.bounce, pivot, params
    );
    const studySolution = Clipper.union([studyPathLeft], [studyPathRight], FillRule.NonZero);

    const dynamicStudyX: number[] = [];
    const dynamicStudyY: number[] = [];
    if (studySolution.length > 0) {
        const outerStudy = studySolution.reduce((p, c) => c.length > p.length ? c : p, []);
        outerStudy.forEach(pt => {
            const p = fromPoint64(pt);
            dynamicStudyX.push(p.x);
            dynamicStudyY.push(p.y);
        });
        dynamicStudyX.push(dynamicStudyX[0]);
        dynamicStudyY.push(dynamicStudyY[0]);
    }

    // 5. Static & Ghost Visualization
    const rotPathStaticLeft = fullStaticShape.map(p => {
        const rot = getRotatedCoords(p.x, p.y, rollLeftAngle, pivot.x, pivot.y);
        return toPoint64({ x: rot.x, y: params.considerYRotation ? rot.y : p.y });
    });
    const rotPathStaticRight = fullStaticShape.map(p => {
        const rot = getRotatedCoords(p.x, p.y, rollRightAngle, pivot.x, pivot.y);
        return toPoint64({ x: rot.x, y: params.considerYRotation ? rot.y : p.y });
    });
    const solutionStatic = Clipper.union([rotPathStaticLeft], [rotPathStaticRight], FillRule.NonZero);
    
    const rotStaticX: number[] = [];
    const rotStaticY: number[] = [];
    if (solutionStatic.length > 0) {
        const outer = solutionStatic.reduce((p, c) => c.length > p.length ? c : p, []);
        outer.forEach(pt => {
            const p = fromPoint64(pt);
            rotStaticX.push(p.x);
            rotStaticY.push(p.y);
        });
        rotStaticX.push(rotStaticX[0]);
        rotStaticY.push(rotStaticY[0]);
    }

    // 6. Study Points Analysis
    const envelopePoly: Point[] = envX.map((x, i) => ({ x, y: envY[i] }));
    const studyPoints = calculateStudyPoints(
        params, rawPointsRight, rawPointsLeft, 
        tols.bounce, pivot, rollLeftAngle, rollRightAngle, 
        latShiftLeft, latShiftRight, studyThrows, 
        envelopePoly, rotStaticX, rotStaticY, isCW
    );

    // 7. Calculate Delta Curve Data (Clearance Deviation)
    const ys = rawPointsRight.map(p => p.y);
    const maxY = Math.max(...ys);
    
    // NEW: Calculate Deltas by iterating every 1mm from 0 to maxY
    // JUST OUTPUT THE ENVX as requested
    const deltaGraphData = calculateDeltaCurvesIterative(0, maxY, envelopePoly);

    // 8. Global Status
    let globalStatus: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';
    if (studyPoints.length > 0) {
        if (studyPoints.some(sp => sp.status === 'FAIL')) globalStatus = 'FAIL';
        else if (studyPoints.some(sp => sp.status === 'BOUNDARY')) globalStatus = 'BOUNDARY';
    }

    return {
        polygons: {
            left: { 
                x: envX, y: envY, 
                static_x: rawPointsLeft.map(p => p.x), static_y: rawPointsLeft.map(p => p.y),
                rot_static_x: rotStaticX, rot_static_y: rotStaticY
            },
            right: { 
                x: [], y: [], // Right side data is implicit in the full envelope for now
                static_x: rawPointsRight.map(p => p.x), static_y: rawPointsRight.map(p => p.y),
                rot_static_x: [], rot_static_y: []
            }
        },
        studyVehicle: {
            static_x: studyBox.map(p => p.x), static_y: studyBox.map(p => p.y),
            dynamic_x: dynamicStudyX, dynamic_y: dynamicStudyY
        },
        studyPoints,
        deltaGraphData,
        globalStatus,
        calculatedParams: {
            rollUsed: params.roll,
            cantTolUsed: tols.cantTolDeg,
            appliedCantUsed: appliedCantDeg,
            tolLatShift: tols.latShift
        },
        pivot
    };
}

function calculateDeltaCurvesIterative(
    minY: number, maxY: number, 
    envelope: Point[]
): DeltaCurveData {
    const result: DeltaCurveData = { y: [], deltaLeft: [], deltaRight: [] };

    // Iterate 1mm steps from 0 to Max Height
    for (let y = minY; y <= maxY; y += 1) {
        // Get Envelope Boundary at this height
        const envL = getXAtY(y, envelope, 'left');
        const envR = getXAtY(y, envelope, 'right');

        if (envL !== null && envR !== null) {
            result.y.push(y);
            // Output absolute X values (Envelope Widths)
            result.deltaLeft.push(Math.abs(envL)); 
            result.deltaRight.push(Math.abs(envR));
        }
    }
    return result;
}

function calculateStudyPoints(
    params: SimulationParams, 
    rawRight: Point[], rawLeft: Point[], 
    bounce: number, pivot: Point,
    rollLeft: number, rollRight: number,
    latLeft: number, latRight: number,
    throws: { right: number, left: number },
    envelope: Point[], rotStaticX: number[], rotStaticY: number[],
    isCW: boolean
): StudyPointResult[] {
    const studyPoints: StudyPointResult[] = [];
    const ys = rawRight.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const vHeight = (maxY - minY) || 1;
    
    // Scale bounce based on height (simple linear interpolation for suspension effect)
    const h_bounced = params.h + ((params.h - minY) / vHeight) * bounce; 

    (['right', 'left'] as const).forEach(side => {
        const isRight = side === 'right';
        const xMult = isRight ? 1 : -1;
        const x_base = params.w / 2 * xMult;
        
        // Determine Throw Label
        const throwType = (isCW === isRight) ? 'CT' : 'ET'; 
        const geomThrowShift = isRight ? throws.right : throws.left;

        // Calculate Critical Point (Max Excursion between Left/Right Lean)
        const p1 = getRotatedCoords(x_base, h_bounced, rollLeft, pivot.x, pivot.y);
        const x1 = p1.x + latLeft + geomThrowShift;
        const y1 = params.considerYRotation ? p1.y : h_bounced;

        const p2 = getRotatedCoords(x_base, h_bounced, rollRight, pivot.x, pivot.y);
        const x2 = p2.x + latRight + geomThrowShift;
        const y2 = params.considerYRotation ? p2.y : h_bounced;

        // Critical logic: Right side -> Max X, Left side -> Min X
        const finalP = (isRight ? (x1 > x2) : (x1 < x2)) ? { x: x1, y: y1 } : { x: x2, y: y2 };
        // Fix variable names from copy/paste (x_1 -> x1)
        if (isRight) {
             // For Right Side (positive X), critical is Max X
             // If leaned right > leaned left
             if (x2 > x1) { finalP.x = x2; finalP.y = y2; } else { finalP.x = x1; finalP.y = y1; }
        } else {
             // For Left Side (negative X), critical is Min X
             // If leaned left < leaned right
             if (x1 < x2) { finalP.x = x1; finalP.y = y1; } else { finalP.x = x2; finalP.y = y2; }
        }

        // Intersections
        const envXAtY = getXAtY(finalP.y, envelope, side);
        const rotStaticPoly = rotStaticX.map((x, i) => ({ x, y: rotStaticY[i] }));
        const rotStaticXAtY = getXAtY(finalP.y, rotStaticPoly, side);
        const origStaticX = getXAtY(finalP.y, isRight ? rawRight : rawLeft, side);

        // Fail Check Logic (Matches Main Branch)
        const isInside = pointInPolygon(finalP, envelope);
        const dist = minDistanceToEdges(finalP, envelope);
        
        let status: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';

        if (dist <= TOLERANCE) {
            // Effectively on the boundary (within tolerance)
            // This captures points that are technically inside OR outside but very close
            status = 'BOUNDARY';
        } else if (!isInside) {
            // Strictly outside and not on boundary
            status = 'FAIL';
        }

        studyPoints.push({
            p: finalP,
            side,
            throwType,
            rotStaticX: rotStaticXAtY,
            origStaticX,
            envX: envXAtY,
            staticStudyX: x_base,
            status
        });
    });

    return studyPoints;
}

// --- Geometry Helpers ---
function getXAtY(targetY: number, polyPoints: Point[], side: 'right' | 'left'): number | null {
    const intersections: number[] = [];
    for (let i = 0; i < polyPoints.length; i++) {
        const p1 = polyPoints[i];
        const p2 = polyPoints[(i + 1) % polyPoints.length];
        const y1 = p1.y, y2 = p2.y;
        const x1 = p1.x, x2 = p2.x;

        if ((y1 <= targetY && targetY <= y2) || (y2 <= targetY && targetY <= y1)) {
            if (Math.abs(y1 - y2) < 0.001) intersections.push(x1, x2);
            else {
                const x = x1 + (targetY - y1) * (x2 - x1) / (y2 - y1);
                intersections.push(x);
            }
        }
    }
    if (intersections.length === 0) return null;
    return side === 'right' ? Math.max(...intersections) : Math.min(...intersections);
}

function pointInPolygon(p: Point, vs: Point[]) {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, yi = vs[i].y;
        const xj = vs[j].x, yj = vs[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function minDistanceToEdges(p: Point, poly: Point[]): number {
    let minDistSq = Number.MAX_VALUE;
    for (let i = 0; i < poly.length; i++) {
        const v = poly[i];
        const w = poly[(i + 1) % poly.length];
        
        // Segment distance squared
        const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
        let t = 0;
        if (l2 === 0) {
            t = 0;
        } else {
            t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
            t = Math.max(0, Math.min(1, t));
        }
        
        const dSq = Math.pow(p.x - (v.x + t * (w.x - v.x)), 2) + Math.pow(p.y - (v.y + t * (w.y - v.y)), 2);
        minDistSq = Math.min(minDistSq, dSq);
    }
    return Math.sqrt(minDistSq);
}