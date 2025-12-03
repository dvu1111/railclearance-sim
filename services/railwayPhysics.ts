import { OUTLINE_DATA_SETS } from "../constants";
import { Point, SimulationParams, SimulationResult, StudyPointResult, PolyCoords } from "../types";
import { Clipper, Path64, Point64, FillRule } from "../lib/clipper2-ts/index";

// --- Math Helpers ---
function radians(deg: number) { return deg * Math.PI / 180; }
function degrees(rad: number) { return rad * 180 / Math.PI; }

const CLIPPER_SCALE = 1000;

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

// Linear interpolation to find X at a given Y
function getXAtY(targetY: number, polyPoints: Point[], side: 'right' | 'left' = 'right'): number | null {
    const intersections: number[] = [];
    for (let i = 0; i < polyPoints.length; i++) {
        const p1 = polyPoints[i];
        const p2 = polyPoints[(i + 1) % polyPoints.length]; // Wrap around for closed loop

        const y1 = p1.y, y2 = p2.y;
        const x1 = p1.x, x2 = p2.x;

        if ((y1 <= targetY && targetY <= y2) || (y2 <= targetY && targetY <= y1)) {
            if (Math.abs(y1 - y2) < 0.001) {
                // Horizontal line at target Y
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

function distToSegmentSquared(p: Point, v: Point, w: Point): number {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.pow(p.x - v.x, 2) + Math.pow(p.y - v.y, 2);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.pow(p.x - (v.x + t * (w.x - v.x)), 2) + Math.pow(p.y - (v.y + t * (w.y - v.y)), 2);
}

function minDistanceToEdges(p: Point, poly: Point[]): number {
    let minDistSq = Number.MAX_VALUE;
    for (let i = 0; i < poly.length; i++) {
        const v = poly[i];
        const w = poly[(i + 1) % poly.length];
        const dSq = distToSegmentSquared(p, v, w);
        if (dSq < minDistSq) minDistSq = dSq;
    }
    return Math.sqrt(minDistSq);
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
    const rawPointsRight = outlineData.points;
    
    // Construct full vehicle shape (Right side + Mirror Left side)
    const rawPointsLeft = rawPointsRight.map(p => ({ x: -p.x, y: p.y })).reverse();
    const fullStaticShape = [...rawPointsRight, ...rawPointsLeft];

    // 1. Calculations - Tolerances
    let tolLatShift = 0;
    let cantTolAngleDeg = 0;
    let bounce = params.bounce;

    if (params.enableTolerances) {
        bounce += params.tol_vert;
        
        // Cant Tolerance (Uncertainty) - Always Widens Envelope
        const cantTolRad = params.tol_cant / 1137; 
        cantTolAngleDeg = degrees(cantTolRad);
        
        tolLatShift = params.tol_lat + params.tol_gw;
    }

    // 2. Calculations - Applied Cant (Deterministic Bias)
    const appliedCantRad = params.appliedCant / 1137;
    const appliedCantDeg = degrees(appliedCantRad);
    const cantBiasAngle = isCW ? -appliedCantDeg : appliedCantDeg;

    // --- KINEMATIC THROW CALCULATIONS ---

    // A. Reference Outline Throws (Used for the Dynamic Envelope Polygon)
    let ref_ET = 0, ref_CT = 0;
    if (R_mm !== 0) {
        ref_ET = (Math.pow(params.L_outline, 2) - Math.pow(params.B_outline, 2)) / (8 * R_mm);
        ref_CT = Math.pow(params.B_outline, 2) / (8 * R_mm);
    }
    // Apply Throws based on direction for Reference
    const refThrowShiftRight = isCW ? ref_CT : ref_ET; 
    const refThrowShiftLeft = isCW ? -ref_ET : -ref_CT;

    // B. Study Vehicle Throws (Used for the specific Study Points)
    let study_ET = 0, study_CT = 0;
    if (R_mm !== 0) {
        study_ET = (Math.pow(params.L_veh, 2) - Math.pow(params.B_veh, 2)) / (8 * R_mm);
        study_CT = Math.pow(params.B_veh, 2) / (8 * R_mm);
    }
    // Apply Throws based on direction for Study Vehicle
    const studyThrowShiftRight = isCW ? study_CT : study_ET;
    const studyThrowShiftLeft = isCW ? -study_ET : -study_CT;


    // Roll Logic
    let rollLeftAngle = Math.abs(params.roll);
    let rollRightAngle = -Math.abs(params.roll);

    // Apply Bias & Tolerance
    rollLeftAngle += cantBiasAngle + cantTolAngleDeg;
    rollRightAngle += cantBiasAngle - cantTolAngleDeg;

    // --- CLIPPER: Generate Superimposed Envelope ---
    // NOTE: We use REFERENCE throws here to generate the standard envelope
    
    // Function to transform the full shape into a specific state
    const createTransformedPath = (shape: Point[], rollAngle: number, lateralBias: number, throwRight: number, throwLeft: number): Path64 => {
        return shape.map(p => {
            // 1. Bounce (Vertical)
            let y_bounced = p.y;
            if (p.y > params.bounceYThreshold) {
                y_bounced += bounce;
            }

            // 2. Rotation (Body Roll) - Rotate FIRST
            const rot = getRotatedCoords(p.x, y_bounced, rollAngle, PIVOT_POINT.x, PIVOT_POINT.y);

            // 3. Lateral Shift (Geometric Throw + Play + Tolerances) - Add LINEARLY
            const geomThrow = (p.x >= 0) ? throwRight : throwLeft;
            const totalLat = lateralBias + geomThrow;
            
            // 4. Apply shift to rotated X
            const finalX = rot.x + totalLat;
            
            // 5. Y-Rotation flag
            const finalY = params.considerYRotation ? rot.y : y_bounced;

            return toPoint64({ x: finalX, y: finalY });
        });
    };

    // State 1: Leaned Left
    const latShiftLeft = -params.latPlay - tolLatShift;
    const pathLeft = createTransformedPath(fullStaticShape, rollLeftAngle, latShiftLeft, refThrowShiftRight, refThrowShiftLeft);

    // State 2: Leaned Right
    const latShiftRight = params.latPlay + tolLatShift;
    const pathRight = createTransformedPath(fullStaticShape, rollRightAngle, latShiftRight, refThrowShiftRight, refThrowShiftLeft);

    // Superimpose (Union)
    const solution = Clipper.union([pathLeft], [pathRight], FillRule.NonZero);
    
    const envX: number[] = [];
    const envY: number[] = [];

    // Extract points from Clipper solution
    if (solution.length > 0) {
        // Use the largest path (outermost)
        const outerPath = solution.reduce((prev, curr) => curr.length > prev.length ? curr : prev, []);
        outerPath.forEach(pt => {
            const p = fromPoint64(pt);
            envX.push(p.x);
            envY.push(p.y);
        });
        // Close the loop
        envX.push(envX[0]);
        envY.push(envY[0]);
    }

    // --- Study Vehicle Outline (New Feature) ---
    // Define the Study Vehicle Box based on params.w and params.h
    const halfW = params.w / 2;
    const studyBox: Point[] = [
        { x: -halfW, y: 0 },
        { x: halfW, y: 0 },
        { x: halfW, y: params.h },
        { x: -halfW, y: params.h },
        { x: -halfW, y: 0 } // Close
    ];

    // Static Study Vehicle (Centered)
    const staticStudyX = studyBox.map(p => p.x);
    const staticStudyY = studyBox.map(p => p.y);

    // Dynamic Study Vehicle (Transformed using Study Throws)
    // We create the union of Left and Right lean states for the Study Vehicle
    const studyPathLeft = createTransformedPath(studyBox, rollLeftAngle, latShiftLeft, studyThrowShiftRight, studyThrowShiftLeft);
    const studyPathRight = createTransformedPath(studyBox, rollRightAngle, latShiftRight, studyThrowShiftRight, studyThrowShiftLeft);
    const studySolution = Clipper.union([studyPathLeft], [studyPathRight], FillRule.NonZero);

    const dynamicStudyX: number[] = [];
    const dynamicStudyY: number[] = [];

    if (studySolution.length > 0) {
        const outerStudy = studySolution.reduce((prev, curr) => curr.length > prev.length ? curr : prev, []);
        outerStudy.forEach(pt => {
            const p = fromPoint64(pt);
            dynamicStudyX.push(p.x);
            dynamicStudyY.push(p.y);
        });
        // Close loop
        if (dynamicStudyX.length > 0) {
            dynamicStudyX.push(dynamicStudyX[0]);
            dynamicStudyY.push(dynamicStudyY[0]);
        }
    }

    // --- Static Visualization Data ---
    const visPointsRight = rawPointsRight; 
    const visPointsLeft = rawPointsRight.map(p => ({ x: -p.x, y: p.y })); 

    const staticCoords = {
        leftX: [] as number[], leftY: [] as number[],
        rightX: [] as number[], rightY: [] as number[],
        rotLeftX: [] as number[], rotLeftY: [] as number[],
        rotRightX: [] as number[], rotRightY: [] as number[]
    };

    // 1. Original Static (Blue Solid)
    visPointsLeft.forEach(p => {
        staticCoords.leftX.push(p.x);
        staticCoords.leftY.push(p.y);
    });
    visPointsRight.forEach(p => {
        staticCoords.rightX.push(p.x);
        staticCoords.rightY.push(p.y);
    });

    // 2. Rotated Static Ghost (Faint Blue)
    // Uses ref throws? Actually Rotation usually doesn't apply throw in simple viz, but here we want to show the 'rotated static' context
    // The previous implementation rotated fullStaticShape. Let's keep it but ideally it shouldn't shift if it's just 'rotated'.
    // However, for consistency with the ghost logic, we keep the previous pure rotation logic:
    const createRotatedStaticPath = (rollAngle: number): Path64 => {
        return fullStaticShape.map(p => {
            const rot = getRotatedCoords(p.x, p.y, rollAngle, PIVOT_POINT.x, PIVOT_POINT.y);
            const finalY = params.considerYRotation ? rot.y : p.y;
            return toPoint64({ x: rot.x, y: finalY }); 
        });
    };

    const pathRotStaticLeft = createRotatedStaticPath(rollLeftAngle);
    const pathRotStaticRight = createRotatedStaticPath(rollRightAngle);
    const solutionStatic = Clipper.union([pathRotStaticLeft], [pathRotStaticRight], FillRule.NonZero);

    if (solutionStatic.length > 0) {
        const outerStatic = solutionStatic.reduce((prev, curr) => curr.length > prev.length ? curr : prev, []);
        outerStatic.forEach(pt => {
            const p = fromPoint64(pt);
            staticCoords.rotLeftX.push(p.x);
            staticCoords.rotLeftY.push(p.y);
        });
        // Close loop
        if (staticCoords.rotLeftX.length > 0) {
            staticCoords.rotLeftX.push(staticCoords.rotLeftX[0]);
            staticCoords.rotLeftY.push(staticCoords.rotLeftY[0]);
        }
    }

    // --- Structure Result ---
    const polyCoords = {
        left: { 
            x: envX, 
            y: envY, 
            static_x: staticCoords.leftX, 
            static_y: staticCoords.leftY, 
            rot_static_x: staticCoords.rotLeftX, 
            rot_static_y: staticCoords.rotLeftY 
        },
        right: { 
            x: [], 
            y: [], 
            static_x: staticCoords.rightX, 
            static_y: staticCoords.rightY,
            rot_static_x: [], 
            rot_static_y: [] 
        }
    };

    // --- Study Points Logic ---
    const envelopePoly: Point[] = envX.map((x, i) => ({ x, y: envY[i] }));

    const studyPoints: StudyPointResult[] = [];
    const ys = rawPointsRight.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const vHeight = (maxY - minY) || 1;
    const h_bounced = params.h + ((params.h - minY) / vHeight) * bounce; 

    (['right', 'left'] as const).forEach(side => {
        const isRight = side === 'right';
        const xMult = isRight ? 1 : -1;
        
        // Base point (static position)
        const x_base = params.w / 2 * xMult;
        
        // Determine Throw Type for label
        let throwType = '';
        if (isCW) {
            // Right Turn (CW): Right Side = Inner (CT), Left Side = Outer (ET)
            throwType = isRight ? 'CT' : 'ET';
        } else {
            // Left Turn (CCW): Right Side = Outer (ET), Left Side = Inner (CT)
            throwType = isRight ? 'ET' : 'CT';
        }

        // Geometric Throw Shift
        // NOTE: Use STUDY throws here to check the specific vehicle
        const geomThrowShift = isRight ? studyThrowShiftRight : studyThrowShiftLeft;

        // Calculate Position for BOTH dynamic states to find the critical one
        
        // Case 1: Leaned Left (Left Roll, Left Shift)
        const p_rot_1 = getRotatedCoords(x_base, h_bounced, rollLeftAngle, PIVOT_POINT.x, PIVOT_POINT.y);
        const x_1 = p_rot_1.x + latShiftLeft + geomThrowShift;
        const y_1 = params.considerYRotation ? p_rot_1.y : h_bounced;

        // Case 2: Leaned Right (Right Roll, Right Shift)
        const p_rot_2 = getRotatedCoords(x_base, h_bounced, rollRightAngle, PIVOT_POINT.x, PIVOT_POINT.y);
        const x_2 = p_rot_2.x + latShiftRight + geomThrowShift;
        const y_2 = params.considerYRotation ? p_rot_2.y : h_bounced;

        // Select Critical Point (Max Excursion)
        let final_sp_p: Point;
        if (isRight) {
            // For Right Side (positive X), critical is Max X
            final_sp_p = (x_1 > x_2) ? { x: x_1, y: y_1 } : { x: x_2, y: y_2 };
        } else {
            // For Left Side (negative X), critical is Min X
            final_sp_p = (x_1 < x_2) ? { x: x_1, y: y_1 } : { x: x_2, y: y_2 };
        }

        // --- Measurements relative to envelope & static ---
        const envXAtY = getXAtY(final_sp_p.y, envelopePoly, side);
        
        const rotStaticPoly = staticCoords.rotLeftX.map((x, i) => ({x, y: staticCoords.rotLeftY[i]}));
        const rotStaticX = getXAtY(final_sp_p.y, rotStaticPoly, side);
        const origStaticX = getXAtY(final_sp_p.y, (side === 'right' ? rawPointsRight : rawPointsLeft), side);

        // Position of the static study vehicle edge at this height
        // Since study vehicle is a box, vertical walls are at +/- w/2.
        // If y > h, it's above the vehicle, but study points are usually at h.
        // We use x_base which is w/2 or -w/2.
        const staticStudyX = x_base;

        studyPoints.push({
            p: final_sp_p,
            side,
            throwType,
            rotStaticX,
            origStaticX,
            envX: envXAtY,
            staticStudyX
        });
    });

    // --- Global Status ---
    let globalStatus: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';
    const TOLERANCE = 1e-1;

    if (envelopePoly.length > 0 && studyPoints.length > 0) {
        let hasFail = false;
        let hasBoundary = false;
        
        studyPoints.forEach(sp => {
            const isInside = pointInPolygon(sp.p, envelopePoly);
            const dist = minDistanceToEdges(sp.p, envelopePoly);

            if (dist <= TOLERANCE) {
                // Effectively on the boundary (within tolerance)
                hasBoundary = true;
            } else if (!isInside) {
                // Strictly outside and not on boundary
                hasFail = true;
            }
        });

        if (hasFail) globalStatus = 'FAIL';
        else if (hasBoundary) globalStatus = 'BOUNDARY';
    }

    return {
        polygons: polyCoords,
        studyVehicle: {
            static_x: staticStudyX,
            static_y: staticStudyY,
            dynamic_x: dynamicStudyX,
            dynamic_y: dynamicStudyY
        },
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
