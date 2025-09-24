import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Download, Wifi, WifiOff, AlertTriangle, Activity } from 'lucide-react';

// Memoized classification function
const getBloodLossClassification = (bloodLoss) => {
  if (bloodLoss >= 500) return { level: 'Major Hemorrhage', color: '#ef4445', alert: 'CRITICAL' };
  if (bloodLoss >= 250) return { level: 'Moderate Hemorrhage', color: '#f97316', alert: 'WARNING' };
  if (bloodLoss >= 100) return { level: 'Minor Hemorrhage', color: '#eab308', alert: 'CAUTION' };
  return { level: 'Normal bleeding', color: '#22c55e', alert: 'NORMAL' };
};

// Optimized rate calculation
const calculateRates = (data) => {
  if (!Array.isArray(data) || data.length < 2) {
    return (data || []).map(d => ({ ...d, rate: 0, smoothedRate: 0 }));
  }

  let previousSmoothedRate = 0;
  const alpha = 0.25;

  return data.map((point, i) => {
    if (i === 0) {
      return { ...point, rate: 0, smoothedRate: 0 };
    }
    
    const prev = data[i - 1];
    const bloodDiff = (point.bloodLoss ?? 0) - (prev.bloodLoss ?? 0);
    const timeDiffMins = (point.timestamp - prev.timestamp) / 60000;
    const rate = timeDiffMins > 0 ? Math.max(0, bloodDiff / timeDiffMins) : 0;
    
    // Exponential smoothing
    const smoothedRate = previousSmoothedRate * (1 - alpha) + rate * alpha;
    previousSmoothedRate = smoothedRate;

    return { 
      ...point, 
      rate: Math.round(rate * 10) / 10, 
      smoothedRate: Math.round(smoothedRate * 10) / 10 
    };
  });
};

