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
    // rawPointsRight starts at bottom center (0, Y), goes to side, up, top center (0, Y)
    // We assume the outline is the right half.
    const rawPointsLeft = rawPointsRight.map(p => ({ x: -p.x, y: p.y })).reverse();
    // Combine to form closed loop: Right path -> Left path (which goes top to bottom)
    const fullStaticShape = [...rawPointsRight, ...rawPointsLeft];

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
    const cantBiasAngle = isCW ? -appliedCantDeg : appliedCantDeg;

    // Kinematic Throws
    let calc_ET = 0, calc_CT = 0;
    
    if (R_mm !== 0) {
        calc_ET = (Math.pow(params.L_outline, 2) - Math.pow(params.B_outline, 2)) / (8 * R_mm);
        calc_CT = Math.pow(params.B_outline, 2) / (8 * R_mm);
    }

    // Apply Throws based on direction
    const throwShiftRight = isCW ? calc_CT : calc_ET; // Outward shift
    const throwShiftLeft = isCW ? -calc_ET : -calc_CT; // Inward shift (negative X)

    // Roll Logic
    let rollLeftAngle = Math.abs(params.roll);
    let rollRightAngle = -Math.abs(params.roll);

    // Apply Bias & Tolerance
    rollLeftAngle += cantBiasAngle + cantTolAngleDeg;
    rollRightAngle += cantBiasAngle - cantTolAngleDeg;

    // --- CLIPPER: Generate Superimposed Envelope ---
    
    // Function to transform the full shape into a specific state
    const createTransformedPath = (rollAngle: number, lateralBias: number): Path64 => {
        return fullStaticShape.map(p => {
            // 1. Bounce (Vertical)
            let y_bounced = p.y;
            if (p.y > params.bounceYThreshold) {
                y_bounced += bounce;
            }

            // 2. Lateral Shift (Geometric Throw)
            const geomThrow = (p.x >= 0) ? throwShiftRight : throwShiftLeft;
            
            // 3. Play & Tolerances
            // Lateral Shift for this specific instance
            const totalLat = lateralBias + geomThrow;

            // 4. Rotation
            const rot = getRotatedCoords(p.x + totalLat, y_bounced, rollAngle, PIVOT_POINT.x, PIVOT_POINT.y);
            
            // 5. Y-Rotation flag
            const finalY = params.considerYRotation ? rot.y : y_bounced;

            return toPoint64({ x: rot.x, y: finalY });
        });
    };

    // State 1: Leaned Left (Positive Angle), Shifted Left (Negative X)
    // Lateral Play moves body Left. Tolerances move body Left.
    const latShiftLeft = -params.latPlay - tolLatShift;
    const pathLeft = createTransformedPath(rollLeftAngle, latShiftLeft);

    // State 2: Leaned Right (Negative Angle), Shifted Right (Positive X)
    const latShiftRight = params.latPlay + tolLatShift;
    const pathRight = createTransformedPath(rollRightAngle, latShiftRight);

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

    // --- Static Visualization Data ---
    const visPointsRight = rawPointsRight; // Already Bottom -> Top
    const visPointsLeft = rawPointsRight.map(p => ({ x: -p.x, y: p.y })); // Bottom -> Top, mirrored

    const staticCoords = {
        leftX: [] as number[], leftY: [] as number[],
        rightX: [] as number[], rightY: [] as number[],
        rotLeftX: [] as number[], rotLeftY: [] as number[],
        rotRightX: [] as number[], rotRightY: [] as number[]
    };

    // 1. Original Static (Blue Solid) - Upright
    visPointsLeft.forEach(p => {
        staticCoords.leftX.push(p.x);
        staticCoords.leftY.push(p.y);
    });
    visPointsRight.forEach(p => {
        staticCoords.rightX.push(p.x);
        staticCoords.rightY.push(p.y);
    });

    // 2. Rotated Static Ghost (Faint Blue) - Swept Rotation
    // Create a Union of the Static shape rotated to Max Left and Max Right.
    // This allows the user to see the roll limits even if no throw is applied.
    const createRotatedStaticPath = (rollAngle: number): Path64 => {
        return fullStaticShape.map(p => {
            // No throw, no bounce, no play - just pure rotation around pivot
            const rot = getRotatedCoords(p.x, p.y, rollAngle, PIVOT_POINT.x, PIVOT_POINT.y);
            
            // Apply y-rotation flag logic
            const finalY = params.considerYRotation ? rot.y : p.y;

            return toPoint64({ x: rot.x, y: finalY }); 
        });
    };

    const pathRotStaticLeft = createRotatedStaticPath(rollLeftAngle);
    const pathRotStaticRight = createRotatedStaticPath(rollRightAngle);
    const solutionStatic = Clipper.union([pathRotStaticLeft], [pathRotStaticRight], FillRule.NonZero);

    if (solutionStatic.length > 0) {
        // Use largest path
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
            x: envX, // Full envelope here
            y: envY, 
            static_x: staticCoords.leftX, 
            static_y: staticCoords.leftY, 
            rot_static_x: staticCoords.rotLeftX, // Full ghost loop here
            rot_static_y: staticCoords.rotLeftY 
        },
        right: { 
            x: [], 
            y: [], 
            static_x: staticCoords.rightX, 
            static_y: staticCoords.rightY,
            rot_static_x: [], // Empty, as Left contains the full loop
            rot_static_y: [] 
        }
    };

    // --- Study Points Logic ---
    // Re-construct the full envelope polygon for point-in-poly checks
    const envelopePoly: Point[] = envX.map((x, i) => ({ x, y: envY[i] }));

    const studyPoints: StudyPointResult[] = [];
    const ys = rawPointsRight.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const vHeight = (maxY - minY) || 1;
    const h_bounced = params.h + ((params.h - minY) / vHeight) * bounce; // Approximation for H bounce

    (['right', 'left'] as const).forEach(side => {
        const xMult = (side === 'right') ? 1 : -1;
        
        let vehThrow = 0;
        let throwType = '';
        if (isCW) {
            vehThrow = (side === 'left') ? (Math.pow(params.L_veh, 2) - Math.pow(params.B_veh, 2)) / (8 * R_mm) : Math.pow(params.B_veh, 2) / (8 * R_mm);
            throwType = (side === 'left') ? 'ET' : 'CT';
        } else {
            vehThrow = (side === 'left') ? Math.pow(params.B_veh, 2) / (8 * R_mm) : (Math.pow(params.L_veh, 2) - Math.pow(params.B_veh, 2)) / (8 * R_mm);
            throwType = (side === 'left') ? 'CT' : 'ET';
        }

        const studyShift = (side === 'right') ? params.latPlay : -params.latPlay;
        const tolShift = (side === 'right') ? tolLatShift : -tolLatShift;
        
        // Calculate the "Thrown" position of the study point
        const x_raw = (params.w / 2 * xMult) + (vehThrow * xMult) + tolShift;
        const y_pos = h_bounced;

        // Rotate to the extreme of that side
        const rotAngle = (side === 'right') ? rollRightAngle : rollLeftAngle;
        const p_rot = getRotatedCoords(x_raw, y_pos, rotAngle, PIVOT_POINT.x, PIVOT_POINT.y);
        
        const final_sp_x = p_rot.x + studyShift;
        const final_sp_y = params.considerYRotation ? p_rot.y : y_pos;

        // Calculate Distance to Envelope at this Y
        const envXAtY = getXAtY(final_sp_y, envelopePoly, side);
        
        // Static Ref for delta - Use Rotated Static Ghost (Swept) for better visual Ref
        // rotLeftX contains the full loop now
        const rotStaticPoly = staticCoords.rotLeftX.map((x, i) => ({x, y: staticCoords.rotLeftY[i]}));
        
        const rotStaticX = getXAtY(final_sp_y, rotStaticPoly, side);
        const origStaticX = getXAtY(final_sp_y, (side === 'right' ? rawPointsRight : rawPointsLeft), side);

        studyPoints.push({
            p: { x: final_sp_x, y: final_sp_y },
            side,
            throwType,
            rotStaticX,
            origStaticX,
            envX: envXAtY
        });
    });

    // --- Global Status ---
    let globalStatus: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';
    if (envelopePoly.length > 0 && studyPoints.length > 0) {
        let hasFail = false;
        let hasBoundary = false;
        studyPoints.forEach(sp => {
            const isInside = pointInPolygon(sp.p, envelopePoly);
            if (!isInside) hasBoundary = true;
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