import { useState, useMemo, useEffect, useCallback } from 'react';
import { SimulationParams, ToleranceSet } from '../types';
import { TRACK_TOLERANCES, OUTLINE_DATA_SETS } from '../constants';
import { calculateEnvelope } from '../services/railwayPhysics.ts';

const DEFAULT_PARAMS: SimulationParams = {
    radius: 100,
    half_gauge: 568.5, // Default value
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
    w_factor: 1925,
    enableStructureGauge: false, // Default disabled
    appliedCant: 0,
    roll: 0,
    latPlay: 0,
    bounce: 0,
    bounceYThreshold: 535,
    considerYRotation: false,
    useTrigCalculation: false, // Default to approximation (standard practice)
    showStudyVehicle: false,
    showDeltaGraph: false,
    showThrowInfo: true
};

export const useSimulation = () => {
    const [params, setParams] = useState<SimulationParams>(DEFAULT_PARAMS);

    // Business Logic: Auto-update tolerances when scenario changes
    const updateToleranceSettings = useCallback((currentParams: SimulationParams) => {
        if (!currentParams.enableTolerances) return currentParams;

        const data: ToleranceSet | undefined = TRACK_TOLERANCES[currentParams.trackScenario];
        if (data) {
            const lat = (currentParams.radiusScenario === 'gt_1000') 
                ? data.lat_gt_1000 
                : data.lat_lte_1000;
            
            return {
                ...currentParams,
                tol_lat: lat,
                tol_vert: data.vert,
                tol_cant: data.cant,
                tol_gw: data.gw
            };
        }
        return currentParams;
    }, []);

    // Wrapper for parameter updates
    const updateParams = useCallback((updates: Partial<SimulationParams>) => {
        setParams(prev => {
            const next = { ...prev, ...updates };
            
            // Check if we need to sync tolerances
            const shouldSync = 
                ('trackScenario' in updates) || 
                ('radiusScenario' in updates) || 
                ('enableTolerances' in updates);

            // Handle special case: Outline Change
            if ('outlineId' in updates && updates.outlineId) {
                const outline = OUTLINE_DATA_SETS[updates.outlineId];
                if (outline) {
                    next.L_outline = outline.L;
                    next.B_outline = outline.B;
                    // Also update w_factor if it exists in outline data, though it's usually static per model
                    if (outline.w_factor) next.w_factor = outline.w_factor;
                }
            }

            return shouldSync ? updateToleranceSettings(next) : next;
        });
    }, [updateToleranceSettings]);

    // Derived State: Simulation Result
    const simulationResult = useMemo(() => {
        try {
            return calculateEnvelope(params);
        } catch (e) {
            console.error("Physics Calculation Error:", e);
            return null;
        }
    }, [params]);

    return {
        params,
        updateParams,
        simulationResult
    };
};