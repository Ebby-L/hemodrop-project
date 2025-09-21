import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Download, Wifi, WifiOff, AlertTriangle, Activity } from 'lucide-react';

// Simulate real-time data generation
const generateSimulatedData = (currentTime, totalMinutes) => {
  const data = [];
  const startTime = currentTime - (totalMinutes * 60 * 1000);
  
  for (let i = 0; i <= totalMinutes; i += 2) { // Every 2 minutes
    const timestamp = startTime + (i * 60 * 1000);
    const time = new Date(timestamp);
    
    // Simulate blood loss progression with some realistic patterns
    let bloodLoss = 0;
    if (i < 20) {
      bloodLoss = Math.max(0, 10 + (i * 2) + Math.random() * 5);
    } else if (i < 40) {
      bloodLoss = 50 + (i - 20) * 8 + Math.random() * 10;
    } else {
      bloodLoss = 210 + (i - 40) * 15 + Math.random() * 20;
    }
    
    data.push({
      time: time.toLocaleTimeString('en-US', { hour12: false }),
      timestamp: timestamp,
      bloodLoss: Math.round(bloodLoss),
      rate: i > 0 ? Math.max(0, Math.round((bloodLoss - (data[data.length - 1]?.bloodLoss || 0)) / 2)) : 0
    });
  }
  return data;
};

// Classification based on blood loss
const getBloodLossClassification = (bloodLoss) => {
  if (bloodLoss >= 500) return { level: 'Major Hemorrhage', color: '#ef4444', alert: 'CRITICAL' };
  if (bloodLoss >= 250) return { level: 'Moderate Hemorrhage', color: '#f97316', alert: 'WARNING' };
  if (bloodLoss >= 100) return { level: 'Minor Hemorrhage', color: '#eab308', alert: 'CAUTION' };
  return { level: 'Normal bleeding', color: '#22c55e', alert: 'NORMAL' };
};

