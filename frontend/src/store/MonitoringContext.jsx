// src/store/MonitoringContext.jsx
import React, { createContext, useContext, useState, useEffect } from "react";

const MonitoringContext = createContext();

export const MonitoringProvider = ({ children }) => {
  const [data, setData] = useState([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [paused, setPaused] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(60);

  // Simulate data generation when monitoring is active
  useEffect(() => {
    let interval;
    
    if (isMonitoring && !paused) {
      interval = setInterval(() => {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        
        // Simulate blood loss data - replace with real sensor data
        const newDataPoint = {
          time: timeString,
          bloodLoss: Math.floor(Math.random() * 600), // Random for demo
          rate: Math.floor(Math.random() * 50), // Rate of change
          timestamp: now.getTime()
        };
        
        setData(prevData => {
          const updatedData = [...prevData, newDataPoint];
          // Keep only the last 100 data points to prevent memory issues
          return updatedData.slice(-100);
        });
      }, 2000); // Update every 2 seconds
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isMonitoring, paused]);

  const startMonitoring = (patient) => {
    setSelectedPatient(patient);
    setIsMonitoring(true);
    setPaused(false);
    // Reset data when starting new monitoring session
    setData([]);
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    setPaused(false);
    setSelectedPatient(null);
    // Keep data for review, don't clear it
  };

  const togglePause = () => {
    setPaused(!paused);
  };

  const contextValue = {
    data,
    isMonitoring,
    selectedPatient,
    paused,
    zoomLevel,
    startMonitoring,
    stopMonitoring,
    togglePause,
    setZoomLevel,
  };

  return (
    <MonitoringContext.Provider value={contextValue}>
      {children}
    </MonitoringContext.Provider>
  );
};

export const useMonitoring = () => {
  const context = useContext(MonitoringContext);
  if (!context) {
    throw new Error("useMonitoring must be used within a MonitoringProvider");
  }
  return context;
};