# RailClearance Sim

![Version](https://img.shields.io/badge/version-8.1.0-blue.svg?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)
![React](https://img.shields.io/badge/React-19-Tk.svg?style=flat-square&logo=react&color=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC.svg?style=flat-square&logo=tailwind-css)
![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg?style=flat-square&logo=vite)

**RailClearance Sim** is a high-precision engineering simulation tool designed to compute and visualize the kinematic envelope of rail vehicles negotiating horizontal curves. 

It enables permanent way engineers and rolling stock engineers to perform real-time clearance assessments, visualizing the complex interaction between vehicle geometry, track curvature, and dynamic suspension movements.

You can access this page here: https://dvu1111.github.io/railclearance-sim

---

## Key Features

* **Kinematic Envelope Generation**: dynamic calculation of vehicle boundaries using the **Clipper2** polygon clipping engine.
* **Real-time Physics Engine**: Instantly updates calculations for:
    * **Geometric Overthrow**: End Throw ($ET$) and Center Throw ($CT$).
    * **Dynamic Roll**: Body rotation due to cant deficiency/excess.
    * **Suspension Effects**: Lateral play and vertical bounce.
* **Comprehensive Tolerance Sets**: Pre-configured scenarios for:
    * Ballasted Open Track
    * Fixed (Slab) Track
    * Fouling Points
* **Interactive Visualization**: 
    * Zoomable/pannable canvas using `Plotly.js`.
    * Visual comparison of Static vs. Kinematic profiles.
    * "Study Point" analysis for specific gauging critical points.
* **Vehicle Library**: Includes standard reference outlines (e.g., RS1.1, RS4.1, RS6).

---

## Tech Stack

* **Core**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Build Tool**: [Vite](https://vitejs.dev/)
* **Styling**: [Tailwind CSS](https://tailwindcss.com/)
* **Visualization**: [Plotly.js](https://plotly.com/javascript/) (`react-plotly.js`)
* **Math & Geometry**: Custom Physics Engine + [Clipper2-ts](https://github.com/AngusJohnson/Clipper2) (Ported)

---

## Mathematical Framework

The simulation pipeline transforms a static vehicle profile into a dynamic envelope through the following stages:

1.  **Geometric Throw Calculation**:
    Approximated using the versine formula based on the vehicle's rigid wheelbase ($B$) and overall length ($L$):
    **End Throw** $\approx \frac{L^2 - B^2}{8R}$
    **and** **Centre Throw** $\approx \frac{B^2}{8R}$

    An option also is there to get the exact throws:
    
   $$
   ET_{\text{exact}} = \sqrt{R^2 - \left(\frac{B}{2}\right)^2} - \sqrt{R^2 - \left(\frac{L}{2}\right)^2}
   $$

   $$
   CT_{\text{exact}} = R - \sqrt{R^2 - \left(\frac{B}{2}\right)^2}
   $$
    

23.  **Coordinate Transformation**:
    Points are translated and rotated based on the aggregate of track tolerances and vehicle dynamics:
    * **Lateral Translation ($T_y$):** $Throw + LatPlay + \sum Tolerances_{lat}$
    * **Vertical Translation ($T_z$):** $Bounce + \sum Tolerances_{vert}$
    * **Rotation ($\theta$):** Rotated around the Roll Center ($h_{roll}$) accounting for applied cant and roll tolerances.

3.  **Envelope Construction**:
    The system generates two polygon states (leaning left and leaning right). The final kinematic envelope is the **Union** of these two states computed via the Clipper2 boolean operation library.

---

## Getting Started

### Prerequisites

* Node.js (v20 or higher recommended)
* npm or yarn

### Installation

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/dvu1111/railclearance-sim.git](https://github.com/dvu1111/railclearance-sim.git)
    cd railclearance-sim
    ```

2.  **Install dependencies**
    ```bash
    npm ci
    ```

3.  **Start the development server**
    ```bash
    npm run dev
    ```
    Open your browser to `http://localhost:3000` to view the application.

4.  **Build for production**
    ```bash
    npm run build
    ```

---

## Usage Guide

### Control Panel
Located on the left sidebar, use this to configure the simulation environment:

| Section | Parameter | Description |
| :--- | :--- | :--- |
| **Geometry** | Radius ($R$) | Horizontal curve radius in meters. |
| | Applied Cant | Superelevation of the track in mm. |
| **Vehicle** | Dimensions | Define Length ($L$), Bogie Centers ($B$), and profile dimensions. |
| | Reference Outline | Select from presets (e.g., `RS4.1`, `RS6`) defined in `constants.ts`. |
| **Dynamics** | Roll | Body roll angle in degrees. |
| | Bounce | Vertical suspension travel in mm. |
| **Tolerances** | Track Scenario | Select preset tolerance standards (e.g., "Ballasted Open"). |

### Visualizer
The main view provides a cross-section of the vehicle and track:
* **Blue Line**: Original Static Profile.
* **Dotted Blue**: Static profile rotated by roll angle (ghost).
* **Filled Area**: The final computed Dynamic Kinematic Envelope.
* **Markers**: "Study Points" indicating critical clearance checks on the vehicle corners.

---

## wm Project Structure

```bash
src/
├── components/       # UI Components
│   ├── ControlPanel.tsx  # Input form for simulation parameters
│   └── Visualizer.tsx    # Plotly chart rendering
├── hooks/            # Custom React Hooks
│   └── useSimulation.tsx # Central logic binding state to physics
├── lib/              # External Libraries
│   └── clipper2-ts/      # Polygon clipping engine (Union/Offset)
├── services/         # Business Logic
│   └── railwayPhysics.ts # Core math, coordinate transformations
├── types.ts          # TypeScript interfaces
├── constants.ts      # Vehicle datasets and Tolerance presets
├── App.tsx           # Main application layout
└── index.css         # Tailwind global styles
