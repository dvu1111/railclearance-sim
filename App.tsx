import React from 'react';
import ControlPanel from './components/ControlPanel';
import Visualizer from './components/Visualizer';
import { useSimulation } from './hooks/useSimulation';

const App: React.FC = () => {
    const { params, updateParams, simulationResult } = useSimulation();

    return (
        <div className="flex flex-col lg:flex-row h-screen w-screen overflow-hidden bg-gray-50">
            {/* Sidebar */}
            <div className="w-full lg:w-80 h-1/3 lg:h-full flex-shrink-0 z-10 border-r border-gray-200">
                <ControlPanel params={params} onUpdate={updateParams} />
            </div>

            {/* Main Visualizer */}
            <div className="flex-1 h-2/3 lg:h-full p-4 overflow-hidden relative">
                {simulationResult ? (
                    <Visualizer data={simulationResult} params={params} />
                ) : (
                    <div className="flex items-center justify-center h-full text-red-500 font-bold bg-white rounded-lg shadow">
                        Calculation Error: Please check input parameters.
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;