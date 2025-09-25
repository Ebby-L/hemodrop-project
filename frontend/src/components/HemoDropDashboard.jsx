import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Download, Wifi, WifiOff, AlertTriangle, Activity, Server, ServerOff } from 'lucide-react';

// Configuration - using fallback values since process.env is not available in Claude artifacts
const BACKEND_CONFIG = {
  HOST: 'localhost', // In real app: process.env.REACT_APP_BACKEND_HOST || 'localhost'
  PORT: '8000',      // In real app: process.env.REACT_APP_BACKEND_PORT || '8000'
  USE_SIMULATION: true, // In real app: process.env.REACT_APP_USE_SIMULATION !== 'false'
};

const API_BASE_URL = `http://${BACKEND_CONFIG.HOST}:${BACKEND_CONFIG.PORT}`;
const WS_URL = `ws://${BACKEND_CONFIG.HOST}:${BACKEND_CONFIG.PORT}/ws`;

// Memoized classification function
const getBloodLossClassification = (bloodLoss) => {
  if (bloodLoss >= 500) return { level: 'Major Hemorrhage', color: '#ef4445', alert: 'CRITICAL' };
  if (bloodLoss >= 250) return { level: 'Moderate Hemorrhage', color: '#f97316', alert: 'WARNING' };
  if (bloodLoss >= 100) return { level: 'Minor Hemorrhage', color: '#eab308', alert: 'CAUTION' };
  return { level: 'Normal bleeding', color: '#22c55e', alert: 'NORMAL' };
};

