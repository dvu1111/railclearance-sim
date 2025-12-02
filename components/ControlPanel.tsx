import React, { useEffect } from 'react';
import { SimulationParams, ToleranceSet } from '../types';
import { TRACK_TOLERANCES, OUTLINE_DATA_SETS } from '../constants';

interface ControlPanelProps {
  params: SimulationParams;
  setParams: React.Dispatch<React.SetStateAction<SimulationParams>>;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ params, setParams }) => {

  const handleChange = (field: keyof SimulationParams, value: any) => {
    setParams(prev => ({ ...prev, [field]: value }));
  };

  const handleOutlineChange = (id: string) => {
    const data = OUTLINE_DATA_SETS[id];
    setParams(prev => ({
      ...prev,
      outlineId: id,
      L_outline: data.L,
      B_outline: data.B
    }));
  };

  // Sync tolerances when presets change
  useEffect(() => {
    if (params.enableTolerances) {
      const data: ToleranceSet | undefined = TRACK_TOLERANCES[params.trackScenario];
      if (data) {
        const lat = (params.radiusScenario === 'gt_1000') ? data.lat_gt_1000 : data.lat_lte_1000;
        setParams(prev => ({
          ...prev,
          tol_lat: lat,
          tol_vert: data.vert,
          tol_cant: data.cant,
          tol_gw: data.gw
        }));
      }
    }
  }, [params.enableTolerances, params.trackScenario, params.radiusScenario, setParams]);

  return (
    <div className="h-full overflow-y-auto p-4 bg-gray-50 border-r border-gray-200 shadow-sm text-sm">
      <h1 className="text-xl font-bold mb-4 text-gray-900">Input Parameters</h1>

      {/* Geometry Section */}
      <div className="bg-white border border-gray-300 p-2 mb-4 rounded">
        <div className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">Track Geometry</div>
        
        {/* Radius */}
        <div className="flex items-center gap-2 mb-2">
          <span className="font-bold mr-auto text-gray-700">Radius (R) [m]</span>
          <input
            type="number"
            value={params.radius}
            onChange={(e) => handleChange('radius', parseFloat(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 w-24 text-right focus:border-blue-500 outline-none"
          />
        </div>

        {/* Applied Cant */}
        <div className="flex items-center gap-2">
          <span className="font-bold mr-auto text-gray-700">Applied Cant [mm]</span>
          <input
            type="number"
            value={params.appliedCant}
            onChange={(e) => handleChange('appliedCant', parseFloat(e.target.value))}
            className="border border-blue-300 bg-blue-50 rounded px-2 py-1 w-24 text-right focus:border-blue-500 outline-none font-bold text-blue-900"
            title="Design superelevation of the track"
          />
        </div>
      </div>

      {/* Vehicle Dims */}
      <div className="bg-white border border-gray-300 p-2 mb-4 rounded space-y-2">
        <div className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">Vehicle Dimensions</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1">
            <label className="font-bold text-gray-500 w-12 text-right">L_veh</label>
            <input
              type="number"
              value={params.L_veh}
              onChange={(e) => handleChange('L_veh', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex-1 flex items-center gap-1">
            <label className="font-bold text-gray-500 w-12 text-right">B_veh</label>
            <input
              type="number"
              value={params.B_veh}
              onChange={(e) => handleChange('B_veh', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right focus:border-blue-500 outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1">
            <label className="font-bold text-gray-500 w-12 text-right">h</label>
            <input
              type="number"
              value={params.h}
              onChange={(e) => handleChange('h', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex-1 flex items-center gap-1">
            <label className="font-bold text-gray-500 w-12 text-right">w</label>
            <input
              type="number"
              value={params.w}
              onChange={(e) => handleChange('w', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right focus:border-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Outline Selection */}
      <div className="bg-white border border-gray-300 p-2 mb-4 rounded">
        <div className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">Outline Selection</div>
        <div className="flex flex-col gap-2 mb-2">
          <label className="text-xs font-bold text-gray-500">Select Model:</label>
          <select
            value={params.outlineId}
            onChange={(e) => handleOutlineChange(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded bg-white outline-none"
          >
            {Object.keys(OUTLINE_DATA_SETS).map(key => {
               const d = OUTLINE_DATA_SETS[key];
               return <option key={key} value={key}>{key} (L={d.L}, B={d.B})</option>
            })}
          </select>
        </div>
        <div className="border-t border-gray-200 mt-2 pt-2 flex items-center gap-2">
          <div className="text-xs font-bold text-gray-500 w-12">Ref Dims:</div>
          <div className="flex-1 flex items-center gap-1">
            <span className="text-xs font-bold text-gray-400">L</span>
            <input
              type="number"
              value={params.L_outline}
              onChange={(e) => handleChange('L_outline', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right outline-none"
            />
          </div>
          <div className="flex-1 flex items-center gap-1">
            <span className="text-xs font-bold text-gray-400">B</span>
            <input
              type="number"
              value={params.B_outline}
              onChange={(e) => handleChange('B_outline', parseFloat(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 w-full text-right outline-none"
            />
          </div>
        </div>
      </div>

      {/* Curve Direction */}
      <div className="bg-white border-l-4 border-l-blue-500 border border-gray-300 p-2 mb-4 rounded">
        <div className="font-bold text-blue-800 mb-2 border-b border-gray-200 pb-1">Curve Direction</div>
        <div className="flex items-center gap-2 mb-2">
          <input
            type="radio"
            name="curve_dir"
            id="curve_cw"
            checked={params.direction === 'cw'}
            onChange={() => handleChange('direction', 'cw')}
            className="accent-blue-600 scale-125"
          />
          <label htmlFor="curve_cw" className="flex-1 cursor-pointer font-bold">Clockwise</label>
          <span className="bg-blue-100 text-blue-800 px-2 rounded text-xs">Right Turn</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="radio"
            name="curve_dir"
            id="curve_ccw"
            checked={params.direction === 'ccw'}
            onChange={() => handleChange('direction', 'ccw')}
            className="accent-blue-600 scale-125"
          />
          <label htmlFor="curve_ccw" className="flex-1 cursor-pointer font-bold">Counter-Clockwise</label>
          <span className="bg-blue-100 text-blue-800 px-2 rounded text-xs">Left Turn</span>
        </div>
      </div>

      {/* Track Tolerances */}
      <div className="bg-white border-l-4 border-l-green-600 border border-gray-300 p-2 mb-4 rounded">
        <div className="font-bold text-green-800 mb-2 border-b border-gray-200 pb-1 flex items-center gap-2">
          <input
            type="checkbox"
            checked={params.enableTolerances}
            onChange={(e) => handleChange('enableTolerances', e.target.checked)}
            className="w-4 h-4 cursor-pointer"
          />
          <span className="cursor-pointer select-none">Track Tolerances</span>
        </div>

        <div className={`transition-opacity duration-200 ${params.enableTolerances ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
          <div className="mb-2">
            <label className="block text-xs font-bold text-gray-600 mb-1">Track Scenario</label>
            <select
              value={params.trackScenario}
              onChange={(e) => handleChange('trackScenario', e.target.value)}
              className="w-full text-xs p-1 border rounded outline-none"
            >
              <option value="ballasted_open">Ballasted open track</option>
              <option value="ballasted_prescribed">Ballasted track (prescribed)</option>
              <option value="fixed_track">Fixed track</option>
              <option value="fouling_point">Fouling Point</option>
            </select>
          </div>
          <div className="mb-2">
            <label className="block text-xs font-bold text-gray-600 mb-1">Radius Scenario</label>
            <select
              value={params.radiusScenario}
              onChange={(e) => handleChange('radiusScenario', e.target.value)}
              className="w-full text-xs p-1 border rounded outline-none"
            >
              <option value="gt_1000">Lateral Tol [mm] – Radius &gt;1000m</option>
              <option value="lte_1000">Lateral Tol [mm] – Radius &le; 1000m</option>
            </select>
          </div>

          <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-2 gap-2">
             {[
               { l: 'Lat Tol (mm)', k: 'tol_lat' },
               { l: 'Vert Tol (mm)', k: 'tol_vert' },
               { l: 'Cant Tol (mm)', k: 'tol_cant' },
               { l: 'GW Tol (mm)', k: 'tol_gw' },
             ].map((f) => (
                <div key={f.k}>
                  <label className="block text-[10px] font-bold text-gray-500">{f.l}</label>
                  <input
                    type="number"
                    value={params[f.k as keyof SimulationParams] as number}
                    onChange={(e) => handleChange(f.k as keyof SimulationParams, parseFloat(e.target.value))}
                    className="border border-gray-300 rounded px-1 w-full h-6 text-xs text-right outline-none"
                  />
                </div>
             ))}
          </div>
          <div className="text-[10px] text-gray-500 italic mt-1 leading-tight">
              *Values populated from Table 13.
          </div>
        </div>
      </div>

      {/* Dynamics */}
      <div className="bg-white border border-gray-300 p-2 mb-4 rounded">
          <div className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">Dynamics</div>
          <div className="flex justify-between mb-2 px-2 text-xs font-bold text-gray-500">
              <span className="w-20 text-center">Roll (deg)</span>
              <span className="w-20 text-center">Lat (mm)</span>
              <span className="w-20 text-center">Bounce (mm)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 mb-3">
              <input 
                type="number" 
                value={params.roll} 
                onChange={(e) => handleChange('roll', parseFloat(e.target.value))}
                step="0.1"
                className="border border-gray-300 rounded px-2 py-1 w-full text-right outline-none"
              />
              <input 
                type="number" 
                value={params.latPlay} 
                onChange={(e) => handleChange('latPlay', parseFloat(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 w-full text-right outline-none"
              />
              <input 
                type="number" 
                value={params.bounce} 
                onChange={(e) => handleChange('bounce', parseFloat(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 w-full text-right outline-none"
              />
          </div>
          <div className="flex items-center gap-2 px-1 pt-2 border-t border-gray-200">
              <label className="text-xs font-bold text-gray-700 w-auto">Bounce Start Y:</label>
              <input 
                type="number" 
                value={params.bounceYThreshold} 
                onChange={(e) => handleChange('bounceYThreshold', parseFloat(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 flex-1 text-right outline-none"
                title="Apply bounce only to points above this Y height"
              />
          </div>
      </div>
      
      <div className="mt-4 text-xs text-gray-400 text-center">
         Results update automatically.
      </div>
    </div>
  );
};

export default ControlPanel;