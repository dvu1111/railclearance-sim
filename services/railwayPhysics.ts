import { OUTLINE_DATA_SETS } from "../constants";
import { Point, SimulationParams, SimulationResult, StudyPointResult, DeltaCurveData } from "../types";
import { Clipper, Path64, Point64, FillRule, Paths64 } from "../lib/clipper2-ts/index";

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

/**
 * Prepares a clean, simple, positively oriented polygon from input points.
 * Essential for robust Clipper operations.
 */
function normalizePolygon(path: Path64): Path64 {
    // 1. Remove strict duplicates (zero-length edges)
    let p = Clipper.stripDuplicates(path, true);
    
    // 2. Filter out degenerate polygons (lines/points)
    // A polygon must have at least 3 vertices to have area.
    if (p.length < 3) return [];

    // 3. Ensure Positive Orientation (CCW)
    // This is critical for the Union operation to treat this as a solid shape
    // rather than a hole.
    if (!Clipper.isPositive(p)) {
        p = Clipper.reversePath(p);
    }
    return p;
}

// --- Pipeline Steps ---

const calculateThrows = (L: number, B: number, R_mm: number, isCW: boolean, useTrig: boolean) => {
    if (R_mm === 0) return { right: 0, left: 0, ET: 0, CT: 0 };
    
    let ET: number, CT: number;

    if (useTrig) {
        // Precise calculation using exact geometry
        const halfB = B / 2;
        const halfL = L / 2;
        const R2 = Math.pow(R_mm, 2);
        const halfB2 = Math.pow(halfB, 2);
        const halfL2 = Math.pow(halfL, 2);
        
        if (R2 < halfB2) {
            console.warn("Radius too small for bogie centers, defaulting to approximation");
            ET = (Math.pow(L, 2) - Math.pow(B, 2)) / (8 * R_mm);
            CT = Math.pow(B, 2) / (8 * R_mm);
        } else {
            const rootB = Math.sqrt(R2 - halfB2);
            CT = R_mm - rootB;
            
            if (R2 < halfL2) {
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

/**
 * Generates points along an arc for a single vertex.
 * Respects considerYRotation flag.
 */
const getArcPoints = (
    pt: Point, 
    pivot: Point, 
    startAngle: number, 
    endAngle: number, 
    steps: number,
    considerYRotation: boolean
): Point64[] => {
    const points: Point64[] = [];
    // Handle case where steps is 0 or angles are equal to avoid NaN
    if (steps <= 0 || Math.abs(endAngle - startAngle) < 0.0001) {
        const r = getRotatedCoords(pt.x, pt.y, startAngle, pivot.x, pivot.y);
        return [toPoint64({ x: r.x, y: considerYRotation ? r.y : pt.y })];
    }

    const stepSize = (endAngle - startAngle) / steps;
    
    for (let i = 0; i <= steps; i++) {
        const angle = startAngle + i * stepSize;
        const r = getRotatedCoords(pt.x, pt.y, angle, pivot.x, pivot.y);
        points.push(toPoint64({ x: r.x, y: considerYRotation ? r.y : pt.y }));
    }
    return points;
};

/**
 * Creates a "Bent Rectangle" (Swept Edge) polygon.
 * Connects the edge at Start position to the edge at End position via arcs.
 */
const createSweptEdge = (
    p1: Point, 
    p2: Point, 
    pivot: Point, 
    startAngle: number, 
    endAngle: number,
    steps: number,
    considerYRotation: boolean
): Path64 => {
    // 1. Generate Arc for P1 (Start -> End)
    const arc1 = getArcPoints(p1, pivot, startAngle, endAngle, steps, considerYRotation);
    
    // 2. Generate Arc for P2 (End -> Start) - Reversed to close the loop
    const arc2 = getArcPoints(p2, pivot, endAngle, startAngle, steps, considerYRotation);

    // 3. Combine into a closed polygon: 
    //    [P1_arc_points] -> [P2_arc_points_reversed]
    //    This traces P1(start)->P1(end) -> P2(end)->P2(start) -> close
    return [...arc1, ...arc2];
};

/**
 * OPTIMIZED CONTINUOUS SWEEP (CSG Approach)
 * Unions the start shape, end shape, and all edge-swept polygons.
 */
const generateRotationalSweep = (
    shape: Point[], 
    rollStart: number, 
    rollEnd: number, 
    pivot: Point,
    considerYRotation: boolean
): Paths64 => {
    // 1. Define Caps (Start & End Shapes)
    const pathStart: Path64 = shape.map(p => {
        const r = getRotatedCoords(p.x, p.y, rollStart, pivot.x, pivot.y);
        return toPoint64({ x: r.x, y: considerYRotation ? r.y : p.y });
    });

    const pathEnd: Path64 = shape.map(p => {
        const r = getRotatedCoords(p.x, p.y, rollEnd, pivot.x, pivot.y);
        return toPoint64({ x: r.x, y: considerYRotation ? r.y : p.y });
    });

    // Handle 0-degree roll (or near-zero) case
    if (Math.abs(rollStart - rollEnd) < 0.001) {
        return [normalizePolygon(pathStart)];
    }

    // --- FIX FOR CRASH WHEN Y-ROTATION IS DISABLED ---
    // If Y-Rotation is disabled, the sweep generates degenerate (flat) polygons for horizontal edges.
    // We simply union the start and end positions which covers the swept area monotonically in X.
    if (!considerYRotation || Math.abs(rollStart) < 0 || Math.abs(rollEnd) < 0) {
        const cleanStart = normalizePolygon(pathStart);
        const cleanEnd = normalizePolygon(pathEnd);
        
        const startValid = cleanStart.length >= 3;
        const endValid = cleanEnd.length >= 3;

        if (!startValid && !endValid) return [];
        if (!startValid) return [cleanEnd];
        if (!endValid) return [cleanStart];

        const result = Clipper.union([cleanStart, cleanEnd], FillRule.NonZero);
        
        // FAILSAFE: If Union fails (returns empty) but inputs are valid, 
        // return both inputs as separate paths. We will merge them later in calculateEnvelope.
        if (result.length === 0) {
            return [cleanStart, cleanEnd]; 
        }
        
        return result;
    }

    const parts: Paths64 = [];
    
    // Add Caps to parts list
    // Use self-union to ensure caps are topologically clean (removes self-intersections)
    const cleanStart = Clipper.union([normalizePolygon(pathStart)], FillRule.NonZero);
    const cleanEnd = Clipper.union([normalizePolygon(pathEnd)], FillRule.NonZero);
    parts.push(...cleanStart);
    parts.push(...cleanEnd);

    // Determine step count for arcs
    const angleDiff = Math.abs(rollEnd - rollStart);
    const steps = Math.max(5, Math.ceil(angleDiff * 2)); 

    // 2. Add Swept Paths for each edge (Bent Rectangles)
    const len = shape.length;
    for (let i = 0; i < len; i++) {
        const p1 = shape[i];
        const p2 = shape[(i + 1) % len];

        const edgePoly = createSweptEdge(p1, p2, pivot, rollStart, rollEnd, steps, considerYRotation);
        
        // Normalize ensures the swept edge is a valid, positively oriented polygon.
        const cleaned = normalizePolygon(edgePoly);

        // Filter degenerate polygons
        if (cleaned.length < 3 || Math.abs(Clipper.area(cleaned)) < 1.0) { 
            continue; 
        }

        // Clean the swept edge polygon
        const cleanEdgeParts = Clipper.union([cleaned], FillRule.NonZero);
        parts.push(...cleanEdgeParts);
    }

    // 3. Single Boolean Union Operation
    return Clipper.union(parts, FillRule.NonZero);
};

/**
 * Applies lateral sweep using Minkowski Sum or Simple Union.
 */
const applyLateralSweep = (
    rotationalPaths: Paths64, 
    minLat: number, 
    maxLat: number,
    useSimpleSweep: boolean = true
): Paths64 => {
    if (Math.abs(maxLat - minLat) < 0.1) {
        // Just translate
        return Clipper.translatePaths(rotationalPaths, minLat * CLIPPER_SCALE, 0);
    }

    if (useSimpleSweep) {
        // Optimization: When Y-rotation is disabled (or strictly lateral shift), 
        // we can simply Union the left-most and right-most positions.
        // Because the vehicle width (e.g. 3000mm) is significantly larger than lateral shifts (e.g. 100mm),
        // the two instances overlap heavily, forming a solid envelope without holes.
        // This avoids the expensive/complex Minkowski Sum operation.
        const pathMin = Clipper.translatePaths(rotationalPaths, minLat * CLIPPER_SCALE, 0);
        const pathMax = Clipper.translatePaths(rotationalPaths, maxLat * CLIPPER_SCALE, 0);
        return Clipper.union([...pathMin, ...pathMax], FillRule.NonZero);
    }

    const width = (maxLat - minLat) * CLIPPER_SCALE;
 
    // Minkowski sum path (a horizontal line segment)
    const pathPattern: Path64 = [
        { x: 0, y: 0 },
        { x: Math.round(width), y: 0 }
    ];

    const sweptPaths: Paths64 = [];

    for (const path of rotationalPaths) {
        const cleanPath = normalizePolygon(path);
        // Only process if valid
        if (cleanPath.length >= 3) {
            const result = Clipper.minkowskiSum(cleanPath, pathPattern, true); 
            sweptPaths.push(...result);
        }
    }
        

    // Translate the result to the start position (minLat)
    return Clipper.translatePaths(sweptPaths, minLat * CLIPPER_SCALE, 0);
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
    
    // Convert to 64-bit integer space immediately for processing
    const rawRight64 = rawPointsRight.map(toPoint64);
    const rawLeft64 = rawPointsLeft.map(toPoint64);
    let fullShape64 = [...rawRight64, ...rawLeft64];
    
    // FIX: Normalize the base polygon (Simplify + Orient)
    fullShape64 = normalizePolygon(fullShape64);
    
    const fullStaticShape = fullShape64.map(fromPoint64);

    // 2. Calculate Physics Parameters
    const tols = calculateTolerances(params);
    const refThrows = calculateThrows(params.L_outline, params.B_outline, R_mm, isCW, useTrig);
    const studyThrows = calculateThrows(params.L_veh, params.B_veh, R_mm, isCW, useTrig);

    const appliedCantRad = params.appliedCant / 1137;
    const appliedCantDeg = degrees(appliedCantRad);
    const cantBiasAngle = isCW ? -appliedCantDeg : appliedCantDeg;

    // Roll Angles
    const angle1 = Math.abs(params.roll) + cantBiasAngle + tols.cantTolDeg;
    const angle2 = -Math.abs(params.roll) + cantBiasAngle - tols.cantTolDeg;
    
    const rollStart = Math.min(angle1, angle2);
    const rollEnd = Math.max(angle1, angle2);

    // Lateral Biases
    const latBiasLeft = -params.latPlay - tols.latShift;
    const latBiasRight = params.latPlay + tols.latShift;

    // Combined Lateral Limits
    const totalMinLat = latBiasLeft + refThrows.left;
    const totalMaxLat = latBiasRight + refThrows.right;

    // 3. Pre-apply Bounce to Shape
    const bouncedShape = fullStaticShape.map(p => {
        let y = p.y;
        if (p.y > params.bounceYThreshold) {
            y += tols.bounce;
        }
        return { x: p.x, y };
    });

    let checkRotation: boolean = (params.considerYRotation) ? ((Math.abs(rollStart) > 0 || Math.abs(rollEnd) > 0) ? false : true) : true;
    // 4. Generate Rotational Envelope (CSG Method)
    const rotPaths = generateRotationalSweep(bouncedShape, rollStart, rollEnd, pivot, !checkRotation);

    // 5. Generate Full Kinematic Envelope
    // Pass !params.considerYRotation as the trigger for simple sweep
    let solution = applyLateralSweep(rotPaths, totalMinLat, totalMaxLat, checkRotation);
    
    // FAILSAFE MERGE: If solution contains disjoint parts (e.g. from fallback), merge them now.
    // This ensures we have a single envelope even if the intermediate steps produced fragments.
    if (solution.length > 1) {
        solution = Clipper.union(solution, FillRule.NonZero);
    }

    // Extract Envelope Polygon
    const envX: number[] = [];
    const envY: number[] = [];
    if (solution.length > 0) {
        // Pick the largest path if still multiple, but Union above usually fixes it.
        const outerPath = solution.reduce((p, c) => c.length > p.length ? c : p, []);
        outerPath.forEach(pt => {
            const p = fromPoint64(pt);
            envX.push(p.x);
            envY.push(p.y);
        });
        if (envX.length > 0) {
            envX.push(envX[0]);
            envY.push(envY[0]);
        }
    }

    // 6. Study Vehicle Visualization
    const halfW = params.w / 2;
    const studyBox: Point[] = [
        { x: -halfW, y: 0 }, { x: halfW, y: 0 },
        { x: halfW, y: params.h }, { x: -halfW, y: params.h },
        { x: -halfW, y: 0 }
    ];
    
    let studyBox64 = studyBox.map(toPoint64);
    studyBox64 = normalizePolygon(studyBox64);
    const cleanedStudyBox = studyBox64.map(fromPoint64);
    
    const bouncedStudyBox = cleanedStudyBox.map(p => {
        let y = p.y;
        if (p.y > params.bounceYThreshold) y += tols.bounce;
        return { x: p.x, y };
    });

    const studyMinLat = latBiasLeft + studyThrows.left;
    const studyMaxLat = latBiasRight + studyThrows.right;

    const studyRotPaths = generateRotationalSweep(bouncedStudyBox, rollStart, rollEnd, pivot, !checkRotation);
    let studySolution = applyLateralSweep(studyRotPaths, studyMinLat, studyMaxLat, checkRotation);
    
    if (studySolution.length > 1) {
        studySolution = Clipper.union(studySolution, FillRule.NonZero);
    }

    const dynamicStudyX: number[] = [];
    const dynamicStudyY: number[] = [];
    if (studySolution.length > 0) {
        const outerStudy = studySolution.reduce((p, c) => c.length > p.length ? c : p, []);
        outerStudy.forEach(pt => {
            const p = fromPoint64(pt);
            dynamicStudyX.push(p.x);
            dynamicStudyY.push(p.y);
        });
        if (dynamicStudyX.length > 0) {
            dynamicStudyX.push(dynamicStudyX[0]);
            dynamicStudyY.push(dynamicStudyY[0]);
        }
    }

    // 7. Static & Ghost Visualization
    const rotPathStaticLeft = bouncedShape.map(p => {
        const rot = getRotatedCoords(p.x, p.y, rollStart, pivot.x, pivot.y);
        return toPoint64({ x: rot.x, y: params.considerYRotation ? rot.y : p.y });
    });
    const rotPathStaticRight = bouncedShape.map(p => {
        const rot = getRotatedCoords(p.x, p.y, rollEnd, pivot.x, pivot.y);
        return toPoint64({ x: rot.x, y: params.considerYRotation ? rot.y : p.y });
    });
    // Safely union static ghost shapes
    let solutionStatic = Clipper.union([normalizePolygon(rotPathStaticLeft)], [normalizePolygon(rotPathStaticRight)], FillRule.NonZero);
    
    const rotStaticX: number[] = [];
    const rotStaticY: number[] = [];
    if (solutionStatic.length > 0) {
        const outer = solutionStatic.reduce((p, c) => c.length > p.length ? c : p, []);
        outer.forEach(pt => {
            const p = fromPoint64(pt);
            rotStaticX.push(p.x);
            rotStaticY.push(p.y);
        });
        if (rotStaticX.length > 0) {
            rotStaticX.push(rotStaticX[0]);
            rotStaticY.push(rotStaticY[0]);
        }
    }

    // 8. Study Points
    const envelopePoly: Point[] = envX.map((x, i) => ({ x, y: envY[i] }));
    const studyPoints = calculateStudyPoints(
        params, rawPointsRight, rawPointsLeft, 
        tols.bounce, pivot, rollStart, rollEnd, 
        latBiasLeft, latBiasRight, studyThrows, 
        envelopePoly, rotStaticX, rotStaticY, isCW
    );

    // 9. Delta Curve
    const ys = rawPointsRight.map(p => p.y);
    const maxY = Math.max(...ys);
    
    const subtractLeft = isCW ? studyThrows.ET : studyThrows.CT;
    const subtractRight = isCW ? studyThrows.CT : studyThrows.ET;

    const deltaGraphData = calculateDeltaCurvesIterative(
        0, maxY, envelopePoly, subtractLeft, subtractRight, halfW
    );

    // 10. Status
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
                x: [], y: [], 
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
    envelope: Point[],
    subtractLeft: number,
    subtractRight: number,
    halfWidth: number
): DeltaCurveData {
    const result: DeltaCurveData = { y: [], deltaLeft: [], deltaRight: [] };

    for (let y = minY; y <= maxY; y += 1) {
        const envL = getXAtY(y, envelope, 'left');
        const envR = getXAtY(y, envelope, 'right');

        if (envL !== null && envR !== null) {
            result.y.push(y);
            result.deltaLeft.push(Math.abs(envL) - subtractLeft - halfWidth); 
            result.deltaRight.push(Math.abs(envR) - subtractRight - halfWidth);
        }
    }
    return result;
}

function calculateStudyPoints(
    params: SimulationParams, 
    rawRight: Point[], rawLeft: Point[], 
    bounce: number, pivot: Point,
    rollMin: number, rollMax: number,
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

        // --- Calculate Critical Point (Worst Case Excursion) ---
        const testPoints: Point[] = [];
        const rolls = [rollMin, rollMax];
        const lats = [latLeft, latRight];

        rolls.forEach(r => {
            const rotated = getRotatedCoords(x_base, h_bounced, r, pivot.x, pivot.y);
            const y = params.considerYRotation ? rotated.y : h_bounced;
            lats.forEach(lat => {
                testPoints.push({
                    x: rotated.x + lat + geomThrowShift,
                    y: y
                });
            });
        });

        // Find the extreme point based on side
        let finalP = testPoints[0];
        if (isRight) {
            finalP = testPoints.reduce((max, p) => p.x > max.x ? p : max, testPoints[0]);
        } else {
            finalP = testPoints.reduce((min, p) => p.x < min.x ? p : min, testPoints[0]);
        }

        // Intersections
        const envXAtY = getXAtY(finalP.y, envelope, side);
        const rotStaticPoly = rotStaticX.map((x, i) => ({ x, y: rotStaticY[i] }));
        const rotStaticXAtY = getXAtY(finalP.y, rotStaticPoly, side);
        const origStaticX = getXAtY(finalP.y, isRight ? rawRight : rawLeft, side);

        const isInside = pointInPolygon(finalP, envelope);
        const dist = minDistanceToEdges(finalP, envelope);
        
        let status: 'PASS' | 'FAIL' | 'BOUNDARY' = 'PASS';

        if (dist <= TOLERANCE) {
            status = 'BOUNDARY';
        } else if (!isInside) {
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