import React, { useCallback } from 'react';
import ControlPanel from './components/ControlPanel';
import Visualizer from './components/Visualizer';
import { useSimulation } from './hooks/useSimulation';
import { SimulationResult } from './types';

// Helper function to convert coordinates to CSV format
const convertCoordinatesToCsv = (
    outlineName: string, 
    type: 'Kinematic' | 'Static' | 'Rotated Static', 
    xCoords: number[], 
    yCoords: number[]
): string => {
    // CSV Header
    let csv = "Outline,Type,X (mm),Y (mm)\n";
    
    // Safety check: ensure arrays are the same length
    const length = Math.min(xCoords.length, yCoords.length);

    for (let i = 0; i < length; i++) {
        // Format to 2 decimal places for better readability
        const x = xCoords[i].toFixed(2);
        const y = yCoords[i].toFixed(2);
        csv += `${outlineName},${type},${x},${y}\n`;
    }
    return csv;
};

const App: React.FC = () => {
    const { params, updateParams, simulationResult } = useSimulation();

    const handleExport = useCallback((type: 'static' | 'kinematic' | 'rotated-static') => {
        if (!simulationResult) {
            console.error("Attempted export without a valid simulation result.");
            return;
        }

        const { polygons } = simulationResult;
        const { outlineId } = params;
        let xCoords: number[];
        let yCoords: number[];
        let fileNameType: string;
        let dataLabel: 'Static' | 'Kinematic' | 'Rotated Static';

        if (type === 'kinematic') {
            // Kinematic Envelope (Dynamic Envelope) coordinates.
            // Exclude the last point, as it's a duplicate only used to close the path for plotting.
            xCoords = polygons.left.x.slice(0, -1); 
            yCoords = polygons.left.y.slice(0, -1);
            fileNameType = 'kinematic_envelope';
            dataLabel = 'Kinematic';
        } else if (type === 'rotated-static') {
            // Rotated Static Outline coordinates (Ghost outline)
            // Note: These might be empty if rotation/cant/tolerances don't produce a distinct ghost shape,
            // but usually they contain the bounds of the static vehicle rotated by the roll angle.
            xCoords = polygons.left.rot_static_x.slice(0, -1);
            yCoords = polygons.left.rot_static_y.slice(0, -1);
            fileNameType = 'rotated_static_outline';
            dataLabel = 'Rotated Static';
        } else {
            // Static Outline coordinates.
            xCoords = polygons.left.static_x;
            yCoords = polygons.left.static_y;
            fileNameType = 'static_outline';
            dataLabel = 'Static';
        }

        // Generate CSV data
        const csvData = convertCoordinatesToCsv(outlineId, dataLabel, xCoords, yCoords);
        
        // Trigger file download
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `${outlineId}_${fileNameType}_${dateStr}.csv`;

        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`Exported ${dataLabel} data for ${outlineId}.`);

    }, [simulationResult, params.outlineId]);

    return (
        <div className="flex flex-col lg:flex-row h-screen w-screen overflow-hidden bg-gray-50">
            {/* Sidebar */}
            <div className="w-full lg:w-80 h-1/3 lg:h-full flex-shrink-0 z-10 border-r border-gray-200">
                <ControlPanel 
                    params={params} 
                    onUpdate={updateParams} 
                    simulationResult={simulationResult} // Pass result
                    onExport={handleExport} // Pass export callback
                />
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