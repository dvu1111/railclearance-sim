import React, { useState, useMemo } from 'react';
import ControlPanel from './components/ControlPanel';
import Visualizer from './components/Visualizer';
import { SimulationParams } from './types';
import { calculateEnvelope } from './services/railwayPhysics';

const App: React.FC = () => {
    const [params, setParams] = useState<SimulationParams>({
        radius: 100,
        L_veh: 21000,
        B_veh: 15850,
        h: 400,
        w: 2540,
        L_outline: 21000,
        B_outline: 15850,
        outlineId: 'RS4.1',
        direction: 'cw',
        enableTolerances: false,
        trackScenario: 'ballasted_open',
        radiusScenario: 'gt_1000',
        tol_lat: 25,
        tol_vert: 25,
        tol_cant: 10,
        tol_gw: 25,
        roll: 1.25,
        latPlay: 43,
        bounce: 50,
        bounceYThreshold: 535
    });

    const simulationResult = useMemo(() => {
        try {
            return calculateEnvelope(params);
        } catch (e) {
            console.error(e);
            return null;
        }
    }, [params]);

    return (
        <div className="flex flex-col lg:flex-row h-screen w-screen overflow-hidden bg-gray-50">
            {/* Sidebar (Fixed Width) */}
            <div className="w-full lg:w-80 h-1/3 lg:h-full flex-shrink-0 z-10 border-r border-gray-200">
                <ControlPanel params={params} setParams={setParams} />
            </div>

            {/* Main Visualizer Area */}
            <div className="flex-1 h-2/3 lg:h-full p-4 overflow-hidden relative">
                {simulationResult ? (
                    <Visualizer data={simulationResult} params={params} />
                ) : (
                    <div className="flex items-center justify-center h-full text-red-500 font-bold">
                        Error computing envelope. Check inputs.
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;