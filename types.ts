export interface Point {
  x: number;
  y: number;
}

export interface VehicleOutlineData {
  L: number;
  B: number;
  h_roll: number;
  points: Point[];
}

export interface ToleranceSet {
  lat_gt_1000: number;
  lat_lte_1000: number;
  vert: number;
  cant: number;
  gw: number;
}

export interface SimulationParams {
  // Radius
  radius: number; // meters

  // Vehicle Dimensions (for Throw Calculation)
  L_veh: number;
  B_veh: number;
  h: number;
  w: number;

  // Outline Dimensions (Reference for Envelope)
  L_outline: number;
  B_outline: number;
  outlineId: string;

  // Curve
  direction: 'cw' | 'ccw';

  // Tolerances
  enableTolerances: boolean;
  trackScenario: string;
  radiusScenario: string;
  
  // Manual Tolerance Overrides
  tol_lat: number;
  tol_vert: number;
  tol_cant: number;
  tol_gw: number;

  // Dynamics
  roll: number; // degrees
  appliedCant: number; // mm
  latPlay: number; // mm
  bounce: number; // mm
  bounceYThreshold: number; // mm
  
  // Calculation Settings
  considerYRotation: boolean;
  
  // Visualization
  showStudyVehicle: boolean; // New flag to toggle study vehicle overlay
}

export interface StudyPointResult {
  p: Point; // The computed dynamic point
  side: 'left' | 'right';
  throwType: string;
  rotStaticX: number | null;
  origStaticX: number | null;
  envX: number | null;
  staticStudyX: number | null; // New: X position of the static study vehicle edge
}

export interface PolyCoords {
  x: number[];
  y: number[];
  static_x: number[];
  static_y: number[];
  rot_static_x: number[];
  rot_static_y: number[];
}

export interface StudyVehicleCoords {
  static_x: number[];
  static_y: number[];
  dynamic_x: number[];
  dynamic_y: number[];
}

export interface SimulationResult {
  polygons: {
    left: PolyCoords;
    right: PolyCoords;
  };
  studyVehicle: StudyVehicleCoords; // New: Coordinates for the study vehicle box
  studyPoints: StudyPointResult[];
  globalStatus: 'PASS' | 'FAIL' | 'BOUNDARY';
  calculatedParams: {
    rollUsed: number;
    cantTolUsed: number;
    appliedCantUsed: number;
    tolLatShift: number;
  };
  pivot: Point;
}