// Optimized rate calculation with elapsed minutes
const calculateRates = (data) => {
  if (!Array.isArray(data) || data.length < 2) {
    return (data || []).map((d, i) => ({ 
      ...d, 
      rate: 0, 
      smoothedRate: 0, 
      elapsedMinutes: i * 2 // Default 2-minute intervals
    }));
  }

  let previousSmoothedRate = 0;
  const alpha = 0.25;
  const startTime = data[0]?.timestamp || Date.now();

  return data.map((point, i) => {
    // Calculate elapsed minutes from start
    const elapsedMinutes = Math.round((point.timestamp - startTime) / 60000);
    
    if (i === 0) {
      return { ...point, rate: 0, smoothedRate: 0, elapsedMinutes: 0 };
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
      smoothedRate: Math.round(smoothedRate * 10) / 10,
      elapsedMinutes: Math.max(0, elapsedMinutes)
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
  
  // Backend integration states
  const [backendConnected, setBackendConnected] = useState(false);
  const [backendMode, setBackendMode] = useState('unknown');
  const [connectionError, setConnectionError] = useState(null);
  const [isUsingBackend, setIsUsingBackend] = useState(BACKEND_CONFIG.USE_SIMULATION);
  
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);
  const dataBufferRef = useRef([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // WebSocket connection management
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      wsRef.current = new WebSocket(WS_URL);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setBackendConnected(true);
        setConnectionError(null);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'connection_established') {
            setBackendMode(message.mode || 'unknown');
            console.log(`Connected to backend in ${message.mode} mode`);
          } else if (message.type === 'real_time_data') {
            handleBackendData(message.data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setBackendConnected(false);
        
        // Attempt to reconnect after delay
        if (isUsingBackend) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionError('Failed to connect to backend');
        setBackendConnected(false);
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionError('WebSocket creation failed');
    }
  }, [isUsingBackend]);

  // Handle data from backend
  const handleBackendData = useCallback((data) => {
    if (data.patient_id !== selectedPatient.id.toString()) {
      return; // Ignore data for other patients
    }

    const newPoint = {
      timestamp: new Date(data.timestamp).getTime(),
      time: new Date(data.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      bloodLoss: data.volume_ml,
      rate: data.rate_ml_min,
    };

    setMonitoringData(prev => {
      const newData = [...prev, newPoint];
      const cutoff = Date.now() - zoomLevel * 60 * 1000;
      const filteredData = newData.filter(d => d.timestamp >= cutoff);
      
      // Calculate rates with elapsed minutes
      return calculateRates(filteredData);
    });
  }, [selectedPatient.id, zoomLevel]);

  // Backend API calls
  const sendDataToBackend = useCallback(async (data) => {
    if (!isUsingBackend || !backendConnected) return;

    try {
      await fetch(`${API_BASE_URL}/api/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          volume_ml: data.bloodLoss,
          rate_ml_min: data.rate || 0,
          timestamp: data.timestamp / 1000, // Convert to seconds
          patient_id: selectedPatient.id.toString(),
        }),
      });
    } catch (error) {
      console.error('Error sending data to backend:', error);
    }
  }, [isUsingBackend, backendConnected, selectedPatient.id]);

  const fetchPatientHistory = useCallback(async (patientId, hours = 24) => {
    if (!isUsingBackend || !backendConnected) return [];

    try {
      const response = await fetch(`${API_BASE_URL}/api/history/${patientId}?hours=${hours}`);
      if (response.ok) {
        const data = await response.json();
        return data.history.map(item => ({
          timestamp: new Date(item.timestamp).getTime(),
          time: item.time,
          bloodLoss: item.volume_ml,
          rate: item.rate_ml_min,
        }));
      }
    } catch (error) {
      console.error('Error fetching patient history:', error);
    }
    return [];
  }, [isUsingBackend, backendConnected]);

  const generateSimulatedData = useCallback(async () => {
    if (!isUsingBackend || !backendConnected || backendMode !== 'simulation') {
      // Fallback to frontend simulation
      return generateFallbackData();
    }

    try {
      await fetch(`${API_BASE_URL}/api/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration_minutes: 10,
          max_volume: 500,
          patient_id: selectedPatient.id.toString(),
        }),
      });
    } catch (error) {
      console.error('Error generating simulated data:', error);
    }
  }, [isUsingBackend, backendConnected, backendMode, selectedPatient.id]);

  // Fallback data generation for when backend is unavailable
  const generateFallbackData = useCallback((currentTime = Date.now(), totalMinutes = 60) => {
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
        elapsedMinutes: i, // Add elapsed minutes for rate chart
      });
    }
    return calculateRates(data);
  }, []);

  // Clear interval safely
  const clearMonitoringInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Check backend health on component mount
  useEffect(() => {
    if (!isUsingBackend) return;

    const checkBackendHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
          const health = await response.json();
          setBackendMode(health.mode);
          connectWebSocket();
        }
      } catch (error) {
        console.error('Backend health check failed:', error);
        setConnectionError('Backend unavailable');
      }
    };

    checkBackendHealth();
  }, [isUsingBackend, connectWebSocket]);

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
    return generateFallbackData(Date.now(), zoomLevel);
  }, [monitoring, monitoringData, zoomLevel, generateFallbackData]);

  // Real-time data simulation with backend integration
  useEffect(() => {
    if (!monitoring || paused) {
      clearMonitoringInterval();
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
      dataBufferRef.current = [];
    }

    // If using backend and connected, let backend handle data generation
    if (isUsingBackend && backendConnected && backendMode === 'simulation') {
      // Backend will send data via WebSocket
      return;
    }

    // Fallback to frontend simulation
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

      // Send to backend if connected
      sendDataToBackend(newPoint);

      dataBufferRef.current = [...dataBufferRef.current, newPoint];
      
      if (dataBufferRef.current.length >= 5) {
        const processedData = calculateRates(dataBufferRef.current);
        dataBufferRef.current = [];
        
        setMonitoringData(prev => {
          const newData = [...prev, ...processedData];
          const cutoff = Date.now() - zoomLevel * 60 * 1000;
          const filteredData = newData.filter(d => d.timestamp >= cutoff);
          
          // Recalculate with proper elapsed minutes
          return calculateRates(filteredData);
        });
      }
    }, 3000);

    return clearMonitoringInterval;
  }, [monitoring, paused, zoomLevel, clearMonitoringInterval, isUsingBackend, backendConnected, backendMode, sendDataToBackend]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMonitoringInterval();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [clearMonitoringInterval]);

  const handleStartMonitoring = useCallback(async (patient) => {
    setSelectedPatient(patient);
    setMonitoring(true);
    setPaused(false);
    setMonitoringData([]);
    dataBufferRef.current = [];
    startTimeRef.current = null;
    setCurrentView('monitoring');

    // Load historical data from backend if available
    if (isUsingBackend && backendConnected) {
      const history = await fetchPatientHistory(patient.id.toString(), 1);
      if (history.length > 0) {
        setMonitoringData(calculateRates(history));
      }
    }
  }, [isUsingBackend, backendConnected, fetchPatientHistory]);

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

  // Toggle backend usage
  const toggleBackendUsage = useCallback(() => {
    setIsUsingBackend(prev => !prev);
    if (!isUsingBackend) {
      connectWebSocket();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setBackendConnected(false);
    }
  }, [isUsingBackend, connectWebSocket]);

  // Backend status indicator component
  const BackendStatus = () => (
    <div className="flex items-center gap-2">
      {isUsingBackend ? (
        <>
          {backendConnected ? (
            <div className="flex items-center gap-2 text-green-400">
              <Server className="w-4 h-4" />
              <span className="text-sm font-medium">Backend: {backendMode}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-400">
              <ServerOff className="w-4 h-4" />
              <span className="text-sm font-medium">Backend: Disconnected</span>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-yellow-400">
          <Activity className="w-4 h-4" />
          <span className="text-sm font-medium">Frontend Only</span>
        </div>
      )}
      <button
        onClick={toggleBackendUsage}
        className="text-xs px-2 py-1 bg-slate-600 rounded hover:bg-slate-500 transition-colors"
      >
        Toggle
      </button>
    </div>
  );

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
    if (!chartData || chartData.length === 0) {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <div className="flex items-center justify-center h-full text-gray-500">
            No rate data available
          </div>
        </ResponsiveContainer>
      );
    }

    const maxElapsed = Math.max(...chartData.map(d => d.elapsedMinutes || 0));
    const maxRate = Math.max(...chartData.map(d => d.smoothedRate || 0));
    
    // Generate tick marks every 2 minutes
    const ticks = [];
    for (let t = 0; t <= Math.max(maxElapsed, zoomLevel); t += Math.max(2, Math.ceil(maxElapsed / 10))) {
      ticks.push(t);
    }

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
            tickFormatter={v => `${v}min`} 
            label={{ value: 'Time (minutes)', position: 'insideBottom', offset: -5 }}
          />
          <YAxis 
            domain={[0, Math.max(maxRate + 5, 10)]} 
            tick={{ fontSize: 12 }} 
            label={{ value: 'Rate (mL/min)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip 
            formatter={(value, name) => [`${Number(value).toFixed(1)} mL/min`, 'Blood Loss Rate']} 
            labelFormatter={label => `Time: ${label} min`} 
          />
          <Area 
            type="monotone" 
            dataKey="smoothedRate" 
            stroke="#3b82f6" 
            fill="rgba(59, 130, 246, 0.3)" 
            strokeWidth={2} 
            isAnimationActive={false} 
            connectNulls={false}
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
            <div className="flex items-center gap-6">
              <BackendStatus />
              <button onClick={() => handleNavigation('dashboard')} className="text-blue-300 font-medium">Dashboard</button>
              <button onClick={() => handleNavigation('patients')} className="hover:text-blue-300 transition-colors font-medium">Patients</button>
              <button onClick={() => handleNavigation('monitoring')} className="hover:text-blue-300 transition-colors font-medium">Monitoring</button>
            </div>
          </div>
        </nav>

        {connectionError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 mx-6 mt-4 rounded">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span>{connectionError}</span>
            </div>
          </div>
        )}

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
                    {isUsingBackend && backendConnected && (
                      <Server className="w-4 h-4 text-blue-500" />
                    )}
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
            <div className="flex items-center gap-6">
              <BackendStatus />
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
            <div className="flex items-center gap-6">
              <BackendStatus />
              <button onClick={() => handleNavigation('dashboard')} className="hover:text-blue-300 transition-colors font-medium">Dashboard</button>
              <button onClick={() => handleNavigation('patients')} className="hover:text-blue-300 transition-colors font-medium">Patients</button>
              <button onClick={() => handleNavigation('monitoring')} className="text-blue-300 font-medium">Monitoring</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto p-6">
          <div className="bg-slate-800 text-white p-4 rounded-t-lg">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">{selectedPatient.name.toUpperCase()}</h2>
                <p className="text-slate-300">Bed: {selectedPatient.bed} - Delivery Room {selectedPatient.room} - {selectedPatient.deliveryType} Birth</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-300">Data Source:</p>
                <p className="font-medium">
                  {isUsingBackend ? (backendConnected ? `Backend (${backendMode})` : 'Backend (Disconnected)') : 'Frontend Only'}
                </p>
              </div>
            </div>
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
                  
                  <div className="mt-6 space-y-2">
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
                    
                    {isUsingBackend && backendConnected && backendMode === 'simulation' && (
                      <button
                        onClick={generateSimulatedData}
                        className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium transition-colors"
                      >
                        Generate Test Data
                      </button>
                    )}
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
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Rate (mL/min)</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Source</th>
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
                          <td className="px-4 py-3 text-sm">{reading.rate?.toFixed(1) || '0.0'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {isUsingBackend && backendConnected ? 'Backend' : 'Frontend'}
                          </td>
                        </tr>
                      );
                    })}
                    {monitoringData.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-sm text-gray-500 text-center" colSpan={5}>
                          No monitoring data available. Start monitoring to see classification history.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  {isUsingBackend ? (
                    <div className="flex items-center gap-2">
                      {backendConnected ? (
                        <>
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Connected to backend ({backendMode} mode)</span>
                        </>
                      ) : (
                        <>
                          <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                          <span>Backend disconnected - using fallback data</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                      <span>Frontend simulation mode</span>
                    </div>
                  )}
                </div>
                
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

            {/* Connection Settings Panel */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">Connection Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Backend URL</label>
                  <input
                    type="text"
                    value={API_BASE_URL}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">WebSocket URL</label>
                  <input
                    type="text"
                    value={WS_URL}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isUsingBackend}
                        onChange={toggleBackendUsage}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Use Backend Integration</span>
                    </label>
                    
                    {isUsingBackend && !backendConnected && (
                      <button
                        onClick={connectWebSocket}
                        className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm transition-colors"
                      >
                        Reconnect
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Toggle between backend integration and frontend-only simulation mode
                  </p>
                </div>
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