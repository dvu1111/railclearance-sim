import React from 'react';
import { SimulationParams } from '../types';
import { OUTLINE_DATA_SETS } from '../constants';

interface ControlPanelProps {
  params: SimulationParams;
  onUpdate: (updates: Partial<SimulationParams>) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ params, onUpdate }) => {

  const handleNum = (field: keyof SimulationParams, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) onUpdate({ [field]: num });
  };

  const handleStr = (field: keyof SimulationParams, val: string) => {
    onUpdate({ [field]: val });
  };

  const handleBool = (field: keyof SimulationParams, val: boolean) => {
    onUpdate({ [field]: val });
  };

  return (
    <div className="h-full overflow-y-auto p-4 bg-gray-50 text-sm">
      <h1 className="text-xl font-bold mb-4 text-gray-900">Input Parameters</h1>

      {/* Geometry */}
      <section className="bg-white border border-gray-300 p-3 mb-4 rounded shadow-sm">
        <h3 className="font-bold text-gray-800 mb-2 border-b pb-1">Track Geometry</h3>
        
        <div className="flex items-center gap-2 mb-2">
          <label className="font-bold text-gray-700 flex-1">Radius (R) [m]</label>
          <input
            type="number"
            value={params.radius}
            onChange={(e) => handleNum('radius', e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 w-24 text-right focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="font-bold text-gray-700 flex-1">Applied Cant [mm]</label>
          <input
            type="number"
            value={params.appliedCant}
            onChange={(e) => handleNum('appliedCant', e.target.value)}
            className="border border-blue-300 bg-blue-50 rounded px-2 py-1 w-24 text-right font-bold text-blue-900"
          />
        </div>
      </section>

      {/* Vehicle Dimensions */}
      <section className="bg-white border border-gray-300 p-3 mb-4 rounded shadow-sm">
        <h3 className="font-bold text-gray-800 mb-2 border-b pb-1">Vehicle Dimensions</h3>
        <div className="grid grid-cols-2 gap-2">
            {[
                { label: 'L_veh', key: 'L_veh' },
                { label: 'B_veh', key: 'B_veh' },
                { label: 'Height (h)', key: 'h' },
                { label: 'Width (w)', key: 'w' }
            ].map(({ label, key }) => (
                <div key={key} className="flex flex-col">
                    <label className="text-xs font-bold text-gray-500">{label}</label>
                    <input
                        type="number"
                        value={params[key as keyof SimulationParams] as number}
                        onChange={(e) => handleNum(key as keyof SimulationParams, e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-right"
                    />
                </div>
            ))}
        </div>
      </section>

      {/* Reference Outline */}
      <section className="bg-white border border-gray-300 p-3 mb-4 rounded shadow-sm">
        <h3 className="font-bold text-gray-800 mb-2 border-b pb-1">Reference Outline</h3>
        <div className="mb-2">
          <label className="block text-xs font-bold text-gray-500 mb-1">Select Model:</label>
          <select
            value={params.outlineId}
            onChange={(e) => handleStr('outlineId', e.target.value)}
            className="w-full p-2 border border-gray-300 rounded bg-white"
          >
            {Object.keys(OUTLINE_DATA_SETS).map(key => (
               <option key={key} value={key}>{key}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 text-xs text-gray-500">
            <span>Ref L: {params.L_outline}</span>
            <span>Ref B: {params.B_outline}</span>
        </div>
      </section>

      {/* Curve Direction */}
      <section className="bg-white border-l-4 border-blue-500 border-gray-300 border p-3 mb-4 rounded shadow-sm">
        <h3 className="font-bold text-blue-800 mb-2 border-b pb-1">Curve Direction</h3>
        <div className="flex flex-col gap-2">
            {[
                { val: 'cw', label: 'Clockwise (Right)' },
                { val: 'ccw', label: 'Counter-Clockwise (Left)' }
            ].map(({ val, label }) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="radio"
                        name="direction"
                        checked={params.direction === val}
                        onChange={() => handleStr('direction', val)}
                        className="accent-blue-600"
                    />
                    <span className="font-medium text-gray-700">{label}</span>
                </label>
            ))}
        </div>
      </section>

      {/* Dynamics */}
      <section className="bg-white border border-gray-300 p-3 mb-4 rounded shadow-sm">
          <h3 className="font-bold text-gray-800 mb-2 border-b pb-1">Dynamics</h3>
          <div className="grid grid-cols-3 gap-2 mb-2">
              {[
                  { l: 'Roll (°)', k: 'roll' },
                  { l: 'Lat (mm)', k: 'latPlay' },
                  { l: 'Bounce', k: 'bounce' }
              ].map(f => (
                  <div key={f.k}>
                      <label className="block text-xs font-bold text-center text-gray-500">{f.l}</label>
                      <input 
                        type="number" 
                        value={params[f.k as keyof SimulationParams] as number}
                        onChange={(e) => handleNum(f.k as keyof SimulationParams, e.target.value)}
                        className="w-full border rounded px-1 text-right"
                      />
                  </div>
              ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
              <label className="text-xs font-bold text-gray-500">Bounce Y-Threshold:</label>
              <input 
                type="number" 
                value={params.bounceYThreshold} 
                onChange={(e) => handleNum('bounceYThreshold', e.target.value)}
                className="flex-1 border rounded px-1 text-right"
              />
          </div>
      </section>

      {/* Tolerances */}
      <section className="bg-white border-l-4 border-green-600 border-gray-300 border p-3 mb-4 rounded shadow-sm">
        <label className="flex items-center gap-2 font-bold text-green-800 mb-2 border-b pb-1 cursor-pointer">
          <input
            type="checkbox"
            checked={params.enableTolerances}
            onChange={(e) => handleBool('enableTolerances', e.target.checked)}
            className="w-4 h-4 accent-green-600"
          />
          Track Tolerances
        </label>

        {params.enableTolerances && (
            <div className="space-y-2">
                <select
                    value={params.trackScenario}
                    onChange={(e) => handleStr('trackScenario', e.target.value)}
                    className="w-full text-xs p-1 border rounded"
                >
                    <option value="ballasted_open">Ballasted Open Track</option>
                    <option value="ballasted_prescribed">Ballasted Prescribed</option>
                    <option value="fixed_track">Fixed Track</option>
                    <option value="fouling_point">Fouling Point</option>
                </select>
                
                <select
                    value={params.radiusScenario}
                    onChange={(e) => handleStr('radiusScenario', e.target.value)}
                    className="w-full text-xs p-1 border rounded"
                >
                    <option value="gt_1000">Radius &gt; 1000m</option>
                    <option value="lte_1000">Radius &le; 1000m</option>
                </select>

                <div className="grid grid-cols-2 gap-2 mt-2 border-t pt-2">
                    {[
                        { l: 'Lat Tol', k: 'tol_lat' },
                        { l: 'Vert Tol', k: 'tol_vert' },
                        { l: 'Cant Tol', k: 'tol_cant' },
                        { l: 'GW Tol', k: 'tol_gw' }
                    ].map(f => (
                        <div key={f.k}>
                            <label className="text-[10px] font-bold text-gray-500 block">{f.l}</label>
                            <input
                                type="number"
                                value={params[f.k as keyof SimulationParams] as number}
                                onChange={(e) => handleNum(f.k as keyof SimulationParams, e.target.value)}
                                className="w-full border rounded px-1 text-right text-xs"
                            />
                        </div>
                    ))}
                </div>
            </div>
        )}
      </section>

      {/* Options */}
      <section className="bg-white border border-gray-300 p-3 rounded shadow-sm space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
              <input
                  type="checkbox"
                  checked={params.considerYRotation}
                  onChange={(e) => handleBool('considerYRotation', e.target.checked)}
              />
              <span className="text-xs font-bold text-gray-700">Apply Y-Rotation</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
              <input
                  type="checkbox"
                  checked={params.showStudyVehicle}
                  onChange={(e) => handleBool('showStudyVehicle', e.target.checked)}
              />
              <span className="text-xs font-bold text-gray-700">Show Study Vehicle</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
              <input
                  type="checkbox"
                  checked={params.useTrigCalculation}
                  onChange={(e) => handleBool('useTrigCalculation', e.target.checked)}
              />
              <span className="text-xs font-bold text-gray-700">Precise Calculation (Trig)</span>
          </label>
      </section>
    </div>
  );
};

export default ControlPanel;