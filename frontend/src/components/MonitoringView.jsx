// src/components/MonitoringView.jsx
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { useMonitoring } from "../store/MonitoringContext";

// --- blood loss classification (same logic as dashboard) ---
const getBloodLossClassification = (bloodLoss) => {
  if (bloodLoss >= 500)
    return { level: "Major Hemorrhage", color: "#ef4445", alert: "CRITICAL" };
  if (bloodLoss >= 250)
    return { level: "Moderate Hemorrhage", color: "#f97316", alert: "WARNING" };
  if (bloodLoss >= 100)
    return { level: "Minor Hemorrhage", color: "#eab308", alert: "CAUTION" };
  return { level: "Normal bleeding", color: "#22c55e", alert: "NORMAL" };
};

const MonitoringView = ({ selectedPatient, classification, onStop }) => {
  const { data, isMonitoring, paused, togglePause, zoomLevel, setZoomLevel, startMonitoring, stopMonitoring } = useMonitoring();

  const currentBloodLoss = data.length ? data[data.length - 1].bloodLoss : 0;
  const currentClassification = classification || getBloodLossClassification(currentBloodLoss);

  const handleStart = () => {
    if (selectedPatient) {
      startMonitoring(selectedPatient);
    }
  };

  const handleStop = () => {
    stopMonitoring();
    if (onStop) {
      onStop();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-slate-800 text-white p-4 shadow-lg flex justify-between items-center">
        <h1 className="text-xl font-bold">Monitoring: {selectedPatient?.name || "Unknown Patient"}</h1>
        <div className="flex gap-2">
          {!isMonitoring ? (
            <button
              onClick={handleStart}
              className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
            >
              Start Monitoring
            </button>
          ) : (
            <>
              <button
                onClick={togglePause || (() => {})}
                className="px-3 py-1 rounded bg-yellow-500 hover:bg-yellow-600 text-white"
              >
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={handleStop}
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Classification */}
        <div
          className="p-4 rounded-lg shadow"
          style={{ backgroundColor: currentClassification.color }}
        >
          <p className="text-white font-bold text-lg">
            {currentClassification.alert}: {currentClassification.level}
          </p>
          <p className="text-white">
            Current Blood Loss: {currentBloodLoss} ml
          </p>
        </div>

        {/* Blood Loss Chart */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="font-semibold mb-2">Blood Loss Over Time</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="bloodLoss" stroke="#2563eb" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Rate of Blood Loss */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="font-semibold mb-2">Rate of Blood Loss</h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#dc2626"
                fill="#fca5a5"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Zoom Control */}
        {setZoomLevel && (
          <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
            <label className="font-medium">
              Zoom (minutes): {zoomLevel || 60}
            </label>
            <input
              type="range"
              min="10"
              max="180"
              step="10"
              value={zoomLevel || 60}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-1/2"
            />
          </div>
        )}

        {/* Alerts */}
        {currentClassification.alert !== "NORMAL" && (
          <div className="bg-red-100 p-4 rounded-lg flex items-center gap-3">
            <AlertTriangle className="text-red-600 w-6 h-6" />
            <span className="text-red-800 font-semibold">
              {currentClassification.level}! Immediate clinical attention required.
            </span>
          </div>
        )}

        {/* Connection Status */}
        <div className="bg-white p-4 rounded-lg shadow flex items-center gap-2">
          {isMonitoring ? (
            <>
              <Wifi className="text-green-600 w-5 h-5" />
              <span className="text-green-600 font-medium">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="text-gray-400 w-5 h-5" />
              <span className="text-gray-400 font-medium">Not Connected</span>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default MonitoringView;