const HemoDropDashboard = () => {
  const [patients] = useState([
    { id: 1, name: 'Jane Doe', dob: 'May 15, 1990', gravidity: 2, parity: 1, room: '101', bed: 'A', deliveryType: 'Vaginal', stage: 'Active' },
    { id: 2, name: 'Mary Smith', dob: 'Aug 22, 1988', gravidity: 3, parity: 2, room: '102', bed: 'B', deliveryType: 'Cesarean', stage: 'Complete' }
  ]);

  const [selectedPatient, setSelectedPatient] = useState(patients[0]);
  const [currentView, setCurrentView] = useState('dashboard');
  const [monitoring, setMonitoring] = useState(false);
  const [paused, setPaused] = useState(false);
  const [monitoringData, setMonitoringData] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(60);
  
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const dataBufferRef = useRef([]);

  // Clear interval safely
  const clearMonitoringInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Generate simulated data only when needed
  const generateSimulatedData = useCallback((currentTime, totalMinutes) => {
    const data = [];
    const startTime = currentTime - (totalMinutes * 60 * 1000);
    
    for (let i = 0; i <= totalMinutes; i += 2) {
      const timestamp = startTime + (i * 60 * 1000);
      
      let bloodLoss = 0;
      if (i < 20) {
        bloodLoss = Math.max(0, 10 + (i * 2) + Math.random() * 5);
      } else if (i < 40) {
        bloodLoss = 50 + (i - 20) * 8 + Math.random() * 10;
      } else {
        bloodLoss = 210 + (i - 40) * 15 + Math.random() * 20;
      }
      
      data.push({
        time: new Date(timestamp).toLocaleTimeString('en-US', { hour12: false }),
        timestamp,
        bloodLoss: Math.round(bloodLoss),
      });
    }
    return calculateRates(data);
  }, []);

  // Memoized current blood loss
  const currentBloodLoss = useMemo(() => 
    monitoringData.length > 0 ? monitoringData[monitoringData.length - 1].bloodLoss : 0, 
    [monitoringData]
  );

  // Memoized classification
  const classification = useMemo(() => 
    getBloodLossClassification(currentBloodLoss), 
    [currentBloodLoss]
  );

  // Optimized data for charts
  const chartData = useMemo(() => {
    if (monitoring && monitoringData.length > 0) {
      const cutoff = Date.now() - zoomLevel * 60 * 1000;
      return monitoringData.filter(d => d.timestamp >= cutoff);
    }
    return generateSimulatedData(Date.now(), zoomLevel);
  }, [monitoring, monitoringData, zoomLevel, generateSimulatedData]);

  // Real-time data simulation with optimizations
  useEffect(() => {
    if (!monitoring || paused) {
      clearMonitoringInterval();
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
      dataBufferRef.current = [];
    }

    let lastLoss = monitoringData.length > 0 ? monitoringData[monitoringData.length - 1].bloodLoss : 0;

    intervalRef.current = setInterval(() => {
      const timestamp = Date.now();
      const increment = Math.floor(Math.random() * 6) + 1;
      lastLoss += increment;

      const newPoint = {
        timestamp,
        time: new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        bloodLoss: lastLoss,
      };

      // Use ref for buffer to avoid dependency on monitoringData
      dataBufferRef.current = [...dataBufferRef.current, newPoint];
      
      // Calculate rates in batches for better performance
      if (dataBufferRef.current.length >= 5) {
        const processedData = calculateRates(dataBufferRef.current);
        dataBufferRef.current = []; // Clear buffer after processing
        
        setMonitoringData(prev => {
          const newData = [...prev, ...processedData];
          const cutoff = Date.now() - zoomLevel * 60 * 1000;
          return newData.filter(d => d.timestamp >= cutoff);
        });
      }
    }, 3000); // Reduced frequency for better performance

    return clearMonitoringInterval;
  }, [monitoring, paused, zoomLevel, clearMonitoringInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMonitoringInterval();
    };
  }, [clearMonitoringInterval]);

  const handleStartMonitoring = useCallback((patient) => {
    setSelectedPatient(patient);
    setMonitoring(true);
    setPaused(false);
    setMonitoringData([]);
    dataBufferRef.current = [];
    startTimeRef.current = null;
    setCurrentView('monitoring');
  }, []);

  const handlePauseToggle = useCallback(() => {
    if (paused) {
      setPaused(false);
    } else {
      setPaused(true);
      clearMonitoringInterval();
    }
  }, [paused, clearMonitoringInterval]);

  const downloadPatientHistory = useCallback(() => {
    if (monitoringData.length === 0) return;
    
    const dataStr = JSON.stringify(monitoringData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `${selectedPatient.name.replace(' ', '_')}_blood_loss_history.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }, [monitoringData, selectedPatient.name]);

  // Navigation handler
  const handleNavigation = useCallback((view) => {
    clearMonitoringInterval();
    setCurrentView(view);
  }, [clearMonitoringInterval]);

  // Memoized chart components to prevent unnecessary re-renders
  const renderBloodLossChart = useMemo(() => (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="timestamp" 
          type="number" 
          domain={['dataMin', 'dataMax']} 
          tick={{ fontSize: 12 }} 
          tickFormatter={ts => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} 
        />
        <YAxis 
          domain={[0, 'dataMax + 50']} 
          tick={{ fontSize: 12 }} 
        />
        <Tooltip 
          formatter={(value) => [`${Number(value).toFixed(1)} mL`, 'Blood Loss']} 
          labelFormatter={ts => new Date(ts).toLocaleTimeString()} 
        />
        <Line 
          type="monotone" 
          dataKey="bloodLoss" 
          stroke="#ef4444" 
          strokeWidth={2} 
          isAnimationActive={false} 
          dot={false} 
        />
      </LineChart>
    </ResponsiveContainer>
  ), [chartData]);

  const renderRateChart = useMemo(() => {
    const maxElapsed = chartData.length ? Math.max(...chartData.map(d => d.elapsedMinutes || 0)) : 0;
    const ticks = [];
    for (let t = 0; t <= maxElapsed; t += 2) ticks.push(t);

    return (
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="elapsedMinutes" 
            type="number" 
            domain={[0, Math.max(maxElapsed, zoomLevel)]} 
            ticks={ticks} 
            tick={{ fontSize: 12 }} 
            tickFormatter={v => `${v} min`} 
          />
          <YAxis 
            domain={[0, 'dataMax + 5']} 
            tick={{ fontSize: 12 }} 
          />
          <Tooltip 
            formatter={(value) => [`${Number(value).toFixed(1)} mL/min`, 'Rate']} 
            labelFormatter={label => `Time: ${label} min`} 
          />
          <Area 
            type="monotone" 
            dataKey="smoothedRate" 
            stroke="#3b82f6" 
            fill="rgba(59, 130, 246, 0.3)" 
            strokeWidth={2} 
            isAnimationActive={false} 
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }, [chartData, zoomLevel]);

   // Render different views
   if (currentView === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-slate-800 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-8 h-8 text-blue-400" />
              Hemodrop Detector
            </h1>
            <div className="flex gap-6">
              <button onClick={() => handleNavigation('dashboard')} className="text-blue-300 font-medium">Dashboard</button>
              <button onClick={() => handleNavigation('patients')} className="hover:text-blue-300 transition-colors font-medium">Patients</button>
              <button onClick={() => handleNavigation('monitoring')} className="hover:text-blue-300 transition-colors font-medium">Monitoring</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-6 rounded-b-lg shadow-lg">
            {patients.map(patient => (
              <div key={patient.id} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">{patient.name}</h3>
                  <div className="flex items-center gap-2">
                    {monitoring && selectedPatient.id === patient.id ? 
                      <Wifi className="w-5 h-5 text-green-500" /> : 
                      <WifiOff className="w-5 h-5 text-red-500" />
                    }
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div><p className="text-gray-600">DOB:</p><p className="font-medium">{patient.dob}</p></div>
                  <div><p className="text-gray-600">Gravidity:</p><p className="font-medium">{patient.gravidity}</p></div>
                  <div><p className="text-gray-600">Parity:</p><p className="font-medium">{patient.parity}</p></div>
                </div>

                <div className="mb-4">
                  <h4 className="font-semibold text-slate-700 mb-2">Location</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><p className="text-gray-600">Room:</p><p className="font-medium">{patient.room}</p></div>
                    <div><p className="text-gray-600">Bed:</p><p className="font-medium">{patient.bed}</p></div>
                  </div>
                </div>

                <div className="mb-4">
                  <h4 className="font-semibold text-slate-700 mb-2">Delivery Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><p className="text-gray-600">Type:</p><p className="font-medium">{patient.deliveryType}</p></div>
                    <div><p className="text-gray-600">Stage:</p><p className="font-medium">{patient.stage}</p></div>
                  </div>
                </div>

                <button
                  onClick={() => handleStartMonitoring(patient)}
                  className="w-full bg-slate-800 text-white py-2 rounded font-medium hover:bg-slate-700 transition-colors"
                >
                  Monitor
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'patients') {
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-slate-800 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-8 h-8 text-blue-400" />
              Hemodrop Detector
            </h1>
            <div className="flex gap-6">
              <button onClick={() => handleNavigation('dashboard')} className="hover:text-blue-300 transition-colors font-medium">Dashboard</button>
              <button onClick={() => handleNavigation('patients')} className="text-blue-300 font-medium">Patients</button>
              <button onClick={() => handleNavigation('monitoring')} className="hover:text-blue-300 transition-colors font-medium">Monitoring</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto p-6">
          <h2 className="text-2xl font-bold mb-6">Patient Management</h2>
          <div className="bg-white rounded-lg shadow-lg p-6">
            <p className="text-gray-600">Patient management features would be implemented here.</p>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'monitoring') {
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-slate-800 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-8 h-8 text-blue-400" />
              Hemodrop Detector
            </h1>
            <div className="flex gap-6">
              <button onClick={() => handleNavigation('dashboard')} className="hover:text-blue-300 transition-colors font-medium">Dashboard</button>
              <button onClick={() => handleNavigation('patients')} className="hover:text-blue-300 transition-colors font-medium">Patients</button>
              <button onClick={() => handleNavigation('monitoring')} className="text-blue-300 font-medium">Monitoring</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto p-6">
          <div className="bg-slate-800 text-white p-4 rounded-t-lg">
            <h2 className="text-xl font-bold">{selectedPatient.name.toUpperCase()}</h2>
            <p className="text-slate-300">Bed: {selectedPatient.bed} - Delivery Room {selectedPatient.room} - {selectedPatient.deliveryType} Birth</p>
          </div>

          <div className="bg-white rounded-b-lg shadow-lg p-6">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-1">
                <div className="text-center p-6 bg-gray-50 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">TOTAL BLOOD LOSS</h3>
                  <div className="text-6xl font-bold text-slate-800 mb-4">
                    {currentBloodLoss} <span className="text-2xl">mL</span>
                  </div>
                  <div className="px-6 py-3 rounded-full text-white font-bold text-lg" style={{ backgroundColor: classification.color }}>
                    {classification.level.toUpperCase()}
                  </div>
                  
                  <div className="mt-6">
                    <button
                      onClick={handlePauseToggle}
                      disabled={!monitoring}
                      className={`w-full px-6 py-2 rounded font-medium transition-colors ${
                        !monitoring ? 'bg-gray-400 cursor-not-allowed' :
                        paused ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'
                      }`}
                    >
                      {paused ? 'Resume Monitoring' : 'Stop Monitoring'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-2">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold mb-2">Blood Activity Rate</h3>
                  <div className="flex gap-2 mb-4">
                    {[60, 120, 360, 720, 1440].map(minutes => (
                      <button
                        key={minutes}
                        onClick={() => setZoomLevel(minutes)}
                        className={`px-3 py-1 rounded text-sm transition-colors ${
                          zoomLevel === minutes ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
                        }`}
                      >
                        {minutes < 60 ? `${minutes}min` : `${minutes/60}hr`}
                      </button>
                    ))}
                  </div>
                </div>
                {renderRateChart}
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Live Monitoring Trend</h3>
              {renderBloodLossChart}
            </div>

            {/* Classification History Table */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Classification History</h3>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Time</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Classification</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Blood Loss (mL)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {monitoringData.slice(-5).reverse().map((reading, index) => {
                      const readingClassification = getBloodLossClassification(reading.bloodLoss);
                      return (
                        <tr key={`${reading.timestamp}-${index}`} style={{ backgroundColor: `${readingClassification.color}22` }}>
                          <td className="px-4 py-3 text-sm font-medium">{reading.time}</td>
                          <td className="px-4 py-3 text-sm">{readingClassification.level}</td>
                          <td className="px-4 py-3 text-sm font-medium">{reading.bloodLoss}mL</td>
                        </tr>
                      );
                    })}
                    {monitoringData.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-sm text-gray-500 text-center" colSpan={3}>
                          No monitoring data available. Start monitoring to see classification history.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4 flex justify-end">
                <button 
                  onClick={downloadPatientHistory} 
                  disabled={monitoringData.length === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition-colors ${
                    monitoringData.length === 0 
                      ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <Download className="w-4 h-4" /> Download History
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default HemoDropDashboard;