const HemoDropDashboard = () => {
  const [patients] = useState([
    {
      id: 1,
      name: 'Jane Doe',
      dob: 'May 15, 1990',
      gravidity: 2,
      parity: 1,
      room: '101',
      bed: 'A',
      deliveryType: 'Vaginal',
      stage: 'Active'
    },
    {
      id: 2,
      name: 'Mary Smith',
      dob: 'Aug 22, 1988',
      gravidity: 3,
      parity: 2,
      room: '102',
      bed: 'B',
      deliveryType: 'Cesarean',
      stage: 'Complete'
    }
  ]);

  const [selectedPatient, setSelectedPatient] = useState(patients[0]);
  const [currentView, setCurrentView] = useState('dashboard');
  const [monitoring, setMonitoring] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [monitoringData, setMonitoringData] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(60); // minutes
  const [isBlinking, setIsBlinking] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState([]);

  // Real-time data simulation
  useEffect(() => {
    if (!monitoring) return;
    
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      const newData = generateSimulatedData(Date.now(), zoomLevel);
      setMonitoringData(newData);
      
      // Check for alerts
      const latestReading = newData[newData.length - 1];
      if (latestReading) {
        const classification = getBloodLossClassification(latestReading.bloodLoss);
        
        // Trigger alerts for major hemorrhage
        if (classification.alert === 'CRITICAL') {
          setIsBlinking(true);
          setActiveAlerts(['MAJOR HEMORRHAGE DETECTED', 'IMMEDIATE INTERVENTION REQUIRED']);
        } else {
          setIsBlinking(false);
          setActiveAlerts([]);
        }
      }
    }, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [monitoring, zoomLevel]);

  // Blink effect for critical alerts
  useEffect(() => {
    if (!isBlinking) return;
    
    const blinkInterval = setInterval(() => {
      document.body.style.backgroundColor = document.body.style.backgroundColor === 'rgba(239, 68, 68, 0.1)' ? 'white' : 'rgba(239, 68, 68, 0.1)';
    }, 500);

    return () => {
      clearInterval(blinkInterval);
      document.body.style.backgroundColor = 'white';
    };
  }, [isBlinking]);

  const currentBloodLoss = monitoringData.length > 0 ? monitoringData[monitoringData.length - 1].bloodLoss : 0;
  const classification = getBloodLossClassification(currentBloodLoss);

  // Generate 24-hour trend data for the area chart
  const trendData = generateSimulatedData(Date.now(), 24 * 60).filter((_, index) => index % 30 === 0); // Every hour

  const downloadPatientHistory = () => {
    const dataStr = JSON.stringify(monitoringData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `${selectedPatient.name.replace(' ', '_')}_blood_loss_history.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (currentView === 'dashboard') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <nav className="bg-slate-800 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-8 h-8 text-blue-400" />
              Hemodrop Detector
            </h1>
            <div className="flex gap-6">
              <button 
                onClick={() => setCurrentView('dashboard')}
                className="hover:text-blue-300 transition-colors font-medium"
              >
                Dashboard
              </button>
              <button 
                onClick={() => setCurrentView('patients')}
                className="hover:text-blue-300 transition-colors font-medium"
              >
                Patients
              </button>
              <button 
                onClick={() => setCurrentView('monitoring')}
                className="hover:text-blue-300 transition-colors font-medium"
              >
                Monitoring
              </button>
            </div>
          </div>
        </nav>

        {/* Alert Banner */}
        {activeAlerts.length > 0 && (
          <div className="bg-red-600 text-white p-4 text-center font-bold text-lg animate-pulse">
            <AlertTriangle className="w-6 h-6 inline mr-2" />
            {activeAlerts[0]}
          </div>
        )}

        {/* Patient Bio Data */}
        <div className="max-w-7xl mx-auto p-6">
          <div className="bg-slate-800 text-white p-4 rounded-t-lg">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Patient Bio Data</h2>
              <button
                onClick={downloadPatientHistory}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition-colors"
              >
                <Download className="w-4 h-4" />
                Download History
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-6 rounded-b-lg shadow-lg">
            {patients.map(patient => (
              <div key={patient.id} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold text-slate-800">{patient.name}</h3>
                  <div className="flex items-center gap-2">
                    {monitoring ? (
                      <Wifi className="w-5 h-5 text-green-500" />
                    ) : (
                      <WifiOff className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div>
                    <p className="text-gray-600">DOB:</p>
                    <p className="font-medium">{patient.dob}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Gravidity:</p>
                    <p className="font-medium">{patient.gravidity}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Parity:</p>
                    <p className="font-medium">{patient.parity}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <h4 className="font-semibold text-slate-700 mb-2">Location</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Room:</p>
                      <p className="font-medium">{patient.room}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Bed:</p>
                      <p className="font-medium">{patient.bed}</p>
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <h4 className="font-semibold text-slate-700 mb-2">Delivery Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Type:</p>
                      <p className="font-medium">{patient.deliveryType}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Stage:</p>
                      <p className="font-medium">{patient.stage}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setSelectedPatient(patient);
                    setCurrentView('monitoring');
                  }}
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

  if (currentView === 'monitoring') {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <nav className="bg-slate-800 text-white p-4 shadow-lg">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-8 h-8 text-blue-400" />
              Hemodrop Detector
            </h1>
            <div className="flex gap-6">
              <button 
                onClick={() => setCurrentView('dashboard')}
                className="hover:text-blue-300 transition-colors font-medium"
              >
                Dashboard
              </button>
              <button 
                onClick={() => setCurrentView('patients')}
                className="hover:text-blue-300 transition-colors font-medium"
              >
                Patients
              </button>
              <button className="text-blue-300 font-medium">
                Monitoring
              </button>
            </div>
          </div>
        </nav>

        {/* Alert Banner */}
        {activeAlerts.length > 0 && (
          <div className="bg-red-600 text-white p-4 text-center font-bold text-lg animate-pulse">
            <AlertTriangle className="w-6 h-6 inline mr-2" />
            {activeAlerts[0]}
          </div>
        )}

        <div className="max-w-7xl mx-auto p-6">
          {/* Patient Header */}
          <div className="bg-slate-800 text-white p-4 rounded-t-lg">
            <h2 className="text-xl font-bold">
              {selectedPatient.name.toUpperCase()}
            </h2>
            <p className="text-slate-300">
              Bed: {selectedPatient.bed} - Delivery Room {selectedPatient.room} - {selectedPatient.deliveryType} Birth
            </p>
          </div>

          {/* Main Monitoring Dashboard */}
          <div className="bg-white rounded-b-lg shadow-lg p-6">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              
              {/* Current Blood Loss Display */}
              <div className="xl:col-span-1">
                <div className="text-center p-6 bg-gray-50 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">TOTAL BLOOD LOSS</h3>
                  <div className="text-6xl font-bold text-slate-800 mb-4">
                    {currentBloodLoss} <span className="text-2xl">mL</span>
                  </div>
                  <div 
                    className="px-6 py-3 rounded-full text-white font-bold text-lg"
                    style={{ backgroundColor: classification.color }}
                  >
                    {classification.level.toUpperCase()}
                  </div>
                  
                  <div className="mt-6">
                    <button
                      onClick={() => setMonitoring(!monitoring)}
                      className={`px-6 py-2 rounded font-medium transition-colors ${
                        monitoring 
                          ? 'bg-red-500 hover:bg-red-600 text-white' 
                          : 'bg-green-500 hover:bg-green-600 text-white'
                      }`}
                    >
                      {monitoring ? 'Stop Monitoring' : 'Start Monitoring'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 24-Hour Trend Chart */}
              <div className="xl:col-span-2">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold mb-2">Blood Activity (24 Hours)</h3>
                  <div className="flex gap-2 mb-4">
                    {[60, 120, 360, 720, 1440].map(minutes => (
                      <button
                        key={minutes}
                        onClick={() => setZoomLevel(minutes)}
                        className={`px-3 py-1 rounded text-sm transition-colors ${
                          zoomLevel === minutes 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-200 hover:bg-gray-300'
                        }`}
                      >
                        {minutes < 60 ? `${minutes}min` : `${minutes/60}hr`}
                      </button>
                    ))}
                  </div>
                </div>
                
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      domain={[0, 'dataMax + 50']}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip 
                      formatter={(value) => [`${value} mL`, 'Blood Loss']}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="bloodLoss"
                      stroke="#3b82f6"
                      fill="rgba(59, 130, 246, 0.3)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Live Trend Chart */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold mb-4">Live Monitoring Trend</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={monitoringData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="time"
                    tick={{ fontSize: 12 }}
                    domain={['dataMin', 'dataMax']}
                  />
                  <YAxis 
                    domain={[0, 'dataMax + 50']}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value) => [`${value} mL`, 'Blood Loss']}
                    labelFormatter={(label) => `Time: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="bloodLoss"
                    stroke="#ef4444"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
                        <tr key={index} style={{ backgroundColor: `${readingClassification.color}20` }}>
                          <td className="px-4 py-3 text-sm font-medium">{reading.time}</td>
                          <td className="px-4 py-3 text-sm">{readingClassification.level}</td>
                          <td className="px-4 py-3 text-sm font-medium">{reading.bloodLoss}mL</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-800 text-white p-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-8 h-8 text-blue-400" />
            Hemodrop Detector
          </h1>
          <div className="flex gap-6">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className="hover:text-blue-300 transition-colors font-medium"
            >
              Dashboard
            </button>
            <button className="text-blue-300 font-medium">
              Patients
            </button>
            <button 
              onClick={() => setCurrentView('monitoring')}
              className="hover:text-blue-300 transition-colors font-medium"
            >
              Monitoring
            </button>
          </div>
        </div>
      </nav>
      
      <div className="max-w-7xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Patient Management</h2>
        {/* Patient management content would go here */}
      </div>
    </div>
  );
};

export default HemoDropDashboard;