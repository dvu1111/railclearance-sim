RailClearance Sim

RailClearance Sim is a specialized engineering simulation tool designed to compute and visualize the kinematic envelope of rail vehicles negotiating horizontal curves. The application provides real-time analysis of geometric overthrows, dynamic body movements, and clearance tolerances, enabling rapid assessment of vehicle-structure gauging compliance.

Overview

This software models the transformation of a static vehicle profile into a dynamic kinematic envelope. It accounts for geometric displacement (End Throw and Center Throw), vehicle suspension dynamics (roll, bounce, lateral play), and track infrastructure tolerances. The tool allows engineers to evaluate clearance scenarios against predefined track standards and vehicle classes.

Technical Capabilities

Geometric Calculation

The system calculates geometric overthrow based on vehicle wheelbase and total length relative to the curve radius. It computes:

    End Throw (E): The external excursion of the vehicle ends (overhang).

    Center Throw (C): The internal excursion of the vehicle center (chord).

Dynamic Simulation

The physics engine integrates dynamic factors to generate the final envelope coordinates:

    Vehicle Body Roll: Rotational displacement around the roll center (h_roll), accounting for cant deficiency or excess.

    Lateral Play: Transverse movement of the wheelset and body relative to the track centerline.

    Vertical Bounce: Vertical displacement applied to the vehicle profile to simulate suspension travel.

Tolerance Management

The application supports configurable tolerance sets for various track forms, including:

    Ballasted Open Track

    Ballasted Track (Prescribed)

    Fixed Track (Slab)

    Fouling Points

These tolerances (Lateral, Vertical, Cant, Gauge Widening) are aggregated and applied to the kinematic simulation to determine the worst-case envelope.

Mathematical Framework

The core simulation logic resides in services/railwayPhysics.ts. The coordinate transformation pipeline proceeds as follows:

    Geometric Throw: Approximated using the versine formula based on the vehicle's rigid wheelbase (B) and overall length (L):

    Throw \approx \frac{L^2 - B^2}{8R}

    Translation: Points are translated laterally by the sum of the calculated throw, lateral play, and track lateral tolerances.

    Vertical Adjustment: Vertical bounce is applied to coordinates exceeding a defined Y-threshold.

    Rotation: The transformed profile is rotated around the defined Pivot Point (0, 1100) to account for vehicle roll and track cant tolerances.

    Envelope Generation: The system computes the maximum excursion of the rotated profile to define the dynamic boundary.

Installation and Setup

Prerequisites

    Node.js (v20 or higher recommended)

    npm or yarn package manager

Build Instructions

    Clone the Repository:

    git clone https://github.com/dvu1111/railclearance-sim.git
    cd railclearance-sim

    Install Dependencies:

    npm ci

    Execute Development Environment:

    npm run dev

    Access the application at http://localhost:3000.

    Production Build: To generate static assets for deployment:

    npm run build

Configuration and Parameters

The application utilizes a parametric control panel to define the simulation environment. Key engineering parameters include:

    Geometry:

        Radius (R): Horizontal curve radius (meters).

        Curve Direction: Clockwise (Right) or Counter-Clockwise (Left).

    Vehicle Data:

        Dimensions: Length (L_veh) and Bogie Centers (B_veh).

        Reference Profile: Selectable outlines (e.g., RS4.1) defined in constants.ts.

    Dynamics & Tolerances:

        Roll: Body roll angle (degrees).

        Lateral Play: Allowable lateral shift (mm).

        Bounce: Vertical suspension allowance (mm).

        Track Scenario: Presets for tolerances (e.g., lat_gt_1000 vs lat_lte_1000) based on curve radius regimes.

Project Architecture

    services/railwayPhysics.ts: Contains the primary algorithm for geometric throw calculation, coordinate transformation, and point-in-polygon analysis.

    components/Visualizer.tsx: Handles the canvas-based rendering of the static profile (blue), rotated static profile (dotted), and the dynamic envelope (filled polygon). It also visualizes specific study points and delta measurements.

    constants.ts: Stores static definitions for vehicle outlines (VehicleOutlineData) and track tolerance standards (TRACK_TOLERANCES).

    types.ts: Defines TypeScript interfaces for simulation parameters and computation results.
